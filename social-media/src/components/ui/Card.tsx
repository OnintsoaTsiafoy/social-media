import { Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { palette, radius, spacing } from '@/theme';

export type CardTone = 'default' | 'danger' | 'warning' | 'success' | 'info' | 'muted' | 'dashed';

export type CardProps = ViewProps & {
  tone?: CardTone;
  /** Coloured 3px rail on the leading edge - used for priority and status. */
  accentColor?: string;
  padded?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The surface every list row and section sits on: white, 1px border,
 * generously rounded. Becomes a button when `onPress` is provided.
 *
 * A card that holds its own action button must stay non-pressable and use
 * `CardPressArea` for the tappable part instead - see below.
 */
export function Card({
  tone = 'default',
  accentColor,
  padded = true,
  onPress,
  accessibilityLabel,
  style,
  children,
  ...rest
}: CardProps) {
  const composed: StyleProp<ViewStyle> = [
    styles.base,
    tones[tone],
    padded && styles.padded,
    accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : null,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [composed, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={composed} {...rest}>
      {children}
    </View>
  );
}

export type CardPressAreaProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children?: ViewProps['children'];
};

/**
 * The tappable region of a card that also carries its own action button
 * ("Traiter", "Relancer"…). Wrap the passive content in this and keep the
 * action button as a sibling inside a `<Card padded={false}>`.
 *
 * Why not `<Card onPress>` with the button nested inside: on web a pressable
 * card renders a real `<button>`, so a nested button is invalid DOM and - more
 * importantly - unreachable by keyboard and mangled by screen readers.
 */
export function CardPressArea({ onPress, accessibilityLabel, style, children }: CardPressAreaProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.white,
  },
  padded: { padding: spacing['2xl'] },
  pressed: { opacity: 0.75 },

  default: {},
  danger: { borderColor: palette.dangerBorder, backgroundColor: palette.dangerSurfaceSoft },
  warning: { borderColor: palette.warningBorder, backgroundColor: palette.warningSurface },
  success: { borderColor: palette.successBorder, backgroundColor: palette.successSurface },
  info: { borderColor: palette.infoBorder, backgroundColor: palette.infoBg },
  muted: { borderColor: 'transparent', backgroundColor: palette.surfaceMuted },
  dashed: { borderStyle: 'dashed', borderColor: palette.borderStrong, backgroundColor: palette.white },
});

const tones: Record<CardTone, ViewStyle> = {
  default: styles.default,
  danger: styles.danger,
  warning: styles.warning,
  success: styles.success,
  info: styles.info,
  muted: styles.muted,
  dashed: styles.dashed,
};

/** 1px hairline used between rows inside a card. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[dividerStyles.line, style]} />;
}

const dividerStyles = StyleSheet.create({
  line: { height: 1, backgroundColor: palette.divider },
});
