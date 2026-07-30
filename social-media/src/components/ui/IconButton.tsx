import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { control, palette, radius } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type IconButtonProps = {
  name: IconName;
  /** Required: icon-only controls need a spoken label. */
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: 'outline' | 'accent' | 'plain';
  size?: number;
  loading?: boolean;
  disabled?: boolean;
  /** Unread count rendered as a dot badge on the top-right corner. */
  badgeCount?: number;
  style?: StyleProp<ViewStyle>;
};

/** Square action button used in screen headers. */
export function IconButton({
  name,
  accessibilityLabel,
  onPress,
  variant = 'outline',
  size = control.iconButton,
  loading = false,
  disabled = false,
  badgeCount,
  style,
}: IconButtonProps) {
  const isDisabled = disabled || loading;
  const iconColor = variant === 'accent' ? palette.night : palette.inkBody;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      // Expand the touch target to the 44pt minimum without growing the visual.
      hitSlop={Math.max(0, (control.minTouch - size) / 2)}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size },
        variant === 'outline' && styles.outline,
        variant === 'accent' && styles.accent,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={iconColor} /> : <Icon name={name} size={18} color={iconColor} />}

      {badgeCount !== undefined && badgeCount > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text variant="micro" weight="bold" color={palette.white} style={styles.badgeLabel}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  outline: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white },
  accent: { backgroundColor: palette.lime },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.danger,
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: { fontSize: 10, lineHeight: 13 },
});
