import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { competitorStatusMeta } from '@/components/domain/CompetitorCard';
import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Card,
  Chip,
  ChipRow,
  ComparisonBar,
  Divider,
  EmptyState,
  ErrorState,
  MetricCard,
  MetricGrid,
  Screen,
  SectionHeader,
  SegmentedControl,
  SkeletonList,
  Text,
} from '@/components/ui';
import { competitorsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { excerpt, formatDate, formatDelta, formatPercent, formatRelative } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing, useResponsive } from '@/theme';
import type { SocialNetwork } from '@/types';
import type { AnalyticsPeriod } from '@/types/analytics';
import type { ComparedMetric, CompetitorComparison, CompetitorExplanation } from '@/types/competitors';

/**
 * Comparaison marque / concurrents (`/analytics/competitors`).
 *
 * Chaque ligne du tableau porte sa propre disponibilité : une métrique absente
 * d'un côté s'affiche quand même, marquée « Non disponible ». Masquer la ligne
 * reviendrait à faire croire que la comparaison est complète.
 */
export default function CompetitorAnalyticsScreen() {
  const router = useRouter();
  const { gutter } = useResponsive();
  const { brand } = useSession();

  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
  const [platform, setPlatform] = useState<SocialNetwork | 'all'>('all');
  const [explanation, setExplanation] = useState<CompetitorExplanation | null>(null);
  const explaining = useMutation();

  const request = useAsync(
    () => (brand ? competitorsApi.comparison(brand.id, period, platform) : Promise.resolve(null)),
    [brand?.id, period, platform]
  );

  async function onExplain() {
    if (!brand) return;
    const result = await explaining.run(() => competitorsApi.explainComparison(brand.id, period, platform));
    if (result.ok && result.data) setExplanation(result.data);
  }

  const data = request.data;
  const comparisons = data?.comparisons ?? [];

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <>
          <AppHeader
            title="Analyse concurrentielle"
            showBack
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
            <Chip label="Tous réseaux" selected={platform === 'all'} onPress={() => setPlatform('all')} />
            <Chip label="Facebook" selected={platform === 'facebook'} onPress={() => setPlatform('facebook')} />
            <Chip label="Instagram" selected={platform === 'instagram'} onPress={() => setPlatform('instagram')} />
          </ChipRow>
        </>
      }
    >
      {request.loading ? <SkeletonList count={3} /> : null}
      {request.error ? <ErrorState message={request.error} onRetry={request.reload} /> : null}

      {data && comparisons.length === 0 && !request.loading ? (
        <EmptyState
          title="Aucun concurrent à comparer"
          message="Ajoutez un concurrent pour situer vos performances publiques."
          actionLabel="Ajouter un concurrent"
          onAction={() => router.push('/competitors/new')}
        />
      ) : null}

      {data && comparisons.length > 0 ? (
        <Text variant="footnote" color={palette.inkFaint}>
          Période du {formatDate(data.periodStart)} au {formatDate(data.periodEnd)}.
        </Text>
      ) : null}

      {comparisons.map((entry) => (
        <ComparisonCard key={entry.competitor.id} entry={entry} onOpen={() => router.push(`/competitors/${entry.competitor.id}`)} />
      ))}

      {comparisons.length > 0 ? (
        <>
          <SectionHeader title="Analyse IA" />
          <Text variant="footnote" color={palette.inkFaint}>
            Les chiffres sont calculés par Hootly ; l’IA ne fait que les expliquer et ne peut citer aucune valeur absente
            de cette comparaison.
          </Text>
          <Button
            label={explanation ? 'Régénérer l’analyse' : 'Expliquer les écarts'}
            variant="secondary"
            loading={explaining.pending}
            onPress={onExplain}
          />
          {explaining.error ? <Text variant="footnote" color={palette.dangerText}>{explaining.error}</Text> : null}

          {explanation ? (
            <Card>
              <View style={styles.block}>
                <Text>{explanation.text}</Text>
                {explanation.recommendations.length > 0 ? (
                  <>
                    <Divider />
                    <Text variant="eyebrow">Recommandations</Text>
                    {explanation.recommendations.map((recommendation) => (
                      <Text key={recommendation} variant="footnote">
                        • {recommendation}
                      </Text>
                    ))}
                  </>
                ) : null}
                {explanation.warnings.map((warning) => (
                  <Callout key={warning.code + warning.message} tone={warning.severity === 'warning' ? 'warning' : 'neutral'}>
                    {warning.message}
                  </Callout>
                ))}
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      {data?.warnings.map((warning) => (
        <Callout key={warning} tone="neutral">
          {warning}
        </Callout>
      ))}

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

function ComparisonCard({ entry, onOpen }: { entry: CompetitorComparison; onOpen: () => void }) {
  const status = competitorStatusMeta[entry.competitor.status];

  return (
    <Card>
      <View style={styles.block}>
        <View style={styles.headerRow}>
          <View style={styles.identity}>
            <Text weight="bold">{entry.competitor.name}</Text>
            <Text variant="footnote" color={palette.inkFaint}>
              {entry.network} · @{entry.competitor.username}
            </Text>
          </View>
          <Badge label={status.label} tone={status.tone} />
        </View>

        <MetricGrid>
          <MetricCard label="Mes publications" value={String(entry.brand.postsCount)} minWidth={120} />
          <MetricCard label="Ses publications" value={String(entry.competitorIndicators.postsCount)} minWidth={120} />
        </MetricGrid>

        <Divider />

        {entry.metrics.map((metric) => (
          <MetricComparisonRow key={metric.key} metric={metric} />
        ))}

        {entry.topPosts.competitor ? (
          <>
            <Divider />
            <Text variant="eyebrow">Sa publication la plus performante</Text>
            <Text variant="footnote">
              {entry.topPosts.competitor.message
                ? excerpt(entry.topPosts.competitor.message, 120)
                : 'Publication sans texte'}
            </Text>
            <Text variant="micro" color={palette.inkFaint}>
              {entry.topPosts.competitor.interactions} interactions
            </Text>
          </>
        ) : null}

        <Text variant="micro" color={palette.inkFaint}>
          {entry.competitor.lastSyncedAt
            ? `Dernière synchronisation ${formatRelative(entry.competitor.lastSyncedAt)}`
            : 'Jamais synchronisé'}
        </Text>

        {entry.notes.map((note) => (
          <Callout key={note} tone="neutral">
            {note}
          </Callout>
        ))}

        <Button label="Ouvrir la fiche" variant="secondary" size="sm" onPress={onOpen} />
      </View>
    </Card>
  );
}

function MetricComparisonRow({ metric }: { metric: ComparedMetric }) {
  const format = (value: number | null) =>
    value === null ? 'Non disponible' : metric.unit === 'percent' ? formatPercent(value, 2) : String(value);

  if (metric.availability !== 'available') {
    return (
      <View style={styles.metricRow}>
        <Text variant="body" weight="semibold">
          {metric.label}
        </Text>
        <Text variant="footnote" color={palette.inkDisabled}>
          Non disponible via Meta pour cette comparaison
        </Text>
      </View>
    );
  }

  const max = Math.max(metric.brand ?? 0, metric.competitor ?? 0);

  return (
    <View style={styles.metricRow}>
      <View style={styles.metricHeader}>
        <Text variant="body" weight="semibold">
          {metric.label}
        </Text>
        {metric.differencePercent === null ? null : (
          <Text
            variant="footnote"
            weight="semibold"
            color={metric.differencePercent >= 0 ? palette.successText : palette.dangerText}
          >
            {formatDelta(metric.differencePercent)}
          </Text>
        )}
      </View>
      <ComparisonBar label="Ma marque" value={metric.brand} valueLabel={format(metric.brand)} max={max} color={palette.lime} />
      <ComparisonBar
        label="Concurrent"
        value={metric.competitor}
        valueLabel={format(metric.competitor)}
        max={max}
        color={palette.inkFaint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { paddingBottom: spacing.md },
  block: { gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  identity: { flex: 1, gap: 2 },
  metricRow: { gap: spacing.sm },
  metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
});
