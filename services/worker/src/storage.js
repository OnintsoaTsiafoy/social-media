/**
 * Accès objet du worker : suppression (nettoyage) et lecture signée
 * (Sprint 07 — fournir une URL à graph-api pour une publication avec média).
 *
 * `S3_PUBLIC_ENDPOINT` est l'hôte utilisé pour signer : en local ce n'est pas
 * joignable par les serveurs Meta (MinIO n'est pas exposé publiquement), donc
 * la publication réelle avec média nécessite un vrai endpoint public
 * (staging/production) — connu et documenté, pas un oubli du Sprint 07. Les
 * tests automatisés n'appellent jamais Meta réellement, cette limite ne les
 * affecte pas.
 */

import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_URL_TTL_SECONDS = 900;

let clients;

export function isStorageConfigured() {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() && process.env.S3_ACCESS_KEY?.trim() && process.env.S3_SECRET_KEY?.trim()
  );
}

function getClients() {
  if (clients) return clients;

  const common = {
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY.trim(),
      secretAccessKey: process.env.S3_SECRET_KEY.trim(),
    },
    forcePathStyle: true,
  };

  clients = {
    internal: new S3Client({ ...common, endpoint: process.env.S3_ENDPOINT.trim() }),
    signing: new S3Client({
      ...common,
      endpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.S3_ENDPOINT.trim(),
    }),
  };
  return clients;
}

export async function deleteObject(bucket, key) {
  const { internal } = getClients();
  await internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** URL de lecture signée à durée de vie courte — jamais de clé S3 transmise telle quelle. */
export async function signedReadUrl(bucket, key, ttlSeconds) {
  const { signing } = getClients();
  const expiresIn = ttlSeconds ?? (Number(process.env.MEDIA_URL_TTL_SECONDS) || DEFAULT_URL_TTL_SECONDS);
  const url = await getSignedUrl(signing, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
  return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

/** Réinitialise le client mémorisé ; utilisé par les tests. */
export function resetStorageClients() {
  clients = undefined;
}
