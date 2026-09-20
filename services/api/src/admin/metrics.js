import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';

// Agrégats SQL partagés par la vue d'ensemble, l'analytique et le résumé de la
// coque de la console. Volontairement en SQL : la console lit toute la
// plateforme, jamais une marque, et ne doit pas charger des milliers de lignes
// pour les compter côté Node.
//
// Alias imposés dans chaque requête : c = social_comments, sa = social_accounts,
// a = comment_analyses (dernière analyse), sr = sent_responses.

const DAY_MS = 86_400_000;

export const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

/** Fenêtre demandée et fenêtre précédente de même durée (base des deltas). */
export function periodWindows(period, now = new Date()) {
  const days = PERIOD_DAYS[period];
  const from = new Date(now.getTime() - days * DAY_MS);
  return {
    days,
    current: { from, to: now },
    previous: { from: new Date(from.getTime() - days * DAY_MS), to: from },
  };
}

const PROVIDER_BY_NETWORK = { facebook: 'FACEBOOK', instagram: 'INSTAGRAM' };

export function providerOf(network) {
  return PROVIDER_BY_NETWORK[network] ?? null;
}

/** Filtre `AND …` sur le compte social (alias `sa`). Valeurs toujours liées. */
export function accountFilter({ network = 'all', pageId } = {}) {
  const provider = providerOf(network);
  return Prisma.sql`${
    provider ? Prisma.sql`AND sa.provider = ${provider}::"SocialProvider"` : Prisma.empty
  } ${pageId ? Prisma.sql`AND sa.id = ${pageId}::uuid` : Prisma.empty}`;
}

const iso = (date) => date.toISOString();

/**
 * Indice de seau d'une colonne horodatée : la fenêtre est découpée en `buckets`
 * durées égales. `column` est une constante du code, jamais une entrée client.
 */
function bucketOf(column, { from, to }, buckets) {
  const seconds = (to.getTime() - from.getTime()) / 1000 / buckets;
  return Prisma.sql`LEAST(${buckets - 1}::int, FLOOR(EXTRACT(EPOCH FROM (${Prisma.raw(column)} - ${iso(from)}::timestamptz)) / ${seconds}::float8))::int`;
}

/** Bornes de chaque seau, pour que le client puisse étiqueter l'axe. */
export function bucketBounds({ from, to }, buckets) {
  const step = (to.getTime() - from.getTime()) / buckets;
  return Array.from({ length: buckets }, (_, index) => ({
    start: new Date(from.getTime() + index * step).toISOString(),
    end: new Date(from.getTime() + (index + 1) * step).toISOString(),
  }));
}

const empty = (buckets, make) => Array.from({ length: buckets }, make);

// Délai entre le commentaire et la réponse envoyée. `::float8` : EXTRACT renvoie
// un numeric (donc un Decimal côté Prisma) depuis PostgreSQL 14.
const REPLY_SECONDS = Prisma.sql`EXTRACT(EPOCH FROM (sr.finished_at - COALESCE(c.meta_created_at, c.created_at)))::float8`;

/**
 * Commentaires reçus par seau, ventilés par sentiment de leur dernière analyse.
 * `pending` = pas encore analysé : jamais rangé arbitrairement dans « neutre ».
 */
export async function commentSentimentBuckets(window, buckets, filters) {
  const rows = await prisma.$queryRaw`
    SELECT ${bucketOf('c.created_at', window, buckets)} AS bucket,
           a.sentiment::text AS sentiment,
           COUNT(*)::int AS count
    FROM social_comments c
    JOIN social_accounts sa ON sa.id = c.social_account_id
    LEFT JOIN comment_analyses a ON a.id = c.latest_analysis_id
    WHERE c.created_at >= ${iso(window.from)}::timestamptz
      AND c.created_at < ${iso(window.to)}::timestamptz
      ${accountFilter(filters)}
    GROUP BY 1, 2`;

  const result = empty(buckets, () => ({ positive: 0, neutral: 0, negative: 0, pending: 0 }));
  for (const row of rows) {
    const key = row.sentiment ? row.sentiment.toLowerCase() : 'pending';
    if (result[row.bucket]) result[row.bucket][key] += row.count;
  }
  return result;
}

