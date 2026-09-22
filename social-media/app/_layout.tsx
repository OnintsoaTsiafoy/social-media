import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FeedbackProvider } from '@/components/ui';
import { notificationsApi } from '@/data/api';
import {
  hrefFor,
  registerForPushNotifications,
  subscribeToForegroundNotifications,
  subscribeToNotificationTaps,
  subscribeToTokenRefresh,
} from '@/lib/pushNotifications';
import { ComposerProvider } from '@/store/ComposerProvider';
import { SessionProvider, useSession } from '@/store/SessionProvider';
import { ThemeProvider } from '@/store/ThemeProvider';
import { palette } from '@/theme';

/**
 * Sprint 11 — branche Firebase Cloud Messaging sur la session courante.
 * Rendu à l'intérieur de `SessionProvider` : un accès push n'a de sens
 * qu'une fois connecté (l'enregistrement du token exige un utilisateur
 * authentifié côté API).
 */
function PushNotificationsBridge() {
  const router = useRouter();
  const { status, unreadCount, refreshUnreadCount } = useSession();

  // Le badge natif de l'icône (au-delà du badge dans l'app, déjà tenu par
  // `unreadCount` côté SessionProvider) doit refléter le VRAI compteur
  // serveur, pas seulement s'incrémenter à chaque réception — sinon il
  // dérive dès qu'une notification est lue ou marquée lue ailleurs.
  useEffect(() => {
    void Notifications.setBadgeCountAsync(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (status !== 'signedIn') return undefined;

    void registerForPushNotifications();
    const unsubscribeRefresh = subscribeToTokenRefresh();

    // Premier plan : rien à afficher soi-même (le handler global s'en
    // charge), seul le compteur non lu doit rester à jour.
    const unsubscribeForeground = subscribeToForegroundNotifications(() => {
      void refreshUnreadCount();
    });

    // Appui sur la notification (arrière-plan ou application relancée
    // depuis fermée) : on recharge toujours la ressource via l'API avant
    // d'agir — ici, marquer la notification lue avant d'ouvrir l'écran
    // cible, jamais faire confiance au contenu du push lui-même.
    const unsubscribeTaps = subscribeToNotificationTaps((data) => {
      void (async () => {
        if (data.notificationId) {
          await notificationsApi.markRead(data.notificationId).catch(() => undefined);
        }
        await refreshUnreadCount();
        router.push(hrefFor(data) as Href);
      })();
    });

    return () => {
      unsubscribeRefresh();
      unsubscribeForeground();
      unsubscribeTaps();
    };
  }, [status, refreshUnreadCount, router]);

  // Jour 5 — reprise REST après une absence : un push manqué (application
  // fermée sans réveil, appareil hors ligne) ne doit pas laisser le
  // compteur en retard indéfiniment. Le retour au premier plan revérifie
  // toujours via l'API, jamais seulement via ce que le push a pu livrer.
  useEffect(() => {
    if (status !== 'signedIn') return undefined;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshUnreadCount();
    });
    return () => subscription.remove();
  }, [status, refreshUnreadCount]);

  return null;
}

// Keep the native splash up until the fonts are ready, so the first frame is
// never rendered with a fallback typeface.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    // Hide on error too: a missing font must not leave the user on a blank screen.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <PushNotificationsBridge />
          <ThemeProvider>
            <FeedbackProvider>
              <ComposerProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: palette.background },
                    animation: 'slide_from_right',
                  }}
                >
                  <Stack.Screen name="index" options={{ animation: 'none' }} />
                  <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
                  <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />

                  {/* Bottom-sheet style flows presented over the current screen. */}
                  <Stack.Screen
                    name="media-picker"
                    options={{ presentation: 'transparentModal', animation: 'none' }}
                  />
                  <Stack.Screen
                    name="hashtags"
                    options={{ presentation: 'transparentModal', animation: 'none' }}
                  />
                  <Stack.Screen name="comments/[id]/response" options={{ presentation: 'modal' }} />
                </Stack>
              </ComposerProvider>
            </FeedbackProvider>
          </ThemeProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
