/**
 * Synchronisation des concurrents (section 7 du TODO analyse concurrentielle).
 *
 * Trois étapes enchaînées, une file par étape :
 *
 *   sync-competitor          profil public + audience du compte de la marque
 *          ↓
 *   sync-competitor-posts    publications publiques, dédupliquées
 *          ↓
 *   sync-competitor-metrics  relevé agrégé append-only
 *
 * Les découper plutôt que d'en faire une seule tâche a une conséquence
 * concrète : une erreur sur la pagination des publications ne rejoue pas
 * l'appel de profil déjà réussi, et le relevé agrégé se recalcule seul depuis
 * la base sans redemander quoi que ce soit à Meta.
 *
 * Contrairement à la synchronisation des commentaires et des métriques
 * (Sprints 08/12), l'écriture est faite ICI et non dans graph-api : il n'y a
 * pas de table concurrents côté graph-api, et c'est le worker qui possède
 * l'enchaînement des trois étapes et les règles de déduplication. graph-api
 * reste ce qu'il est partout ailleurs — la seule porte vers Meta, sans état.
 */

import { activeBrand } from './lib/active-brand.js';

const SELECT_COMPETITOR = `
  SELECT c.id,
         c.brand_id,
         c.platform,
         c.username,
         c.external_id,
         c.status,
         c.name,
         sa.id AS social_account_id,
         ${activeBrand('c.brand_id')} AS brand_alive
    FROM competitors c
    LEFT JOIN LATERAL (
      SELECT id
        FROM social_accounts
       WHERE brand_id = c.brand_id
         AND provider = c.platform
         AND status IN ('CONNECTED', 'EXPIRING')
       ORDER BY created_at ASC
       LIMIT 1
    ) sa ON true
   WHERE c.id = $1
`;

// Deux fenêtres de fraîcheur : un concurrent illisible n'est re-tenté que
// beaucoup plus rarement. Il peut redevenir lisible (compte repassé public,
// App Review acceptée), donc il n'est jamais exclu pour de bon — mais le
// re-tester au même rythme que les autres consommerait du quota Meta pour un
// résultat connu d'avance.
const SELECT_COMPETITORS_DUE = `
  SELECT id
    FROM competitors
   WHERE (
           (
             status <> 'UNAVAILABLE'
             AND (last_synced_at IS NULL OR last_synced_at < now() - make_interval(mins => $1::int))
           )
           OR (
             status = 'UNAVAILABLE'
             AND (last_synced_at IS NULL OR last_synced_at < now() - make_interval(mins => $2::int))
           )
         )
     AND ${activeBrand('competitors.brand_id')}
   ORDER BY last_synced_at NULLS FIRST
   LIMIT $3::int
`;

// COALESCE sur les champs d'identité : un refus Meta ne doit jamais effacer le
// nom ou l'avatar déjà connus (section 11, « Conserver la dernière donnée
// connue avec sa date »). Seuls le statut et l'erreur sont écrasés.
const UPDATE_COMPETITOR_PROFILE = `
  UPDATE competitors
     SET external_id = COALESCE($2, external_id),
         name = COALESCE($3, name),
         profile_url = COALESCE($4, profile_url),
         avatar_url = COALESCE($5, avatar_url),
         status = $6::"CompetitorStatus",
         last_error_code = $7,
         last_error_message = $8,
         last_synced_at = now(),
         updated_at = now()
   WHERE id = $1
`;

const UPDATE_ACCOUNT_AUDIENCE = `
  UPDATE social_accounts
     SET followers_count = $2,
         followers_synced_at = now(),
         updated_at = now()
   WHERE id = $1
`;

