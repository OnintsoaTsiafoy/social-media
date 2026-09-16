import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PublicationRow } from '@/components/domain/PublicationCard';
import { AnalyticsInsightPanel } from '@/components/domain/AnalyticsInsightPanel';
import {
  AppHeader,
  Callout,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  MetricCard,
  MetricGrid,
  Screen,
  SectionHeader,
  SegmentedControl,
  SentimentMeter,
  SkeletonList,
  StackedBarChart,
  Text,
} from '@/components/ui';
import { analyticsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { formatDelta, formatMetric, formatPercent, formatRelative } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing, useResponsive } from '@/theme';
import type { SocialNetwork } from '@/types';

type Period = '7d' | '30d' | '90d';

/**
 * ÉCRAN 22 - Tableau de bord Analytics global (`/analytics`)
 *
 * Metrics a platform does not provide render as "Non disponible", never as 0 -
 * a hard rule in the spec.
 */
export default function AnalyticsScreen() {
  const router = useRouter();
  const { gutter } = useResponsive();
  const { brand } = useSession();

  const [period, setPeriod] = useState<Period>('30d');
  const [network, setNetwork] = useState<SocialNetwork | 'all'>('all');

  const request = useAsync(() => analyticsApi.overview(brand?.id ?? '', period, network), [brand?.id, period, network]);
  const overview = request.data;
  const totals = overview?.totals;

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <>
          <AppHeader
            title="Analytics"
            actions={
              <SegmentedControl
                label="Période"
                value={period}
                options={[
                  { value: '7d', label: '7 j' },
                  { value: '30d', label: '30 j' },
                  { value: '90d', label: '90 j' },
                ]}
                onChange={setPeriod}
              />
            }
          />
          <ChipRow gutter={gutter} style={styles.chipRow}>
            <Chip label="Tous réseaux" selected={network === 'all'} onPress={() => setNetwork('all')} />
            <Chip
              label="Facebook"
              selected={network === 'facebook'}
              onPress={() => setNetwork('facebook')}
            />
            <Chip
              label="Instagram"
              selected={network === 'instagram'}
              onPress={() => setNetwork('instagram')}
            />
          </ChipRow>
        </>
      }
    >
      {request.loading ? (
        <SkeletonList count={4} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : overview && totals ? (
        <>
          <MetricGrid>
            <MetricCard
              label="Réactions"
              value={formatMetric(totals.reactions)}
              unavailable={totals.reactions === null}
              delta={totals.deltas.reactions !== undefined ? formatDelta(totals.deltas.reactions) : undefined}
              minWidth={104}
            />
            <MetricCard
              label="Commentaires"
              value={formatMetric(totals.comments)}
              unavailable={totals.comments === null}
              delta={totals.deltas.comments !== undefined ? formatDelta(totals.deltas.comments) : undefined}
              minWidth={104}
            />
            <MetricCard
              label="Engagement"
              value={formatPercent(totals.engagementRate)}
              unavailable={totals.engagementRate === null}
              delta={
                totals.deltas.engagementRate !== undefined
                  ? formatDelta(totals.deltas.engagementRate)
                  : undefined
              }
              minWidth={104}
            />
            <MetricCard
              label="Portée"
              value={formatMetric(totals.reach)}
              unavailable={totals.reach === null}
              minWidth={104}
            />
            <MetricCard
              label="Impressions"
              value={formatMetric(totals.impressions)}
              unavailable={totals.impressions === null}
              minWidth={104}
            />
            <MetricCard
              label="Partages"
              value={formatMetric(totals.shares, { short: true })}
              unavailable={totals.shares === null}
              minWidth={104}
            />
          </MetricGrid>

          {brand ? <AnalyticsInsightPanel key={`${brand.id}:${period}:${network}`} brandId={brand.id} period={period} network={network}
            canGenerate={['OWNER', 'ADMIN', 'COMMUNITY_MANAGER'].includes(brand.role ?? '')} /> : null}

          <Card style={styles.card}>
            <SectionHeader title="Interactions" />
            <Text variant="micro" color={palette.inkFaint}>
              4 dernières semaines
            </Text>
            <StackedBarChart data={overview.interactions} />
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Sentiments" />
            <SentimentMeter
              positive={overview.sentiment.positive}
              neutral={overview.sentiment.neutral}
              negative={overview.sentiment.negative}
            />
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Traitement des commentaires" />
            <MetricGrid>
              <MetricCard
                label="Négatifs"
                value={formatMetric(totals.negativeComments, { short: true })}
                unavailable={totals.negativeComments === null}
                minWidth={90}
              />
              <MetricCard
                label="Urgents"
                value={formatMetric(totals.urgentComments, { short: true })}
                unavailable={totals.urgentComments === null}
                minWidth={90}
              />
              <MetricCard
                label="Réponses générées"
                value={formatMetric(totals.responsesGenerated, { short: true })}
                unavailable={totals.responsesGenerated === null}
                minWidth={90}
              />
              <MetricCard
                label="Réponses envoyées"
                value={formatMetric(totals.responsesSent, { short: true })}
                unavailable={totals.responsesSent === null}
                minWidth={90}
              />
            </MetricGrid>
          </Card>

          <View style={styles.section}>
            <SectionHeader
              title="Analyse concurrentielle"
              actionLabel="Comparer"
              onActionPress={() => router.push('/analytics/competitors')}
            />
            <Text variant="footnote" color={palette.inkFaint}>
              Situez vos performances publiques face aux concurrents suivis, réseau par réseau.
            </Text>
          </View>

          <View style={styles.section}>
            <SectionHeader
              title="Meilleures publications"
              actionLabel="Voir"
              onActionPress={() => router.push('/publications')}
            />
            {overview.topPublications.length === 0 ? (
              <EmptyState
                icon="trending"
                title="Pas encore de données"
                message="Les performances apparaîtront après votre première publication."
              />
            ) : (
              <View style={styles.list}>
                {overview.topPublications.map((publication) => (
                  <PublicationRow
                    key={publication.id}
                    publication={publication}
                    onPress={() => router.push(`/analytics/publications/${publication.id}`)}
                  />
                ))}
              </View>
            )}
          </View>

          {overview.unavailable.length > 0 ? (
            <Callout tone="warning" icon="info">
              Métriques non disponibles : {overview.unavailable.join(', ')}. La plateforme ne les
              fournit pas avec les permissions accordées.
            </Callout>
          ) : null}

          <Text variant="micro" color={palette.inkDisabled}>
            {overview.lastSyncAt ? `Dernière synchronisation : ${formatRelative(overview.lastSyncAt)} · ` : 'Statistiques pas encore synchronisées. '}
            « Non disponible » = métrique non fournie par la plateforme.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { paddingBottom: spacing.xl, flexGrow: 0 },
  card: { gap: spacing.xl },
  section: { gap: spacing.xl },
  list: { gap: spacing.lg },
});
