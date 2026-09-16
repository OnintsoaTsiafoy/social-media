import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Card, ErrorState, SectionHeader, SkeletonList, Text, TextField } from '@/components/ui';
import { analyticsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { palette, spacing } from '@/theme';
import type { SocialNetwork } from '@/types';
import type { AnalyticsInsight, AnalyticsPeriod } from '@/types/analytics';

type Props = { brandId: string; period: AnalyticsPeriod; network: SocialNetwork | 'all'; canGenerate: boolean };
const dateTime = (value: string) => new Date(value).toLocaleString('fr-FR');
const rangeLabel = (insight: AnalyticsInsight) => `Du ${dateTime(insight.periodStart)} au ${dateTime(insight.periodEnd)}`;
const networkLabel = (network: SocialNetwork | 'all') => network === 'all' ? 'Tous réseaux' : network === 'facebook' ? 'Facebook' : 'Instagram';

function Points({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <View style={styles.group}>
    <Text weight="semibold">{title}</Text>
    {items.map((item) => <Text key={item}>• {item}</Text>)}
  </View>;
}

function InsightDetails({ insight, onFeedback }: { insight: AnalyticsInsight; onFeedback: () => void }) {
  const router = useRouter();
  const feedback = useMutation();
  const [useful, setUseful] = useState<boolean | null>(insight.feedback?.useful ?? null);
  const [comment, setComment] = useState(insight.feedback?.comment ?? '');
  const [saved, setSaved] = useState(Boolean(insight.feedback));
  const [showSources, setShowSources] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function save() {
    if (useful === null) return;
    const result = await feedback.run(() => analyticsApi.insightFeedback(insight.brandId, insight.id, useful, comment));
    if (result.ok && mounted.current) { setSaved(true); onFeedback(); }
  }

  return <View style={styles.group}>
    {insight.historical ? <Callout tone="warning" icon="info">Analyse historique — les chiffres ci-dessous correspondent au relevé conservé lors de sa génération.</Callout> : null}
    <Text variant="micro" color={palette.inkFaint}>{rangeLabel(insight)} · {networkLabel(insight.network)}</Text>
    <Text variant="micro" color={palette.inkFaint}>Générée le {dateTime(insight.createdAt)}</Text>
    {insight.ai.status === 'fallback' ? <Callout tone="warning" icon="info">IA indisponible · Résumé local disponible</Callout> : null}
    <Text weight="semibold">{insight.summary}</Text>
    <Points title="Faits importants" items={insight.importantFacts} />
    <Points title="Points positifs" items={insight.positivePoints} />
    <Points title="Points d’attention" items={insight.attentionPoints} />
    <Points title="Recommandations" items={insight.recommendations} />
    <Points title="À savoir" items={insight.warnings} />
    <Button label={showSources ? 'Masquer les chiffres sources' : 'Voir les chiffres sources'} variant="ghost" size="sm" onPress={() => setShowSources(!showSources)} />
    {showSources ? <View style={styles.group}>
      <Text variant="micro">{insight.metricsSnapshot.lastSyncAt ? `Dernier relevé : ${dateTime(insight.metricsSnapshot.lastSyncAt)}` : 'Aucune synchronisation disponible.'}</Text>
      {Object.entries(insight.metricsSnapshot.metrics).filter(([key]) => key.startsWith('current.')).map(([key, metric]) => <Text key={key} variant="micro">
        {metric.label} : {metric.value === null ? 'Non disponible' : `${metric.value.toLocaleString('fr-FR')}${metric.unit === 'percent' ? ' %' : ''}`}{metric.availability === 'partial' ? ' (partiel)' : ''}
      </Text>)}
      {insight.metricsSnapshot.topPublications.map((post) => <Button key={post.publicationId} variant="ghost" size="sm"
        label={`Publication ${post.rank} · ${new Date(post.publishedAt).toLocaleDateString('fr-FR')} · ${post.interactions} interactions connues`}
        onPress={() => router.push(`/analytics/publications/${post.publicationId}`)} />)}
    </View> : null}
    <View style={styles.group}>
      <Text weight="semibold">Cette analyse était-elle utile ?</Text>
      <View style={styles.actions}>
        <Button label="👍 Oui" accessibilityState={{ selected: useful === true }} variant={useful === true ? 'accent' : 'secondary'} size="sm"
          disabled={feedback.pending} onPress={() => { setUseful(true); setSaved(false); }} />
        <Button label="👎 Non" accessibilityState={{ selected: useful === false }} variant={useful === false ? 'accent' : 'secondary'} size="sm"
          disabled={feedback.pending} onPress={() => { setUseful(false); setSaved(false); }} />
      </View>
      <TextField label="Commentaire facultatif" multiline maxLength={1000} value={comment} editable={!feedback.pending}
        onChangeText={(value) => { setComment(value); setSaved(false); }} />
      <Button label={saved ? 'Avis enregistré' : 'Enregistrer mon avis'} variant="secondary" size="sm"
        disabled={saved || useful === null} loading={feedback.pending} onPress={() => void save()} />
      {feedback.error ? <Callout tone="danger">{feedback.error}</Callout> : null}
    </View>
  </View>;
}

function InsightHistory({ brandId, period, network, onSelect }: Props & { onSelect: (insight: AnalyticsInsight) => void }) {
  const [page, setPage] = useState(1);
  const history = useAsync(() => analyticsApi.insightHistory(brandId, period, network, page), [brandId, period, network, page]);
  const stats = useAsync(() => analyticsApi.insightFeedbackStats(brandId, period, network), [brandId, period, network]);
  const detail = useMutation();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function select(id: string) {
    const result = await detail.run(() => analyticsApi.insightDetail(brandId, id));
    if (result.ok && mounted.current) onSelect(result.data);
  }

  return <View style={styles.group}>
    <Text weight="semibold">Historique · {networkLabel(network)} · {period.slice(0, -1)} jours</Text>
    {history.loading ? <SkeletonList count={2} withThumbnail={false} /> : history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : <>
      {history.data?.items.length === 0 ? <Text>Aucune analyse enregistrée pour ces filtres.</Text> : null}
      {history.data?.items.map((item) => <Button key={item.id} label={`${rangeLabel(item)} · Générée le ${dateTime(item.createdAt)}`}
        variant="secondary" size="sm" onPress={() => onSelect(item)} />)}
      <View style={styles.actions}>
        {page > 1 ? <Button label="Plus récentes" variant="ghost" size="sm" onPress={() => setPage(page - 1)} /> : null}
        {history.data && page * history.data.pageSize < history.data.total ? <Button label="Plus anciennes" variant="ghost" size="sm" onPress={() => setPage(page + 1)} /> : null}
      </View>
    </>}
    {stats.error ? <ErrorState message={stats.error} onRetry={stats.reload} /> : null}
    {stats.data ? <>
      <Text variant="micro">{stats.data.satisfactionRate === null ? 'Aucun avis pour ces filtres.' : `${stats.data.satisfactionRate.toLocaleString('fr-FR')} % d’avis positifs · ${stats.data.total} avis`}</Text>
      {stats.data.mostRejected.length ? <Text weight="semibold">Analyses ayant reçu le plus d’avis négatifs</Text> : null}
      {stats.data.mostRejected.map((entry) => <Button key={entry.insightId} label={`Consulter l’analyse · ${entry.rejections} avis négatifs`}
        variant="ghost" size="sm" disabled={detail.pending} onPress={() => void select(entry.insightId)} />)}
    </> : null}
    {detail.error ? <Callout tone="danger">{detail.error}</Callout> : null}
  </View>;
}

/** Parent keys this component by brand and filters: in-flight results cannot cross scopes. */
export function AnalyticsInsightPanel(props: Props) {
  const mutation = useMutation();
  const [current, setCurrent] = useState<AnalyticsInsight | null>(null);
  const [selected, setSelected] = useState<AnalyticsInsight | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function generate() {
    const result = await mutation.run(() => analyticsApi.generateInsight(props.brandId, props.period, props.network));
    if (result.ok && mounted.current) {
      setCurrent(result.data); setSelected(null); setRevision((value) => value + 1);
    }
  }
  const displayed = selected ?? current;

  return <Card style={styles.panel}>
    <SectionHeader title="Analyse IA" />
    <Text>Un résumé des performances et des actions suggérées pour la période sélectionnée.</Text>
    {props.canGenerate ? <Button label={current ? 'Régénérer' : 'Analyser cette période'} loading={mutation.pending} onPress={() => void generate()} />
      : <Text variant="micro">Un community manager peut générer une analyse. Vous pouvez consulter l’historique et donner votre avis.</Text>}
    {mutation.pending ? <Text accessibilityLiveRegion="polite" variant="micro">Analyse de la période en cours…</Text> : null}
    {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
    {selected && current ? <Button label="Revenir à l’analyse générée" variant="ghost" size="sm" onPress={() => setSelected(null)} /> : null}
    {displayed ? <InsightDetails key={`${displayed.id}:${displayed.historical}`} insight={displayed} onFeedback={() => setRevision((value) => value + 1)} /> : null}
    <Button label={showHistory ? 'Fermer l’historique' : 'Consulter l’historique'} variant="secondary" size="sm" onPress={() => setShowHistory(!showHistory)} />
    {showHistory ? <InsightHistory key={revision} {...props} onSelect={setSelected} /> : null}
  </Card>;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.lg }, group: { gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
