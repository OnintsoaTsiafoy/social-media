import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { networksLabel } from '@/components/domain/PublicationCard';
import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Card,
  ComparisonBar,
  DetailRow,
  Divider,
  ErrorState,
  IconButton,
  MetricCard,
  MetricGrid,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
  Thumbnail,
  networkMeta,
  publicationStatusMeta,
} from '@/components/ui';
import { analyticsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { excerpt, formatDateTime, formatMetric, formatPercent, formatRelative } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 23 - Analytics d’une publication (`/analytics/publications/:id`)
 */
export default function PublicationAnalyticsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { brand } = useSession();

  const request = useAsync(() => analyticsApi.forPublication(brand?.id ?? '', id), [brand?.id, id]);
  const data = request.data;
  const publication = data?.publication;
  const status = publication ? publicationStatusMeta[publication.status] : undefined;

  const maxReactions = Math.max(1, ...(data?.perNetwork ?? []).map((entry) => entry.reactions ?? 0));

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <AppHeader
          title="Performance"
          showBack
          actions={
            <IconButton
              name="sync"
              accessibilityLabel="Actualiser les statistiques"
              loading={request.refreshing}
              onPress={request.refresh}
            />
          }
        />
      }
      footer={
        publication ? (
          <View style={styles.footerRow}>
            <Button
              label="Ouvrir la publication"
              variant="secondary"
              onPress={() => router.push(`/publications/${publication.id}`)}
              style={styles.footerButton}
            />
            <Button
              label="Commentaires"
              onPress={() => router.push('/comments')}
              style={styles.footerButton}
            />
          </View>
        ) : undefined
      }
    >
      {request.loading ? (
        <SkeletonList count={3} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : data && publication && status ? (
        <>
          <Card
            onPress={() => router.push(`/publications/${publication.id}`)}
            style={styles.headCard}
          >
            <Thumbnail size={52} uri={publication.media?.uri} />
            <View style={styles.headText}>
              <Text variant="body" weight="bold" numberOfLines={2}>
                {excerpt(publication.text, 70)}
              </Text>
              <Text variant="micro" color={palette.inkFaint} numberOfLines={1}>
                {publication.publishedAt ? formatDateTime(publication.publishedAt) : '-'} ·{' '}
                {networksLabel(publication)}
              </Text>
            </View>
            <Badge label={status.label} tone={status.tone} />
          </Card>

          <MetricGrid>
            <MetricCard
              label="Réactions"
              value={formatMetric(publication.metrics.reactions)}
              unavailable={publication.metrics.reactions === null}
            />
            <MetricCard
              label="Commentaires"
              value={formatMetric(publication.metrics.comments)}
              unavailable={publication.metrics.comments === null}
            />
            <MetricCard
              label="Portée"
              value={formatMetric(publication.metrics.reach)}
              unavailable={publication.metrics.reach === null}
            />
            <MetricCard
              label="Engagement"
              value={formatPercent(publication.metrics.engagementRate)}
              unavailable={publication.metrics.engagementRate === null}
            />
            <MetricCard
              label="Impressions"
              value={formatMetric(publication.metrics.impressions)}
              unavailable={publication.metrics.impressions === null}
            />
            <MetricCard
              label="Partages"
              value={formatMetric(publication.metrics.shares)}
              unavailable={publication.metrics.shares === null}
            />
          </MetricGrid>

          <Card style={styles.card}>
            <SectionHeader title="Comparaison par réseau" />
            {data.perNetwork.length === 0 ? (
              <Text variant="footnote" color={palette.inkFaint}>
                Aucun réseau ciblé pour cette publication.
              </Text>
            ) : (
              data.perNetwork.map((entry) => (
                <ComparisonBar
                  key={entry.network}
                  label={networkMeta[entry.network].label}
                  value={entry.reactions}
                  valueLabel={
                    entry.reactions === null ? 'Non disponible' : `${entry.reactions} réactions`
                  }
                  max={maxReactions}
                  color={entry.network === 'facebook' ? palette.lime : palette.info}
                />
              ))
            )}
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Commentaires" />
            <View style={styles.badges}>
              <Badge label={`${data.sentiment.positive} positifs`} tone="success" />
              <Badge label={`${data.sentiment.neutral} neutres`} tone="neutral" />
              <Badge label={`${data.sentiment.negative} négatifs`} tone="danger" />
              {data.urgent > 0 ? <Badge label={`${data.urgent} urgent`} tone="warning" /> : null}
            </View>

            <Divider />

            <DetailRow label="Réponses IA générées" value={String(data.responsesGenerated)} />
            <DetailRow label="Réponses envoyées" value={String(data.responsesSent)} />

            <Button
              label="Ouvrir les commentaires"
              onPress={() => router.push('/comments')}
              block
              style={styles.commentsButton}
            />
          </Card>

          {data.unavailable.length > 0 ? (
            <Callout tone="warning" icon="info">
              {data.unavailable.join(', ')} : non disponibles (permission analytics non accordée).
            </Callout>
          ) : null}

          <Text variant="micro" color={palette.inkDisabled}>
            {publication.metrics.lastSyncAt
              ? `Dernière synchronisation : ${formatRelative(publication.metrics.lastSyncAt)}`
              : 'Statistiques pas encore synchronisées.'}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  headText: { flex: 1 },
  card: { gap: spacing.xl },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  commentsButton: { marginTop: spacing.md },
  footerRow: { flexDirection: 'row', gap: spacing.lg },
  footerButton: { flex: 1 },
});
