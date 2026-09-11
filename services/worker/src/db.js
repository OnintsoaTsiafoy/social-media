/**
 * Accès PostgreSQL du worker.
 *
 * Le worker lit et écrit en SQL : Prisma reste le propriétaire unique du schéma
 * et des migrations (ADR-05), côté API. Le worker ne crée aucune table et ne
 * duplique pas la génération du client Prisma dans son image.
 */

import pg from 'pg';

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error('DATABASE_URL est absent.');
    pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 5) || 5 });
    pool.on('error', (error) => console.error({ scope: 'postgres', error: error?.message }));
  }
  return pool;
}

/** Signature injectée dans la logique de livraison, pour la rendre testable. */
export async function query(text, params) {
  const result = await getPool().query(text, params);
  return result.rows;
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end().catch(() => {});
}
