import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import { requestAssistantReply } from './src/chat-api';
import { createSlicklySupabase, signInWithGoogle } from './src/supabase';

const INSTALL_ID_KEY = 'slickly.mobile.install-id';

export default function App() {
  const [installId, setInstallId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const [cloudAnnouncement, setCloudAnnouncement] = useState('');
  const [cloudAnnouncementUrl, setCloudAnnouncementUrl] = useState('');
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('signin');
  const [authBusy, setAuthBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    let active = true;
    let authSubscription;
    async function initialize() {
      try {
        let id = await SecureStore.getItemAsync(INSTALL_ID_KEY);
        if (!id) {
          id = Crypto.randomUUID();
          await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
        }
        if (active) setInstallId(id);
        const client = await createSlicklySupabase();
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!active) return;
        setSupabase(client);
        setSession(data.session || null);
        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          if (active) setSession(nextSession || null);
        });
        authSubscription = listener.data.subscription;
      } catch (initError) {
        if (active) setError(initError?.message || 'Secure Slickly account setup failed. Please restart the app.');
      } finally {
        if (active) setInitializing(false);
      }
    }
    initialize();
    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer;
    async function refreshCloudContent() {
      let nextDelay = 15 * 60 * 1000;
      try {
        const response = await fetch('https://slicklyai.vercel.app/api/cloud-config', {
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Cloud content is unavailable.');
        const config = await response.json();
        const enabled = config?.features?.cloudConfig !== false;
        const presentation = config?.presentation && typeof config.presentation === 'object'
          ? config.presentation : {};
        const announcement = enabled && typeof presentation.announcement === 'string'
          ? presentation.announcement.trim().slice(0, 240) : '';
        const candidateUrl = typeof presentation.announcementUrl === 'string'
          ? presentation.announcementUrl.trim() : '';
        const safeUrl = /^https:\/\/(?:slicklyai\.vercel\.app|github\.com\/DangerZone8\/OpenCluely1)(?:\/|$)/.test(candidateUrl)
          ? candidateUrl : '';
        if (active) {
          setCloudAnnouncement(announcement);
          setCloudAnnouncementUrl(safeUrl);
        }
        if (Number.isInteger(config.pollIntervalMs) &&
            config.pollIntervalMs >= 60000 && config.pollIntervalMs <= 86400000) {
          nextDelay = config.pollIntervalMs;
        }
      } catch (_) {
        // Keep the last known announcement visible and retry later while offline.
      } finally {
        if (active) timer = setTimeout(refreshCloudContent, nextDelay);
      }
    }
    refreshCloudContent();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending || !installId) return;

    const userMessage = { id: Crypto.randomUUID(), role: 'user', text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    setError('');

    try {
      const answer = await requestAssistantReply({ messages: nextMessages, installId, accessToken: session?.access_token });
      setMessages(current => [...current, {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: answer
      }]);
    } catch (requestError) {
      setError(requestError?.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }

  async function submitEmailAuth() {
    if (!supabase || authBusy) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail || password.length < 8) {
      setError('Enter a valid email and a password with at least 8 characters.');
      return;
    }
    setAuthBusy(true);
    setError('');
    try {
      if (authMode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: Linking.createURL('auth/callback') }
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setError('Your account was created. If email confirmation is enabled, finish the confirmation step, then sign in.');
        } else {
          setSession(data.session);
          setPassword('');
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        });
        if (signInError) throw signInError;
        setSession(data.session);
        setPassword('');
      }
    } catch (authError) {
      setError(authError?.message || 'Slickly could not complete email sign-in.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitGoogleAuth() {
    if (!supabase || authBusy) return;
    setAuthBusy(true);
    setError('');
    try {
      const nextSession = await signInWithGoogle(supabase);
      setSession(nextSession);
    } catch (authError) {
      setError(authError?.message || 'Slickly could not complete Google sign-in.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!supabase || sending) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    else {
      setSession(null);
      setMessages([]);
    }
  }

  function clearConversation() {
    if (sending) return;
    setMessages([]);
    setError('');
  }

  function renderMessage({ item }) {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={styles.messageRole}>{isUser ? 'YOU' : 'SLICKLY'}</Text>
          <Text selectable style={styles.messageText}>{item.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <Image source={require('./assets/icon.png')} style={styles.brandIcon} accessibilityLabel="Slickly logo" />
            <View>
              <Text style={styles.brand}>SLICKLYAI</Text>
              <Text style={styles.subtitle}>AI assistant · Mobile</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://slicklyai.vercel.app/pricing.html')} style={styles.clearButton}>
              <Text style={styles.clearText}>Plans</Text>
            </Pressable>
            {session ? (
              <>
                <Pressable accessibilityRole="button" disabled={sending || messages.length === 0} onPress={clearConversation} style={[styles.clearButton, (sending || messages.length === 0) && styles.disabled]}>
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={sending} onPress={signOut} style={styles.clearButton}>
                  <Text style={styles.clearText}>Sign out</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>

        {!!cloudAnnouncement && (
          <View style={styles.liveNotice}>
            <View style={styles.liveNoticeCopy}>
              <Text style={styles.liveNoticeLabel}>SLICKLY LIVE</Text>
              <Text style={styles.liveNoticeText}>{cloudAnnouncement}</Text>
            </View>
            {!!cloudAnnouncementUrl && (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(cloudAnnouncementUrl).catch(() => {})} style={styles.liveNoticeLink}>
                <Text style={styles.liveNoticeLinkText}>Open ↗</Text>
              </Pressable>
            )}
          </View>
        )}

        {initializing ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#a78bfa" size="large" />
            <Text style={styles.stateText}>Preparing secure account session…</Text>
          </View>
        ) : !session ? (
          <View style={styles.authState}>
            <Image source={require('./assets/icon.png')} style={styles.welcomeLogo} accessibilityLabel="SlicklyAI logo" />
            <Text style={styles.welcomeTitle}>Welcome to SlicklyAI</Text>
            <Text style={styles.welcomeBody}>Sign in to sync your account and credits across your devices.</Text>
            <Pressable accessibilityRole="button" disabled={!supabase || authBusy} onPress={submitGoogleAuth} style={[styles.authButton, styles.googleButton, (!supabase || authBusy) && styles.disabled]}>
              <Text style={styles.authButtonText}>{authBusy ? 'Please wait…' : 'Continue with Google'}</Text>
            </Pressable>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor="#71717a" autoCapitalize="none" keyboardType="email-address" autoComplete="email" style={styles.authInput} editable={!authBusy} />
            <TextInput value={password} onChangeText={setPassword} placeholder="Password (8+ characters)" placeholderTextColor="#71717a" secureTextEntry autoComplete={authMode === 'signup' ? 'new-password' : 'password'} style={styles.authInput} editable={!authBusy} />
            <Pressable accessibilityRole="button" disabled={!supabase || authBusy} onPress={submitEmailAuth} style={[styles.authButton, (!supabase || authBusy) && styles.disabled]}>
              <Text style={styles.authButtonText}>{authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account with email' : 'Sign in with email'}</Text>
            </Pressable>
            <Pressable onPress={() => { setAuthMode(mode => mode === 'signin' ? 'signup' : 'signin'); setError(''); }}>
              <Text style={styles.authSwitch}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New to SlicklyAI? Create an account'}</Text>
            </Pressable>
            <Text style={styles.pricingNote}>Free to start · Pro ₹399/month · 1,000 shared monthly AI credits</Text>
            <Pressable onPress={() => Linking.openURL('https://slicklyai.vercel.app/pricing.html')}>
              <Text style={styles.authSwitch}>Compare all plans and features ↗</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Image source={require('./assets/icon.png')} style={styles.welcomeLogo} accessibilityLabel="Slickly logo" />
                <Text style={styles.welcomeTitle}>What can I help with?</Text>
                <Text style={styles.welcomeBody}>Ask a question, explore an idea, or work through a problem. Your conversation stays available in this session.</Text>
                <View style={styles.suggestion}>
                  <Text style={styles.suggestionText}>Explain a difficult concept in simple terms</Text>
                </View>
                <View style={styles.suggestion}>
                  <Text style={styles.suggestionText}>Help me plan and improve an idea</Text>
                </View>
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={item => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messageList}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
              />
            )}

            {sending && (
              <View style={styles.thinking}>
                <ActivityIndicator color="#a78bfa" size="small" />
                <Text style={styles.thinkingText}>Slickly is thinking…</Text>
              </View>
            )}
          </>
        )}

        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}

        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Message Slickly"
            value={draft}
            onChangeText={setDraft}
            placeholder="Message Slickly…"
            placeholderTextColor="#71717a"
            multiline
            maxLength={12000}
            editable={!initializing && !sending && !!installId && !!session}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!draft.trim() || sending || !installId || !session}
            onPress={sendMessage}
            style={({ pressed }) => [styles.sendButton, pressed && styles.pressed, (!draft.trim() || sending || !installId || !session) && styles.disabled]}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
        <Text style={styles.disclaimer}>Messages and recent chat context are sent securely to Slickly’s hosted AI service. Don’t share passwords or sensitive information.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' },
  screen: { flex: 1, backgroundColor: '#09090b' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  authState: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 18 },
  authButton: { backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  googleButton: { backgroundColor: '#27272a', borderWidth: 1, borderColor: '#52525b' },
  authButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  authInput: { backgroundColor: '#18181b', borderWidth: 1, borderColor: '#3f3f46', borderRadius: 12, color: '#fafafa', paddingHorizontal: 14, paddingVertical: 13, marginTop: 10 },
  authSwitch: { color: '#c4b5fd', textAlign: 'center', marginTop: 16, fontSize: 12, fontWeight: '600' },
  pricingNote: { color: '#a1a1aa', textAlign: 'center', fontSize: 11, marginTop: 18, lineHeight: 17 },
  liveNotice: { marginHorizontal: 14, marginTop: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#5b4a24', backgroundColor: '#211b10', flexDirection: 'row', alignItems: 'center', gap: 12 },
  liveNoticeCopy: { flex: 1 },
  liveNoticeLabel: { color: '#f5d76e', fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4 },
  liveNoticeText: { color: '#f4e9c8', fontSize: 13, lineHeight: 19 },
  liveNoticeLink: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: '#3b2f18' },
  liveNoticeLinkText: { color: '#f5d76e', fontSize: 11, fontWeight: '700' },
  header: {
    minHeight: 72, paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#27272a',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: { width: 38, height: 38 },
  welcomeLogo: { width: 64, height: 64, marginBottom: 20 },
  brand: { color: '#fafafa', fontSize: 17, fontWeight: '800', letterSpacing: 2.4 },
  subtitle: { color: '#a1a1aa', fontSize: 12, marginTop: 3 },
  clearButton: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#3f3f46' },
  clearText: { color: '#d4d4d8', fontSize: 12, fontWeight: '600' },
  emptyState: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, paddingBottom: 28 },
  welcomeTitle: { color: '#fafafa', fontSize: 28, lineHeight: 34, fontWeight: '700', marginBottom: 10 },
  welcomeBody: { color: '#a1a1aa', fontSize: 15, lineHeight: 23, marginBottom: 26 },
  suggestion: { borderWidth: 1, borderColor: '#27272a', borderRadius: 13, padding: 14, marginTop: 9, backgroundColor: '#111114' },
  suggestionText: { color: '#d4d4d8', fontSize: 13 },
  messageList: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14 },
  messageRow: { width: '100%', marginBottom: 14 },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  messageBubble: { maxWidth: '90%', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 12 },
  userBubble: { backgroundColor: '#30265a', borderBottomRightRadius: 5 },
  assistantBubble: { backgroundColor: '#18181b', borderWidth: 1, borderColor: '#303036', borderBottomLeftRadius: 5 },
  messageRole: { color: '#c4b5fd', fontSize: 9, fontWeight: '800', letterSpacing: 1.3, marginBottom: 7 },
  messageText: { color: '#f4f4f5', fontSize: 15, lineHeight: 23 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20, paddingBottom: 10 },
  thinkingText: { color: '#a1a1aa', fontSize: 12 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  stateText: { color: '#a1a1aa', fontSize: 13 },
  composer: {
    marginHorizontal: 14, marginTop: 8, padding: 8, minHeight: 58,
    borderWidth: 1, borderColor: '#3f3f46', borderRadius: 17,
    backgroundColor: '#141417', flexDirection: 'row', alignItems: 'flex-end'
  },
  input: { flex: 1, color: '#fafafa', fontSize: 15, lineHeight: 21, maxHeight: 130, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 8 },
  sendButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center', marginLeft: 7 },
  sendText: { color: '#fff', fontSize: 25, lineHeight: 29, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  error: { color: '#fca5a5', fontSize: 12, lineHeight: 17, paddingHorizontal: 20, paddingTop: 8 },
  disclaimer: { color: '#71717a', fontSize: 10, lineHeight: 14, textAlign: 'center', paddingHorizontal: 22, paddingTop: 9, paddingBottom: 9 }
});
