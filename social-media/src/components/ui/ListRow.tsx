import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { control, palette, spacing } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type ListRowProps = {
  label: string;
  /** Right-aligned value, e.g. `Français`. */
  value?: string;
  /** Secondary line under the label. */
  description?: string;
  onPress?: () => void;
  /** Trailing content, e.g. a badge - replaces `value`. */
  trailing?: ReactNode;
  /** Hides the chevron on non-navigating rows. */
  showChevron?: boolean;
  tone?: 'default' | 'danger';
  style?: StyleProp<ViewStyle>;
};

/** Settings row. Rows are grouped inside a `<Card padded={false}>`. */
export function ListRow({
  label,
  value,
  description,
  onPress,
  trailing,
  showChevron = true,
  tone = 'default',
  style,
}: ListRowProps) {
  const labelColor = tone === 'danger' ? palette.dangerText : palette.ink;

  const content = (
    <>
      <View style={styles.labels}>
        <Text variant="bodyLg" weight={tone === 'danger' ? 'bold' : 'semibold'} color={labelColor}>
          {label}
        </Text>
        {description ? (
          <Text variant="micro" color={palette.inkFaint} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>

      {trailing}

      {value ? (
        <Text variant="body" color={palette.inkFaint} numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}

      {onPress && showChevron ? (
        <Icon name="forward" size={18} color={tone === 'danger' ? palette.dangerText : palette.inkDisabled} />
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, style]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityValue={value ? { text: value } : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
    >
      {content}
    </Pressable>
  );
}

/** Read-only `label - value` line inside a detail card. */
export function DetailRow({
  label,
  value,
  valueColor,
  style,
}: {
  label: string;
  value: string;
  valueColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.detailRow, style]}>
      <Text variant="body" color={palette.inkFaint} style={styles.detailLabel}>
        {label}
      </Text>
      <Text variant="body" weight="semibold" color={valueColor} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    minHeight: control.minTouch + 8,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing['2xl'],
  },
  pressed: { opacity: 0.6, backgroundColor: palette.surfaceMuted },
  labels: { flex: 1 },
  description: { marginTop: 2 },
  value: { flexShrink: 1, textAlign: 'right' },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing['3xl'],
  },
  detailLabel: { flexShrink: 0 },
  detailValue: { flex: 1, textAlign: 'right' },
});
