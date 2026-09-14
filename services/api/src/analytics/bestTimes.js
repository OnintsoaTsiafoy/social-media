/**
 * Recommandation du meilleur horaire de publication (sprint_listing/PLUS/
 * TODO_RECOMMANDATION_MEILLEUR_HORAIRE.md).
 *
 * Module pur : aucun accès Prisma ici, volontairement — `analytics/service.js`
 * résout le fuseau et va chercher les métriques, ce fichier ne fait que du
 * calcul sur des lignes déjà résolues. Même séparation que `lib/socialMetrics.js`,
 * qui reste la seule source de vérité pour la formule d'engagement et la règle
 * null-vs-zéro ; ce module ne la réimplémente pas, il la consomme via
 * `sumInteractions`/`aggregateSnapshots` côté service.
 */

// Les 6 tranches du TODO, de 06h à 00h. Une publication envoyée entre 00h et
// 06h n'entre dans aucune tranche : c'est un choix du TODO, pas un oubli, donc
// elle est comptée à part plutôt que rattachée à un créneau qu'elle ne couvre pas.
export const SLOTS = [
  { id: '06-09', startHour: 6, endHour: 9, label: '06h00–09h00' },
  { id: '09-12', startHour: 9, endHour: 12, label: '09h00–12h00' },
  { id: '12-15', startHour: 12, endHour: 15, label: '12h00–15h00' },
  { id: '15-18', startHour: 15, endHour: 18, label: '15h00–18h00' },
  { id: '18-21', startHour: 18, endHour: 21, label: '18h00–21h00' },
  { id: '21-00', startHour: 21, endHour: 24, label: '21h00–00h00' },
];

export const WEEKDAY_LABELS_FR = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

// Sous ce seuil, un créneau jour×tranche ne peut pas produire de
// recommandation ("Refuser une recommandation reposant sur un échantillon
// trop faible" — TODO section 2).
export const MIN_PUBLICATIONS_PER_SLOT = 3;
const CONFIDENCE_HIGH_THRESHOLD = 10;
const CONFIDENCE_MEDIUM_THRESHOLD = 5;
// Échantillon au-delà duquel le coefficient de fiabilité de la formule de
// score (TODO section 3) est saturé à 1.
const RELIABILITY_SAMPLE_TARGET = 10;

const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekdayFormatterCache = new Map();

function weekdayFormatter(timezone) {
  let formatter = weekdayFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: 'numeric',
      hour12: false,
    });
    weekdayFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

/**
 * Jour de semaine (0 = lundi … 6 = dimanche, même convention que
 * `buildMonthGrid` côté mobile) et heure (0–23) d'un instant, lus dans
 * `timezone` plutôt que dans le fuseau du serveur.
 */
export function resolveWeekdayHour(date, timezone) {
  const parts = weekdayFormatter(timezone).formatToParts(date);
  const weekdayName = parts.find((part) => part.type === 'weekday')?.value;
  let hour = Number(parts.find((part) => part.type === 'hour')?.value);
  // `hour12: false` rend minuit sous la forme "24" sur certains moteurs ICU.
  if (hour === 24) hour = 0;
  return { weekday: WEEKDAY_ORDER.indexOf(weekdayName), hour };
}

