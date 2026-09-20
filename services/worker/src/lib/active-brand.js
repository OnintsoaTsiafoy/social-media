/**
 * « La marque est-elle encore vivante ? », en SQL, au même endroit pour tous.
 *
 * Supprimer une marque est un archivage, jamais un effacement
 * (services/api/src/brands/service.js::deleteBrand met `status = 'ARCHIVED'`
 * et `deleted_at`). Côté API, `requireBrandAccess` filtre déjà
 * `deletedAt: null, status: 'ACTIVE'` : une marque archivée répond 404 partout.
 *
 * Le worker, lui, ne passe pas par l'API — il lit PostgreSQL directement. Sans
 * ce filtre, une marque « supprimée » continuait de vivre : ses publications
 * planifiées partaient sur Facebook, ses commentaires et ses métriques
 * continuaient d'être synchronisés, ses jetons d'être revalidés. L'archivage ne
 * doit pas dépendre du fait qu'un job était déjà en file au moment du clic.
 *
 * @param {string} column colonne portant l'identifiant de marque, qualifiée si
 *   la requête utilise des alias (ex. `sa.brand_id`, `publications.brand_id`).
 */
export function activeBrand(column) {
  return `EXISTS (
       SELECT 1 FROM brands live_brand
        WHERE live_brand.id = ${column}
          AND live_brand.deleted_at IS NULL
          AND live_brand.status = 'ACTIVE'
     )`;
}
