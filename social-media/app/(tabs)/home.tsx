import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CommentCard } from '@/components/domain/CommentCard';
import { PublicationRow } from '@/components/domain/PublicationCard';
import {
  Avatar,
  Badge,
  Callout,
  Card,
  Chip,
  ChipRow,
  DetailRow,
  ErrorState,
  Icon,
  IconButton,
  MetricCard,
  MetricGrid,
  Screen,
  SectionHeader,
  Skeleton,
  SkeletonList,
  Text,
  useFeedback,
} from '@/components/ui';
import { accountsApi, analyticsApi, commentsApi, dashboardApi, devSimulation } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { formatCompactNumber, formatPercent, formatRelative } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing, useResponsive } from '@/theme';

/**
 * ÉCRAN 06 - Tableau de bord (`/home`)
 *
 * Each block loads independently: a failing analytics call must not stop the
 * priority comments from rendering, which is an explicit rule in the spec.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { user, brand, unreadCount } = useSession();
  const { toast } = useFeedback();
  const { gutter } = useResponsive();

  const [syncing, setSyncing] = useState(false);

  const summary = useAsync(() => dashboardApi.summary(brand?.id ?? ''), []);
  const priority = useAsync(() => dashboardApi.priorityComments(brand?.id ?? ''), []);
  const upcoming = useAsync(() => dashboardApi.upcomingPublications(brand?.id ?? ''), []);
  const accounts = useAsync(() => accountsApi.list(brand?.id ?? '', brand?.name ?? ''), []);
  const analytics = useAsync(() => analyticsApi.overview(brand?.id ?? '', '30d'), []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      summary.refresh(),
      priority.refresh(),
      upcoming.refresh(),
      accounts.refresh(),
      analytics.refresh(),
    ]);
  }, [summary, priority, upcoming, accounts, analytics]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await commentsApi.sync(brand?.id ?? '');
      await refreshAll();
      toast('Synchronisation terminée.', 'success');
    } catch {
      toast('La synchronisation a échoué. Un compte doit être reconnecté.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const staleAccounts = (accounts.data ?? []).filter(
    (account) => account.status !== 'connected' && account.status !== 'expiring'
  );

  return (
    <Screen
      scroll
      refreshing={summary.refreshing}
      onRefresh={refreshAll}
      header={
        <View style={[styles.header, { paddingHorizontal: gutter }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Profil de ${user?.firstName ?? ''}, marque ${brand?.name ?? ''}`}
            onPress={() => router.push('/profile')}
            style={styles.identity}
          >
            <Avatar initials={user?.avatarInitials ?? '··'} size={40} ringed />
            <View style={styles.identityText}>
              <Text variant="micro" color={palette.inkFaint}>
                Bonjour {user?.firstName ?? ''}
              </Text>
              <View style={styles.brandRow}>
                <Text variant="callout" weight="bold" numberOfLines={1}>
                  {brand?.name ?? 'Marque'}
                </Text>
                <Icon name="chevronDown" size={13} color={palette.inkFaint} />
              </View>
            </View>
          </Pressable>

          <View style={styles.headerActions}>
            <IconButton
              name="sync"
              accessibilityLabel="Synchroniser maintenant"
              loading={syncing}
              onPress={syncNow}
            />
            <IconButton
              name="notification"
              accessibilityLabel={`Notifications, ${unreadCount} non lues`}
              badgeCount={unreadCount}
              onPress={() => router.push('/notifications')}
            />
          </View>
        </View>
      }
    >
      {/* Section 1 - quick indicators */}
      {summary.loading ? (
        <MetricGrid>
          {[0, 1, 2, 3].map((index) => (
            <Card key={index} style={styles.metricSkeleton}>
              <Skeleton width={22} height={22} />
              <Skeleton width={48} height={24} />
              <Skeleton height={11} />
            </Card>
          ))}
        </MetricGrid>
      ) : summary.error ? (
        <ErrorState compact message={summary.error} onRetry={summary.reload} />
      ) : summary.data ? (
        <MetricGrid>
          <MetricCard
            icon="publications"
            label="Publications planifiées"
            value={String(summary.data.scheduledCount).padStart(2, '0')}
            onPress={() => router.push('/publications')}
          />
          <MetricCard
            icon="comments"
            label="Nouveaux commentaires"
            value={String(summary.data.newCommentCount).padStart(2, '0')}
            onPress={() => router.push('/comments')}
          />
          <MetricCard
            icon="priority"
            label="Priorité élevée"
            value={String(summary.data.highPriorityCount).padStart(2, '0')}
            emphasis="danger"
            onPress={() => router.push('/comments')}
          />
          <MetricCard
            icon="ai"
            label="Réponses IA à valider"
            value={String(summary.data.pendingAiResponseCount).padStart(2, '0')}
            onPress={() => router.push('/comments')}
          />
        </MetricGrid>
      ) : null}

      {/* Section 2 - quick actions */}
      <ChipRow gutter={0}>
        <Chip label="+ Publication" variant="choice" selected onPress={() => router.push('/publications/new')} />
        <Chip label="Calendrier" onPress={() => router.push('/calendar')} />
        <Chip label="Commentaires" onPress={() => router.push('/comments')} />
        <Chip label="Comptes sociaux" onPress={() => router.push('/settings/social-accounts')} />
        <Chip label="Synchroniser" onPress={syncNow} />
      </ChipRow>

      {/* Account needing attention - surfaced high because it blocks publishing */}
      {staleAccounts.length > 0 ? (
        <Callout tone="warning" icon="clock" title="Compte social à reconnecter">
          <Text variant="footnote" color={palette.warningText}>
            {staleAccounts.map((account) => account.username).join(', ')} doit être reconnecté par un
            administrateur de la plateforme pour reprendre les envois et la synchronisation.
          </Text>
          <Text
            variant="body"
            weight="bold"
            color={palette.warningText}
            accessibilityRole="link"
            onPress={() => router.push('/settings/social-accounts')}
            style={styles.calloutLink}
          >
            Ouvrir les comptes sociaux
          </Text>
        </Callout>
      ) : null}

      {/* Section 3 - priority comments, first as required */}
      <View style={styles.section}>
        <SectionHeader
          title="Commentaires prioritaires"
          actionLabel="Tout voir"
          onActionPress={() => router.push('/comments')}
        />
        {priority.loading ? (
          <SkeletonList count={2} withThumbnail={false} />
        ) : priority.error ? (
          <ErrorState compact message={priority.error} onRetry={priority.reload} />
        ) : (priority.data ?? []).length === 0 ? (
          <Card tone="muted">
            <Text variant="footnote" color={palette.inkMuted}>
              Aucun commentaire prioritaire en attente. Tout est traité.
            </Text>
          </Card>
        ) : (
          <View style={styles.list}>
            {priority.data?.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                onPress={() => router.push(`/comments/${comment.id}`)}
                onTreat={() => router.push(`/comments/${comment.id}/response`)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Section 4 - upcoming publications */}
      <View style={styles.section}>
        <SectionHeader
          title="Prochaines publications"
          actionLabel="Voir"
          onActionPress={() => router.push('/publications')}
        />
        {upcoming.loading ? (
          <SkeletonList count={2} />
        ) : upcoming.error ? (
          <ErrorState compact message={upcoming.error} onRetry={upcoming.reload} />
        ) : (upcoming.data ?? []).length === 0 ? (
          <Card tone="dashed" onPress={() => router.push('/publications/new')}>
            <Text variant="body" weight="bold" center color={palette.inkMuted}>
              Aucune publication planifiée
            </Text>
            <Text variant="micro" color={palette.inkFaint} center style={styles.emptyHint}>
              Créez votre première publication pour remplir le planning.
            </Text>
          </Card>
        ) : (
          <View style={styles.list}>
            {upcoming.data?.map((publication) => (
              <PublicationRow
                key={publication.id}
                publication={publication}
                onPress={() => router.push(`/publications/${publication.id}`)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Section 5 - social accounts */}
      <View style={styles.section}>
        <SectionHeader
          title="Comptes sociaux"
          actionLabel="Gérer"
          onActionPress={() => router.push('/settings/social-accounts')}
        />
        {accounts.loading ? (
          <SkeletonList count={2} />
        ) : accounts.error ? (
          <ErrorState compact message={accounts.error} onRetry={accounts.reload} />
        ) : (accounts.data ?? []).length === 0 ? (
          <Card tone="dashed" onPress={() => router.push('/settings/social-accounts')}>
            <Text variant="body" weight="bold" center>
              Connectez un compte social
            </Text>
            <Text variant="micro" color={palette.inkFaint} center style={styles.emptyHint}>
              Reliez une page Facebook ou un compte Instagram professionnel pour commencer.
            </Text>
          </Card>
        ) : (
          <Card style={styles.accountsCard}>
            {accounts.data?.map((account) => (
              <View key={account.id} style={styles.accountRow}>
                <View style={styles.accountText}>
                  <Text variant="body" weight="bold" numberOfLines={1}>
                    {account.name}
                  </Text>
                  <Text variant="micro" color={palette.inkFaint} numberOfLines={1}>
                    {account.username} ·{' '}
                    {account.lastSyncAt ? `synchro ${formatRelative(account.lastSyncAt)}` : 'jamais synchronisé'}
                  </Text>
                </View>
                {account.status === 'connected' ? (
                  <Badge label="Connecté" tone="success" />
                ) : (
                  <Text
                    variant="body"
                    weight="bold"
                    color={palette.warningText}
                    accessibilityRole="button"
                    onPress={() => router.push('/settings/social-accounts')}
                  >
                    Voir le compte
                  </Text>
                )}
              </View>
            ))}
          </Card>
        )}
      </View>

      {/* Section 6 - analytics summary */}
      <View style={styles.section}>
        <SectionHeader
          title="Résumé analytics"
          actionLabel="Voir les analytics"
          onActionPress={() => router.push('/analytics')}
        />
        {analytics.loading ? (
          <SkeletonList count={1} withThumbnail={false} />
        ) : analytics.error ? (
          <ErrorState compact message={analytics.error} onRetry={analytics.reload} />
        ) : analytics.data ? (
          <Card style={styles.analyticsCard}>
            <DetailRow
              label="Réactions"
              value={
                analytics.data.totals.reactions === null
                  ? 'Non disponible'
                  : formatCompactNumber(analytics.data.totals.reactions)
              }
            />
            <DetailRow
              label="Commentaires"
              value={
                analytics.data.totals.comments === null
                  ? 'Non disponible'
                  : formatCompactNumber(analytics.data.totals.comments)
              }
            />
            <DetailRow label="Engagement" value={formatPercent(analytics.data.totals.engagementRate)} />
            {analytics.data.topPublications[0] ? (
              <DetailRow
                label="Meilleure publication"
                value={analytics.data.topPublications[0].text.slice(0, 28) + '…'}
              />
            ) : null}
            <Text variant="micro" color={palette.inkDisabled}>
              {analytics.data.lastSyncAt
                ? `Dernière synchronisation : ${formatRelative(analytics.data.lastSyncAt)}`
                : 'Statistiques pas encore synchronisées.'}
            </Text>
          </Card>
        ) : null}
      </View>

      {/* Development affordance for demonstrating the error / offline states. */}
      <Card tone="muted" style={styles.devCard}>
        <Text variant="eyebrow">Démo des états</Text>
        <View style={styles.devActions}>
          <Chip
            label="Simuler une erreur"
            onPress={() => {
              devSimulation.failNextRead();
              void summary.reload();
            }}
          />
          <Chip
            label={devSimulation.get().offline ? 'Repasser en ligne' : 'Passer hors connexion'}
            onPress={() => {
              devSimulation.setOffline(!devSimulation.get().offline);
              void refreshAll();
            }}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['3xl'],
    paddingTop: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  identityText: { flex: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerActions: { flexDirection: 'row', gap: spacing.lg },

  metricSkeleton: { flexGrow: 1, flexBasis: 150, minWidth: 150, gap: spacing.md },
  section: { gap: spacing.xl },
  list: { gap: spacing.lg },
  emptyHint: { marginTop: spacing.sm },
  calloutLink: { marginTop: spacing.lg },

  accountsCard: { gap: spacing.xl },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  accountText: { flex: 1 },
  analyticsCard: { gap: spacing.xl },

  devCard: { gap: spacing.xl },
  devActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
