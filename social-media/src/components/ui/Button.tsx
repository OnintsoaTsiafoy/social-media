import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { control, palette, radius, spacing } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant =
  /** Night-filled - the single main action of a screen. */
  | 'primary'
  /** Lime-filled - the affirmative action when it sits beside a primary one. */
  | 'accent'
  /** Outlined - secondary actions. */
  | 'secondary'
  /** Outlined red - destructive actions. */
  | 'danger'
  /** Text only. */
  | 'ghost';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  /** Stretches the button to fill its row. */
  block?: boolean;
  /** Overrides the variant's label colour - for buttons on a dark surface. */
  labelColor?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * All buttons expose a busy state and are disabled while busy - the spec
 * requires actions to be blocked during a request so nothing is submitted twice.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'leading',
  loading = false,
  block = false,
  labelColor,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const tone = tones[variant];
  const foreground = labelColor ?? tone.labelColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        tone.container,
        block && styles.block,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'leading' ? (
            <Icon name={icon} size={size === 'sm' ? 15 : 17} color={foreground} />
          ) : null}
          <Text
            variant={size === 'sm' ? 'body' : 'bodyLg'}
            weight="bold"
            color={foreground}
            numberOfLines={1}
          >
            {label}
          </Text>
          {icon && iconPosition === 'trailing' ? (
            <Icon name={icon} size={size === 'sm' ? 15 : 17} color={foreground} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing['3xl'],
  },
  md: { minHeight: control.buttonHeight },
  sm: { minHeight: control.buttonHeightSm },
  block: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { opacity: 0.85 },
  // The label keeps its contrast; only the surface dims.
  disabled: { opacity: 0.45 },

  primary: { backgroundColor: palette.night },
  accent: { backgroundColor: palette.lime },
  secondary: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border },
  danger: { backgroundColor: palette.dangerSurface, borderWidth: 1, borderColor: palette.dangerBorder },
  ghost: { backgroundColor: 'transparent' },
});

const tones: Record<ButtonVariant, { container: ViewStyle; labelColor: string }> = {
  primary: { container: styles.primary, labelColor: palette.white },
  accent: { container: styles.accent, labelColor: palette.night },
  secondary: { container: styles.secondary, labelColor: palette.ink },
  danger: { container: styles.danger, labelColor: palette.dangerText },
  ghost: { container: styles.ghost, labelColor: palette.inkMuted },
};
