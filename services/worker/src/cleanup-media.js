/**
 * Nettoyage des médias temporaires.
 *
 * Un média déposé mais jamais rattaché à une publication reste dans le bucket :
 * ce job le supprime après un délai. Un média rattaché n'est jamais touché, y
 * compris si son statut a été mal renseigné (double garde `NOT EXISTS`).
 */

const SELECT_ORPHANS = `
  SELECT m.id, m.bucket, m.object_key
    FROM media m
   WHERE m.status = 'TEMPORARY'
     AND m.deleted_at IS NULL
     AND m.created_at < now() - make_interval(hours => $1::int)
     AND NOT EXISTS (SELECT 1 FROM publication_media pm WHERE pm.media_id = m.id)
   ORDER BY m.created_at
   LIMIT $2::int
`;

const MARK_DELETED = `UPDATE media SET status = 'DELETED', deleted_at = now() WHERE id = $1::uuid`;

export function createMediaCleanup({ query, deleteObject, logger = console }) {
  async function cleanup({ olderThanHours = 24, limit = 200 } = {}) {
    const orphans = await query(SELECT_ORPHANS, [olderThanHours, limit]);

    let deleted = 0;
    for (const media of orphans) {
      try {
        await deleteObject(media.bucket, media.object_key);
        await query(MARK_DELETED, [media.id]);
        deleted += 1;
      } catch (error) {
        // Un objet introuvable ou un stockage momentanément absent ne doit pas
        // interrompre le nettoyage des autres médias.
        logger.error?.({ scope: 'cleanup-media', mediaId: media.id, error: error?.message });
      }
    }

    return { inspected: orphans.length, deleted };
  }

  return { cleanup };
}
