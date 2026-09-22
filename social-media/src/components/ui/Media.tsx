import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radius, spacing, themed } from '@/theme';

import { Text } from './Text';

export type AvatarProps = {
  initials: string;
  size?: number;
  uri?: string;
  /** Lime ring - marks the signed-in user. */
  ringed?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Round avatar. Falls back to initials, which is what the mocks show. */
export function Avatar({ initials, size = 34, uri, ringed = false, style }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ringed ? 2 : 0,
        },
        style,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.fill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Text
          weight="bold"
          color={palette.inkAvatar}
          style={{ fontSize: Math.max(10, size / 2.9) }}
          numberOfLines={1}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

export type ThumbnailProps = {
  size?: number;
  uri?: string;
  /** Rendered instead of an image when a publication has no media. */
  placeholderLabel?: string;
  radiusValue?: number;
  style?: StyleProp<ViewStyle>;
};

/** Square media thumbnail with the design's hatched placeholder. */
export function Thumbnail({ size = 52, uri, placeholderLabel, radiusValue, style }: ThumbnailProps) {
  return (
    <View
      style={[
        styles.thumbnail,
        { width: size, height: size, borderRadius: radiusValue ?? radius.md },
        style,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.fill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : placeholderLabel ? (
        <Text variant="micro" weight="semibold" color={palette.inkAvatar} numberOfLines={1}>
          {placeholderLabel}
        </Text>
      ) : null}
    </View>
  );
}

/** Wide media preview used on the publication detail and media picker screens. */
export function MediaPreview({
  uri,
  fileName,
  height = 160,
  style,
}: {
  uri?: string;
  fileName?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.preview, { height }, style]}>
      {uri ? (
        <Image source={{ uri }} style={styles.fill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : null}
      {fileName ? (
        <View style={styles.fileTag}>
          <Text variant="micro" weight="semibold" color={palette.inkAvatar} numberOfLines={1}>
            {fileName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function ProgressBar({
  /** 0 → 1. */
  progress,
  height = 5,
  color = palette.lime,
  label,
}: {
  progress: number;
  height?: number;
  color?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <View>
      {label ? (
        <View style={styles.progressLabel}>
          <Text variant="micro" color={palette.inkFaint}>
            {label}
          </Text>
          <Text variant="micro" weight="bold">
            {Math.round(clamped * 100)} %
          </Text>
        </View>
      ) : null}
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
        style={[styles.track, { height, borderRadius: height / 2 }]}
      >
        <View
          style={[
            styles.fillBar,
            { width: `${clamped * 100}%`, backgroundColor: color, borderRadius: height / 2 },
          ]}
        />
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    avatar: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: palette.skeleton,
      borderColor: palette.lime,
    },
    thumbnail: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: palette.skeleton,
    },
    preview: {
      borderRadius: radius.xl,
      overflow: 'hidden',
      backgroundColor: palette.skeleton,
      justifyContent: 'flex-end',
      padding: spacing.xl,
    },
    fill: { width: '100%', height: '100%' },
    fileTag: {
      alignSelf: 'flex-start',
      backgroundColor: palette.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.xs,
      maxWidth: '100%',
    },
    progressLabel: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: spacing.sm,
    },
    track: { backgroundColor: palette.track, overflow: 'hidden' },
    fillBar: { height: '100%' },
  })
);
