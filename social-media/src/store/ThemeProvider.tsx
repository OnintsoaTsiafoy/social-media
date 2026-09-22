import { usePathname, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Appearance } from 'react-native';

import {
  applyColorScheme,
  getColorScheme,
  palette,
  readThemePreference,
  resolveColorScheme,
  saveThemePreference,
  type ColorScheme,
  type ThemePreference,
} from '@/theme';

type ThemeValue = {
  /** What the user picked: follow the system, or force a scheme. */
  preference: ThemePreference;
  /** The scheme actually on screen. */
  scheme: ColorScheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

/**
 * Thème clair / sombre / système.
 *
 * Les styles sont figés au niveau des modules : changer de thème recopie la
 * palette active (`applyColorScheme`), puis remonte l'arbre sous ce provider
 * pour que chaque écran relise ses couleurs. La session reste au-dessus et
 * n'est donc pas relue ; l'écran courant est rouvert juste après le remontage.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);
  const [scheme, setScheme] = useState<ColorScheme>(getColorScheme);
  const [revision, setRevision] = useState(0);

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const returnTo = useRef<string | null>(null);

  const switchTo = useCallback((next: ColorScheme) => {
    if (!applyColorScheme(next)) return;
    returnTo.current = pathnameRef.current;
    setScheme(next);
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.background);
  }, [scheme]);

  // "Système" : suit le réglage du téléphone tant qu'il est choisi.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    switchTo(resolveColorScheme('system'));
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      switchTo(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => subscription.remove();
  }, [preference, switchTo]);

  // Le remontage repart de `/` : on revient sur l'écran où l'utilisateur était.
  useEffect(() => {
    const target = returnTo.current;
    if (!target || target === '/') return undefined;
    returnTo.current = null;
    const timer = setTimeout(() => router.replace(target as Href), 0);
    return () => clearTimeout(timer);
  }, [revision, router]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      saveThemePreference(next);
      setPreferenceState(next);
      switchTo(resolveColorScheme(next));
    },
    [switchTo]
  );

  const value = useMemo(() => ({ preference, scheme, setPreference }), [preference, scheme, setPreference]);

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Fragment key={revision}>{children}</Fragment>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
