import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NotificationCard } from '@/components/domain/NotificationCard';
import {
  AppHeader,
  Callout,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonList,
  useFeedback,
} from '@/components/ui';
import { notificationsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/store/SessionProvider';
import { spacing, useResponsive } from '@/theme';

type Filter = 'unread' | 'priority' | 'errors' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'unread', label: 'Non lues' },
  { value: 'priority', label: 'Prioritaires' },
  { value: 'errors', label: 'Erreurs' },
  { value: 'all', label: 'Toutes' },
];

/**
 * ÉCRAN 21 - Centre de notifications (`/notifications`)
 *
 * Opening a notification marks it read and navigates to the resource it points
 * at, so the unread counter and the tab badge stay in step.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { toast } = useFeedback();
  const { gutter } = useResponsive();
  const { refreshUnreadCount, markAllNotificationsRead, unreadCount } = useSession();

  const [filter, setFilter] = useState<Filter>('unread');
  const request = useAsync(() => notificationsApi.list(filter), [filter]);

  const notifications = request.data ?? [];

  const open = async (id: string, href: Href) => {
    // Optimistic: the row updates immediately, then the server catches up.
    request.setData((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item))
    );
    try {
      await notificationsApi.markRead(id);
      await refreshUnreadCount();
    } catch {
      // Non-blocking - navigation matters more than the read receipt.
    }
    router.push(href);
  };

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      markAllNotificationsRead();
      request.reload();
      toast('Toutes les notifications sont marquées comme lues.', 'success');
    } catch {
      toast('Action impossible pour le moment. Réessayez.', 'error');
    }
  };

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <>
          <AppHeader
            title="Notifications"
            showBack
            subtitle={unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'À jour'}
            actionLabel={unreadCount > 0 ? 'Tout marquer lu' : undefined}
            onActionPress={markAllRead}
          />
          <ChipRow gutter={gutter} style={styles.chipRow}>
            {FILTERS.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                count={item.value === 'unread' && unreadCount > 0 ? unreadCount : undefined}
                selected={filter === item.value}
                onPress={() => setFilter(item.value)}
              />
            ))}
          </ChipRow>
        </>
      }
    >
      {request.loading ? (
        <SkeletonList count={4} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon="notification"
          title={filter === 'unread' ? 'Aucune notification non lue' : 'Aucune notification'}
          message={
            filter === 'unread'
              ? 'Vous êtes à jour. Les nouvelles alertes apparaîtront ici en temps réel.'
              : 'Les alertes sur les commentaires, les publications et les comptes apparaîtront ici.'
          }
          actionLabel={filter !== 'all' ? 'Voir toutes les notifications' : undefined}
          onAction={() => setFilter('all')}
        />
      ) : (
        <>
          <View style={styles.list}>
            {notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onPress={() => open(notification.id, notification.href)}
              />
            ))}
          </View>

          <Callout tone="neutral" icon="info">
            Notifications push par Firebase · l’historique reste disponible même hors ligne.
          </Callout>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { paddingBottom: spacing.xl, flexGrow: 0 },
  list: { gap: spacing.lg },
});