/**
 * Réponses réellement envoyées (sent_responses SUCCEEDED) par seau : nombre,
 * délai médian de première réponse, réponses IA envoyées sans retouche
 * (`generated_by_ai` reste vrai tant qu'un humain n'a pas réécrit le texte) et
 * réponses dans le délai cible.
 *
 * Le délai part de la date du commentaire chez Meta (repli : réception).
 */
export async function replyBuckets(window, buckets, { sentiment, slaSeconds = 0, ...filters } = {}) {
  const sentimentFilter =
    sentiment && sentiment !== 'all'
      ? Prisma.sql`AND a.sentiment = ${sentiment.toUpperCase()}::"CommentSentiment"`
      : Prisma.empty;

  const rows = await prisma.$queryRaw`
    SELECT ${bucketOf('sr.finished_at', window, buckets)} AS bucket,
           COUNT(*)::int AS replies,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${REPLY_SECONDS}) AS median_seconds,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM response_suggestions rs
             WHERE rs.comment_id = sr.comment_id AND rs.status = 'SENT' AND rs.generated_by_ai
           ))::int AS by_ai,
           COUNT(*) FILTER (WHERE ${REPLY_SECONDS} <= ${slaSeconds}::float8)::int AS within_sla
    FROM sent_responses sr
    JOIN social_comments c ON c.id = sr.comment_id
    JOIN social_accounts sa ON sa.id = sr.social_account_id
    LEFT JOIN comment_analyses a ON a.id = c.latest_analysis_id
    WHERE sr.status = 'SUCCEEDED'
      AND sr.finished_at >= ${iso(window.from)}::timestamptz
      AND sr.finished_at < ${iso(window.to)}::timestamptz
      AND sr.finished_at >= COALESCE(c.meta_created_at, c.created_at)
      ${accountFilter(filters)}
      ${sentimentFilter}
    GROUP BY 1`;

  const result = empty(buckets, () => ({ replies: 0, medianSeconds: null, byAi: 0, withinSla: 0 }));
  for (const row of rows) {
    if (!result[row.bucket]) continue;
    result[row.bucket] = {
      replies: row.replies,
      medianSeconds: row.median_seconds === null ? null : Number(row.median_seconds),
      byAi: row.by_ai,
      withinSla: row.within_sla,
    };
  }
  return result;
}

/** Escalades ouvertes par seau (une ligne d'historique vers ESCALATED = une escalade). */
export async function escalationBuckets(window, buckets, filters) {
  const rows = await prisma.$queryRaw`
    SELECT ${bucketOf('h.changed_at', window, buckets)} AS bucket,
           COUNT(DISTINCT h.comment_id)::int AS count
    FROM comment_status_history h
    JOIN social_comments c ON c.id = h.comment_id
    JOIN social_accounts sa ON sa.id = c.social_account_id
    WHERE h.to_status = 'ESCALATED'
      AND h.changed_at >= ${iso(window.from)}::timestamptz
      AND h.changed_at < ${iso(window.to)}::timestamptz
      ${accountFilter(filters)}
    GROUP BY 1`;

  const result = empty(buckets, () => 0);
  for (const row of rows) if (row.bucket in result) result[row.bucket] = row.count;
  return result;
}

const ratio = (part, whole) => (whole > 0 ? part / whole : null);

/** Fusionne des seaux de réponses en un seul (sommes ; la médiane doit être re-mesurée). */
export function sumReplyBuckets(list) {
  const replies = list.reduce((total, entry) => total + entry.replies, 0);
  const byAi = list.reduce((total, entry) => total + entry.byAi, 0);
  const withinSla = list.reduce((total, entry) => total + entry.withinSla, 0);
  return { replies, byAi, withinSla, aiRate: ratio(byAi, replies), slaRate: ratio(withinSla, replies) };
}

export { ratio };
