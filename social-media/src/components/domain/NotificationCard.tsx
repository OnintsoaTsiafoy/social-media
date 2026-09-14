import { StyleSheet, View } from 'react-native';

import { Card, Icon, Text, type IconName } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { palette, radius, spacing } from '@/theme';
import type { AppNotification, NotificationType } from '@/types';

type Appearance = { icon: IconName; tone: 'danger' | 'warning' | 'success' | 'neutral' };

/** Type → icon and colour, so notification styling lives in one place. */
const appearances: Record<NotificationType, Appearance> = {
  publication_approval_requested: { icon: 'clock', tone: 'warning' },
  publication_approved: { icon: 'checkCircle', tone: 'success' },
  publication_rejected: { icon: 'failed', tone: 'danger' },
  publication_changes_requested: { icon: 'priority', tone: 'warning' },
  priority_comment: { icon: 'priority', tone: 'danger' },
  negative_comment: { icon: 'priority', tone: 'danger' },
  urgent_comment: { icon: 'urgent', tone: 'danger' },
  ai_response_ready: { icon: 'ai', tone: 'success' },
  publication_published: { icon: 'checkCircle', tone: 'neutral' },
  publication_failed: { icon: 'failed', tone: 'danger' },
  publication_partial: { icon: 'priority', tone: 'warning' },
  token_expiring: { icon: 'clock', tone: 'warning' },
  token_expired: { icon: 'clock', tone: 'warning' },
  sync_failed: { icon: 'sync', tone: 'neutral' },
  account_disconnected: { icon: 'link', tone: 'warning' },
};

const iconColors = {
  danger: { background: palette.dangerBg, foreground: palette.dangerText },
  warning: { background: palette.warningBg, foreground: palette.warningText },
  success: { background: palette.successBg, foreground: palette.successText },
  neutral: { background: palette.surfaceChip, foreground: palette.inkMuted },
} as const;

export function NotificationCard({
  notification,
  onPress,
}: {
  notification: AppNotification;
  onPress: () => void;
}) {
  const appearance = appearances[notification.type];
  const colors = iconColors[appearance.tone];
  const unread = !notification.read;

  return (
    <Card
      tone={unread && appearance.tone === 'danger' ? 'danger' : unread && appearance.tone === 'warning' ? 'warning' : 'default'}
      onPress={onPress}
      accessibilityLabel={`${notification.title}. ${notification.message}. ${unread ? 'Non lue' : 'Lue'}`}
      style={[styles.card, !unread && styles.read]}
    >
      <View style={[styles.iconTile, { backgroundColor: colors.background }]}>
        <Icon name={appearance.icon} size={17} color={colors.foreground} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="body" weight="bold" style={styles.title} numberOfLines={2}>
            {notification.title}
          </Text>
          {unread ? <View style={styles.unreadDot} accessibilityLabel="Non lue" /> : null}
        </View>
        <Text variant="footnote" color={palette.inkMuted} style={styles.message}>
          {notification.message}
        </Text>
        <Text variant="micro" color={palette.inkDisabled} style={styles.time}>
          {formatRelative(notification.createdAt)}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: spacing.xl },
  read: { opacity: 0.72 },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.lime },
  message: { marginTop: spacing.xs },
  time: { marginTop: spacing.md },
});
