import { Platform } from 'react-native';
import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';

export const SlicklyNative = requireNativeModule('SlicklyNative');

export const SlicklyBroadcastPicker = Platform.OS === 'ios'
  ? requireNativeViewManager('SlicklyNative', 'SlicklyBroadcastPicker')
  : null;
