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
    approvals: initial.approvals ?? [],
    auditLogs: [],
    targets: initial.targets ?? [],
    attempts: initial.attempts ?? [],
    schedules: initial.schedules ?? [],
    media: initial.media ?? [],
    publicationMedia: initial.publicationMedia ?? [],
    socialAccounts: initial.socialAccounts ?? [],
    comments: initial.comments ?? [],
    analyses: initial.analyses ?? [],
    brandMembers: initial.brandMembers ?? [],
    competitors: initial.competitors ?? [],
    competitorPosts: initial.competitorPosts ?? [],
    competitorMetrics: initial.competitorMetrics ?? [],
    calls: [],
  };

  function publication(id) {
    return state.publications.find((row) => row.id === id);
  }

  function approved(row) {
    return row && !row.deleted_at && row.approved_revision === row.content_revision &&
      state.approvals.some((approval) => approval.publication_id === row.id && approval.status === 'APPROVED' && approval.revision === row.content_revision);
  }

  async function query(text, params = []) {
    state.calls.push(text.trim().split('\n')[0].trim());

    if (text.includes('AS approval_valid')) {
      const row = publication(params[0]);
      return row && !row.deleted_at ? [{ ...row, approval_valid: approved(row) }] : [];
    }
    if (text.includes('INSERT INTO audit_logs')) {
      state.auditLogs.push({ publicationId: params[0], ...JSON.parse(params[1]) });
      return [];
    }
    if (text.includes("UPDATE scheduled_publications SET status = 'CANCELLED'")) {
      const row = publication(params[0]);
      const schedule = state.schedules.find((schedule) => schedule.publication_id === params[0]);
      if (schedule?.status === 'PENDING' && !approved(row)) schedule.status = 'CANCELLED';
      return [];
    }

    if (text.includes("SET status = 'PUBLISHING'")) {
      const row = publication(params[0]);
      const claimable = ['APPROVED', 'SCHEDULED', 'PUBLISHING', 'FAILED', 'PARTIALLY_PUBLISHED'];
      if (!row || !approved(row) || row.content_revision !== params[1] || !claimable.includes(row.status)) return [];
      if (params[2] && (!['SCHEDULED', 'PUBLISHING'].includes(row.status) ||
          (params[3] && new Date(row.scheduled_at).getTime() !== new Date(params[3]).getTime()))) return [];
      row.status = 'PUBLISHING';
      return [row];
    }

    // Comptes d'une marque pour un réseau (delivery.js, résolution à l'envoi).
    if (text.includes('FROM social_accounts WHERE brand_id = $1::uuid AND provider = $2')) {
      return state.socialAccounts.filter((row) => row.brand_id === params[0] && row.provider === params[1]);
    }
    if (text.includes('SET social_account_id = $2::uuid')) {
      const target = state.targets.find((row) => row.id === params[0] && !row.social_account_id);
      if (target) target.social_account_id = params[1];
      return [];
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

    if (text.includes('SELECT status, scheduled_at FROM scheduled_publications')) {
      const schedule = state.schedules.find((row) => row.publication_id === params[0]);
      return schedule ? [{ status: schedule.status, scheduled_at: schedule.scheduled_at }] : [];
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

    // Sprint 12 metrics-sync.js's own target-selection query also selects
    // `DISTINCT external_publication_id FROM publication_targets`, so this
    // branch must be checked first, matched on `status = 'SENT'` — the
    // fragment unique to it — before the more generic comment-sync.js branch
    // below, which would otherwise swallow it too.
    if (text.includes("status = 'SENT'") && text.includes('DISTINCT external_publication_id')) {
      const [socialAccountId, limit] = params;
      return (state.targets ?? [])
        .filter(
          (row) =>
            row.social_account_id === socialAccountId &&
            row.status === 'SENT' &&
            row.external_publication_id
        )
        .sort((a, b) => new Date(b.sent_at ?? 0).getTime() - new Date(a.sent_at ?? 0).getTime())
        .slice(0, limit)
        .map((row) => ({ external_publication_id: row.external_publication_id }));
    }

    if (text.includes('DISTINCT external_publication_id')) {
      return (state.targets ?? [])
        .filter((row) => row.social_account_id === params[0] && row.external_publication_id)
        .map((row) => ({ external_publication_id: row.external_publication_id }));
    }

    // Sprint 12 metrics-sync.js's account-selection query. Même remarque que
    // pour last_comments_sync_at : fragment propre à cette requête.
    if (text.includes('last_metrics_sync_at')) {
      const [staleAfterMinutes, limit] = params;
      const staleThreshold = Date.now() - staleAfterMinutes * 60 * 1000;
      return (state.socialAccounts ?? [])
        .filter((row) => {
          if (!['CONNECTED', 'EXPIRING'].includes(row.status)) return false;
          return !row.last_metrics_sync_at || new Date(row.last_metrics_sync_at).getTime() < staleThreshold;
        })
        .sort((a, b) => {
          if (!a.last_metrics_sync_at) return -1;
          if (!b.last_metrics_sync_at) return 1;
          return new Date(a.last_metrics_sync_at).getTime() - new Date(b.last_metrics_sync_at).getTime();
        })
        .slice(0, limit)
        .map((row) => ({ id: row.id, provider: row.provider }));
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

    // --- Analyse concurrentielle (competitor-sync.js) ---------------------
    // Même règle que plus haut : on matche le fragment le plus spécifique de
    // chaque requête, pas le nom de la table — trois d'entre elles touchent
    // `competitors` et deux `competitor_posts`.

    if (text.includes('LEFT JOIN LATERAL')) {
      const competitor = state.competitors.find((row) => row.id === params[0]);
      if (!competitor) return [];
      const account = (state.socialAccounts ?? []).find(
        (row) =>
          row.brand_id === competitor.brand_id &&
          row.provider === competitor.platform &&
          ['CONNECTED', 'EXPIRING'].includes(row.status)
      );
      return [{ ...competitor, social_account_id: account?.id ?? null }];
    }

    if (text.includes("status <> 'UNAVAILABLE'")) {
      const [staleAfterMinutes, unavailableStaleAfterMinutes, limit] = params;
      const isStale = (row, minutes) =>
        !row.last_synced_at || new Date(row.last_synced_at).getTime() < Date.now() - minutes * 60 * 1000;
      return state.competitors
        .filter((row) =>
          row.status === 'UNAVAILABLE' ? isStale(row, unavailableStaleAfterMinutes) : isStale(row, staleAfterMinutes)
        )
        .sort((a, b) => {
          if (!a.last_synced_at) return -1;
          if (!b.last_synced_at) return 1;
          return new Date(a.last_synced_at).getTime() - new Date(b.last_synced_at).getTime();
        })
        .slice(0, limit)
        .map((row) => ({ id: row.id }));
    }

    if (text.includes('external_id = COALESCE')) {
      const competitor = state.competitors.find((row) => row.id === params[0]);
      if (!competitor) return [];
      // COALESCE : une valeur nulle renvoyée par Meta ne doit pas effacer ce
      // qui est déjà connu — c'est précisément ce que le test vérifie.
      Object.assign(competitor, {
        external_id: params[1] ?? competitor.external_id,
        name: params[2] ?? competitor.name,
        profile_url: params[3] ?? competitor.profile_url,
        avatar_url: params[4] ?? competitor.avatar_url,
        status: params[5],
        last_error_code: params[6],
        last_error_message: params[7],
        last_synced_at: new Date().toISOString(),
      });
      return [];
    }

    if (text.includes('followers_count = $2')) {
      const account = (state.socialAccounts ?? []).find((row) => row.id === params[0]);
      if (account) Object.assign(account, { followers_count: params[1], followers_synced_at: new Date().toISOString() });
      return [];
    }

    if (text.includes('INSERT INTO competitor_posts')) {
      const [competitorId, externalPostId, message, mediaType, permalink, publishedAt, reactions, comments, shares, engagement] = params;
      const existing = state.competitorPosts.find(
        (row) => row.competitor_id === competitorId && row.external_post_id === externalPostId
      );
      if (!existing) {
        state.competitorPosts.push({
          id: `post-${state.competitorPosts.length + 1}`,
          competitor_id: competitorId,
          external_post_id: externalPostId,
          message,
          media_type: mediaType,
          permalink,
          published_at: publishedAt,
          reactions_count: reactions,
          comments_count: comments,
          shares_count: shares,
          engagement_rate: engagement,
        });
        return [{ inserted: true }];
      }
      // Reproduit le WHERE du DO UPDATE : sans changement, aucune ligne rendue.
      const changed =
        existing.reactions_count !== reactions ||
        existing.comments_count !== comments ||
        existing.shares_count !== shares ||
        existing.message !== message;
      if (!changed) return [];
      Object.assign(existing, {
        message,
        media_type: mediaType,
        permalink,
        published_at: publishedAt,
        reactions_count: reactions,
        comments_count: comments,
        shares_count: shares,
        engagement_rate: engagement,
      });
      return [{ inserted: false }];
    }

    if (text.includes('FROM competitor_posts')) {
      const [competitorId, days] = params;
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = state.competitorPosts.filter(
        (row) => row.competitor_id === competitorId && row.published_at && new Date(row.published_at).getTime() >= since
      );
      // SUM rend NULL quand aucune valeur n'est connue : le double doit le
      // reproduire, sinon le test ne prouverait rien sur la règle null-vs-zéro.
      const sum = (key) => {
        const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined);
        return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
      };
      return [
        {
          posts: rows.length,
          reactions: sum('reactions_count'),
          comments: sum('comments_count'),
          shares: sum('shares_count'),
        },
      ];
    }

    if (text.includes('FROM competitor_metrics')) {
      const row = state.competitorMetrics
        .filter((metric) => metric.competitor_id === params[0] && metric.followers_count !== null)
        .sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime())[0];
      return row ? [{ followers_count: row.followers_count }] : [];
    }

    if (text.includes('INSERT INTO competitor_metrics')) {
      const metric = {
        id: `metric-${state.competitorMetrics.length + 1}`,
        competitor_id: params[0],
        collected_at: new Date().toISOString(),
        followers_count: params[1],
        posts_count: params[2],
        reactions_count: params[3],
        comments_count: params[4],
        shares_count: params[5],
        engagement_rate: params[6],
      };
      state.competitorMetrics.push(metric);
      return [{ id: metric.id }];
    }

    if (text.includes('UPDATE competitors')) {
      const competitor = state.competitors.find((row) => row.id === params[0]);
      if (competitor) {
        Object.assign(competitor, {
          status: params[1],
          last_error_code: params[2],
          last_error_message: params[3],
          last_synced_at: new Date().toISOString(),
        });
      }
      return [];
    }

    throw new Error(`Requête non gérée par le double de base : ${text.trim().slice(0, 60)}`);
  }

  return { state, query };
}
