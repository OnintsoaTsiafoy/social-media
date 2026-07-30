import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { control, palette, radius, spacing } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Small count rendered after the label, e.g. `Toutes · 42`. */
  count?: number;
  variant?: 'filter' | 'choice' | 'tag' | 'dashed';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Pill control used for status filters, tone choices and hashtags.
 * `filter` selects to night, `choice` selects to lime - matching the design.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  count,
  variant = 'filter',
  disabled = false,
  style,
}: ChipProps) {
  const foreground = selected
    ? variant === 'filter'
      ? palette.white
      : palette.night
    : variant === 'tag'
      ? palette.inkBody
      : palette.inkBody;

  const content = (
    <>
      {icon ? <Icon name={icon} size={13} color={foreground} /> : null}
      <Text variant="body" weight={selected || variant === 'choice' ? 'bold' : 'semibold'} color={foreground} numberOfLines={1}>
        {count === undefined ? label : `${label} · ${count}`}
      </Text>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.base, variantStyle(variant, selected), style]}>{content}</View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyle(variant, selected),
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

function variantStyle(variant: NonNullable<ChipProps['variant']>, selected: boolean): ViewStyle {
  if (variant === 'dashed') return styles.dashed;
  if (variant === 'tag') return selected ? styles.tagSelected : styles.tag;
  if (variant === 'choice') return selected ? styles.choiceSelected : styles.unselected;
  return selected ? styles.filterSelected : styles.unselected;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: control.chipHeight,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  unselected: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white },
  filterSelected: { backgroundColor: palette.night },
  choiceSelected: { backgroundColor: palette.lime },
  tag: { backgroundColor: palette.surfaceChip },
  tagSelected: { backgroundColor: palette.lime },
  dashed: { borderWidth: 1, borderStyle: 'dashed', borderColor: palette.borderStrong },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});

/**
 * Horizontally scrolling row of filter chips. Scrolls rather than wrapping so
 * the filter bar keeps a fixed height on every screen size.
 */
export function ChipRow({
  children,
  gutter,
  style,
}: {
  children: React.ReactNode;
  /** Screen gutter, so the first and last chip align with the content. */
  gutter: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[rowStyles.content, { paddingHorizontal: gutter }]}
      style={style}
    >
      {children}
    </ScrollView>
  );
}

const rowStyles = StyleSheet.create({
  content: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
});

/** Wrapping group for tags and tone choices, where height may grow. */
export function ChipWrap({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[wrapStyles.wrap, style]}>{children}</View>;
}

const wrapStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
