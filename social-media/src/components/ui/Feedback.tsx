import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, radius, shadow, spacing } from '@/theme';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastTone = 'success' | 'error' | 'info';

type Toast = { id: number; message: string; tone: ToastTone };

type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type FeedbackValue = {
  /** Success / error / info toast at the bottom of the screen. */
  toast: (message: string, tone?: ToastTone) => void;
  /** Confirmation dialog - resolves `true` only when the user confirms. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackValue | undefined>(undefined);

const TOAST_DURATION_MS = 3200;

/**
 * Hosts the app's transient feedback: toasts and confirmation dialogs.
 * Kept in one provider so every destructive action can `await confirm(...)`
 * without each screen wiring up its own modal.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<ConfirmRequest | undefined>(undefined);

  const nextId = useRef(0);
  const resolver = useRef<((value: boolean) => void) | undefined>(undefined);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), TOAST_DURATION_MS);
  }, []);

  const confirm = useCallback((next: ConfirmRequest) => {
    // Resolve any dialog still open so a promise is never left hanging.
    resolver.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = undefined;
    setRequest(undefined);
  }, []);

  const value = useMemo<FeedbackValue>(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <View
        pointerEvents="box-none"
        style={[styles.toastHost, { bottom: insets.bottom + spacing['4xl'] }]}
      >
        {toasts.map((item) => (
          <Animated.View
            key={item.id}
            entering={SlideInDown.duration(220)}
            exiting={FadeOut.duration(160)}
            accessibilityRole="alert"
            style={[styles.toast, toastTones[item.tone].container]}
          >
            <Icon name={toastTones[item.tone].icon} size={16} color={toastTones[item.tone].color} />
            <Text variant="body" weight="semibold" color={toastTones[item.tone].color} style={styles.toastText}>
              {item.message}
            </Text>
          </Animated.View>
        ))}
      </View>

      <Modal
        visible={request !== undefined}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => settle(false)}
      >
        <View style={styles.dialogBackdrop}>
          <Pressable
            accessibilityLabel="Fermer"
            style={styles.backdropPress}
            onPress={() => settle(false)}
          />
          {request ? (
            <Animated.View entering={FadeIn.duration(160)} style={styles.dialog}>
              <Text variant="title3" weight="extrabold">
                {request.title}
              </Text>
              {request.message ? (
                <Text variant="footnote" color={palette.inkMuted} style={styles.dialogMessage}>
                  {request.message}
                </Text>
              ) : null}
              <View style={styles.dialogActions}>
                <Button
                  label={request.cancelLabel ?? 'Annuler'}
                  variant="secondary"
                  size="sm"
                  onPress={() => settle(false)}
                  style={styles.dialogButton}
                />
                <Button
                  label={request.confirmLabel ?? 'Confirmer'}
                  variant={request.destructive ? 'danger' : 'primary'}
                  size="sm"
                  onPress={() => settle(true)}
                  style={styles.dialogButton}
                />
              </View>
            </Animated.View>
          ) : null}
        </View>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside <FeedbackProvider>.');
  return context;
}

const toastTones: Record<ToastTone, { container: object; color: string; icon: IconName }> = {
  success: { container: { backgroundColor: palette.night }, color: palette.lime, icon: 'checkCircle' },
  error: { container: { backgroundColor: palette.dangerText }, color: palette.white, icon: 'priority' },
  info: { container: { backgroundColor: palette.night }, color: palette.white, icon: 'info' },
};

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Right-aligned action in the sheet header. */
  headerAction?: ReactNode;
  children: ReactNode;
  /** Sticky footer, kept above the safe-area inset. */
  footer?: ReactNode;
};

/**
 * Bottom sheet with a dimmed backdrop, matching the media-picker and
 * hashtag panels in the design. Dismisses on backdrop tap and Android back.
 */
export function BottomSheet({ visible, onClose, title, headerAction, children, footer }: BottomSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <View style={styles.sheetBackdrop}>
          <Pressable accessibilityLabel="Fermer" style={styles.backdropPress} onPress={onClose} />
        </View>

        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing['3xl'] }]}>
          <View style={styles.grabber} />
          {title ? (
            <View style={styles.sheetHeader}>
              <Text variant="title3" weight="extrabold" style={styles.sheetTitle}>
                {title}
              </Text>
              {headerAction}
            </View>
          ) : null}
          {children}
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toastHost: {
    position: 'absolute',
    left: spacing['4xl'],
    right: spacing['4xl'],
    gap: spacing.md,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing['2xl'],
    borderRadius: radius.md,
    ...shadow.card,
  },
  toastText: { flex: 1 },

  dialogBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['4xl'],
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  backdropPress: { ...StyleSheet.absoluteFillObject },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: palette.white,
    borderRadius: radius.xl,
    padding: spacing['5xl'],
    ...shadow.card,
  },
  dialogMessage: { marginTop: spacing.md },
  dialogActions: { flexDirection: 'row', gap: spacing.xl, marginTop: spacing['5xl'] },
  dialogButton: { flex: 1 },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  sheet: {
    backgroundColor: palette.white,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing['4xl'],
    paddingTop: spacing['2xl'],
    maxHeight: '90%',
    ...shadow.sheet,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.trackAlt,
    alignSelf: 'center',
    marginBottom: spacing['3xl'],
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xl,
    marginBottom: spacing['3xl'],
  },
  sheetTitle: { flex: 1 },
  sheetFooter: { marginTop: spacing['4xl'] },
});
