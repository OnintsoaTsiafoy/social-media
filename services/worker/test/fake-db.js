/**
 * Double de PostgreSQL pour les tests du worker.
 *
 * Il reconnaît les requêtes réellement émises par `src/delivery.js` et
 * `src/cleanup-media.js` et applique leurs effets sur un état en mémoire. Les
 * garanties testées (verrou conditionnel, clé d'idempotence, statut global)
 * dépendent de ces effets, pas d'un moteur SQL.
 */

export function createFakeDb(initial = {}) {
  const state = {
    publications: initial.publications ?? [],
    targets: initial.targets ?? [],
    attempts: initial.attempts ?? [],
    schedules: initial.schedules ?? [],
    media: initial.media ?? [],
    publicationMedia: initial.publicationMedia ?? [],
    socialAccounts: initial.socialAccounts ?? [],
    comments: initial.comments ?? [],
    analyses: initial.analyses ?? [],
    brandMembers: initial.brandMembers ?? [],
    calls: [],
  };

  function publication(id) {
    return state.publications.find((row) => row.id === id);
  }

  async function query(text, params = []) {
    state.calls.push(text.trim().split('\n')[0].trim());

    if (text.includes("SET status = 'PUBLISHING'")) {
      const row = publication(params[0]);
      const claimable = ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'FAILED', 'PARTIALLY_PUBLISHED'];
      if (!row || row.deleted_at || !claimable.includes(row.status)) return [];
      row.status = 'PUBLISHING';
      return [row];
    }

    if (text.includes('adapted_content, adapted_hashtags, attempt_count')) {
      return state.targets.filter((row) => row.publication_id === params[0]);
    }

    // NOTE: cleanup-media.js's own SELECT_ORPHANS query contains a `NOT
    // EXISTS (SELECT 1 FROM publication_media pm WHERE pm.media_id = m.id)`
    // subquery, so matching on the bare "FROM publication_media pm" text
    // would incorrectly intercept it too — "ORDER BY pm.position" is unique
    // to this query.
    if (text.includes('ORDER BY pm.position')) {
      return (state.publicationMedia ?? []).filter((row) => row.publication_id === params[0]);
    }

    if (text.includes("SET status = 'SENDING'")) {
      const target = state.targets.find((row) => row.id === params[0]);
      if (!target || !['PENDING', 'FAILED'].includes(target.status)) return [];
      target.status = 'SENDING';
      return [{ attempt_count: target.attempt_count }];
    }

    if (text.includes('INSERT INTO publication_delivery_attempts')) {
      const [targetId, attemptNumber, idempotencyKey] = params;
      // ON CONFLICT (idempotency_key) DO NOTHING
      if (state.attempts.some((row) => row.idempotency_key === idempotencyKey)) return [];
      const attempt = {
        id: `attempt-${state.attempts.length + 1}`,
        publication_target_id: targetId,
        attempt_number: attemptNumber,
        idempotency_key: idempotencyKey,
        status: 'STARTED',
      };
      state.attempts.push(attempt);
      return [{ id: attempt.id }];
    }

    if (text.includes("SET status = 'SUCCEEDED'")) {
      const attempt = state.attempts.find((row) => row.id === params[0]);
      Object.assign(attempt, { status: 'SUCCEEDED', external_publication_id: params[1] });
      return [];
    }

    if (text.includes("SET status = 'FAILED', error_code")) {
      const attempt = state.attempts.find((row) => row.id === params[0]);
      Object.assign(attempt, { status: 'FAILED', error_code: params[1], error_message: params[2] });
      return [];
    }

    if (text.includes("SET status = 'SENT'")) {
      const target = state.targets.find((row) => row.id === params[0]);
      Object.assign(target, {
        status: 'SENT',
        external_publication_id: params[1],
        attempt_count: params[2],
        last_error_code: null,
      });
      return [];
    }

    if (text.includes("SET status = 'FAILED', attempt_count")) {
      const target = state.targets.find((row) => row.id === params[0]);
      Object.assign(target, {
        status: 'FAILED',
        attempt_count: params[1],
        last_error_code: params[2],
        last_error_message: params[3],
      });
      return [];
    }

    if (text.includes('SELECT status FROM publication_targets')) {
      return state.targets.filter((row) => row.publication_id === params[0]).map((row) => ({ status: row.status }));
    }

    if (text.includes('UPDATE publications') && text.includes('SET status = $2')) {
      const row = publication(params[0]);
      row.status = params[1];
      if (params[2] && !row.published_at) row.published_at = new Date().toISOString();
      return [];
    }

    if (text.includes('SELECT status FROM scheduled_publications')) {
      const schedule = state.schedules.find((row) => row.publication_id === params[0]);
      return schedule ? [{ status: schedule.status }] : [];
    }

    if (text.includes('UPDATE scheduled_publications')) {
      const schedule = state.schedules.find((row) => row.publication_id === params[0]);
      if (schedule && schedule.status === 'PENDING') schedule.status = 'DISPATCHED';
      return [];
    }

    if (text.includes('FROM media m')) {
      const [olderThanHours, limit] = params;
      const threshold = Date.now() - olderThanHours * 3600 * 1000;
      return state.media
        .filter(
          (row) =>
            row.status === 'TEMPORARY' &&
            !row.deleted_at &&
            new Date(row.created_at).getTime() < threshold &&
            !row.attached
        )
        .slice(0, limit)
        .map((row) => ({ id: row.id, bucket: row.bucket, object_key: row.object_key }));
    }

    if (text.includes('UPDATE media SET')) {
      const row = state.media.find((item) => item.id === params[0]);
      Object.assign(row, { status: 'DELETED', deleted_at: new Date().toISOString() });
      return [];
    }

    // Sprint 08 comment-sync.js's own candidate-selection query also starts
    // with `FROM social_accounts`, without the `sa` alias token-refresh.js
    // uses — matched here on `last_comments_sync_at` instead, a fragment
    // unique to this query, per this file's own established lesson (see the
    // `pm.position`/`publication_media` note above) about picking maximally
    // specific substrings rather than a generic table name.
    if (text.includes('last_comments_sync_at')) {
      const [staleAfterMinutes, limit] = params;
      const staleThreshold = Date.now() - staleAfterMinutes * 60 * 1000;
      return (state.socialAccounts ?? [])
        .filter((row) => {
          if (!['CONNECTED', 'EXPIRING'].includes(row.status)) return false;
          return !row.last_comments_sync_at || new Date(row.last_comments_sync_at).getTime() < staleThreshold;
        })
        .sort((a, b) => {
          if (!a.last_comments_sync_at) return -1;
          if (!b.last_comments_sync_at) return 1;
          return new Date(a.last_comments_sync_at).getTime() - new Date(b.last_comments_sync_at).getTime();
        })
        .slice(0, limit)
        .map((row) => ({ id: row.id, provider: row.provider }));
    }

    // Sprint 09 comment-analysis.js. `latest_analysis_id IS NULL` est propre à
    // la sélection des commentaires non analysés — même règle que plus haut :
    // on choisit le fragment le plus spécifique, pas le nom de la table.
    // Sprint 11 Jour 3 : la vraie requête joint social_accounts pour
    // brand_id/provider — les fixtures portent ces champs directement sur la
    // ligne de commentaire plutôt que de faire faire un vrai join à ce double.
    if (text.includes('latest_analysis_id IS NULL')) {
      const [limit] = params;
      return (state.comments ?? [])
        .filter(
          (row) =>
            !row.latest_analysis_id &&
            typeof row.content === 'string' &&
            row.content.trim().length > 0 &&
            !row.is_deleted_on_platform
        )
        .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          content: row.content,
          author_name: row.author_name ?? null,
          brand_id: row.brand_id ?? null,
          provider: row.provider ?? null,
        }));
    }

    // Sprint 11 Jour 3 — résolution des destinataires d'une notification de
    // portée marque (comment-analysis.js). Fragment unique à cette requête
    // dans ce double : aucune autre ne sélectionne `brand_members`.
    if (text.includes('FROM brand_members')) {
      const [brandId] = params;
      const eligible = ['COMMUNITY_MANAGER', 'ADMIN', 'OWNER'];
      return (state.brandMembers ?? [])
        .filter((row) => row.brand_id === brandId && eligible.includes(row.role))
        .map((row) => ({ user_id: row.user_id }));
    }

    if (text.includes('INSERT INTO comment_analyses')) {
      const [commentId, sentiment, intent, priority] = params;
      const analysis = {
        id: `analysis-${state.analyses.length + 1}`,
        comment_id: commentId,
        sentiment,
        intent,
        priority,
        model_version: params[15],
      };
      state.analyses.push(analysis);
      // Le CTE met à jour le pointeur dans le même énoncé : le double doit
      // reproduire cet effet, sinon un commentaire déjà analysé ressortirait
      // du balayage suivant et le test ne prouverait rien.
      const comment = state.comments.find((row) => row.id === commentId);
      if (comment) comment.latest_analysis_id = analysis.id;
      return [{ id: analysis.id }];
    }

    if (text.includes('DISTINCT external_publication_id')) {
      return (state.targets ?? [])
        .filter((row) => row.social_account_id === params[0] && row.external_publication_id)
        .map((row) => ({ external_publication_id: row.external_publication_id }));
    }

    if (text.includes('FROM social_accounts sa')) {
      const [expiringWithinHours, staleAfterHours, limit] = params;
      const expiryThreshold = Date.now() + expiringWithinHours * 3600 * 1000;
      const staleThreshold = Date.now() - staleAfterHours * 3600 * 1000;
      return state.socialAccounts
        .filter((row) => {
          if (!['CONNECTED', 'EXPIRING'].includes(row.status)) return false;
          const expiringSoon = row.expires_at && new Date(row.expires_at).getTime() < expiryThreshold;
          const stale = new Date(row.updated_at).getTime() < staleThreshold;
          return expiringSoon || stale;
        })
        .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          status: row.status,
          brand_id: row.brand_id ?? null,
          connected_by_user_id: row.connected_by_user_id ?? null,
          provider: row.provider ?? null,
          name: row.name ?? null,
        }));
    }

    // Sprint 11 Jour 3 — relit le statut courant après une tentative de
    // rafraîchissement, pour détecter une dégradation (token-refresh.js).
    // Fragment unique : aucune autre requête de ce double n'utilise
    // exactement `SELECT status FROM social_accounts WHERE id`.
    if (text.includes('SELECT status FROM social_accounts WHERE id')) {
      const account = (state.socialAccounts ?? []).find((row) => row.id === params[0]);
      return account ? [{ status: account.status }] : [];
    }

    throw new Error(`Requête non gérée par le double de base : ${text.trim().slice(0, 60)}`);
  }

  return { state, query };
}
