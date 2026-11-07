import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, FlatList, Image, KeyboardAvoidingView, Platform,
  Pressable, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View
} from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import { requestAssistantReply, requestScreenAnalysis } from './src/chat-api';
import { SlicklyNative, SlicklyBroadcastPicker } from './src/native';

const INSTALL_ID_KEY = 'slickly.mobile.install-id';

export default function App() {
  const [installId, setInstallId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const [screenReady, setScreenReady] = useState(false);
  const [platformHint, setPlatformHint] = useState('');
  const listRef = useRef(null);
  const lastBroadcastCapture = useRef(null);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        let id = await SecureStore.getItemAsync(INSTALL_ID_KEY);
        if (!id) {
          id = Crypto.randomUUID();
          await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
        }
        await SlicklyNative.setInstallId(id).catch(() => {});
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

  async function enableFloatingOverlay() {
    if (Platform.OS !== 'android' || !installId) return;
    try {
      const permitted = await SlicklyNative.hasOverlayPermission();
      if (!permitted) {
        await SlicklyNative.requestOverlayPermission();
        setPlatformHint('Allow Slickly to display over other apps in Android Settings, then tap Floating assistant again.');
        return;
      }
      await SlicklyNative.setInstallId(installId);
      await SlicklyNative.startOverlay();
      setPlatformHint('Floating assistant is active. Use the movable Slickly bubble above other apps.');
    } catch (nativeError) {
      setError(nativeError?.message || 'Could not start the floating assistant.');
    }
  }

  async function stopFloatingOverlay() {
    try {
      await SlicklyNative.stopOverlay();
      setPlatformHint('Floating assistant stopped.');
    } catch (nativeError) {
      setError(nativeError?.message || 'Could not stop the floating assistant.');
    }
  }

  async function refreshBroadcastScreenContext() {
    if (Platform.OS !== 'ios') return;
    try {
      const latest = await SlicklyNative.readLatestScreenContext();
      if (latest?.text && latest.capturedAt && lastBroadcastCapture.current !== latest.capturedAt) {
        lastBroadcastCapture.current = latest.capturedAt;
        setMessages(current => [...current, {
          id: Crypto.randomUUID(),
          role: 'assistant',
          text: 'SCREEN AI — broadcast screen analyzed\n' + latest.text + '\n\nAsk a follow-up question about this captured screen.'
        }]);
        setScreenReady(true);
        setPlatformHint('Latest ReplayKit screen capture loaded. Follow-up questions can use this context.');
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      } else if (latest?.status) {
        setPlatformHint(latest.status);
      } else {
        setPlatformHint('Start the screen broadcast, switch to the app you want Slickly to inspect, stop the broadcast, then return here and load the result.');
      }
    } catch (nativeError) {
      setError(nativeError?.message || 'Could not load the latest screen broadcast.');
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refreshBroadcastScreenContext();
    });
    return () => subscription.remove();
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
      setMessages(current => [...current, { id: Crypto.randomUUID(), role: 'assistant', text: answer }]);
    } catch (requestError) {
      setError(requestError?.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }

  async function startScreenAI() {
    if (sending || !installId) return;
    setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo-library access to choose a screenshot for Screen AI.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.72,
        base64: true
      });
      if (picked.canceled || !picked.assets?.[0]?.base64) return;
      setSending(true);
      setScreenReady(false);
      const asset = picked.assets[0];
      const answer = await requestScreenAnalysis({
        imageBase64: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
        prompt: 'Analyze this screenshot for Slickly Screen AI. Describe what is visible, extract the key text, and if it contains a question or task, identify exactly what is being asked. Be ready to answer follow-up questions about this same screenshot.',
        history: messages,
        installId
      });
      const contextMessage = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: 'SCREEN AI — screenshot analyzed\n' + answer + '\n\nI’ll use this captured-screen context for your follow-up questions in this conversation.'
      };
      setMessages(current => [...current, contextMessage]);
      setScreenReady(true);
    } catch (requestError) {
      setError(requestError?.message || 'Screen AI could not analyze that screenshot.');
    } finally {
      setSending(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }

  function clearConversation() {
    if (sending) return;
    setMessages([]);
    setError('');
    setScreenReady(false);
  }

  function renderMessage({ item }) {
    const isUser = item.role === 'user';
    const isScreen = item.text.startsWith('SCREEN AI —');
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble, isScreen && styles.screenBubble]}>
          <Text style={styles.messageRole}>{isUser ? 'YOU' : isScreen ? 'SCREEN AI' : 'SLICKLY'}</Text>
          <Text selectable style={styles.messageText}>{isScreen ? item.text.replace('SCREEN AI — screenshot analyzed\n', '') : item.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#09090b" />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <Image source={require('./assets/icon.png')} style={styles.brandIcon} accessibilityLabel="Slickly logo" />
            <View><Text style={styles.brand}>SLICKLY</Text><Text style={styles.subtitle}>AI assistant · Mobile</Text></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Clear conversation" disabled={sending || messages.length === 0} onPress={clearConversation} style={styles.clearButton}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>

        {initializing ? (
          <View style={styles.centerState}><ActivityIndicator color="#a78bfa" size="large" /><Text style={styles.stateText}>Preparing secure session…</Text></View>
        ) : (
          <>
            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Image source={require('./assets/icon.png')} style={styles.welcomeLogo} accessibilityLabel="Slickly logo" />
                <Text style={styles.welcomeTitle}>Your AI, wherever you work.</Text>
                <Text style={styles.welcomeBody}>Chat with Slickly or share a screenshot to let Screen AI understand what you’re looking at.</Text>
                <Pressable accessibilityRole="button" onPress={startScreenAI} style={styles.screenCard}>
                  <Text style={styles.screenCardIcon}>▣</Text>
                  <View style={{flex: 1}}><Text style={styles.screenCardTitle}>Open Screen AI</Text><Text style={styles.screenCardBody}>Choose a screenshot · Ask follow-up questions</Text></View>
                  <Text style={styles.cardArrow}>›</Text>
                </Pressable>
                <View style={styles.suggestion}><Text style={styles.suggestionText}>Explain a difficult concept in simple terms</Text></View>
                <View style={styles.suggestion}><Text style={styles.suggestionText}>Help me plan and improve an idea</Text></View>
              </View>
            ) : (
              <FlatList ref={listRef} data={messages} keyExtractor={item => item.id} renderItem={renderMessage} contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled" onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })} />
            )}
            {sending && <View style={styles.thinking}><ActivityIndicator color="#a78bfa" size="small" /><Text style={styles.thinkingText}>Slickly is thinking…</Text></View>}
          </>
        )}

        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {screenReady && <Text style={styles.contextStatus}>● Screen context active · Follow-up questions enabled</Text>}
        {!!platformHint && <Text style={styles.platformHint}>{platformHint}</Text>}
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" onPress={startScreenAI} disabled={sending || initializing} style={[styles.screenButton, sending && styles.disabled]}>
            <Text style={styles.screenButtonText}>▣  Screen AI</Text>
          </Pressable>
          <Text style={styles.actionHint}>Choose a screenshot for instant Screen AI analysis</Text>
        </View>
        {Platform.OS === 'android' ? (
          <View style={styles.platformActionRow}>
            <Pressable accessibilityRole="button" onPress={enableFloatingOverlay} disabled={initializing || !installId} style={styles.platformButton}>
              <Text style={styles.platformButtonText}>Enable floating assistant</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={stopFloatingOverlay} style={styles.platformButtonSecondary}>
              <Text style={styles.platformButtonText}>Stop</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.platformActionRow}>
            <SlicklyBroadcastPicker preferredExtension="ai.slickly.mobile.SlicklyScreenBroadcast" style={styles.broadcastPicker} />
            <Pressable accessibilityRole="button" onPress={refreshBroadcastScreenContext} style={styles.platformButton}>
              <Text style={styles.platformButtonText}>Load screen result</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.composer}>
          <TextInput accessibilityLabel="Message Slickly" value={draft} onChangeText={setDraft} placeholder="Ask Slickly anything…" placeholderTextColor="#71717a" multiline maxLength={12000} editable={!initializing && !sending && !!installId} style={styles.input} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim() || sending || !installId} onPress={sendMessage} style={[styles.sendButton, (!draft.trim() || sending || !installId) && styles.disabled]}>
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
        <Text style={styles.disclaimer}>Screen AI only analyzes screenshots you choose. It does not silently record your screen. Avoid sharing passwords or sensitive information.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#09090b'}, screen:{flex:1,backgroundColor:'#09090b'},
  header:{minHeight:72,paddingHorizontal:20,paddingVertical:14,borderBottomWidth:1,borderBottomColor:'#27272a',flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  brandLockup:{flexDirection:'row',alignItems:'center',gap:10},brandIcon:{width:38,height:38},welcomeLogo:{width:64,height:64,marginBottom:20},
  brand:{color:'#fafafa',fontSize:17,fontWeight:'800',letterSpacing:2.4},subtitle:{color:'#a1a1aa',fontSize:12,marginTop:3},
  clearButton:{paddingHorizontal:13,paddingVertical:8,borderRadius:10,borderWidth:1,borderColor:'#3f3f46'},clearText:{color:'#d4d4d8',fontSize:12,fontWeight:'600'},
  emptyState:{flex:1,justifyContent:'center',paddingHorizontal:22,paddingBottom:22},welcomeTitle:{color:'#fafafa',fontSize:27,lineHeight:34,fontWeight:'700',marginBottom:10},
  welcomeBody:{color:'#a1a1aa',fontSize:14,lineHeight:22,marginBottom:18},screenCard:{borderWidth:1,borderColor:'#6d55b8',borderRadius:16,padding:15,marginBottom:9,backgroundColor:'#1c1730',flexDirection:'row',alignItems:'center',gap:12},
  screenCardIcon:{color:'#c4b5fd',fontSize:25},screenCardTitle:{color:'#f5f3ff',fontSize:14,fontWeight:'700'},screenCardBody:{color:'#b4a8d8',fontSize:11,marginTop:4},cardArrow:{color:'#c4b5fd',fontSize:26},
  suggestion:{borderWidth:1,borderColor:'#27272a',borderRadius:13,padding:14,marginTop:9,backgroundColor:'#111114'},suggestionText:{color:'#d4d4d8',fontSize:13},
  messageList:{paddingHorizontal:16,paddingTop:18,paddingBottom:14},messageRow:{width:'100%',marginBottom:14},userRow:{alignItems:'flex-end'},assistantRow:{alignItems:'flex-start'},
  messageBubble:{maxWidth:'92%',borderRadius:16,paddingHorizontal:15,paddingVertical:12},userBubble:{backgroundColor:'#30265a',borderBottomRightRadius:5},assistantBubble:{backgroundColor:'#18181b',borderWidth:1,borderColor:'#303036',borderBottomLeftRadius:5},screenBubble:{borderColor:'#7054b8',backgroundColor:'#1a1627'},
  messageRole:{color:'#c4b5fd',fontSize:9,fontWeight:'800',letterSpacing:1.3,marginBottom:7},messageText:{color:'#f4f4f5',fontSize:15,lineHeight:23},
  thinking:{flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:20,paddingBottom:10},thinkingText:{color:'#a1a1aa',fontSize:12},
  centerState:{flex:1,alignItems:'center',justifyContent:'center',gap:14},stateText:{color:'#a1a1aa',fontSize:13},
  actionRow:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingTop:10},screenButton:{borderWidth:1,borderColor:'#6d55b8',borderRadius:11,paddingHorizontal:13,paddingVertical:9,backgroundColor:'#1c1730'},screenButtonText:{color:'#ddd6fe',fontSize:12,fontWeight:'700'},actionHint:{color:'#71717a',fontSize:10,flex:1},
  contextStatus:{color:'#86efac',fontSize:10,paddingHorizontal:18,paddingTop:8},
  platformHint:{color:'#c4b5fd',fontSize:10,lineHeight:15,paddingHorizontal:18,paddingTop:6},
  platformActionRow:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:8},
  platformButton:{borderWidth:1,borderColor:'#62508c',borderRadius:10,paddingHorizontal:11,paddingVertical:9,backgroundColor:'#1c1730'},
  platformButtonSecondary:{borderWidth:1,borderColor:'#3f3f46',borderRadius:10,paddingHorizontal:12,paddingVertical:9},
  platformButtonText:{color:'#ddd6fe',fontSize:10,fontWeight:'700'},
  broadcastPicker:{width:155,height:40},
  composer:{marginHorizontal:14,marginTop:8,padding:8,minHeight:58,borderWidth:1,borderColor:'#3f3f46',borderRadius:17,backgroundColor:'#141417',flexDirection:'row',alignItems:'flex-end'},
  input:{flex:1,color:'#fafafa',fontSize:15,lineHeight:21,maxHeight:130,paddingHorizontal:10,paddingTop:9,paddingBottom:8},
  sendButton:{width:40,height:40,borderRadius:12,backgroundColor:'#8b5cf6',alignItems:'center',justifyContent:'center',marginLeft:7},sendText:{color:'#fff',fontSize:25,lineHeight:29,fontWeight:'700'},
  disabled:{opacity:0.4},error:{color:'#fca5a5',fontSize:12,lineHeight:17,paddingHorizontal:20,paddingTop:8},
  disclaimer:{color:'#71717a',fontSize:10,lineHeight:14,textAlign:'center',paddingHorizontal:22,paddingTop:9,paddingBottom:9}
});
