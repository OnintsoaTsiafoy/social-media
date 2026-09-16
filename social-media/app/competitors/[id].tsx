import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { competitorStatusMeta } from '@/components/domain/CompetitorCard';
import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Card,
  DetailRow,
  Divider,
  ErrorState,
  IconButton,
  MetricCard,
  MetricGrid,
  Screen,
  SectionHeader,
  SegmentedControl,
  SkeletonList,
  Text,
  useFeedback,
} from '@/components/ui';
import { competitorsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { excerpt, formatCompactNumber, formatDateTime, formatDelta, formatPercent, formatRelative } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';
import type { AnalyticsPeriod } from '@/types/analytics';
import type { AveragedMetric, CompetitorPost } from '@/types/competitors';

/**
 * Détail d'un concurrent (`/competitors/:id`).
 *
 * Toutes les métriques passent par `metricValue` : une valeur absente s'écrit
 * « Non disponible », jamais 0, et une moyenne calculée sur une partie
 * seulement des publications le dit. C'est la règle du projet, et la
 * section 11 du TODO la redemande explicitement pour les concurrents.
 */
export default function CompetitorDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { brand } = useSession();
  const { toast } = useFeedback();

  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
  const syncing = useMutation();

  const request = useAsync(
    () => (brand ? competitorsApi.analytics(brand.id, id, period) : Promise.resolve(null)),
    [brand?.id, id, period]
  );
  const postsRequest = useAsync(
    () => (brand ? competitorsApi.posts(brand.id, id, period) : Promise.resolve(null)),
    [brand?.id, id, period]
  );

  const data = request.data;
  const indicators = data?.indicators;
  const status = data ? competitorStatusMeta[data.competitor.status] : null;

  async function onSync() {
    if (!brand) return;
    const result = await syncing.run(() => competitorsApi.sync(brand.id, id));
    if (result.ok) toast('Synchronisation demandée. Les données seront mises à jour sous peu.');
    else if (result.error) toast(result.error, 'error');
  }

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <>
          <AppHeader
            title={data?.competitor.name ?? 'Concurrent'}
            showBack
            actions={
              <IconButton
                name="sync"
                accessibilityLabel="Synchroniser ce concurrent"
                loading={syncing.pending}
                onPress={onSync}
              />
            }
          />
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
        </>
      }
    >
      {request.loading ? <SkeletonList count={4} /> : null}
      {request.error ? <ErrorState message={request.error} onRetry={request.reload} /> : null}

      {data && indicators && status ? (
        <>
          <Card>
            <View style={styles.block}>
              <View style={styles.headerRow}>
                <View style={styles.identity}>
                  <Text weight="bold">{data.competitor.name}</Text>
                  <Text variant="footnote" color={palette.inkFaint}>
                    @{data.competitor.username} · {data.competitor.platform === 'facebook' ? 'Facebook' : 'Instagram'}
                  </Text>
                </View>
                <Badge label={status.label} tone={status.tone} />
              </View>

              <DetailRow
                label="Abonnés"
                value={
                  indicators.followersCount === null
                    ? 'Non disponible'
                    : formatCompactNumber(indicators.followersCount)
                }
              />
              <DetailRow
                label="Dernière synchronisation"
                value={
                  data.competitor.lastSyncedAt ? formatRelative(data.competitor.lastSyncedAt) : 'Jamais synchronisé'
                }
              />
              {data.competitor.profileUrl ? (
                <Button
                  label="Ouvrir le profil"
                  variant="ghost"
                  size="sm"
                  onPress={() => Linking.openURL(data.competitor.profileUrl as string)}
                />
              ) : null}
              {data.competitor.status !== 'active' ? (
                <Callout tone={status.tone === 'danger' ? 'danger' : 'warning'} title={status.label}>
                  {status.hint}
                </Callout>
              ) : null}
            </View>
          </Card>

          <SectionHeader title="Indicateurs de la période" />
          <MetricGrid>
            <MetricCard label="Publications" value={String(indicators.postsCount)} />
            <MetricCard label="Par semaine" value={indicators.postsPerWeek.toFixed(1)} />
            <MetricCard {...metricProps('Réactions / publication', indicators.avgReactions)} />
            <MetricCard {...metricProps('Commentaires / publication', indicators.avgComments)} />
            <MetricCard {...metricProps('Partages / publication', indicators.avgShares)} />
            <MetricCard
              label="Engagement moyen"
              value={
                indicators.engagementRate.value === null
                  ? 'Non disponible'
                  : formatPercent(indicators.engagementRate.value, 2)
              }
              unavailable={indicators.engagementRate.value === null}
              delta={
                indicators.engagementTrend.changePercent === null
                  ? undefined
                  : formatDelta(indicators.engagementTrend.changePercent)
              }
            />
          </MetricGrid>

          {indicators.mostFrequentWeekday || indicators.mostFrequentHour ? (
            <Card>
              <View style={styles.block}>
                <Text variant="eyebrow">Rythme de publication</Text>
                <DetailRow
                  label="Jour le plus fréquent"
                  value={
                    indicators.mostFrequentWeekday
                      ? `${indicators.mostFrequentWeekday.label} (${indicators.mostFrequentWeekday.count})`
                      : 'Non disponible'
                  }
                />
                <DetailRow
                  label="Heure la plus fréquente"
                  value={
                    indicators.mostFrequentHour
                      ? `${indicators.mostFrequentHour.label} (${indicators.mostFrequentHour.count})`
                      : 'Non disponible'
                  }
                />
              </View>
            </Card>
          ) : null}

          {data.history.length > 1 ? (
            <Card>
              <View style={styles.block}>
                <Text variant="eyebrow">Évolution des relevés</Text>
                {data.history.slice(-6).map((entry) => (
                  <DetailRow
                    key={entry.collectedAt}
                    label={formatDateTime(entry.collectedAt)}
                    value={
                      entry.engagementRate === null
                        ? `${entry.followersCount === null ? 'Non disponible' : formatCompactNumber(entry.followersCount)} abonnés`
                        : `${formatPercent(entry.engagementRate, 2)} · ${entry.followersCount === null ? 'abonnés non disponibles' : `${formatCompactNumber(entry.followersCount)} abonnés`}`
                    }
                  />
                ))}
              </View>
            </Card>
          ) : null}

          {data.topPosts.length > 0 ? (
            <>
              <SectionHeader title="Publications les plus performantes" />
              {data.topPosts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </>
          ) : null}

          <SectionHeader title="Publications récentes" />
          {postsRequest.loading ? <SkeletonList count={2} /> : null}
          {postsRequest.data?.items.length === 0 ? (
            <Text variant="footnote" color={palette.inkFaint}>
              Aucune publication collectée sur cette période.
            </Text>
          ) : null}
          {postsRequest.data?.items.map((post) => <PostCard key={post.id} post={post} />)}

          <Button
            label="Comparer avec ma marque"
            variant="secondary"
            onPress={() => router.push('/analytics/competitors')}
          />

          {data.warnings.length > 0 ? (
            <Callout tone="neutral" title="À savoir">
              {data.warnings.join(' ')}
            </Callout>
          ) : null}
        </>
      ) : null}

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

/** Une moyenne partielle ne se présente pas comme une moyenne complète : le
 * libellé porte l'échantillon réellement utilisé. */
function metricProps(label: string, metric: AveragedMetric) {
  if (metric.value === null) return { label, value: 'Non disponible', unavailable: true };
  return {
    label: metric.availability === 'partial' ? `${label} (sur ${metric.sampleSize})` : label,
    value: metric.value.toFixed(1),
  };
}

function PostCard({ post }: { post: CompetitorPost & { interactions?: number } }) {
  return (
    <Card>
      <View style={styles.block}>
        <Text variant="footnote" color={palette.inkFaint}>
          {post.publishedAt ? formatDateTime(post.publishedAt) : 'Date non disponible'}
          {post.mediaType ? ` · ${post.mediaType}` : ''}
        </Text>
        <Text>{post.message ? excerpt(post.message, 140) : 'Publication sans texte'}</Text>
        <Divider />
        <View style={styles.counters}>
          <Counter label="Réactions" value={post.reactionsCount} />
          <Counter label="Commentaires" value={post.commentsCount} />
          <Counter label="Partages" value={post.sharesCount} />
        </View>
        {post.permalink ? (
          <Button
            label="Voir sur le réseau"
            variant="ghost"
            size="sm"
            onPress={() => Linking.openURL(post.permalink as string)}
          />
        ) : null}
      </View>
    </Card>
  );
}

function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.counter}>
      <Text variant="micro" color={palette.inkFaint}>
        {label}
      </Text>
      <Text weight="semibold" color={value === null ? palette.inkDisabled : undefined}>
        {value === null ? 'N. d.' : formatCompactNumber(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  identity: { flex: 1, gap: 2 },
  counters: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  counter: { gap: 2 },
});
