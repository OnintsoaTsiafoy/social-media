/**
 * Sprint 12 — agrégation des relevés `social_metrics`.
 *
 * Point d'entrée unique pour la formule d'engagement et la règle
 * null-vs-zéro (voir docs/SPRINT_12_ANALYTICS_REPORTING.md) : importé à la
 * fois par analytics/service.js et par publications/service.js (Jour 4), pour
 * qu'aucun des deux ne réimplémente la formule à sa façon.
 */
import { prisma } from '../db/prisma.js';

/**
 * Un relevé par cible, le plus récent — `social_metrics` est historisé
 * (une ligne par tentative de synchronisation), mais un écran affiche
 * toujours l'état courant, pas l'historique complet.
 *
 * @param {string[]} targetIds
 * @returns {Promise<Map<string, object>>} publicationTargetId -> relevé
 */
export async function latestMetricsByTarget(targetIds) {
  if (targetIds.length === 0) return new Map();
  const rows = await prisma.socialMetric.findMany({
    where: { publicationTargetId: { in: targetIds } },
    orderBy: { collectedAt: 'desc' },
    distinct: ['publicationTargetId'],
  });
  return new Map(rows.map((row) => [row.publicationTargetId, row]));
}

function sumNonNull(snapshots, key) {
  const values = snapshots.filter(Boolean).map((snapshot) => snapshot[key]).filter((value) => value !== null && value !== undefined);
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Même règle null-vs-zéro que `aggregateSnapshots` pour le seul numérateur
 * (reactions + comments + shares) — exposé séparément pour les appelants
 * (analytics/bestTimes.js) qui ont besoin des interactions sans vouloir
 * recalculer engagementRate.
 */
export function sumInteractions({ reactions, comments, shares }) {
  if ([reactions, comments, shares].every((value) => value === null || value === undefined)) return null;
  return (reactions ?? 0) + (comments ?? 0) + (shares ?? 0);
}

/**
 * Agrège une ou plusieurs cibles (relevés déjà résolus, potentiellement
 * `null` pour une cible jamais synchronisée) en un seul jeu de métriques.
 * `null` = aucune des cibles n'a de valeur pour cette métrique ; `0` = la
 * somme des valeurs connues vaut réellement zéro. engagementRate suit la
 * formule documentée au Jour 1 : (reactions + comments + shares) / reach,
 * `null` si reach est `null`/`0` ou si le numérateur est entièrement `null`.
 *
 * @param {(object|null)[]} snapshots
 */
export function aggregateSnapshots(snapshots) {
  const reactions = sumNonNull(snapshots, 'reactions');
  const comments = sumNonNull(snapshots, 'comments');
  const shares = sumNonNull(snapshots, 'shares');
  const reach = sumNonNull(snapshots, 'reach');
  const impressions = sumNonNull(snapshots, 'impressions');

  const numerator = [reactions, comments, shares].every((value) => value === null)
    ? null
    : (reactions ?? 0) + (comments ?? 0) + (shares ?? 0);
  const engagementRate = reach === null || reach === 0 || numerator === null ? null : numerator / reach;

  const collectedDates = snapshots.filter(Boolean).map((snapshot) => snapshot.collectedAt);
  const lastSyncedAt = collectedDates.length === 0 ? null : new Date(Math.max(...collectedDates.map((date) => date.getTime())));

  return { reactions, comments, shares, reach, impressions, engagementRate, lastSyncedAt };
}
