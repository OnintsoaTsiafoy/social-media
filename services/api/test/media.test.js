import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_IMAGE_TYPES,
  avatarObjectKey,
  extensionFor,
  inspectImage,
  publicationObjectKey,
  temporaryObjectKey,
} from '../../shared/media-inspect.js';
import { MEDIA_LIMITS } from '../src/media/schemas.js';

/** En-tête PNG minimal : signature + IHDR portant les dimensions. */
function pngBuffer(width, height) {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** JPEG minimal : SOI, un segment APP0 à ignorer, puis un SOF0 à lire. */
function jpegBuffer(width, height) {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write('JFIF', 4, 'ascii');

  const sof0 = Buffer.alloc(11);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
}

/** WebP « lossy » minimal : conteneur RIFF + chunk VP8. */
function webpBuffer(width, height) {
  const buffer = Buffer.alloc(34);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(26, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8 ', 12, 'ascii');
  buffer.writeUInt32LE(14, 16);
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

test('le type réel est déduit des octets, pas du nom de fichier', () => {
  assert.deepEqual(inspectImage(pngBuffer(1080, 720)), { mimeType: 'image/png', width: 1080, height: 720 });
  assert.deepEqual(inspectImage(jpegBuffer(1200, 630)), { mimeType: 'image/jpeg', width: 1200, height: 630 });
  assert.deepEqual(inspectImage(webpBuffer(800, 400)), { mimeType: 'image/webp', width: 800, height: 400 });
});

test('un fichier qui n’est pas une image acceptée est refusé', () => {
  assert.equal(inspectImage(Buffer.from('GIF89a et le reste', 'ascii')), undefined);
  assert.equal(inspectImage(Buffer.from('<?php echo 1; ?>', 'ascii')), undefined);
  assert.equal(inspectImage(Buffer.alloc(0)), undefined);
  assert.equal(inspectImage('pas un buffer'), undefined);
});

test('le périmètre média du MVP reste JPEG, PNG et WebP (ADR-08)', () => {
  assert.deepEqual(ALLOWED_IMAGE_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(extensionFor('image/png'), 'png');
  assert.equal(extensionFor('image/webp'), 'webp');
  assert.equal(extensionFor('image/jpeg'), 'jpg');
});

test('les clés d’objet suivent la spécification S3/MinIO', () => {
  assert.equal(
    temporaryObjectKey('user-1', 'media-1', 'image/jpeg'),
    'temporary/user-1/media-1.jpg'
  );
  assert.equal(
    publicationObjectKey('brand-1', 'pub-1', 'media-1', 'image/png'),
    'brands/brand-1/publications/pub-1/media-1.png'
  );
  assert.equal(avatarObjectKey('user-1', 'media-1', 'image/webp'), 'users/user-1/avatars/media-1.webp');
});

test('les limites serveur reprennent celles appliquées par le mobile', () => {
  assert.equal(MEDIA_LIMITS.maxBytes, 8_000_000);
  assert.equal(MEDIA_LIMITS.minDimension, 320);
});
