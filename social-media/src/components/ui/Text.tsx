import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { fontFamily, fontScaleCap, fontSize, lineHeight, palette, type FontWeight } from '@/theme';

export type TextVariant =
  | 'display'
  | 'displayLg'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'callout'
  | 'bodyLg'
  | 'body'
  | 'footnote'
  | 'caption'
  | 'micro'
  /** Uppercase section label above a group of fields. */
  | 'eyebrow';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  weight?: FontWeight;
  color?: string;
  center?: boolean;
};

/**
 * The only text primitive in the app. Wires Plus Jakarta Sans to the right
 * family per weight (RN cannot synthesise weights for custom fonts on Android)
 * and caps OS font scaling per variant so dense UI cannot overflow.
 */
export function Text({ variant = 'body', weight, color, center, style, ...rest }: TextProps) {
  const preset = presets[variant];
  const resolvedWeight = weight ?? preset.weight;

  return (
    <RNText
      maxFontSizeMultiplier={preset.scaleCap}
      style={[
        styles.base,
        preset.style,
        { fontFamily: fontFamily[resolvedWeight] },
        color ? { color } : null,
        center ? styles.center : null,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: palette.ink },
  center: { textAlign: 'center' },

  displayLg: { fontSize: fontSize.displayLg, lineHeight: lineHeight.displayLg },
  display: { fontSize: fontSize.display, lineHeight: lineHeight.display },
  title1: { fontSize: fontSize.title1, lineHeight: lineHeight.title1 },
  title2: { fontSize: fontSize.title2, lineHeight: lineHeight.title2 },
  title3: { fontSize: fontSize.title3, lineHeight: lineHeight.title3 },
  callout: { fontSize: fontSize.callout, lineHeight: lineHeight.callout },
  bodyLg: { fontSize: fontSize.bodyLg, lineHeight: lineHeight.bodyLg },
  body: { fontSize: fontSize.body, lineHeight: lineHeight.body },
  footnote: { fontSize: fontSize.footnote, lineHeight: lineHeight.footnote },
  caption: { fontSize: fontSize.caption, lineHeight: lineHeight.caption },
  micro: { fontSize: fontSize.micro, lineHeight: lineHeight.micro },
  eyebrow: {
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: palette.inkFaint,
  },
});

const presets: Record<TextVariant, { style: object; weight: FontWeight; scaleCap: number }> = {
  displayLg: { style: styles.displayLg, weight: 'extrabold', scaleCap: fontScaleCap.dense },
  display: { style: styles.display, weight: 'extrabold', scaleCap: fontScaleCap.dense },
  title1: { style: styles.title1, weight: 'extrabold', scaleCap: fontScaleCap.standard },
  title2: { style: styles.title2, weight: 'extrabold', scaleCap: fontScaleCap.standard },
  title3: { style: styles.title3, weight: 'bold', scaleCap: fontScaleCap.standard },
  callout: { style: styles.callout, weight: 'bold', scaleCap: fontScaleCap.standard },
  bodyLg: { style: styles.bodyLg, weight: 'regular', scaleCap: fontScaleCap.prose },
  body: { style: styles.body, weight: 'regular', scaleCap: fontScaleCap.prose },
  footnote: { style: styles.footnote, weight: 'regular', scaleCap: fontScaleCap.prose },
  caption: { style: styles.caption, weight: 'medium', scaleCap: fontScaleCap.standard },
  micro: { style: styles.micro, weight: 'semibold', scaleCap: fontScaleCap.dense },
  eyebrow: { style: styles.eyebrow, weight: 'bold', scaleCap: fontScaleCap.dense },
};
