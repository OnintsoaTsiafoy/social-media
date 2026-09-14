import { randomUUID } from 'node:crypto';

import {
  ALLOWED_IMAGE_TYPES,
  avatarObjectKey,
  inspectImage,
  publicationObjectKey,
  temporaryObjectKey,
} from '../../../shared/media-inspect.js';
import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { deleteObject, isStorageConfigured, moveObject, putObject, signedReadUrl, storageConfig } from '../lib/storage.js';
import { MEDIA_LIMITS } from './schemas.js';

/** Un média n'est visible que par son déposant ou par un membre de sa marque. */
async function assertMediaVisible(media, userId) {
  if (media.ownerUserId === userId) return;
  if (media.brandId) {
    const membership = await prisma.brandMember.findFirst({
      where: { brandId: media.brandId, userId, brand: { deletedAt: null, status: 'ACTIVE' } },
    });
    if (membership) return;
  }
  // Comme pour les marques, l'existence d'un média d'autrui n'est pas divulguée.
  throw new HttpError(404, 'not_found', 'Média introuvable.');
}

export async function toPublicMedia(media, { withUrl = true } = {}) {
  // Sans stockage configuré, la métadonnée reste lisible : seule l'URL manque.
  const signable = withUrl && !media.deletedAt && isStorageConfigured();
  const preview = signable ? await signedReadUrl(media.objectKey) : undefined;
  return {
    id: media.id,
    fileName: media.objectKey.split('/').pop(),
    mimeType: media.mimeType,
    size: media.sizeBytes,
    width: media.width,
    height: media.height,
    status: media.status,
    purpose: media.purpose,
    brandId: media.brandId,
    createdAt: media.createdAt,
    ...(preview ? { previewUrl: preview.url, downloadUrl: preview.url, expiresAt: preview.expiresAt } : {}),
  };
}

export async function uploadMedia(user, { file, brandId, purpose }, request) {
  if (!file?.buffer?.length) {
    throw new HttpError(400, 'validation_failed', 'Aucun fichier reçu dans le champ « file ».');
  }
  if (file.size > MEDIA_LIMITS.maxBytes) {
    throw new HttpError(413, 'media_too_large', `Fichier trop lourd. Maximum ${MEDIA_LIMITS.maxBytes} octets.`);
  }

  // Le type est déduit des octets : un fichier renommé ne passe pas.
  const inspected = inspectImage(file.buffer);
  if (!inspected || !ALLOWED_IMAGE_TYPES.includes(inspected.mimeType)) {
    throw new HttpError(415, 'media_type_not_allowed', 'Format non supporté. Utilisez un fichier JPEG, PNG ou WebP.');
  }
  if (inspected.width < MEDIA_LIMITS.minDimension || inspected.height < MEDIA_LIMITS.minDimension) {
    throw new HttpError(
      422,
      'unprocessable',
      `Dimensions trop petites. Minimum ${MEDIA_LIMITS.minDimension} x ${MEDIA_LIMITS.minDimension} px.`
    );
  }

  if (brandId) {
    const membership = await prisma.brandMember.findFirst({
      where: { brandId, userId: user.id, brand: { deletedAt: null, status: 'ACTIVE' } },
    });
    if (!membership) throw new HttpError(404, 'not_found', 'Marque introuvable.');
  }

  const mediaId = randomUUID();
  const objectKey =
    purpose === 'avatar'
      ? avatarObjectKey(user.id, mediaId, inspected.mimeType)
      : temporaryObjectKey(user.id, mediaId, inspected.mimeType);

  await putObject({ key: objectKey, body: file.buffer, contentType: inspected.mimeType });

  const media = await prisma.media.create({
    data: {
      id: mediaId,
      ownerUserId: user.id,
      brandId: brandId ?? null,
      bucket: storageConfig().bucket,
      objectKey,
      mimeType: inspected.mimeType,
      sizeBytes: file.size,
      width: inspected.width,
      height: inspected.height,
      purpose,
      // Tant qu'un media n'est pas rattache, il reste temporaire et sera
      // nettoye par le job `cleanup-temporary-media`.
      status: purpose === 'avatar' ? 'READY' : 'TEMPORARY',
    },
  });

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'media.uploaded',
    resourceType: 'media',
    resourceId: media.id,
    requestId: request.requestId,
    metadata: { purpose, mimeType: media.mimeType, sizeBytes: media.sizeBytes },
  });

  return toPublicMedia(media);
}

