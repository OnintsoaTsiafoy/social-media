/**
 * Calcul des indicateurs concurrentiels (section 8 du TODO analyse
 * concurrentielle).
 *
 * Module pur : aucun accès Prisma ici, comme `analytics/bestTimes.js`. Il ne
 * reçoit que des publications déjà résolues (les nôtres comme celles d'un
 * concurrent, ramenées à la même forme par `analytics.js`) et rend des
 * indicateurs comparables.
 *
 * Deux règles structurent tout ce fichier :
 *
 * 1. Une métrique absente vaut `null`, jamais `0`. Une moyenne calculée sur un
 *    sous-ensemble seulement est marquée `partial` : l'écran doit pouvoir
 *    écrire « sur 12 publications sur 20 » plutôt que de laisser croire à un
 *    chiffre complet.
 *
 * 2. Deux côtés d'une comparaison ne sont rapprochés que si leurs métriques
 *    sont calculées de la même façon. C'est pour cela que `compare()` réduit
 *    d'abord les interactions aux composantes disponibles DES DEUX CÔTÉS
 *    (`commonComponents`) avant de calculer le moindre écart : comparer un
 *    total Facebook incluant les partages à un total Instagram qui n'en a pas
 *    fabriquerait un écart qui ne mesure rien.
 */

import { resolveWeekdayHour, WEEKDAY_LABELS_FR } from '../analytics/bestTimes.js';

export const INTERACTION_COMPONENTS = ['reactions', 'comments', 'shares'];

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// En dessous, une moyenne existe mais ne veut rien dire : elle est renvoyée
// quand même (le TODO ne demande pas de la masquer) mais accompagnée d'un
// avertissement, repris tel quel par l'IA (section 10).
export const LOW_SAMPLE_THRESHOLD = 5;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Moyenne d'une liste de valeurs potentiellement incomplète.
 *
 * @returns {{value: number|null, availability: 'available'|'partial'|'unavailable', sampleSize: number, total: number|null}}
 */
export function averageOf(values) {
  const known = values.filter((value) => value !== null && value !== undefined);
  if (known.length === 0) {
    return { value: null, availability: 'unavailable', sampleSize: 0, total: null };
  }
  const total = known.reduce((sum, value) => sum + value, 0);
  return {
    value: round(total / known.length),
    availability: known.length === values.length ? 'available' : 'partial',
    sampleSize: known.length,
    total,
  };
}

/**
 * Interactions d'une publication, restreintes aux composantes demandées.
 *
 * `null` si aucune des composantes retenues n'est connue — une publication dont
 * Meta masque les compteurs n'a pas « zéro interaction ».
 */
export function interactionsOf(post, components = INTERACTION_COMPONENTS) {
  const values = components.map((component) => post[`${component}Count`]);
  if (values.every((value) => value === null || value === undefined)) return null;
  return values.reduce((sum, value) => sum + (value ?? 0), 0);
}

/** Composantes réellement renseignées sur au moins une publication du lot. */
export function availableComponents(posts) {
  return INTERACTION_COMPONENTS.filter((component) =>
    posts.some((post) => post[`${component}Count`] !== null && post[`${component}Count`] !== undefined)
  );
}

/**
 * Écart relatif entre deux valeurs, en pourcentage.
 *
 * `null` dès qu'une des deux manque ou que la référence vaut 0 : un « +100 % »
 * fabriqué à partir de rien est pire qu'une absence de chiffre. Même règle que
 * `analytics/service.js::computeDeltas`.
 */
