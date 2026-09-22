import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radius, spacing, themed } from '@/theme';

import { Text } from './Text';

export type SegmentedControlProps<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  style?: StyleProp<ViewStyle>;
};

/** Compact two-or-three-way switch - calendar month/day, analytics period. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  style,
}: SegmentedControlProps<T>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.group, style]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected ? styles.segmentSelected : styles.segmentIdle,
              pressed && styles.pressed,
            ]}
          >
            <Text
              variant="body"
              weight="bold"
              color={selected ? palette.onNight : palette.inkBody}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    group: { flexDirection: 'row', gap: spacing.md },
    segment: {
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing.lg,
      borderRadius: radius.pill,
      minHeight: 36,
      justifyContent: 'center',
    },
    segmentSelected: { backgroundColor: palette.night },
    segmentIdle: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
    pressed: { opacity: 0.75 },
  })
);
