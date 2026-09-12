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
        .map((row) => ({ id: row.id }));
    }

    throw new Error(`Requête non gérée par le double de base : ${text.trim().slice(0, 60)}`);
  }

  return { state, query };
}