// `xmax = 0` distingue une insertion d'une mise à jour dans le RETURNING.
// Le WHERE du DO UPDATE applique « Mettre à jour uniquement les métriques
// ayant changé » : une publication revue à l'identique ne produit aucune
// écriture, et la requête ne rend alors aucune ligne.
const UPSERT_COMPETITOR_POST = `
  INSERT INTO competitor_posts
    (competitor_id, external_post_id, message, media_type, permalink, published_at,
     reactions_count, comments_count, shares_count, engagement_rate, synced_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
  ON CONFLICT (competitor_id, external_post_id) DO UPDATE
     SET message = EXCLUDED.message,
         media_type = EXCLUDED.media_type,
         permalink = EXCLUDED.permalink,
         published_at = EXCLUDED.published_at,
         reactions_count = EXCLUDED.reactions_count,
         comments_count = EXCLUDED.comments_count,
         shares_count = EXCLUDED.shares_count,
         engagement_rate = EXCLUDED.engagement_rate,
         synced_at = now()
   WHERE competitor_posts.reactions_count IS DISTINCT FROM EXCLUDED.reactions_count
      OR competitor_posts.comments_count IS DISTINCT FROM EXCLUDED.comments_count
      OR competitor_posts.shares_count IS DISTINCT FROM EXCLUDED.shares_count
      OR competitor_posts.message IS DISTINCT FROM EXCLUDED.message
  RETURNING (xmax = 0) AS inserted
`;

const AGGREGATE_RECENT_POSTS = `
  SELECT COUNT(*)::int AS posts,
         SUM(reactions_count)::int AS reactions,
         SUM(comments_count)::int AS comments,
         SUM(shares_count)::int AS shares
    FROM competitor_posts
   WHERE competitor_id = $1
     AND published_at >= now() - make_interval(days => $2::int)
`;

const LAST_KNOWN_FOLLOWERS = `
  SELECT followers_count
    FROM competitor_metrics
   WHERE competitor_id = $1 AND followers_count IS NOT NULL
   ORDER BY collected_at DESC
   LIMIT 1
`;

const INSERT_COMPETITOR_METRIC = `
  INSERT INTO competitor_metrics
    (competitor_id, collected_at, followers_count, posts_count,
     reactions_count, comments_count, shares_count, engagement_rate)
  VALUES ($1, now(), $2, $3, $4, $5, $6, $7)
  RETURNING id
`;

const MARK_SYNC_ERROR = `
  UPDATE competitors
     SET status = $2::"CompetitorStatus",
         last_error_code = $3,
         last_error_message = $4,
         last_synced_at = now(),
         updated_at = now()
   WHERE id = $1
`;

/** Fenêtre du relevé agrégé. 30 jours : assez pour absorber une marque qui
 * publie peu, assez court pour qu'une inflexion récente se voie. */
const METRIC_WINDOW_DAYS = 30;

