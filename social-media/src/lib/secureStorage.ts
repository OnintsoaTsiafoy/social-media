import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token storage. The JWT goes to the device keychain / keystore, never to plain
 * AsyncStorage, and is never rendered anywhere in the UI.
 *
 * `expo-secure-store` has no web implementation, so on web we fall back to
 * `sessionStorage` - cleared when the tab closes, which is the safest option
 * available there.
 */

const TOKEN_KEY = 'hootly.session.token';

const webStore = {
  get(key: string): string | null {
    try {
      return globalThis.sessionStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      globalThis.sessionStorage?.setItem(key, value);
    } catch {
      // Storage unavailable (private mode) - the session simply won't persist.
    }
  },
  remove(key: string) {
    try {
      globalThis.sessionStorage?.removeItem(key);
    } catch {
      // Nothing to clean up.
    }
  },
};

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore.set(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function readToken(): Promise<string | null> {
  if (Platform.OS === 'web') return webStore.get(TOKEN_KEY);
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // A corrupt or unreadable entry is treated as "no session".
    return null;
  }
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    webStore.remove(TOKEN_KEY);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone.
  }
}
