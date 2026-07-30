import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';

import { Button, Screen, Text } from '@/components/ui';
import { useSession } from '@/store/SessionProvider';
import { palette, radius, spacing } from '@/theme';

/**
 * ÉCRAN 01 - Splash / Initialisation (`/`)
 *
 * Validates the stored session before routing anywhere. The user is never left
 * waiting indefinitely: the restore call is time-boxed by `SessionProvider`,
 * and a failure surfaces a retry instead of a dead screen.
 */
export default function SplashRoute() {
  const { status, restoreError, restore } = useSession();

  if (status === 'signedIn') return <Redirect href="/home" />;
  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <>
      <StatusBar style="light" />
      <Screen dark centred>
        <View style={styles.content}>
          <View style={styles.logo}>
            <View style={styles.logoDot} />
          </View>

          <Text variant="display" weight="extrabold" color={palette.white}>
            Hootly
          </Text>

          {restoreError ? (
            <View style={styles.errorBlock}>
              <View accessibilityRole="alert" style={styles.errorNotice}>
                <Text variant="footnote" color="rgba(255,255,255,0.74)">
                  {restoreError}
                </Text>
              </View>
              <Button
                label="Réessayer"
                variant="secondary"
                icon="sync"
                onPress={restore}
                block
                labelColor={palette.white}
                style={styles.retryButton}
              />
            </View>
          ) : (
            <>
              <IndeterminateBar />
              <Text variant="footnote" color="rgba(255,255,255,0.62)">
                Initialisation de l’application…
              </Text>
            </>
          )}
        </View>
      </Screen>
    </>
  );
}

/** Looping progress bar - the design's lime indicator on the night background. */
function IndeterminateBar() {
  const progress = useSharedValue(0.1);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(withTiming(0.9, { duration: 900 }), withTiming(0.25, { duration: 700 })),
      -1,
      true
    );
  }, [progress]);

  const animated = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Initialisation en cours"
      style={styles.track}
    >
      <Animated.View style={[styles.fill, animated]} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', gap: spacing['4xl'], paddingHorizontal: spacing['4xl'] },
  logo: {
    width: 76,
    height: 76,
    borderRadius: radius.xl + 6,
    backgroundColor: palette.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.night },
  track: {
    width: 140,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: palette.lime },
  errorBlock: { alignSelf: 'stretch', gap: spacing['3xl'], marginTop: spacing.md },
  errorNotice: {
    padding: spacing['2xl'],
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  // Outlined on the night background, per the design.
  retryButton: { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.24)' },
});