function round4(value) {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Taux d'engagement en POURCENTAGE, avec exactement la même définition que
 * `services/api/src/competitors/indicators.js` : interactions moyennes par
 * publication, rapportées aux abonnés. Les deux implémentations doivent rester
 * alignées — c'est cette valeur qui est historisée et tracée dans les courbes,
 * pendant que l'API recalcule la sienne à la volée sur une période choisie.
 *
 * `null` dès qu'un terme manque : jamais de 0 fabriqué.
 */
export function engagementRatePercent({ interactions, posts, followers }) {
  if (interactions === null || !posts || !followers) return null;
  return round4((interactions / posts / followers) * 100);
}

export function createCompetitorSync({ query, fetchProfile, fetchPosts, fetchAudience, enqueue, logger = console }) {
  async function loadCompetitor(competitorId) {
    const rows = await query(SELECT_COMPETITOR, [competitorId]);
    return rows[0] ?? null;
  }

  /**
   * Balayage périodique : ne fait qu'élire des candidats et enfiler une étape
   * de profil pour chacun. Aucun appel Meta ici — même découpage que
   * metrics-sync.js, pour qu'un balayage reste borné et interruptible.
   */
  async function sweep({ staleAfterMinutes = 720, unavailableStaleAfterMinutes = 10_080, limit = 25 } = {}) {
    const rows = await query(SELECT_COMPETITORS_DUE, [staleAfterMinutes, unavailableStaleAfterMinutes, limit]);
    let queued = 0;
    for (const row of rows) {
      try {
        await enqueue('sync-competitor', { competitorId: row.id });
        queued += 1;
      } catch (error) {
        logger.warn?.({ scope: 'competitor-sweep', competitorId: row.id, error: error?.message });
      }
    }
    return { inspected: rows.length, queued };
  }

  /**
   * Étape 1 — profil public du concurrent, puis audience du compte de la
   * marque. Le second appel n'est pas facultatif : sans lui, le taux
   * d'engagement de la marque resterait indisponible et la comparaison
   * n'aurait rien à rapprocher.
   */
  async function syncProfile({ competitorId }) {
    const competitor = await loadCompetitor(competitorId);
    if (!competitor) return { skipped: 'unknown_competitor' };
    // Le balayage exclut déjà les marques archivées ; il reste le job ciblé
    // enfilé juste avant l'archivage.
    if (!competitor.brand_alive) return { skipped: 'brand_archived' };

    if (!competitor.social_account_id) {
      // Compte social déconnecté depuis l'ajout du concurrent : ce n'est pas
      // le concurrent qui est en cause, mais l'accès — d'où PERMISSION_REQUIRED
      // plutôt que UNAVAILABLE.
      await query(MARK_SYNC_ERROR, [
        competitorId,
        'PERMISSION_REQUIRED',
        'social_account_missing',
        'Aucun compte social connecté sur ce réseau pour interroger Meta.',
      ]);
      return { skipped: 'no_social_account' };
    }

    let profile;
    try {
      profile = await fetchProfile(competitor.social_account_id, competitor.platform, competitor.username);
    } catch (error) {
      // Panne de transport : transitoire par défaut, le prochain balayage
      // retentera. L'identité déjà connue est conservée.
      await query(MARK_SYNC_ERROR, [competitorId, 'SYNC_ERROR', error?.message ?? 'sync_failed', null]);
      logger.warn?.({ scope: 'competitor-profile', competitorId, error: error?.message });
      return { status: 'SYNC_ERROR', error: error?.message ?? 'sync_failed' };
    }

    await query(UPDATE_COMPETITOR_PROFILE, [
      competitorId,
      profile.externalId ?? null,
      profile.name ?? null,
      profile.profileUrl ?? null,
      profile.avatarUrl ?? null,
      profile.status,
      profile.status === 'ACTIVE' ? null : (profile.errorCode ?? profile.status),
      profile.status === 'ACTIVE' ? null : (profile.errorMessage ?? null),
    ]);

    // Audience de la marque : un échec ici ne compromet pas la collecte du
    // concurrent, il rend seulement le taux d'engagement non comparable.
    try {
      const audience = await fetchAudience(competitor.social_account_id);
      if (audience.status === 'ACTIVE') {
        await query(UPDATE_ACCOUNT_AUDIENCE, [competitor.social_account_id, audience.followersCount ?? null]);
      }
    } catch (error) {
      logger.warn?.({ scope: 'competitor-audience', socialAccountId: competitor.social_account_id, error: error?.message });
    }

    if (profile.status !== 'ACTIVE') {
      return { status: profile.status, error: profile.errorCode ?? null };
    }

    await enqueue('sync-competitor-posts', {
      competitorId,
      followersCount: profile.followersCount ?? null,
      postsCount: profile.postsCount ?? null,
    });

    return { status: 'ACTIVE', followersCount: profile.followersCount ?? null };
  }

  /**
   * Étape 2 — publications publiques. graph-api parcourt lui-même les pages
   * (jusqu'à `maxPages`) et rend un lot déjà normalisé ; le worker ne fait que
   * l'écrire sans jamais dupliquer.
   */
  async function syncPosts({ competitorId, followersCount = null, postsCount = null }) {
    const competitor = await loadCompetitor(competitorId);
    if (!competitor) return { skipped: 'unknown_competitor' };
    if (!competitor.brand_alive) return { skipped: 'brand_archived' };
    if (!competitor.social_account_id) return { skipped: 'no_social_account' };

    let result;
    try {
      result = await fetchPosts(competitor.social_account_id, competitor.platform, competitor.username);
    } catch (error) {
      await query(MARK_SYNC_ERROR, [competitorId, 'SYNC_ERROR', error?.message ?? 'posts_sync_failed', null]);
      logger.warn?.({ scope: 'competitor-posts', competitorId, error: error?.message });
      return { status: 'SYNC_ERROR', error: error?.message ?? 'posts_sync_failed' };
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const post of result.posts ?? []) {
      if (!post.externalPostId) continue;
      const interactions = sumKnown(post);
      const rows = await query(UPSERT_COMPETITOR_POST, [
        competitorId,
        post.externalPostId,
        post.message ?? null,
        post.mediaType ?? null,
        post.permalink ?? null,
        post.publishedAt ?? null,
        post.reactionsCount ?? null,
        post.commentsCount ?? null,
        post.sharesCount ?? null,
        engagementRatePercent({ interactions, posts: 1, followers: followersCount }),
      ]);
      if (rows.length === 0) unchanged += 1;
      else if (rows[0].inserted) inserted += 1;
      else updated += 1;
    }

    // Un refus survenu après une première page (`status` non ACTIVE avec des
    // publications déjà collectées) est enregistré, mais ce qui a été lu est
    // conservé : c'est un lot partiel, pas un échec.
    if (result.status && result.status !== 'ACTIVE') {
      await query(MARK_SYNC_ERROR, [
        competitorId,
        result.status,
        result.errorCode ?? result.status,
        result.errorMessage ?? null,
      ]);
    }

    await enqueue('sync-competitor-metrics', { competitorId, followersCount, postsCount });

    return { status: result.status ?? 'ACTIVE', inserted, updated, unchanged };
  }

  /**
   * Étape 3 — relevé agrégé append-only. Recalculé depuis la base, sans aucun
   * appel Meta : une ligne de plus, jamais une ligne modifiée ni supprimée
   * (« Ne pas supprimer les anciennes métriques »).
   */
  async function syncMetrics({ competitorId, followersCount = null, postsCount = null }) {
    const competitor = await loadCompetitor(competitorId);
    if (!competitor) return { skipped: 'unknown_competitor' };
    if (!competitor.brand_alive) return { skipped: 'brand_archived' };

    let followers = followersCount;
    if (followers === null || followers === undefined) {
      // Relance isolée de cette étape (ou profil ayant échoué) : on repart du
      // dernier chiffre connu plutôt que de produire un relevé sans audience.
      const rows = await query(LAST_KNOWN_FOLLOWERS, [competitorId]);
      followers = rows[0]?.followers_count ?? null;
    }

    const [aggregate] = await query(AGGREGATE_RECENT_POSTS, [competitorId, METRIC_WINDOW_DAYS]);
    const posts = aggregate?.posts ?? 0;

    // `SUM` rend NULL quand aucune valeur n'est connue : PostgreSQL applique
    // donc déjà la règle null-vs-zéro, à condition de ne pas la rattraper avec
    // un `?? 0` juste après — ce que fait pourtant le calcul des interactions
    // ci-dessous, mais seulement une fois établi qu'au moins une composante
    // est connue.
    const reactions = aggregate?.reactions ?? null;
    const comments = aggregate?.comments ?? null;
    const shares = aggregate?.shares ?? null;
    const interactions = [reactions, comments, shares].every((value) => value === null)
      ? null
      : (reactions ?? 0) + (comments ?? 0) + (shares ?? 0);

    const rows = await query(INSERT_COMPETITOR_METRIC, [
      competitorId,
      followers,
      postsCount ?? posts,
      reactions,
      comments,
      shares,
      engagementRatePercent({ interactions, posts, followers }),
    ]);

    return { metricId: rows[0]?.id ?? null, posts, interactions, followers };
  }

  return { sweep, syncProfile, syncPosts, syncMetrics };
}

function sumKnown(post) {
  const values = [post.reactionsCount, post.commentsCount, post.sharesCount];
  if (values.every((value) => value === null || value === undefined)) return null;
  return values.reduce((total, value) => total + (value ?? 0), 0);
}