/** La tranche couvrant `hour`, ou `null` pour 00h–06h (aucune tranche définie). */
export function slotForHour(hour) {
  return SLOTS.find((slot) => hour >= slot.startHour && hour < slot.endHour) ?? null;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// min === max (un seul créneau éligible, ou des valeurs identiques) : rien ne
// permet de départager, donc le terme ne pénalise ni n'avantage personne.
function normalise(value, values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? 1 : (value - min) / (max - min);
}

/**
 * `rows`: `{ weekday: 0-6, hour: 0-23, engagementRate, reach, interactions }[]`
 * déjà résolues côté service (fuseau appliqué, dernier relevé `social_metrics`
 * agrégé). `engagementRate`/`reach`/`interactions` valent `null` quand la
 * publication n'a pas encore de statistiques exploitables — ces lignes sont
 * exclues, pas comptées à zéro (TODO section 1 : "Exclure les publications
 * sans données suffisantes").
 *
 * Retourne le classement des 3 meilleurs créneaux selon la formule du TODO
 * section 3, ou `{ status: 'insufficient_data' }` si aucun créneau n'atteint
 * `MIN_PUBLICATIONS_PER_SLOT`.
 */
export function computeBestTimes(rows) {
  const buckets = new Map();
  let excludedOutsideSlots = 0;
  let excludedInsufficientData = 0;
  let analyzedCount = 0;

  for (const row of rows) {
    const slot = slotForHour(row.hour);
    if (!slot) {
      excludedOutsideSlots += 1;
      continue;
    }
    if (row.engagementRate === null) {
      excludedInsufficientData += 1;
      continue;
    }
    analyzedCount += 1;
    const key = `${row.weekday}-${slot.id}`;
    if (!buckets.has(key)) buckets.set(key, { weekday: row.weekday, slot, samples: [] });
    buckets.get(key).samples.push(row);
  }

  const eligible = [...buckets.values()].filter((bucket) => bucket.samples.length >= MIN_PUBLICATIONS_PER_SLOT);

  if (eligible.length === 0) {
    return {
      status: 'insufficient_data',
      analyzedCount,
      excludedOutsideSlots,
      excludedInsufficientData,
      minimumRequired: MIN_PUBLICATIONS_PER_SLOT,
      best: null,
      alternatives: [],
    };
  }

  const aggregated = eligible.map((bucket) => ({
    weekday: bucket.weekday,
    slot: bucket.slot,
    sampleSize: bucket.samples.length,
    engagementRate: average(bucket.samples.map((sample) => sample.engagementRate)),
    reach: average(bucket.samples.map((sample) => sample.reach)),
    interactions: average(bucket.samples.map((sample) => sample.interactions)),
  }));

  const engagementValues = aggregated.map((entry) => entry.engagementRate);
  const interactionValues = aggregated.map((entry) => entry.interactions);
  const reachValues = aggregated.map((entry) => entry.reach);
  const overallEngagementAverage = average(engagementValues);

  const scored = aggregated
    .map((entry) => {
      const engagementNorm = normalise(entry.engagementRate, engagementValues);
      const interactionsNorm = normalise(entry.interactions, interactionValues);
      const reachNorm = normalise(entry.reach, reachValues);
      const reliability = Math.min(entry.sampleSize / RELIABILITY_SAMPLE_TARGET, 1);
      // Formule exacte du TODO section 3.
      const score = engagementNorm * 0.5 + interactionsNorm * 0.25 + reachNorm * 0.15 + reliability * 0.1;
      const confidence =
        entry.sampleSize >= CONFIDENCE_HIGH_THRESHOLD
          ? 'high'
          : entry.sampleSize >= CONFIDENCE_MEDIUM_THRESHOLD
            ? 'medium'
            : 'low';
      const deltaVsAveragePercent =
        overallEngagementAverage > 0
          ? round(((entry.engagementRate - overallEngagementAverage) / overallEngagementAverage) * 100, 1)
          : null;

      return {
        weekday: entry.weekday,
        weekdayLabel: WEEKDAY_LABELS_FR[entry.weekday],
        slotId: entry.slot.id,
        slotStartHour: entry.slot.startHour,
        slotEndHour: entry.slot.endHour,
        slotLabel: entry.slot.label,
        score: round(score, 4),
        confidence,
        sampleSize: entry.sampleSize,
        metrics: {
          avgEngagementRate: round(entry.engagementRate, 4),
          avgReach: round(entry.reach, 1),
          avgInteractions: round(entry.interactions, 1),
        },
        deltaVsAveragePercent,
      };
    })
    .sort((a, b) => b.score - a.score);

  const [best, ...rest] = scored;
  return {
    status: 'ok',
    analyzedCount,
    excludedOutsideSlots,
    excludedInsufficientData,
    minimumRequired: MIN_PUBLICATIONS_PER_SLOT,
    best,
    alternatives: rest.slice(0, 2),
  };
}
