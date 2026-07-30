import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FeedbackProvider } from '@/components/ui';
import { ComposerProvider } from '@/store/ComposerProvider';
import { SessionProvider } from '@/store/SessionProvider';
import { palette } from '@/theme';

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
          <FeedbackProvider>
            <ComposerProvider>
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.white },
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
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