export function changePercent(current, previous) {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

function mostFrequent(counts, labelOf) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  const [key, count] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return { value: Number(key), label: labelOf(Number(key)), count };
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, '0')}h00`;
}

/**
 * Indicateurs d'un compte (concurrent ou marque) sur une période.
 *
 * @param {object} input
 * @param {Array} input.posts publications de la période, forme normalisée
 *   `{externalPostId, publishedAt, reactionsCount, commentsCount, sharesCount, message, permalink}`
 * @param {Array} [input.previousPosts] publications de la période précédente,
 *   pour l'évolution de l'engagement
 * @param {number|null} input.followersCount abonnés connus, ou `null`
 * @param {Date} input.from
 * @param {Date} input.to
 * @param {string} input.timezone fuseau de lecture des jours et heures
 * @param {string[]} [input.components] composantes d'interaction à retenir
 */
export function computeIndicators({
  posts,
  previousPosts = [],
  followersCount = null,
  from,
  to,
  timezone = 'Europe/Paris',
  components,
}) {
  const retained = components ?? availableComponents(posts);
  const warnings = [];
  const unavailable = [];

  const avgReactions = averageOf(posts.map((post) => post.reactionsCount));
  const avgComments = averageOf(posts.map((post) => post.commentsCount));
  const avgShares = averageOf(posts.map((post) => post.sharesCount));
  const avgInteractions = averageOf(posts.map((post) => interactionsOf(post, retained)));

  for (const [key, metric] of Object.entries({ reactions: avgReactions, comments: avgComments, shares: avgShares })) {
    if (metric.availability === 'unavailable') unavailable.push(key);
  }

  const weeks = Math.max((to.getTime() - from.getTime()) / MS_PER_WEEK, 1 / 7);
  const postsPerWeek = posts.length === 0 ? 0 : round(posts.length / weeks, 1);

  // Taux d'engagement = interactions moyennes par publication / abonnés.
  // Une seule définition dans tout le produit pour cette comparaison, et elle
  // est délibérément DIFFÉRENTE de celle du Sprint 12 (interactions / portée,
  // `lib/socialMetrics.js`) : la portée n'existe jamais pour un concurrent, et
  // mélanger les deux formules reviendrait exactement à ce que le TODO
  // interdit. Les deux ne doivent jamais être affichées sous le même nom.
  const engagementRate =
    avgInteractions.value === null || !followersCount
      ? { value: null, availability: 'unavailable' }
      : { value: round((avgInteractions.value / followersCount) * 100, 2), availability: avgInteractions.availability };

  if (engagementRate.value === null && !followersCount) unavailable.push('followersCount');

  const previousInteractions = averageOf(previousPosts.map((post) => interactionsOf(post, retained)));
  const previousEngagement =
    previousInteractions.value === null || !followersCount
      ? null
      : round((previousInteractions.value / followersCount) * 100, 2);

  const engagementTrend = {
    current: engagementRate.value,
    previous: previousEngagement,
    changePercent: changePercent(engagementRate.value, previousEngagement),
  };

  const weekdayCounts = {};
  const hourCounts = {};
  for (const post of posts) {
    if (!post.publishedAt) continue;
    const { weekday, hour } = resolveWeekdayHour(new Date(post.publishedAt), timezone);
    if (weekday < 0) continue;
    weekdayCounts[weekday] = (weekdayCounts[weekday] ?? 0) + 1;
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  const ranked = posts
    .map((post) => ({ post, interactions: interactionsOf(post, retained) }))
    .filter((entry) => entry.interactions !== null)
    .sort((a, b) => b.interactions - a.interactions);

  const topPost = ranked.length === 0 ? null : { ...ranked[0].post, interactions: ranked[0].interactions };

  if (posts.length === 0) {
    warnings.push('Aucune publication collectée sur la période.');
  } else if (posts.length < LOW_SAMPLE_THRESHOLD) {
    warnings.push(`Échantillon limité : ${posts.length} publication${posts.length > 1 ? 's' : ''} sur la période.`);
  }
  if (avgInteractions.availability === 'partial') {
    warnings.push(
      `Interactions connues pour ${avgInteractions.sampleSize} publication${avgInteractions.sampleSize > 1 ? 's' : ''} sur ${posts.length}.`
    );
  }

  return {
    periodStart: from.toISOString(),
    periodEnd: to.toISOString(),
    postsCount: posts.length,
    postsPerWeek,
    followersCount: followersCount ?? null,
    interactionComponents: retained,
    avgReactions,
    avgComments,
    avgShares,
    avgInteractions,
    engagementRate,
    engagementTrend,
    topPost,
    mostFrequentWeekday: mostFrequent(weekdayCounts, (value) => WEEKDAY_LABELS_FR[value]),
    mostFrequentHour: mostFrequent(hourCounts, hourLabel),
    unavailable: [...new Set(unavailable)],
    warnings,
  };
}

// Métriques réellement comparables entre deux comptes, avec leur unité. Le
// taux d'engagement n'y figure qu'à la condition d'avoir les abonnés des deux
// côtés — assurée par `compare()`, pas par cette table.
const COMPARABLE_METRICS = [
  { key: 'postsPerWeek', label: 'Publications par semaine', unit: 'count', path: (side) => side.postsPerWeek },
  { key: 'avgReactions', label: 'Réactions par publication', unit: 'count', path: (side) => side.avgReactions.value },
  { key: 'avgComments', label: 'Commentaires par publication', unit: 'count', path: (side) => side.avgComments.value },
  { key: 'avgShares', label: 'Partages par publication', unit: 'count', path: (side) => side.avgShares.value },
  { key: 'avgInteractions', label: 'Interactions par publication', unit: 'count', path: (side) => side.avgInteractions.value },
  { key: 'engagementRate', label: 'Taux d’engagement', unit: 'percent', path: (side) => side.engagementRate.value },
];

/**
 * Rapproche la marque et un concurrent, métrique par métrique.
 *
 * Les deux jeux d'indicateurs doivent avoir été calculés avec les mêmes
 * `components` — c'est `buildComparison` (analytics.js) qui s'en assure en les
 * recalculant sur l'intersection. Ici, une métrique dont un côté manque n'est
 * pas écartée : elle est renvoyée avec `availability: 'unavailable'`, pour que
 * l'écran affiche la ligne et écrive « Non disponible » dessus (section 11 :
 * « Ne pas bloquer tout l'écran si une seule métrique manque »).
 */
export function compare(brand, competitor) {
  return COMPARABLE_METRICS.map(({ key, label, unit, path }) => {
    const brandValue = path(brand);
    const competitorValue = path(competitor);
    const available = brandValue !== null && competitorValue !== null;
    return {
      key,
      label,
      unit,
      brand: brandValue,
      competitor: competitorValue,
      // Écart de la marque PAR RAPPORT au concurrent : positif = la marque fait
      // mieux. Orientation fixée ici une fois pour toutes, l'écran ne la
      // réinterprète pas.
      differencePercent: available ? changePercent(brandValue, competitorValue) : null,
      availability: available ? 'available' : 'unavailable',
    };
  });
}

/**
 * Intersection des composantes d'interaction disponibles des deux côtés.
 *
 * Renvoie une liste vide quand les deux comptes n'ont aucune composante en
 * commun : la comparaison des interactions est alors impossible, et l'appelant
 * doit le dire plutôt que de comparer des totaux hétérogènes.
 */
export function commonComponents(brandPosts, competitorPosts) {
  const brandSide = new Set(availableComponents(brandPosts));
  return availableComponents(competitorPosts).filter((component) => brandSide.has(component));
}
