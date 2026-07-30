import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Text, type IconName } from '@/components/ui';
import { useSession } from '@/store/SessionProvider';
import { control, palette, radius, shadow, spacing } from '@/theme';

/** Visual height of the bar, excluding the safe-area inset. */
export const TAB_BAR_HEIGHT = 62;

type TabMeta = { icon: IconName; label: string };

/** Route name → icon and label. Route names come from the file names. */
const tabs: Record<string, TabMeta> = {
  home: { icon: 'home', label: 'Accueil' },
  publications: { icon: 'publications', label: 'Publications' },
  comments: { icon: 'comments', label: 'Commentaires' },
  analytics: { icon: 'analytics', label: 'Analytics' },
  settings: { icon: 'more', label: 'Plus' },
};

/**
 * Custom tab bar: five destinations plus the floating "new publication" button
 * that overhangs the bar, as in the design.
 *
 * Built on the navigator's own state so the active tab, badges and long-press
 * behaviour stay consistent with React Navigation.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unreadCount } = useSession();

  return (
    // The outer view reserves the FAB's overhang inside its own bounds: Android
    // clips children that fall outside a parent - and drops their touches - so
    // the button cannot simply be offset upwards. `box-none` lets the content
    // behind the transparent strip stay scrollable.
    <View style={styles.container} pointerEvents="box-none">
      <View style={[styles.bar, { paddingBottom: insets.bottom || spacing.xl }]}>
        <View style={styles.row}>
          {state.routes.map((route, index) => {
            const meta = tabs[route.name];
            if (!meta) return null;

            const focused = state.index === index;
            // Only the comments tab carries a count, mirroring the design.
            const badge = route.name === 'comments' && unreadCount > 0 ? unreadCount : undefined;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={meta.label}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                style={styles.tab}
              >
                <View style={[styles.iconSlot, focused && styles.iconSlotActive]}>
                  <Icon
                    name={meta.icon}
                    size={19}
                    color={focused ? palette.night : palette.inkDisabled}
                  />
                  {badge !== undefined ? (
                    <View style={styles.badge}>
                      <Text variant="micro" weight="bold" color={palette.white} style={styles.badgeLabel}>
                        {badge > 99 ? '99+' : badge}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text
                  weight={focused ? 'bold' : 'medium'}
                  color={focused ? palette.night : palette.inkDisabled}
                  numberOfLines={1}
                  style={styles.label}
                  maxFontSizeMultiplier={1.1}
                >
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Rendered after the bar so it paints above it: the bar is opaque, and
          on Android sibling order (plus the FAB's elevation) decides z-order. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Créer une publication"
        onPress={() => router.push('/publications/new')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Icon name="add" size={26} color={palette.night} />
      </Pressable>
    </View>
  );
}

/** Gap between the bottom of the FAB and the top edge of the bar. */
const FAB_GAP = spacing.lg;

const styles = StyleSheet.create({
  // The FAB overlays the screen, so the navigator only reserves space for the bar.
  container: { backgroundColor: 'transparent', overflow: 'visible' },
  bar: {
    backgroundColor: palette.white,
    borderTopWidth: 1,
    borderTopColor: palette.dividerSoft,
    paddingTop: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', height: TAB_BAR_HEIGHT - 12 },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: 2,
  },
  iconSlot: {
    width: 42,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlotActive: { backgroundColor: palette.tabActiveBg },
  label: { fontSize: 10, lineHeight: 13, letterSpacing: -0.1, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -2,
    right: 0,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: palette.danger,
    borderWidth: 1.5,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: { fontSize: 9, lineHeight: 11 },
  fab: {
    position: 'absolute',
    right: spacing['4xl'],
    // Floats above the bar without reserving a blank strip in the navigator.
    top: -(control.fab + FAB_GAP),
    width: control.fab,
    height: control.fab,
    borderRadius: radius.xl,
    backgroundColor: palette.lime,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...shadow.fab,
  },
  fabPressed: { opacity: 0.9, transform: [{ scale: 0.96 }] },
});
