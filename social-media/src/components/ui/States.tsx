import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { palette, radius, spacing } from '@/theme';

import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Shimmering placeholder block. */
export function Skeleton({
  width,
  height = 14,
  radiusValue = radius.xs,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radiusValue?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 850 }), -1, true);
  }, [opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeleton,
        { height, borderRadius: radiusValue },
        width !== undefined ? { width } : styles.skeletonStretch,
        animated,
        style,
      ]}
    />
  );
}

/** Skeleton in the shape of a list card, so the first load matches the layout. */
export function SkeletonCard({ lines = 2, withThumbnail = true }: { lines?: number; withThumbnail?: boolean }) {
  return (
    <Card>
      <View style={styles.skeletonRow}>
        {withThumbnail ? <Skeleton width={52} height={52} radiusValue={radius.md} /> : null}
        <View style={styles.skeletonLines}>
          <Skeleton height={13} />
          {Array.from({ length: Math.max(0, lines - 1) }).map((_, index) => (
            <Skeleton key={index} height={11} width={index === lines - 2 ? '60%' : undefined} />
          ))}
        </View>
      </View>
    </Card>
  );
}

export function SkeletonList({ count = 3, withThumbnail = true }: { count?: number; withThumbnail?: boolean }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} withThumbnail={withThumbnail} />
      ))}
    </View>
  );
}

/** Centred spinner for a whole screen or a section. */
export function LoadingState({ label = 'Chargement…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.centred, compact ? styles.centredCompact : null]}
    >
      <ActivityIndicator color={palette.night} />
      <Text variant="footnote" color={palette.inkFaint}>
        {label}
      </Text>
    </View>
  );
}

export type EmptyStateProps = {
  title: string;
  message?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** Every list needs one of these - the spec makes it a validation criterion. */
export function EmptyState({ title, message, icon = 'empty', actionLabel, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.centred, style]}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={22} color={palette.inkDisabled} />
      </View>
      <Text variant="callout" weight="bold" center>
        {title}
      </Text>
      {message ? (
        <Text variant="footnote" color={palette.inkFaint} center style={styles.emptyMessage}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" size="sm" onPress={onAction} style={styles.stateAction} />
      ) : null}
    </View>
  );
}

export type ErrorStateProps = {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Error surface with a way forward. Never shows technical detail - the message
 * comes from `toUserMessage`, which maps API codes to actionable copy.
 */
export function ErrorState({
  message,
  title = 'Impossible de charger ces données',
  onRetry,
  retryLabel = 'Réessayer',
  compact = false,
  style,
}: ErrorStateProps) {
  if (compact) {
    return (
      <Card tone="danger" style={style}>
        <View style={styles.compactError}>
          <Icon name="priority" size={16} color={palette.dangerText} />
          <Text variant="footnote" color={palette.dangerText} style={styles.compactErrorText}>
            {message}
          </Text>
        </View>
        {onRetry ? (
          <Button label={retryLabel} variant="secondary" size="sm" icon="sync" onPress={onRetry} style={styles.stateAction} />
        ) : null}
      </Card>
    );
  }

  return (
    <View accessibilityRole="alert" style={[styles.centred, style]}>
      <View style={styles.errorIcon}>
        <Icon name="priority" size={22} color={palette.dangerText} />
      </View>
      <Text variant="callout" weight="bold" center>
        {title}
      </Text>
      <Text variant="footnote" color={palette.inkMuted} center style={styles.emptyMessage}>
        {message}
      </Text>
      {onRetry ? (
        <Button label={retryLabel} variant="secondary" size="sm" icon="sync" onPress={onRetry} style={styles.stateAction} />
      ) : null}
    </View>
  );
}

/** Persistent bar shown while the device has no usable connection. */
export function OfflineBanner({ onRetry }: { onRetry?: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.offline}>
      <Icon name="offline" size={15} color={palette.warningText} />
      <Text variant="micro" weight="semibold" color={palette.warningText} style={styles.offlineText}>
        Mode hors connexion - les données affichées peuvent être obsolètes.
      </Text>
      {onRetry ? (
        <Text
          variant="micro"
          weight="bold"
          color={palette.warningText}
          onPress={onRetry}
          accessibilityRole="button"
        >
          Réessayer
        </Text>
      ) : null}
    </View>
  );
}

/** Footer spinner for infinite scroll. */
export function ListFooterLoader({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.footerLoader}>
      <ActivityIndicator color={palette.inkDisabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: palette.skeleton },
  skeletonStretch: { alignSelf: 'stretch' },
  skeletonRow: { flexDirection: 'row', gap: spacing.xl, alignItems: 'center' },
  skeletonLines: { flex: 1, gap: spacing.md },
  skeletonList: { gap: spacing.lg },

  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['7xl'],
    paddingHorizontal: spacing['4xl'],
    gap: spacing.lg,
  },
  centredCompact: { paddingVertical: spacing['4xl'] },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceChip,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  errorIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: palette.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyMessage: { maxWidth: 300 },
  stateAction: { marginTop: spacing.md, alignSelf: 'center', paddingHorizontal: spacing['4xl'] },

  compactError: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  compactErrorText: { flex: 1 },

  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing.xl,
    backgroundColor: palette.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: palette.warningBorder,
  },
  offlineText: { flex: 1 },

  footerLoader: { paddingVertical: spacing['4xl'], alignItems: 'center' },
});
