import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const secureStorage = {
  getItem: key => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: key => SecureStore.deleteItemAsync(key)
};

export async function createSlicklySupabase(fetchImpl = fetch) {
  const response = await fetchImpl('https://slicklyai.vercel.app/api/public-config', { cache: 'no-store' });
  const config = await response.json().catch(() => ({}));
  if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error(config.error || 'Slickly sign-in is temporarily unavailable. Please try again later.');
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce'
    }
  });
}

export async function signInWithGoogle(supabase) {
  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true }
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Slickly could not start Google sign-in. Please try again.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) {
    throw new Error(result.type === 'cancel' ? 'Google sign-in was cancelled.' : 'Google sign-in did not complete.');
  }
  const { queryParams } = Linking.parse(result.url);
  const code = queryParams?.code;
  if (typeof code !== 'string' || !code) {
    throw new Error('Google sign-in did not return a valid authorization code.');
  }
  const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  if (!sessionData?.session) throw new Error('Slickly could not establish your account session.');
  return sessionData.session;
}
