import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommentAnalysis } from '../src/comment-analysis.js';
import { createFakeDb } from './fake-db.js';

function analysis(overrides = {}) {
  return {
    sentiment: 'negative',
    intent: 'claim',
    priority: 'high',
    confidence: 0.91,
    sentimentConfidence: 0.93,
    intentConfidence: 0.91,
    lowConfidence: false,
    urgent: true,
    sensitive: false,
    language: 'fr',
    recommendedAction: 'Traiter en priorité aujourd’hui.',
    explanation: 'Message négatif, classé comme réclamation.',
    signals: ['no_answer'],
    topTerms: ['remboursement'],
    modelVersion: 'fr-linear-1.0.0+v1',
    datasetVersion: 'v1',
    ...overrides,
  };
}

test('analyse les commentaires sans analyse et renseigne le pointeur', async () => {
  const db = createFakeDb({
    comments: [
      { id: 'c1', content: 'Commande jamais reçue', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z' },
      { id: 'c2', content: 'Merci beaucoup', latest_analysis_id: null, created_at: '2026-09-01T11:00:00Z' },
    ],
  });
  const { run } = createCommentAnalysis({ query: db.query, analyseComment: async () => analysis() });

  const result = await run({ limit: 50 });

  assert.deepEqual(result, { inspected: 2, analysed: 2, failed: 0 });
  assert.equal(db.state.analyses.length, 2);
  assert.equal(db.state.comments[0].latest_analysis_id, 'analysis-1');
});

test('un commentaire déjà analysé n’est jamais repris', async () => {
  const db = createFakeDb({
    comments: [{ id: 'c1', content: 'Déjà vu', latest_analysis_id: 'analysis-0', created_at: '2026-09-01T10:00:00Z' }],
  });
  let calls = 0;
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async () => {
      calls += 1;
      return analysis();
    },
  });

  const result = await run({});

  assert.deepEqual(result, { inspected: 0, analysed: 0, failed: 0 });
  assert.equal(calls, 0);
});

test('un commentaire vide ou supprimé sur la plateforme est ignoré', async () => {
  const db = createFakeDb({
    comments: [
      { id: 'vide', content: '   ', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z' },
      { id: 'sans-texte', content: null, latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z' },
      {
        id: 'supprime',
        content: 'Texte réel',
        latest_analysis_id: null,
        is_deleted_on_platform: true,
        created_at: '2026-09-01T10:00:00Z',
      },
    ],
  });
  const { run } = createCommentAnalysis({ query: db.query, analyseComment: async () => analysis() });

  assert.deepEqual(await run({}), { inspected: 0, analysed: 0, failed: 0 });
});

test('un échec du service IA n’interrompt pas le lot et laisse le commentaire repris plus tard', async () => {
  const db = createFakeDb({
    comments: [
      { id: 'ko', content: 'Premier', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z' },
      { id: 'ok', content: 'Second', latest_analysis_id: null, created_at: '2026-09-01T11:00:00Z' },
    ],
  });
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async (commentId) => {
      if (commentId === 'ko') throw new Error('ai_unavailable');
      return analysis();
    },
    logger: { warn() {} },
  });

  const result = await run({});

  assert.deepEqual(result, { inspected: 2, analysed: 1, failed: 1 });
  // Le commentaire en échec garde un pointeur nul : il ressortira du prochain
  // balayage, sans intervention.
  assert.equal(db.state.comments.find((row) => row.id === 'ko').latest_analysis_id, null);
});

test('les valeurs sont écrites en majuscules, comme les énumérations Prisma', async () => {
  const db = createFakeDb({
    comments: [{ id: 'c1', content: 'Bonjour', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z' }],
  });
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async () => analysis({ sentiment: 'neutral', intent: 'info_request', priority: 'low' }),
  });

  await run({});

  const [stored] = db.state.analyses;
  assert.equal(stored.sentiment, 'NEUTRAL');
  assert.equal(stored.intent, 'INFO_REQUEST');
  assert.equal(stored.priority, 'LOW');
});

// Sprint 11 Jour 3 : un commentaire signalé (priorité haute, négatif ou
// urgent) notifie tous les membres éligibles (COMMUNITY_MANAGER/ADMIN/OWNER)
// de la marque — jamais les VIEWER, qui ne peuvent rien faire d'une alerte
// de modération.
test('a flagged comment notifies every eligible brand member, excluding viewers', async () => {
  const db = createFakeDb({
    comments: [
      {
        id: 'c1',
        content: 'Remboursez-moi immédiatement !',
        latest_analysis_id: null,
        created_at: '2026-09-01T10:00:00Z',
        author_name: 'Karim B.',
        brand_id: 'brand-1',
        provider: 'INSTAGRAM',
      },
    ],
    brandMembers: [
      { brand_id: 'brand-1', user_id: 'cm-1', role: 'COMMUNITY_MANAGER' },
      { brand_id: 'brand-1', user_id: 'admin-1', role: 'ADMIN' },
      { brand_id: 'brand-1', user_id: 'viewer-1', role: 'VIEWER' },
      { brand_id: 'brand-2', user_id: 'other-brand', role: 'OWNER' },
    ],
  });
  const notified = [];
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async () => analysis({ priority: 'high', sentiment: 'negative', urgent: true }),
    notifyUser: async (payload) => notified.push(payload),
  });

  await run({});

  const recipients = notified.map((n) => n.userId).sort();
  assert.deepEqual(recipients, ['admin-1', 'admin-1', 'admin-1', 'cm-1', 'cm-1', 'cm-1']);
  assert.equal(notified.every((n) => n.brandId === 'brand-1'), true);
  // Trois types déclenchés (priorité haute + négatif + urgent) × 2 membres éligibles.
  assert.equal(notified.length, 6);
  assert.deepEqual(
    new Set(notified.map((n) => n.type)),
    new Set(['PRIORITY_COMMENT', 'NEGATIVE_COMMENT', 'URGENT_COMMENT'])
  );
  assert.equal(notified[0].resourceType, 'COMMENT');
  assert.equal(notified[0].resourceId, 'c1');
  assert.equal(notified[0].network, 'INSTAGRAM');
  assert.ok(notified[0].eventId.startsWith('comment-analysis:analysis-1:'));
});

