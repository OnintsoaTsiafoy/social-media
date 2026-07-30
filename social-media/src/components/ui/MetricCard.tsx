import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { autoGridCell, palette, radius, spacing } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type MetricCardProps = {
  label: string;
  /** Pre-formatted - pass `Non disponible` rather than 0 for missing metrics. */
  value: string;
  icon?: IconName;
  /** e.g. `+12 %`. Colour follows the sign unless `deltaTone` is set. */
  delta?: string;
  deltaTone?: 'positive' | 'negative';
  /** Red treatment for the "priority" tile on the dashboard. */
  emphasis?: 'default' | 'danger';
  /** Greys out the value - used when a platform did not provide the metric. */
  unavailable?: boolean;
  onPress?: () => void;
  minWidth?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Metric tile. Sized with `autoGridCell` so a wrapping row fits two per phone
 * and up to four on a tablet without any breakpoint logic in the screen.
 */
export function MetricCard({
  label,
  value,
  icon,
  delta,
  deltaTone,
  emphasis = 'default',
  unavailable = false,
  onPress,
  minWidth = 150,
  style,
}: MetricCardProps) {
  const isDanger = emphasis === 'danger';
  const deltaColor =
    (deltaTone ?? (delta?.startsWith('−') || delta?.startsWith('-') ? 'negative' : 'positive')) === 'negative'
      ? palette.dangerText
      : palette.successText;

  const body = (
    <>
      {icon ? (
        <Icon name={icon} size={17} color={isDanger ? palette.dangerText : palette.inkBody} />
      ) : null}
      <Text
        variant="display"
        weight="extrabold"
        color={unavailable ? palette.inkFaint : isDanger ? palette.dangerText : palette.ink}
        style={[styles.value, unavailable && styles.valueUnavailable]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text variant="micro" weight="medium" color={isDanger ? palette.dangerText : palette.inkFaint}>
        {label}
      </Text>
      {delta ? (
        <Text variant="micro" weight="bold" color={deltaColor} style={styles.delta}>
          {delta}
        </Text>
      ) : null}
    </>
  );

  const composed: StyleProp<ViewStyle> = [
    styles.card,
    autoGridCell(minWidth),
    isDanger && styles.cardDanger,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${value}`}
        onPress={onPress}
        style={({ pressed }) => [composed, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View accessibilityLabel={`${label} : ${value}`} style={composed}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    backgroundColor: palette.white,
    padding: spacing['2xl'],
    gap: spacing.xxs,
  },
  cardDanger: { borderColor: palette.dangerBorder, backgroundColor: palette.dangerSurface },
  pressed: { opacity: 0.75 },
  value: { marginTop: spacing.sm },
  /** "Non disponible" needs to fit, so it renders smaller than a number. */
  valueUnavailable: { fontSize: 15, lineHeight: 20, marginTop: spacing.lg },
  delta: { marginTop: spacing.xxs },
});

/** Wrapping container for a row of metric cards. */
export function MetricGrid({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[gridStyles.grid, style]}>{children}</View>;
}

const gridStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
});
