import { Children } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radius, spacing, themed } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export type CalloutProps = {
  children: React.ReactNode;
  tone?: CalloutTone;
  icon?: IconName;
  title?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Inline explanatory banner: server rules, generic reset messages, AI warnings.
 * Errors are announced as alerts so screen readers pick them up immediately.
 */
export function Callout({ children, tone = 'neutral', icon, title, style }: CalloutProps) {
  const colors = toneColors[tone];
  const childNodes = Children.toArray(children);
  const isTextOnly = childNodes.every((child) => typeof child === 'string' || typeof child === 'number');

  const renderChildren = () => {
    if (isTextOnly) {
      return (
        <Text variant="footnote" color={colors.foreground}>
          {childNodes.join('')}
        </Text>
      );
    }

    return childNodes.map((child, index) =>
      typeof child === 'string' || typeof child === 'number' ? (
        <Text key={index} variant="footnote" color={colors.foreground}>
          {child}
        </Text>
      ) : (
        child
      ),
    );
  };

  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[
        styles.container,
        { backgroundColor: colors.background, borderColor: colors.border },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={colors.foreground} style={styles.icon} /> : null}
      <View style={styles.body}>
        {title ? (
          <Text variant="body" weight="bold" color={colors.foreground} style={styles.title}>
            {title}
          </Text>
        ) : null}
        {renderChildren()}
      </View>
    </View>
  );
}

const toneColors: Record<CalloutTone, { background: string; border: string; foreground: string }> = themed(() => ({
  info: { background: palette.infoBg, border: palette.infoBorder, foreground: palette.infoText },
  success: { background: palette.successBg, border: palette.successBorder, foreground: palette.successText },
  warning: { background: palette.warningBg, border: palette.warningBorder, foreground: palette.warningText },
  danger: { background: palette.dangerSurface, border: palette.dangerBorder, foreground: palette.dangerText },
  neutral: { background: palette.surfaceMuted, border: palette.surfaceMuted, foreground: palette.inkMuted },
}));

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing['2xl'],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  icon: { marginTop: 1 },
  body: { flex: 1 },
  title: { marginBottom: spacing.xs },
});
