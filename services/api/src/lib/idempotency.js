/**
 * Idempotence des commandes à effet de bord (`docs/CONTRATS_API.md`).
 *
 * Une seconde requête portant la même `Idempotency-Key` et le même corps rejoue
 * la réponse mémorisée ; un corps différent est un `409 idempotency_conflict`.
 */

import { createHash } from 'node:crypto';

import { prisma } from '../db/prisma.js';
import { HttpError } from './http.js';

const RETENTION_HOURS = 24;

/** Hash stable : l'ordre des clés du corps ne doit pas changer la signature. */
export function hashPayload(payload) {
  const stable = JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return createHash('sha256').update(stable ?? '').digest('hex');
}

export function idempotencyKeyFrom(request) {
  const key = request.get('idempotency-key')?.trim();
  if (!key) return undefined;
  if (key.length > 200) {
    throw new HttpError(400, 'validation_failed', 'La clé d’idempotence dépasse 200 caractères.');
  }
  return key;
}

/**
 * Exécute `handler` une seule fois pour une clé donnée.
 *
 * Sans clé, la commande s'exécute normalement : l'en-tête reste facultatif pour
 * les clients qui n'en ont pas besoin.
 */
export async function withIdempotency({ key, endpoint, userId, payload }, handler) {
  if (!key) return handler();

  const requestHash = hashPayload(payload);
  let record;

  try {
    record = await prisma.idempotencyKey.create({
      data: {
        key,
        endpoint,
        userId,
        requestHash,
        expiresAt: new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;

    const existing = await prisma.idempotencyKey.findUnique({ where: { endpoint_key: { endpoint, key } } });
    if (!existing) throw error;
    if (existing.requestHash !== requestHash) {
      throw new HttpError(409, 'idempotency_conflict', 'Cette clé d’idempotence a déjà servi pour un autre contenu.');
    }
    if (existing.responseStatus === null || existing.responseStatus === undefined) {
      throw new HttpError(409, 'idempotency_conflict', 'Une requête identique est déjà en cours de traitement.');
    }
    return { replayed: true, status: existing.responseStatus, body: existing.responseBody };
  }

  try {
    const result = await handler();
    await prisma.idempotencyKey.update({
      where: { id: record.id },
      data: {
        responseStatus: result.status ?? 200,
        responseBody: result.body ?? undefined,
        resourceId: result.resourceId ?? undefined,
      },
    });
    return { replayed: false, ...result };
  } catch (error) {
    // Un échec ne doit pas bloquer une nouvelle tentative avec la même clé.
    await prisma.idempotencyKey.delete({ where: { id: record.id } }).catch(() => {});
    throw error;
  }
}
