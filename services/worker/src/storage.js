/**
 * Suppression d'objets pour le job de nettoyage.
 *
 * Le worker n'a besoin que de supprimer : aucune URL signée, aucun upload.
 */

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

let client;

export function isStorageConfigured() {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() && process.env.S3_ACCESS_KEY?.trim() && process.env.S3_SECRET_KEY?.trim()
  );
}

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT.trim(),
      region: process.env.S3_REGION?.trim() || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY.trim(),
        secretAccessKey: process.env.S3_SECRET_KEY.trim(),
      },
      forcePathStyle: true,
    });
  }
  return client;
}

export async function deleteObject(bucket, key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
