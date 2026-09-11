/**
 * Inspection d'image sans dépendance native.
 *
 * Le type est déduit des octets réels, jamais du `Content-Type` annoncé par le
 * client : un fichier renommé en `.jpg` doit être refusé. Le périmètre média du
 * MVP est fixé par l'ADR-08 (JPEG, PNG, WebP).
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function isJpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer) {
  return (
    buffer.length > 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isWebp(buffer) {
  return (
    buffer.length > 16 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

/** Parcourt les marqueurs JPEG jusqu'au premier SOF, qui porte les dimensions. */
function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    // SOF0..SOF15, hors DHT (C4), DNL (C8) et DAC (CC).
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }

    // Marqueurs sans charge utile : ne pas lire de longueur derrière eux.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function webpDimensions(buffer) {
  const format = buffer.toString('ascii', 12, 16);

  if (format === 'VP8 ' && buffer.length > 29) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L' && buffer.length > 24) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X' && buffer.length > 29) {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  return undefined;
}

/**
 * @param {Buffer} buffer contenu complet du fichier reçu
 * @returns {{ mimeType: string, width: number, height: number } | undefined}
 *   `undefined` si le format n'est pas une image acceptée ou si l'en-tête est
 *   illisible ; l'appelant doit alors répondre `media_type_not_allowed`.
 */
export function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return undefined;

  if (isPng(buffer)) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (isJpeg(buffer)) {
    const dimensions = jpegDimensions(buffer);
    return dimensions ? { mimeType: 'image/jpeg', ...dimensions } : undefined;
  }
  if (isWebp(buffer)) {
    const dimensions = webpDimensions(buffer);
    return dimensions ? { mimeType: 'image/webp', ...dimensions } : undefined;
  }
  return undefined;
}

export function extensionFor(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

/** Clés d'objet imposées par la spécification S3/MinIO. */
export function temporaryObjectKey(userId, mediaId, mimeType) {
  return `temporary/${userId}/${mediaId}.${extensionFor(mimeType)}`;
}

export function publicationObjectKey(brandId, publicationId, mediaId, mimeType) {
  return `brands/${brandId}/publications/${publicationId}/${mediaId}.${extensionFor(mimeType)}`;
}

export function avatarObjectKey(userId, mediaId, mimeType) {
  return `users/${userId}/avatars/${mediaId}.${extensionFor(mimeType)}`;
}
