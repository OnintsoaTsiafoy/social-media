import { Pressable, StyleSheet, View } from 'react-native';

import { palette, radius, spacing } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB = 20;

export type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Row label - also used as the accessible name. */
  label: string;
  /** Secondary line under the label. */
  description?: string;
  disabled?: boolean;
};

/**
 * Labelled switch row. Uses `accessibilityRole="switch"` so assistive tech
 * announces the state, and the whole row is the touch target.
 */
export function Toggle({ value, onValueChange, label, description, disabled = false }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.labels}>
        <Text variant="bodyLg" weight="medium">
          {label}
        </Text>
        {description ? (
          <Text variant="micro" color={palette.inkFaint} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>

      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3xl'],
    minHeight: 44,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  labels: { flex: 1 },
  description: { marginTop: 2 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    padding: (TRACK_HEIGHT - KNOB) / 2,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: palette.lime },
  trackOff: { backgroundColor: palette.trackAlt },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: palette.white,
  },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});

export type CheckboxProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Accessible name. Pass `children` to render rich label content. */
  label: string;
  children?: React.ReactNode;
  error?: string;
  disabled?: boolean;
};

/** Square checkbox with a rich label slot - used for the consent checkboxes. */
export function Checkbox({ value, onValueChange, label, children, error, disabled = false }: CheckboxProps) {
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        onPress={() => onValueChange(!value)}
        style={({ pressed }) => [checkboxStyles.row, pressed && !disabled && checkboxStyles.pressed]}
      >
        <View style={[checkboxStyles.box, value ? checkboxStyles.boxOn : checkboxStyles.boxOff, error && !value ? checkboxStyles.boxError : null]}>
          {value ? <Icon name="check" size={13} color={palette.night} /> : null}
        </View>
        <View style={checkboxStyles.label}>
          {children ?? (
            <Text variant="footnote" color={palette.inkMuted}>
              {label}
            </Text>
          )}
        </View>
      </Pressable>

      {error ? (
        <Text variant="micro" weight="medium" color={palette.dangerText} style={checkboxStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const checkboxStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xl, paddingVertical: spacing.sm },
  pressed: { opacity: 0.7 },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: palette.lime },
  boxOff: { borderWidth: 1.5, borderColor: palette.borderStrong },
  boxError: { borderColor: palette.danger },
  label: { flex: 1 },
  error: { marginTop: spacing.xs, marginLeft: 34 },
});