test('a neutral low-priority analysis notifies no one', async () => {
  const db = createFakeDb({
    comments: [{ id: 'c1', content: 'Merci beaucoup', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z', brand_id: 'brand-1' }],
    brandMembers: [{ brand_id: 'brand-1', user_id: 'cm-1', role: 'COMMUNITY_MANAGER' }],
  });
  const notified = [];
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async () => analysis({ priority: 'low', sentiment: 'neutral', urgent: false }),
    notifyUser: async (payload) => notified.push(payload),
  });

  await run({});

  assert.equal(notified.length, 0);
});

// Un échec de notification (Express/Firebase indisponible) ne doit ni
// interrompre les autres destinataires, ni faire régresser l'analyse
// elle-même, déjà persistée avec succès.
test('a failing notification for one member does not affect other members or the analysis result', async () => {
  const db = createFakeDb({
    comments: [{ id: 'c1', content: 'Urgent !', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z', brand_id: 'brand-1' }],
    brandMembers: [
      { brand_id: 'brand-1', user_id: 'cm-1', role: 'COMMUNITY_MANAGER' },
      { brand_id: 'brand-1', user_id: 'cm-2', role: 'COMMUNITY_MANAGER' },
    ],
  });
  const notified = [];
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async () => analysis({ priority: 'high', sentiment: 'neutral', urgent: false }),
    notifyUser: async (payload) => {
      if (payload.userId === 'cm-1') throw new Error('api_unavailable');
      notified.push(payload);
    },
    logger: { warn() {} },
  });

  const result = await run({});

  assert.deepEqual(result, { inspected: 1, analysed: 1, failed: 0 });
  assert.equal(notified.length, 1);
  assert.equal(notified[0].userId, 'cm-2');
});

// `notifyUser` est optionnel : un appelant qui ne le fournit pas (aucun test
// existant avant ce sprint) ne doit pas voir le balayage planter.
test('omitting notifyUser does not throw, even for a flagged comment', async () => {
  const db = createFakeDb({
    comments: [{ id: 'c1', content: 'Urgent !', latest_analysis_id: null, created_at: '2026-09-01T10:00:00Z', brand_id: 'brand-1' }],
  });
  const { run } = createCommentAnalysis({
    query: db.query,
    analyseComment: async () => analysis({ priority: 'high', sentiment: 'neutral', urgent: false }),
  });

  const result = await run({});

  assert.deepEqual(result, { inspected: 1, analysed: 1, failed: 0 });
});

test('la limite du lot est transmise à la requête de sélection', async () => {
  const db = createFakeDb({
    comments: Array.from({ length: 5 }, (_, index) => ({
      id: `c${index}`,
      content: `Commentaire ${index}`,
      latest_analysis_id: null,
      created_at: `2026-09-0${index + 1}T10:00:00Z`,
    })),
  });
  const { run } = createCommentAnalysis({ query: db.query, analyseComment: async () => analysis() });

  const result = await run({ limit: 2 });

  assert.equal(result.inspected, 2);
});
