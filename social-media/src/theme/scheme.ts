import * as SecureStore from 'expo-secure-store';
import { Appearance, Platform } from 'react-native';

import { darkPalette, lightPalette, palette } from './tokens';

/**
 * Colour scheme runtime.
 *
 * Styles are declared once per module, so a scheme change cannot rely on React
 * alone: `applyColorScheme` copies the scheme into the live `palette`, bumps a
 * revision, and every style object wrapped in `themed()` rebuilds itself on its
 * next read. `ThemeProvider` then remounts the tree so each screen reads again.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const PREFERENCE_KEY = 'hootly.theme.preference';

let revision = 0;
let activeScheme: ColorScheme = 'light';

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Synchronous so the very first frame already uses the stored scheme. */
export function readThemePreference(): ThemePreference {
  try {
    const stored =
      Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(PREFERENCE_KEY)
        : SecureStore.getItem(PREFERENCE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(PREFERENCE_KEY, preference);
    else SecureStore.setItem(PREFERENCE_KEY, preference);
  } catch {
    // Storage unavailable - the choice simply lasts until the app closes.
  }
}

export function resolveColorScheme(preference: ThemePreference): ColorScheme {
  if (preference !== 'system') return preference;
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

export function getColorScheme(): ColorScheme {
  return activeScheme;
}

/** Returns true when the scheme actually changed. */
export function applyColorScheme(scheme: ColorScheme): boolean {
  if (scheme === activeScheme && revision > 0) return false;
  Object.assign(palette, scheme === 'dark' ? darkPalette : lightPalette);
  activeScheme = scheme;
  revision += 1;
  return true;
}

/**
 * Wraps a module-level object built from `palette` (a `StyleSheet.create`, a
 * tone map) so it is rebuilt after a scheme change instead of keeping the
 * colours it was first created with.
 */
export function themed<T extends object>(factory: () => T): T {
  let cache: T | undefined;
  let builtAt = -1;
  const current = (): T => {
    if (cache === undefined || builtAt !== revision) {
      cache = factory();
      builtAt = revision;
    }
    return cache;
  };
  return new Proxy({} as T, {
    get: (_target, key) => Reflect.get(current(), key),
    has: (_target, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

applyColorScheme(resolveColorScheme(readThemePreference()));
