import { aggregateSnapshots, sumInteractions } from '../lib/socialMetrics.js';

const DAY = 86_400_000;
const PERIODS = { '7d': 7, '30d': 30, '90d': 90 };
const SOCIAL_KEYS = ['reactions', 'comments', 'shares', 'reach', 'impressions'];
const LABELS = {
  reactions: 'Réactions', comments: 'Commentaires', shares: 'Partages', reach: 'Portée',
  impressions: 'Impressions', engagement: 'Taux d’engagement', interactions: 'Interactions connues',
  positiveComments: 'Commentaires positifs', neutralComments: 'Commentaires neutres',
  negativeComments: 'Commentaires négatifs', negativeShare: 'Part des commentaires négatifs',
  urgentComments: 'Commentaires urgents', priorityComments: 'Commentaires prioritaires',
  responsesGenerated: 'Réponses IA générées', responsesSent: 'Réponses IA envoyées',
  responsesAccepted: 'Réponses IA acceptées', responsesReviewed: 'Réponses IA évaluées',
  acceptanceRate: 'Taux d’acceptation des réponses IA',
};

export const round = (number) => Math.round((number + Number.EPSILON) * 100) / 100;
const display = (number) => String(number).replace('.', ',');
const metric = (label, value, unit = 'count', availability = 'available') => ({
  label, value: value == null ? null : round(value), unit,
  availability: value == null ? 'unavailable' : availability,
});

export function insightRanges(period, now = new Date()) {
  const duration = PERIODS[period] * DAY;
  if (!duration) throw new Error('Invalid analytics period');
  return { from: new Date(now.getTime() - duration), to: now,
    previousFrom: new Date(now.getTime() - duration * 2) };
}

function summarizeCohort({ publications, metricsByTarget, comments }) {
  const snapshots = publications.flatMap((post) => post.targets.map((target) => metricsByTarget.get(target.id) ?? null));
  const aggregate = aggregateSnapshots(snapshots);
  const metrics = {};
  for (const key of SOCIAL_KEYS) {
    metrics[key] = metric(LABELS[key], aggregate[key], 'count',
      snapshots.every((snapshot) => snapshot?.[key] != null) ? 'available' : 'partial');
  }
  const interactionAvailability = ['reactions', 'comments', 'shares'].every((key) => metrics[key].availability === 'available')
    ? 'available' : 'partial';
  metrics.interactions = metric(LABELS.interactions, sumInteractions(aggregate), 'count', interactionAvailability);
  metrics.engagement = metric(LABELS.engagement, aggregate.engagementRate == null ? null : aggregate.engagementRate * 100,
    'percent', interactionAvailability === 'available' && metrics.reach.availability === 'available' ? 'available' : 'partial');
  const analyzed = comments.positive + comments.neutral + comments.negative;
  const analysisAvailability = comments.total === analyzed ? 'available' : 'partial';
  for (const [key, value] of Object.entries({ positiveComments: comments.positive, neutralComments: comments.neutral,
    negativeComments: comments.negative, urgentComments: comments.urgent, priorityComments: comments.priority })) {
    metrics[key] = metric(LABELS[key], analyzed ? value : null, 'count', analysisAvailability);
  }
  metrics.negativeShare = metric(LABELS.negativeShare, analyzed ? comments.negative / analyzed * 100 : null, 'percent', analysisAvailability);
  for (const key of ['responsesGenerated', 'responsesSent', 'responsesAccepted', 'responsesReviewed']) {
    metrics[key] = metric(LABELS[key], comments[key]);
  }
  metrics.acceptanceRate = metric(LABELS.acceptanceRate,
    comments.responsesReviewed ? comments.responsesAccepted / comments.responsesReviewed * 100 : null, 'percent');
  return { metrics, analyzed, publicationCount: publications.length, lastSyncAt: aggregate.lastSyncedAt };
}