export async function getMedia(userId, mediaId) {
  const media = await prisma.media.findFirst({ where: { id: mediaId, deletedAt: null } });
  if (!media) throw new HttpError(404, 'not_found', 'Média introuvable.');
  await assertMediaVisible(media, userId);
  return toPublicMedia(media);
}

export async function deleteMedia(userId, mediaId, request) {
  const media = await prisma.media.findFirst({
    where: { id: mediaId, deletedAt: null },
    include: { publications: true, avatarFor: true },
  });
  if (!media) throw new HttpError(404, 'not_found', 'Média introuvable.');
  await assertMediaVisible(media, userId);

  if (media.publications.length > 0) {
    throw new HttpError(409, 'media_in_use', 'Ce média est utilisé par une publication.');
  }
  if (media.avatarFor) {
    throw new HttpError(409, 'media_in_use', 'Ce média est l’avatar du compte. Retirez-le depuis le profil.');
  }

  await deleteObject(media.objectKey);
  // Suppression logique puis physique : la ligne reste pour l'audit, l'objet non.
  await prisma.media.update({ where: { id: media.id }, data: { status: 'DELETED', deletedAt: new Date() } });

  await writeAuditLog(prisma, {
    userId,
    action: 'media.deleted',
    resourceType: 'media',
    resourceId: media.id,
    requestId: request.requestId,
    metadata: { objectKey: media.objectKey },
  });
}

/**
 * Rattache des médias à une publication.
 *
 * L'objet temporaire est déplacé vers la clé définitive
 * `brands/{brandId}/publications/{publicationId}/{mediaId}.{ext}` : la
 * publication devient propriétaire du fichier, et le nettoyage des objets
 * temporaires ne peut plus l'atteindre.
 */
export async function attachMediaToPublication({ mediaIds, publication, userId }, db = prisma) {
  if (!mediaIds?.length) return [];

  const media = await db.media.findMany({ where: { id: { in: mediaIds }, deletedAt: null } });
  if (media.length !== mediaIds.length) {
    throw new HttpError(422, 'media_not_ready', 'Un média sélectionné est introuvable ou a été supprimé.');
  }

  const attached = [];
  for (const [index, mediaId] of mediaIds.entries()) {
    const item = media.find((candidate) => candidate.id === mediaId);
    if (item.ownerUserId !== userId && item.brandId !== publication.brandId) {
      throw new HttpError(404, 'not_found', 'Média introuvable.');
    }
    if (item.purpose !== 'publication') {
      throw new HttpError(422, 'media_not_ready', 'Ce média n’est pas destiné à une publication.');
    }

    // Un média déjà rattaché ailleurs ne peut pas être déplacé : l'objet
    // disparaîtrait de la publication qui l'utilise déjà.
    const usedElsewhere = await db.publicationMedia.count({
      where: { mediaId: item.id, publicationId: { not: publication.id } },
    });
    if (usedElsewhere > 0) {
      throw new HttpError(409, 'media_in_use', 'Ce média est déjà utilisé par une autre publication.');
    }

    const targetKey = publicationObjectKey(publication.brandId, publication.id, item.id, item.mimeType);
    if (item.objectKey !== targetKey) {
      await moveObject(item.objectKey, targetKey);
    }

    const updated = await db.media.update({
      where: { id: item.id },
      data: { objectKey: targetKey, status: 'READY', brandId: publication.brandId },
    });
    await db.publicationMedia.create({
      data: { publicationId: publication.id, mediaId: item.id, position: index },
    });
    attached.push(updated);
  }

  return attached;
}

/**
 * Détache les médias d'une publication sans supprimer les objets.
 *
 * Un média qui n'est plus rattaché à aucune publication redevient
 * `TEMPORARY` : sans cela, remplacer l'image d'un brouillon laisserait un objet
 * dans le bucket que plus rien ne référence et que le nettoyage ignorerait.
 */
export async function detachMediaFromPublication(publicationId, db = prisma) {
  const links = await db.publicationMedia.findMany({ where: { publicationId } });
  await db.publicationMedia.deleteMany({ where: { publicationId } });

  for (const link of links) {
    const stillUsed = await db.publicationMedia.count({ where: { mediaId: link.mediaId } });
    if (stillUsed > 0) continue;
    await db.media.updateMany({
      where: { id: link.mediaId, deletedAt: null, purpose: 'publication' },
      data: { status: 'TEMPORARY' },
    });
  }
}
