import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_DELIVERY_ATTEMPTS,
  canDelete,
  canEditContent,
  canPublish,
  canSchedule,
  canTransition,
  computePublicationStatus,
  retryDelaySeconds,
  selectDeliverableTargets,
} from '../../shared/publication-status.js';
import { composeContent } from '../../shared/social-provider.js';
import { hashPayload } from '../src/lib/idempotency.js';
import {
  calendarSchema,
  createPublicationSchema,
  listPublicationSchema,
  schedulePublicationSchema,
  updatePublicationSchema,
} from '../src/publications/schemas.js';

const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
const mediaId = 'ee025d27-d721-41fd-a2a5-60f71caadb4a';

test('un brouillon valide est accepté avec ses cibles', () => {
  const draft = createPublicationSchema.parse({
    brandId,
    content: '  Nouvelle collection  ',
    hashtags: ['#automne'],
    mediaIds: [mediaId],
    targets: [{ provider: 'facebook' }, { provider: 'instagram', adaptedContent: 'Version Instagram' }],
  });

  assert.equal(draft.content, 'Nouvelle collection');
  assert.equal(draft.language, 'fr');
  assert.equal(draft.timezone, 'Europe/Paris');
  assert.equal(draft.targets.length, 2);
});

test('les paramètres invalides sont refusés', () => {
  assert.throws(() => createPublicationSchema.parse({ brandId, content: '   ' }));
  assert.throws(() => createPublicationSchema.parse({ brandId: 'pas-un-uuid', content: 'Texte' }));
  // Un même réseau deux fois enverrait deux publications identiques.
  assert.throws(() =>
    createPublicationSchema.parse({
      brandId,
      content: 'Texte',
      targets: [{ provider: 'facebook' }, { provider: 'facebook' }],
    })
  );
  // ADR-08 : une seule image par publication dans le MVP.
  assert.throws(() =>
    createPublicationSchema.parse({ brandId, content: 'Texte', mediaIds: [mediaId, brandId] })
  );
  assert.throws(() => updatePublicationSchema.parse({}));
});

test('une planification exige un instant absolu et un fuseau connu', () => {
  const parsed = schedulePublicationSchema.parse({
    scheduledAt: '2026-09-01T08:30:00+02:00',
    timezone: 'Europe/Paris',
  });

  // L'heure est conservée en UTC : 08:30 à Paris = 06:30 UTC.
  assert.equal(parsed.scheduledAt.toISOString(), '2026-09-01T06:30:00.000Z');
  assert.throws(() => schedulePublicationSchema.parse({ scheduledAt: 'demain matin' }));
  assert.throws(() =>
    schedulePublicationSchema.parse({ scheduledAt: '2026-09-01T08:30:00Z', timezone: 'Mars/Olympus' })
  );
});

test('le calendrier refuse une période inversée ou trop large', () => {
  assert.ok(calendarSchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success);
  assert.equal(calendarSchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success, false);
  assert.equal(calendarSchema.safeParse({ from: '2020-01-01', to: '2026-01-01' }).success, false);
});

test('la liste applique des bornes de pagination par défaut', () => {
  const filters = listPublicationSchema.parse({});
  assert.deepEqual({ page: filters.page, pageSize: filters.pageSize }, { page: 1, pageSize: 20 });
  assert.equal(listPublicationSchema.safeParse({ pageSize: 500 }).success, false);
  assert.equal(listPublicationSchema.safeParse({ status: 'inconnu' }).success, false);
});

test('le statut global est déduit de l’état réel des cibles', () => {
  const sent = { status: 'SENT' };
  const failed = { status: 'FAILED' };
  const pending = { status: 'PENDING' };

  assert.equal(computePublicationStatus([sent, sent]), 'PUBLISHED');
  assert.equal(computePublicationStatus([failed, failed]), 'FAILED');
  assert.equal(computePublicationStatus([sent, failed]), 'PARTIALLY_PUBLISHED');
  // Tant qu'une cible n'a pas abouti, l'écran ne doit pas annoncer un envoi terminé.
  assert.equal(computePublicationStatus([sent, pending]), 'PUBLISHING');
  assert.equal(computePublicationStatus([]), 'DRAFT');
});

test('les transitions interdites protègent une publication envoyée', () => {
  assert.ok(canTransition('DRAFT', 'SCHEDULED'));
  assert.ok(canTransition('SCHEDULED', 'PUBLISHING'));
  assert.ok(canTransition('PARTIALLY_PUBLISHED', 'PUBLISHING'));
  assert.equal(canTransition('PUBLISHED', 'DRAFT'), false);
  assert.equal(canTransition('PUBLISHING', 'DRAFT'), false);

  assert.equal(canEditContent('PUBLISHING'), false);
  assert.equal(canEditContent('PUBLISHED'), false);
  assert.ok(canEditContent('SCHEDULED'));
  assert.equal(canDelete('PUBLISHING'), false);
  assert.ok(canDelete('PUBLISHED'));
  assert.equal(canSchedule('PUBLISHED'), false);
  assert.equal(canPublish('PUBLISHED'), false);
  assert.ok(canPublish('PARTIALLY_PUBLISHED'));
});

test('une cible déjà envoyée n’est jamais resélectionnée', () => {
  const targets = [
    { provider: 'FACEBOOK', status: 'SENT' },
    { provider: 'INSTAGRAM', status: 'FAILED' },
  ];

  assert.deepEqual(selectDeliverableTargets(targets).map((target) => target.provider), ['INSTAGRAM']);
  // Retry ciblé : seul le réseau demandé repart.
  assert.deepEqual(selectDeliverableTargets(targets, ['INSTAGRAM']).map((t) => t.provider), ['INSTAGRAM']);
  assert.deepEqual(selectDeliverableTargets(targets, ['FACEBOOK']), []);
});

test('le backoff des retries suit 1 min, 5 min, 15 min puis 1 h', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 9].map(retryDelaySeconds),
    [60, 300, 900, 3600, 3600]
  );
  assert.equal(MAX_DELIVERY_ATTEMPTS, 5);
});

test('le contenu envoyé privilégie le texte adapté par réseau', () => {
  const publication = { content: 'Texte commun', hashtags: ['automne', '#collection'] };

  assert.equal(composeContent(publication, {}), 'Texte commun\n\n#automne #collection');
  assert.equal(
    composeContent(publication, { adaptedContent: 'Version Instagram', adaptedHashtags: ['reels'] }),
    'Version Instagram\n\n#reels'
  );
  assert.equal(composeContent({ content: 'Sans hashtag', hashtags: [] }, {}), 'Sans hashtag');
});

test('la double soumission est neutralisée par la clé d’idempotence', () => {
  const first = hashPayload({ publicationId: 'pub-1', provider: null });
  const sameOtherOrder = hashPayload({ provider: null, publicationId: 'pub-1' });
  const different = hashPayload({ publicationId: 'pub-1', provider: 'facebook' });

  // Le hash ne dépend pas de l'ordre des clés, sinon un même appel serait vu
  // comme un conflit.
  assert.equal(first, sameOtherOrder);
  assert.notEqual(first, different);
});
