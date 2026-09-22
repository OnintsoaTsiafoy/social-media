import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, spacing, themed, useResponsive } from '@/theme';

import { OfflineBanner } from './States';

export type ScreenProps = {
  children: ReactNode;
  /** Wraps the content in a ScrollView. Off for screens that own a FlatList. */
  scroll?: boolean;
  /** Pull-to-refresh - only meaningful with `scroll`. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Sticky bar pinned above the safe-area inset. */
  footer?: ReactNode;
  /** Fixed content above the scroll area (headers, filter bars). */
  header?: ReactNode;
  /** Shows the offline banner under the header. */
  offline?: boolean;
  /** Dark background - the splash screen. */
  dark?: boolean;
  /** Removes the horizontal gutter, for edge-to-edge content. */
  flush?: boolean;
  /** Centres content vertically - used by splash and OAuth result screens. */
  centred?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

/**
 * Screen shell. Owns the four things every screen needs to get right:
 * safe-area insets, the keyboard, the responsive content column, and leaving
 * room for the tab bar when the screen sits inside the tab navigator.
 */
export function Screen({
  children,
  scroll = false,
  onRefresh,
  refreshing = false,
  footer,
  header,
  offline = false,
  dark = false,
  flush = false,
  centred = false,
  contentContainerStyle,
  style,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { gutter, contentMaxWidth, isExpanded } = useResponsive();

  // Present only inside the tab navigator; `undefined` on pushed screens.
  const tabBarHeight = useContext(BottomTabBarHeightContext);

  const horizontalPadding = flush ? 0 : gutter;
  /** Caps the readable width on tablets and centres it. */
  const columnStyle: StyleProp<ViewStyle> = [
    styles.column,
    isExpanded && { maxWidth: contentMaxWidth, alignSelf: 'center' },
  ];

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingHorizontal: horizontalPadding, paddingBottom: (tabBarHeight ?? insets.bottom) + spacing['6xl'] },
        centred && styles.centredContent,
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.night} />
        ) : undefined
      }
    >
      <View style={[columnStyle, styles.stack]}>{children}</View>
    </ScrollView>
  ) : (
    <View
      style={[
        styles.flex,
        { paddingHorizontal: horizontalPadding },
        centred && styles.centredContent,
      ]}
    >
      <View style={[columnStyle, styles.stack, styles.flex]}>{children}</View>
    </View>
  );

  return (
    <View style={[styles.root, dark && styles.rootDark, { paddingTop: insets.top }, style]}>
      {header ? <View style={styles.headerSlot}>{header}</View> : null}
      {offline ? <OfflineBanner /> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}

        {footer ? (
          <View
            style={[
              styles.footer,
              dark && styles.footerDark,
              {
                paddingHorizontal: gutter,
                // Sit above the tab bar when there is one, above the inset otherwise.
                paddingBottom: (tabBarHeight ? spacing['3xl'] : insets.bottom) + spacing['3xl'],
              },
            ]}
          >
            <View style={columnStyle}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Dismisses the keyboard - used by screens with a tappable background. */
export function dismissKeyboard() {
  Keyboard.dismiss();
}

/**
 * Bottom padding a screen-owned list needs so its last row clears the tab bar
 * (inside the tab navigator) or the home indicator (on a pushed screen).
 */
export function useBottomContentInset(extra: number = spacing['6xl']): number {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  return (tabBarHeight ?? insets.bottom) + extra;
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    rootDark: { backgroundColor: palette.brandNight },
    flex: { flex: 1 },
    headerSlot: { zIndex: 2 },
    column: { width: '100%' },
    /** Vertical rhythm between the sections a screen passes as children. */
    stack: { gap: spacing['3xl'] },
    scrollContent: { flexGrow: 1 },
    centredContent: { justifyContent: 'center' },
    footer: {
      borderTopWidth: 1,
      borderTopColor: palette.dividerSoft,
      backgroundColor: palette.background,
      paddingTop: spacing['3xl'],
      alignItems: 'stretch',
    },
    footerDark: { backgroundColor: palette.brandNight, borderTopColor: 'rgba(255,255,255,0.12)' },
  })
);
