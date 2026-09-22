import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { control, palette, radius, spacing, themed } from '@/theme';

import { Card, Divider } from './Card';
import { BottomSheet } from './Feedback';
import { Icon } from './Icon';
import { Text } from './Text';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Secondary line in the option list. */
  description?: string;
};

export type SelectFieldProps<T extends string> = {
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Sheet heading; falls back to `label`. */
  sheetTitle?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Select control. Opens a bottom sheet rather than a native picker so the list
 * looks the same on both platforms and can show descriptions.
 */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  sheetTitle,
  placeholder = 'Sélectionner',
  error,
  hint,
  disabled = false,
  containerStyle,
}: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={containerStyle}>
      {label ? <Text variant="eyebrow" style={styles.label}>{label}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          error && styles.fieldError,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <Text
          variant="bodyLg"
          weight={selected ? 'semibold' : 'regular'}
          color={selected ? palette.ink : palette.inkPlaceholder}
          numberOfLines={1}
          style={styles.value}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="chevronDown" size={17} color={palette.inkPlaceholder} />
      </Pressable>

      {error ? (
        <Text variant="micro" weight="medium" color={palette.dangerText} style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="micro" color={palette.inkFaint} style={styles.helper}>
          {hint}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={sheetTitle ?? label ?? placeholder}>
        <ScrollView style={styles.optionScroll} showsVerticalScrollIndicator={false}>
          <Card padded={false}>
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <View key={option.value}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={option.label}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  >
                    <View style={styles.optionText}>
                      <Text variant="bodyLg" weight={isSelected ? 'bold' : 'medium'}>
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text variant="micro" color={palette.inkFaint} style={styles.optionDescription}>
                          {option.description}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? <Icon name="check" size={18} color={palette.successText} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    label: { marginBottom: spacing.md },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      minHeight: control.inputHeight,
      paddingHorizontal: spacing['2xl'],
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      backgroundColor: palette.surface,
    },
    fieldError: { borderColor: palette.danger, borderWidth: 1.5 },
    value: { flex: 1 },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
    helper: { marginTop: spacing.sm },
    optionScroll: { maxHeight: 380 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xl,
      paddingHorizontal: spacing['2xl'],
      paddingVertical: spacing['2xl'],
      minHeight: control.minTouch,
    },
    optionText: { flex: 1 },
    optionDescription: { marginTop: 2 },
  })
);
