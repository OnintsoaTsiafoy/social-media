import { AppHeader, Button, Card, ErrorState, Screen, SkeletonList, Text } from '@/components/ui';
import { knowledgeApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/store/SessionProvider';

const percent = (value: number | null) => value == null ? '—' : `${Math.round(value * 100)} %`;
const labels: Record<string, string> = { positive: 'Positif', negative: 'Négatif', neutral: 'Neutre', question: 'Question', info_request: 'Demande d’information', complaint: 'Plainte', claim: 'Réclamation', other: 'Autre', unknown: 'Non analysé' };

export default function AiFeedbackScreen() {
  const { brand } = useSession();
  const request = useAsync(() => brand ? knowledgeApi.stats(brand.id) : Promise.resolve(null), [brand?.id]);
  const stats = request.data;
  return (
    <Screen scroll header={<AppHeader title="Qualité des réponses IA" showBack />}>
      <Text>Les décisions de votre équipe permettent de suivre et d’améliorer les propositions pour {brand?.name ?? 'votre marque'}.</Text>
      <Button label="Actualiser" variant="secondary" onPress={request.reload} disabled={request.loading} />
      {request.loading ? <SkeletonList count={4} /> : request.error ? <ErrorState message={request.error} onRetry={request.reload} /> : null}
      {stats ? <>
        {[
          ['Réponses générées', stats.generated], ['Acceptées', `${stats.accepted} · ${percent(stats.acceptanceRate)}`],
          ['Modifiées et validées', `${stats.edited} · ${percent(stats.editRate)}`], ['Rejetées', `${stats.rejected} · ${percent(stats.rejectionRate)}`],
          ['Remplacées par régénération', stats.regenerated], ['Confiance documentaire moyenne', percent(stats.averageConfidence)],
          ['Caractères modifiés en moyenne', stats.averageEditDistance?.toFixed(1) ?? '—'],
          ['Temps de génération moyen', stats.averageDurationMs == null ? '—' : `${(stats.averageDurationMs / 1000).toFixed(1)} s`],
          ['Satisfaction moyenne', stats.averageRating == null ? '—' : `${stats.averageRating.toFixed(1)} / 5`],
        ].map(([label, value]) => <Card key={label}><Text>{label}</Text><Text variant="title1">{value}</Text></Card>)}
        <Text variant="eyebrow">Sentiments</Text>
        {Object.entries(stats.sentiments).map(([key, count]) => <Text key={key}>{labels[key] ?? key} : {count}</Text>)}
        <Text variant="eyebrow">Intentions</Text>
        {Object.entries(stats.intents).map(([key, count]) => <Text key={key}>{labels[key] ?? key} : {count}</Text>)}
        <Text variant="footnote">Taux calculés sur toutes les générations, y compris les propositions encore sans décision. La confiance mesure la proximité des sources, pas la véracité de la réponse.</Text>
      </> : null}
    </Screen>
  );
}
