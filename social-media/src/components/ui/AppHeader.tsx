import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { control, palette, spacing } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type AppHeaderProps = {
  title: string;
  /** Secondary line under the title. */
  subtitle?: string;
  /** Back chevron + centred title. Off for tab roots, which use a large title. */
  showBack?: boolean;
  /** Overrides the default `router.back()` - used to warn about unsaved changes. */
  onBack?: () => void;
  /** Controls placed at the trailing edge. */
  actions?: ReactNode;
  /** Text action at the trailing edge, e.g. "Enregistrer". */
  actionLabel?: string;
  onActionPress?: () => void;
  actionDisabled?: boolean;
  actionTone?: 'default' | 'danger';
};

/**
 * The two header patterns in the design:
 * a large left-aligned title for tab roots, and a back chevron with a centred
 * title for pushed screens.
 */
export function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  actions,
  actionLabel,
  onActionPress,
  actionDisabled = false,
  actionTone = 'default',
}: AppHeaderProps) {
  const router = useRouter();

  const trailing = (
    <View style={styles.trailing}>
      {actions}
      {actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: actionDisabled }}
          disabled={actionDisabled}
          onPress={onActionPress}
          hitSlop={12}
          style={({ pressed }) => [pressed && styles.pressed, actionDisabled && styles.disabled]}
        >
          <Text
            variant="body"
            weight="bold"
            color={actionTone === 'danger' ? palette.dangerText : palette.ink}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (showBack) {
    return (
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={onBack ?? (() => router.back())}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Icon name="back" size={24} color={palette.ink} />
        </Pressable>

        <View style={styles.navTitle}>
          <Text variant="callout" weight="bold" center numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="micro" color={palette.inkFaint} center numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {/* Fixed-width slot keeps the title optically centred. */}
        <View style={styles.navTrailing}>{trailing}</View>
      </View>
    );
  }

  return (
    <View style={styles.large}>
      <View style={styles.largeTitle}>
        <Text variant="title2" weight="extrabold" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="micro" color={palette.inkFaint} numberOfLines={1} style={styles.largeSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

const TRAILING_SLOT_WIDTH = 88;

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing['4xl'],
    paddingTop: spacing.lg,
    paddingBottom: spacing['3xl'],
    gap: spacing.md,
  },
  backButton: {
    width: control.minTouch,
    height: control.minTouch,
    marginLeft: -spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { flex: 1 },
  navTrailing: { minWidth: TRAILING_SLOT_WIDTH - 44, alignItems: 'flex-end' },

  large: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3xl'],
    paddingHorizontal: spacing['4xl'],
    paddingTop: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  largeTitle: { flex: 1 },
  largeSubtitle: { marginTop: 2 },

  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});

/** Uppercase label that introduces a group of fields or a card list. */
export function SectionHeader({
  title,
  actionLabel,
  onActionPress,
  style,
}: {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  style?: object;
}) {
  return (
    <View style={[sectionStyles.row, style]}>
      <Text variant="callout" weight="bold" style={sectionStyles.title}>
        {title}
      </Text>
      {actionLabel && onActionPress ? (
        <Pressable accessibilityRole="button" onPress={onActionPress} hitSlop={10}>
          <Text variant="body" weight="semibold" color={palette.inkSubtle}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xl },
  title: { flex: 1 },
});
