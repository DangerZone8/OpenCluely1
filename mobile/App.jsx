import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { requestAssistantReply } from './src/chat-api';

const INSTALL_ID_KEY = 'slickly.mobile.install-id';

export default function App() {
  const [installId, setInstallId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        let id = await SecureStore.getItemAsync(INSTALL_ID_KEY);
        if (!id) {
          id = Crypto.randomUUID();
          await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
        }
        if (active) setInstallId(id);
      } catch {
        if (active) setError('Secure app setup failed. Check device storage permissions and restart Slickly.');
      } finally {
        if (active) setInitializing(false);
      }
    }
    initialize();
    return () => { active = false; };
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
      const answer = await requestAssistantReply({ messages: nextMessages, installId });
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
              <Text style={styles.brand}>SLICKLY</Text>
              <Text style={styles.subtitle}>AI assistant · Mobile</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear conversation"
            disabled={sending || messages.length === 0}
            onPress={clearConversation}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed, (sending || messages.length === 0) && styles.disabled]}
          >
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>

        {initializing ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#a78bfa" size="large" />
            <Text style={styles.stateText}>Preparing secure session…</Text>
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
            editable={!initializing && !sending && !!installId}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!draft.trim() || sending || !installId}
            onPress={sendMessage}
            style={({ pressed }) => [styles.sendButton, pressed && styles.pressed, (!draft.trim() || sending || !installId) && styles.disabled]}
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