/** AnalyticsSummary: only backend computations, never publication/comment text. */
export function buildAnalyticsSummary({ period, network, range, current, previous }) {
  const now = summarizeCohort(current), before = summarizeCohort(previous);
  const metrics = {};
  for (const [prefix, cohort] of [['current', now], ['previous', before]]) {
    for (const [key, value] of Object.entries(cohort.metrics)) metrics[`${prefix}.${key}`] = value;
  }
  const variations = [], facts = [], anomalies = [];
  function fact(type, key, polarity, message, recommendation = null, anomaly = false) {
    const source = metrics[key];
    if (!source || source.value == null || source.availability !== 'available') return;
    const value = { id: type, type, metric: key, value: source.value, unit: source.unit, polarity, message, recommendation };
    facts.push(value);
    if (anomaly) anomalies.push(value);
  }
  for (const key of Object.keys(now.metrics)) {
    const a = now.metrics[key], b = before.metrics[key];
    const social = [...SOCIAL_KEYS, 'interactions', 'engagement'].includes(key);
    const responses = key.startsWith('responses') || key === 'acceptanceRate';
    const enough = social ? now.publicationCount >= 3 && before.publicationCount >= 3
      : responses ? current.comments.responsesGenerated >= 3 && previous.comments.responsesGenerated >= 3
        : now.analyzed >= 5 && before.analyzed >= 5;
    const reason = a.availability !== 'available' || b.availability !== 'available' ? 'incomplete_metrics'
      : !enough ? 'insufficient_data' : b.value === 0 ? 'zero_baseline' : null;
    const changePercent = reason ? null : round((a.value - b.value) / b.value * 100);
    variations.push({ metric: key, current: a.value, previous: b.value, changePercent, reason });
    metrics[`variation.${key}`] = metric(`Variation : ${a.label}`, changePercent, 'percent');
    if (changePercent !== null && Math.abs(changePercent) >= 20 && ['engagement', 'interactions', 'negativeComments', 'urgentComments'].includes(key)) {
      const direction = changePercent > 0 ? 'increase' : 'decrease';
      const negativeMetric = ['negativeComments', 'urgentComments'].includes(key);
      const positive = negativeMetric ? changePercent < 0 : changePercent > 0;
      fact(`${key}_${direction}`, `variation.${key}`, positive ? 'positive' : 'attention',
        `${a.label} : ${changePercent > 0 ? '+' : ''}${display(changePercent)} % par rapport à la période précédente.`,
        negativeMetric ? 'Examiner les commentaires concernés et adapter leur prise en charge.'
          : 'Comparer les formats des publications les plus performantes pour préparer les prochaines.',
        key === 'interactions' && (changePercent >= 200 || changePercent <= -50));
    }
  }
  if (now.analyzed >= 5 && before.analyzed >= 5 && now.metrics.negativeShare.availability === 'available'
    && before.metrics.negativeShare.availability === 'available') {
    const shift = round(now.metrics.negativeShare.value - before.metrics.negativeShare.value);
    metrics.sentimentShift = metric('Évolution de la part négative', shift, 'percentage_points');
    if (Math.abs(shift) >= 10) fact('sentiment_shift', 'sentimentShift', shift < 0 ? 'positive' : 'attention',
      `La part des commentaires négatifs évolue de ${shift > 0 ? '+' : ''}${display(shift)} points.`,
      'Relire les commentaires négatifs pour identifier les sujets récurrents.', true);
  }
  const urgentDelta = now.metrics.urgentComments.value - before.metrics.urgentComments.value;
  if (now.analyzed >= 5 && before.analyzed >= 5 && now.metrics.urgentComments.availability === 'available'
    && before.metrics.urgentComments.availability === 'available' && urgentDelta >= 3) {
    metrics.urgentIncrease = metric('Commentaires urgents supplémentaires', urgentDelta);
    fact('urgent_increase', 'urgentIncrease', 'attention', `${urgentDelta} commentaires urgents supplémentaires sont signalés.`,
      'Traiter les commentaires urgents avant les autres demandes.', true);
  }

  const byNetwork = {}, byDay = {};
  const scored = current.publications.map((post) => {
    let score = null;
    for (const target of post.targets) {
      const snapshot = current.metricsByTarget.get(target.id);
      const value = snapshot ? sumInteractions(snapshot) : null;
      if (value == null) continue;
      score = (score ?? 0) + value;
      const name = target.provider.toLowerCase();
      byNetwork[name] = (byNetwork[name] ?? 0) + value;
    }
    const day = post.publishedAt.toISOString().slice(0, 10);
    if (score != null) byDay[day] = (byDay[day] ?? 0) + score;
    return { publicationId: post.id, publishedAt: post.publishedAt.toISOString(), interactions: score };
  }).filter((post) => post.interactions != null).sort((a, b) => b.interactions - a.interactions || a.publicationId.localeCompare(b.publicationId));
  const total = now.metrics.interactions.value;
  const complete = now.metrics.interactions.availability === 'available';
  const topPublications = scored.slice(0, 5).map((post, index) => ({ ...post, rank: index + 1,
    sharePercent: total > 0 && complete ? round(post.interactions / total * 100) : null }));
  if (topPublications[0]?.sharePercent >= 40 && now.publicationCount >= 3) {
    metrics.topPublicationShare = metric('Part de la première publication', topPublications[0].sharePercent, 'percent');
    fact('engagement_concentration', 'topPublicationShare', 'attention',
      `La première publication du classement concentre ${display(topPublications[0].sharePercent)} % des interactions.`,
      'Examiner le format de la première publication du classement avant de le reproduire.', true);
  }
  const networks = Object.entries(byNetwork).sort((a, b) => b[1] - a[1]);
  const bestNetwork = complete && networks.length === 2 && networks[0][1] > networks[1][1]
    ? { network: networks[0][0], interactions: networks[0][1] } : null;
  if (bestNetwork) {
    metrics.bestNetworkInteractions = metric('Interactions du réseau le plus performant', bestNetwork.interactions);
    fact('best_network', 'bestNetworkInteractions', 'positive',
      `${bestNetwork.network === 'facebook' ? 'Facebook' : 'Instagram'} arrive en tête avec ${bestNetwork.interactions} interactions.`,
      'Comparer les formats et le volume de publications de chaque réseau avant de réallouer les efforts.');
  }
  const days = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
  const otherMean = days.length > 1 ? (total - days[0][1]) / (days.length - 1) : 0;
  const interactionPeak = complete && days.length >= 3 && days[0][1] >= 10 && days[0][1] > otherMean * 2
    ? { date: days[0][0], interactions: days[0][1] } : null;
  if (interactionPeak) {
    metrics.peakInteractions = metric('Interactions du groupe de publications au pic', interactionPeak.interactions);
    fact('interaction_peak', 'peakInteractions', 'positive',
      `Les publications du jour le plus performant cumulent ${interactionPeak.interactions} interactions.`,
      'Examiner les publications du jour le plus performant pour identifier leurs points communs.', true);
  }
  for (const key of ['engagement', 'reactions', 'comments', 'urgentComments', 'priorityComments', 'acceptanceRate']) {
    const value = now.metrics[key];
    fact(`current_${key}`, `current.${key}`, ['urgentComments', 'priorityComments'].includes(key) && value.value > 0 ? 'attention' : 'neutral',
      `${value.label} : ${display(value.value)}${value.unit === 'percent' ? ' %' : ''}.`,
      key === 'urgentComments' && value.value > 0 ? 'Traiter les commentaires urgents avant les autres demandes.' : null);
  }
  const unavailableMetrics = Object.entries(metrics).filter(([key, value]) => !key.startsWith('variation.') && value.availability === 'unavailable').map(([key]) => key);
  const partialMetrics = Object.entries(metrics).filter(([, value]) => value.availability === 'partial').map(([key]) => key);
  const warnings = ['Les performances sont cumulées au dernier relevé et regroupées par date de publication ; elles ne mesurent pas les interactions reçues pendant la période.'];
  if (unavailableMetrics.length) warnings.push('Certaines métriques sont indisponibles et ne sont pas interprétées.');
  if (partialMetrics.length) warnings.push('Certaines métriques sont partielles ; leurs comparaisons et recommandations sont suspendues.');
  if (variations.some((value) => value.reason === 'insufficient_data')) warnings.push('Échantillon insuffisant pour certaines comparaisons entre périodes.');
  if (variations.some((value) => value.reason === 'zero_baseline')) warnings.push('Aucune variation en pourcentage n’est calculée à partir d’une référence nulle.');
  if (current.comments.total || previous.comments.total) warnings.push('Les sentiments reflètent la dernière analyse des commentaires importés pendant chaque période.');
  return { period, network, periodStart: range.from.toISOString(), periodEnd: range.to.toISOString(),
    previousPeriodStart: range.previousFrom.toISOString(), previousPeriodEnd: range.from.toISOString(),
    lastSyncAt: now.lastSyncAt?.toISOString() ?? null, metrics, variations, facts, anomalies,
    topPublications, bestNetwork, interactionPeak, unavailableMetrics, partialMetrics, warnings,
    coverage: { currentPublications: now.publicationCount, previousPublications: before.publicationCount,
      currentComments: current.comments.total, previousComments: previous.comments.total,
      currentAnalyzedComments: now.analyzed, previousAnalyzedComments: before.analyzed } };
}
