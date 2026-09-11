/**
 * Stockage objet privé (MinIO en local, S3 en staging/production — ADR-07).
 *
 * Le mobile ne reçoit jamais de credentials : il lit et écrit uniquement via
 * l'API, qui renvoie des URL signées à durée de vie courte.
 */

import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { HttpError } from './http.js';

const DEFAULT_URL_TTL_SECONDS = 900;

export function storageConfig() {
  return {
    endpoint: process.env.S3_ENDPOINT?.trim(),
    // Hôte joignable depuis le téléphone : l'émulateur ne résout pas « minio ».
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim(),
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY?.trim(),
    secretAccessKey: process.env.S3_SECRET_KEY?.trim(),
    bucket: process.env.MEDIA_BUCKET?.trim() || 'hootly',
    urlTtlSeconds: Number(process.env.MEDIA_URL_TTL_SECONDS ?? DEFAULT_URL_TTL_SECONDS) || DEFAULT_URL_TTL_SECONDS,
  };
}

export function isStorageConfigured() {
  const config = storageConfig();
  return Boolean(config.endpoint && config.accessKeyId && config.secretAccessKey && config.bucket);
}

let clients;

function getClients() {
  if (clients) return clients;

  const config = storageConfig();
  if (!isStorageConfigured()) {
    throw new HttpError(503, 'storage_unavailable', 'Le stockage des médias n’est pas configuré.');
  }

  const common = {
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // MinIO n'expose pas les buckets en sous-domaine.
    forcePathStyle: true,
  };

  clients = {
    config,
    internal: new S3Client({ ...common, endpoint: config.endpoint }),
    // Client dédié à la signature, pour que l'URL pointe vers un hôte joignable
    // depuis le téléphone plutôt que vers le nom de service Compose.
    signing: new S3Client({ ...common, endpoint: config.publicEndpoint }),
  };
  return clients;
}

function storageError(error) {
  return new HttpError(503, 'storage_unavailable', 'Le stockage des médias est indisponible.', {
    cause: error?.name ?? 'unknown',
  });
}

/** Crée le bucket privé au démarrage s'il n'existe pas encore. */
export async function ensureBucket() {
  const { internal, config } = getClients();
  try {
    await internal.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchBucket') throw storageError(error);
    await internal.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }
}

export async function putObject({ key, body, contentType, checksum }) {
  const { internal, config } = getClients();
  try {
    await internal.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: checksum ? { checksum } : undefined,
      })
    );
  } catch (error) {
    throw storageError(error);
  }
  return { bucket: config.bucket, key };
}

/** Déplacement logique : copie puis suppression, S3 n'ayant pas de « move ». */
export async function moveObject(fromKey, toKey) {
  const { internal, config } = getClients();
  if (fromKey === toKey) return { bucket: config.bucket, key: toKey };

  try {
    await internal.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${fromKey}`,
        Key: toKey,
      })
    );
    await internal.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: fromKey }));
  } catch (error) {
    throw storageError(error);
  }
  return { bucket: config.bucket, key: toKey };
}

export async function deleteObject(key) {
  const { internal, config } = getClients();
  try {
    await internal.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    throw storageError(error);
  }
}

/** URL de lecture signée ; jamais d'objet public, jamais de clé S3 côté mobile. */
export async function signedReadUrl(key, ttlSeconds) {
  const { signing, config } = getClients();
  const expiresIn = ttlSeconds ?? config.urlTtlSeconds;
  try {
    const url = await getSignedUrl(signing, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  } catch (error) {
    throw storageError(error);
  }
}

/** Réinitialise le client mémorisé ; utilisé par les tests. */
export function resetStorageClients() {
  clients = undefined;
}
