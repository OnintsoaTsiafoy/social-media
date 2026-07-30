import { forwardRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { control, fontFamily, fontSize, palette, radius, spacing } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  /** Rendered under the field, in red, and announced to screen readers. */
  error?: string;
  /** Rendered under the field when there is no error. */
  hint?: string;
  /** Right-aligned counter above the field, e.g. `248 / 2 200`. */
  counter?: string;
  multiline?: boolean;
  /** Control rendered inside the field, after the input. */
  trailing?: ReactNode;
  /** Icon rendered inside the field, before the input. */
  leadingIcon?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    error,
    hint,
    counter,
    multiline,
    trailing,
    leadingIcon,
    containerStyle,
    fieldStyle,
    onFocus,
    onBlur,
    ...rest
  },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={containerStyle}>
      {label || counter ? (
        <View style={styles.labelRow}>
          {label ? <Text variant="eyebrow">{label}</Text> : <View />}
          {counter ? (
            <Text variant="micro" weight="medium" color={palette.inkFaint}>
              {counter}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.field,
          multiline ? styles.fieldMultiline : styles.fieldSingle,
          focused && styles.fieldFocused,
          error && styles.fieldError,
          fieldStyle,
        ]}
      >
        {leadingIcon}
        <TextInput
          ref={ref}
          multiline={multiline}
          placeholderTextColor={palette.inkPlaceholder}
          selectionColor={palette.night}
          accessibilityLabel={label ?? rest.placeholder}
          // Screen readers announce the error (or the hint) with the field.
          accessibilityHint={error ?? hint}
          style={[styles.input, multiline && styles.inputMultiline]}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
        {trailing}
      </View>

      {error ? (
        <Text variant="micro" weight="medium" color={palette.dangerText} style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="micro" weight="regular" color={palette.inkFaint} style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

export type PasswordFieldProps = Omit<TextFieldProps, 'secureTextEntry' | 'trailing'>;

/** Password input with an explicit show / hide control inside the field. */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          onPress={() => setVisible((value) => !value)}
          hitSlop={12}
          style={styles.reveal}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={16} color={palette.inkFaint} />
          <Text variant="micro" weight="semibold" color={palette.inkMuted}>
            {visible ? 'Masquer' : 'Afficher'}
          </Text>
        </Pressable>
      }
      {...props}
    />
  );
}

/** Rounded search input with a leading magnifier. */
export function SearchField(props: Omit<TextFieldProps, 'leadingIcon'>) {
  return (
    <TextField
      placeholder="Rechercher"
      returnKeyType="search"
      autoCapitalize="none"
      autoCorrect={false}
      clearButtonMode="while-editing"
      leadingIcon={<Icon name="search" size={17} color={palette.inkPlaceholder} />}
      fieldStyle={styles.searchField}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.white,
    paddingHorizontal: spacing['2xl'],
  },
  fieldSingle: { minHeight: control.inputHeight },
  fieldMultiline: { minHeight: 104, paddingVertical: spacing['2xl'], alignItems: 'flex-start' },
  fieldFocused: { borderColor: palette.night, borderWidth: 1.5 },
  fieldError: { borderColor: palette.danger, borderWidth: 1.5 },
  searchField: { minHeight: 46 },
  input: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.bodyLg,
    color: palette.ink,
    padding: 0,
    // Android adds asymmetric padding around custom fonts without this.
    includeFontPadding: false,
  },
  inputMultiline: { textAlignVertical: 'top', minHeight: 76, lineHeight: 22 },
  reveal: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  helper: { marginTop: spacing.sm },
});
