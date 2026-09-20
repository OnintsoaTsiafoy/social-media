import assert from 'node:assert/strict';
import test from 'node:test';

import { auditKindOf, publicMetadata } from '../src/admin/audit.js';
import { adminWebReturnUrl } from '../src/admin/pageConnection.js';
import { bucketBounds, periodWindows, providerOf, ratio, sumReplyBuckets } from '../src/admin/metrics.js';
import { requirePlatformAdmin } from '../src/admin/middleware.js';
import { feedTagOf, recentDayKeys, resolveTimeZone, severityOf } from '../src/admin/overview.js';
import { healthOf, tokenStateOf } from '../src/admin/pages.js';
import {
  addKeywordSchema,
  approveDraftSchema,
  connectPageSchema,
  linkSelectionSchema,
  listUsersQuerySchema,
  overviewQuerySchema,
  rejectDraftSchema,
  serviceLevelsPatchSchema,
  supervisionPatchSchema,
  trendQuerySchema,
  updatePageSchema,
  updateUserSchema,
} from '../src/admin/schemas.js';
import { highestRole } from '../src/admin/users.js';
import { allowedOrigins, corsMiddleware } from '../src/lib/cors.js';

function runMiddleware(middleware, request) {
  let outcome;
  middleware(request, {}, (error) => {
    outcome = error ?? 'next';
  });
  return outcome;
}

test('l’API d’administration est réservée au rôle PLATFORM_ADMIN', () => {
  assert.equal(runMiddleware(requirePlatformAdmin, { auth: { user: { platformRole: 'PLATFORM_ADMIN' } } }), 'next');

  const denied = runMiddleware(requirePlatformAdmin, { auth: { user: { platformRole: 'USER' } } });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, 'forbidden');

  // Sans authentification préalable, jamais d'accès par défaut.
  assert.equal(runMiddleware(requirePlatformAdmin, {}).status, 403);
});

test('la vue d’ensemble a des valeurs par défaut et refuse les valeurs inconnues', () => {
  assert.deepEqual(overviewQuerySchema.parse({}), { period: '7d', network: 'all' });
  assert.deepEqual(overviewQuerySchema.parse({ period: '90d', network: 'instagram' }), { period: '90d', network: 'instagram' });
  assert.throws(() => overviewQuerySchema.parse({ period: '1y' }));
  assert.throws(() => overviewQuerySchema.parse({ network: 'tiktok' }));
});

test('la courbe d’analytique accepte une page précise mais jamais un identifiant libre', () => {
  const pageId = '11111111-1111-4111-8111-111111111111';
  assert.equal(trendQuerySchema.parse({ pageId }).pageId, pageId);
  assert.throws(() => trendQuerySchema.parse({ pageId: '1; DROP TABLE users' }));
  assert.throws(() => trendQuerySchema.parse({ metric: 'revenue' }));
  assert.equal(trendQuerySchema.parse({}).metric, 'engagement');
});

test('les modifications d’un compte ne peuvent pas promouvoir propriétaire ni être vides', () => {
  const brandId = '11111111-1111-4111-8111-111111111111';
  assert.throws(() => updateUserSchema.parse({}), /Aucune modification/);
  assert.throws(() => updateUserSchema.parse({ memberships: [{ brandId, role: 'owner' }] }));
  assert.throws(() => updateUserSchema.parse({ status: 'deleted' }));
  assert.throws(() => updateUserSchema.parse({ email: 'x@y.z' }), 'les champs inconnus sont refusés');
  assert.deepEqual(updateUserSchema.parse({ memberships: [{ brandId, role: 'viewer' }] }).memberships, [
    { brandId, role: 'viewer' },
  ]);
});

test('la liste des comptes borne la pagination', () => {
  assert.deepEqual(listUsersQuerySchema.parse({}), { status: 'all', page: 1, pageSize: 25 });
  assert.equal(listUsersQuerySchema.parse({ q: '  léa ' }).q, 'léa');
  assert.throws(() => listUsersQuerySchema.parse({ pageSize: '500' }));
});

test('un mot-clé est normalisé (espaces, casse) et borné', () => {
  assert.equal(addKeywordSchema.parse({ word: '  Arnaque ' }).word, 'arnaque');
  assert.throws(() => addKeywordSchema.parse({ word: 'a' }));
  assert.throws(() => addKeywordSchema.parse({ word: 'x'.repeat(41) }));
});

test('les délais de service restent dans des bornes raisonnables', () => {
  assert.deepEqual(serviceLevelsPatchSchema.parse({ firstResponseMinutes: 20 }), { firstResponseMinutes: 20 });
  assert.throws(() => serviceLevelsPatchSchema.parse({ firstResponseMinutes: 0 }));
  assert.throws(() => serviceLevelsPatchSchema.parse({ escalationMinutes: 1441 }));
  assert.throws(() => serviceLevelsPatchSchema.parse({ nightWindowMinutes: 2.5 }));
  assert.throws(() => serviceLevelsPatchSchema.parse({}), /Aucune modification/);
});

test('le seuil d’autonomie ne sort pas de 50–99 et les règles sont des booléens', () => {
  assert.deepEqual(supervisionPatchSchema.parse({ threshold: 82 }), { threshold: 82 });
  assert.throws(() => supervisionPatchSchema.parse({ threshold: 49 }));
  assert.throws(() => supervisionPatchSchema.parse({ threshold: 100 }));
  assert.deepEqual(supervisionPatchSchema.parse({ rules: { vip: false } }), { rules: { vip: false } });
  assert.throws(() => supervisionPatchSchema.parse({ rules: { unknown: true } }));
});

test('le rejet d’un brouillon exige un motif du catalogue, l’approbation borne la retouche', () => {
  assert.equal(rejectDraftSchema.parse({ reason: 'policy_risk' }).reason, 'policy_risk');
  assert.throws(() => rejectDraftSchema.parse({ reason: 'parce que' }));
  assert.throws(() => rejectDraftSchema.parse({}));
  assert.deepEqual(approveDraftSchema.parse({}), {});
  assert.throws(() => approveDraftSchema.parse({ text: 'x'.repeat(501) }));
  assert.throws(() => approveDraftSchema.parse({ text: '   ' }));
});

test('la réponse automatique d’une page est un booléen strict', () => {
  assert.deepEqual(updatePageSchema.parse({ autoReply: true }), { autoReply: true });
  assert.throws(() => updatePageSchema.parse({ autoReply: 'yes' }));
});

test('périodes : la précédente a la même durée et finit où la courante commence', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');
  const { days, current, previous } = periodWindows('30d', now);
  assert.equal(days, 30);
  assert.equal(current.to.toISOString(), now.toISOString());
  assert.equal(previous.to.toISOString(), current.from.toISOString());
  assert.equal(current.to - current.from, previous.to - previous.from);
});

test('les seaux découpent la fenêtre en parts égales sans trou', () => {
  const window = { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-11T00:00:00.000Z') };
  const bounds = bucketBounds(window, 10);
  assert.equal(bounds.length, 10);
  assert.equal(bounds[0].start, window.from.toISOString());
  assert.equal(bounds[9].end, window.to.toISOString());
  for (let index = 1; index < bounds.length; index += 1) assert.equal(bounds[index].start, bounds[index - 1].end);
});

test('un rapport sans dénominateur est null, jamais 0', () => {
  assert.equal(ratio(3, 0), null);
  assert.equal(ratio(1, 4), 0.25);
  const empty = sumReplyBuckets([{ replies: 0, byAi: 0, withinSla: 0 }]);
  assert.equal(empty.aiRate, null);
  assert.equal(empty.slaRate, null);
  const some = sumReplyBuckets([
    { replies: 4, byAi: 3, withinSla: 2 },
    { replies: 6, byAi: 1, withinSla: 6 },
  ]);
  assert.equal(some.aiRate, 0.4);
  assert.equal(some.slaRate, 0.8);
});

test('providerOf ne renvoie un fournisseur que pour un réseau connu', () => {
  assert.equal(providerOf('facebook'), 'FACEBOOK');
  assert.equal(providerOf('instagram'), 'INSTAGRAM');
  assert.equal(providerOf('all'), null);
  assert.equal(providerOf(undefined), null);
});

test('les jours du graphique suivent le fuseau demandé, du plus ancien au plus récent', () => {
  // 23:30 UTC le 20 septembre = déjà le 21 à Paris (UTC+2 en été).
  const now = new Date('2026-09-20T23:30:00.000Z');
  const paris = recentDayKeys('Europe/Paris', 3, now);
  assert.deepEqual(paris, ['2026-09-19', '2026-09-20', '2026-09-21']);
  assert.deepEqual(recentDayKeys('UTC', 3, now), ['2026-09-18', '2026-09-19', '2026-09-20']);
  assert.equal(recentDayKeys('UTC', 14, now).length, 14);
});

test('un fuseau invalide retombe sur UTC au lieu de casser la requête SQL', () => {
  assert.equal(resolveTimeZone('Europe/Paris'), 'Europe/Paris');
  assert.equal(resolveTimeZone('Mars/Olympus'), 'UTC');
  assert.equal(resolveTimeZone("UTC'; DROP TABLE users;--"), 'UTC');
});

test('gravité d’une escalade : urgence, puis priorité, sans analyse « medium »', () => {
  assert.equal(severityOf({ isUrgent: true, priority: 'LOW' }), 'critical');
  assert.equal(severityOf({ isUrgent: false, priority: 'HIGH' }), 'high');
  assert.equal(severityOf({ isUrgent: false, priority: 'MEDIUM' }), 'medium');
  assert.equal(severityOf(null), 'medium');
});

test('étiquette du flux : négatif avant question avant positif, « pending » sans analyse', () => {
  assert.equal(feedTagOf(null), 'pending');
  assert.equal(feedTagOf({ sentiment: 'NEGATIVE', intent: 'QUESTION' }), 'negative');
  assert.equal(feedTagOf({ sentiment: 'NEUTRAL', intent: 'INFO_REQUEST' }), 'question');
  assert.equal(feedTagOf({ sentiment: 'POSITIVE', intent: 'OTHER' }), 'positive');
  assert.equal(feedTagOf({ sentiment: 'NEUTRAL', intent: 'OTHER' }), 'neutral');
});

test('état d’une page et de son jeton d’après les seules métadonnées', () => {
  assert.equal(healthOf('CONNECTED'), 'healthy');
  assert.equal(healthOf('EXPIRING'), 'attention');
  for (const status of ['EXPIRED', 'REAUTH_REQUIRED', 'REVOKED']) assert.equal(healthOf(status), 'action_required');

  const now = new Date('2026-09-20T00:00:00.000Z');
  const days = (count) => new Date(now.getTime() + count * 86_400_000);
  assert.equal(tokenStateOf({ status: 'CONNECTED' }, { expiresAt: days(60) }, now).state, 'valid');
  assert.equal(tokenStateOf({ status: 'CONNECTED' }, { expiresAt: days(6) }, now).state, 'expiring');
  assert.equal(tokenStateOf({ status: 'CONNECTED' }, { expiresAt: days(-1) }, now).state, 'expired');
  assert.equal(tokenStateOf({ status: 'CONNECTED' }, undefined, now).state, 'unknown', 'sans date connue, jamais « valide »');
  const errored = tokenStateOf({ status: 'REAUTH_REQUIRED' }, { expiresAt: days(60), lastErrorMessage: 'Invalid OAuth token' }, now);
  assert.equal(errored.state, 'error');
  assert.equal(errored.message, 'Invalid OAuth token');
});

test('le journal d’audit ne classe que les événements d’administration', () => {
  assert.equal(auditKindOf('admin.membership.role_changed'), 'role');
  assert.equal(auditKindOf('admin.settings.supervision_updated'), 'ai');
  assert.equal(auditKindOf('admin.settings.keyword_added'), 'rule');
  assert.equal(auditKindOf('admin.user.suspended'), 'user');
  assert.equal(auditKindOf('admin.page.auto_reply_changed'), 'page');
  assert.equal(auditKindOf('auth.logged_in'), null);
  assert.equal(auditKindOf('comment.reply_sent'), null);
});

test('les métadonnées d’audit exposées sont une liste blanche', () => {
  assert.deepEqual(publicMetadata({ userName: 'Léa', refreshToken: 'secret', requestPayload: {} }), { userName: 'Léa' });
  assert.deepEqual(publicMetadata(null), {});
  assert.deepEqual(publicMetadata('texte'), {});
});

test('le rôle principal est le plus élevé des rôles par marque', () => {
  assert.equal(highestRole([{ role: 'VIEWER' }, { role: 'ADMIN' }]), 'ADMIN');
  assert.equal(highestRole([{ role: 'COMMUNITY_MANAGER' }, { role: 'OWNER' }, { role: 'VIEWER' }]), 'OWNER');
  assert.equal(highestRole([]), null);
});

// --- CORS ---------------------------------------------------------------------

function fakeResponse() {
  const headers = new Map();
  return {
    headers,
    statusCode: 200,
    ended: false,
    vary(name) {
      headers.set('vary', name);
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
}

function fakeRequest(method, origin) {
  return { method, get: (name) => (name.toLowerCase() === 'origin' ? origin : undefined) };
}

test('CORS : sans liste blanche aucun en-tête n’est émis', () => {
  const middleware = corsMiddleware({});
  const response = fakeResponse();
  let called = false;
  middleware(fakeRequest('GET', 'https://admin.example'), response, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(response.headers.has('access-control-allow-origin'), false);
});

test('CORS : une origine autorisée reçoit sa propre origine, jamais « * »', () => {
  const middleware = corsMiddleware({ CORS_ALLOWED_ORIGINS: 'https://admin.example/, http://localhost:5173' });
  assert.deepEqual(allowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://admin.example/, http://localhost:5173' }), [
    'https://admin.example',
    'http://localhost:5173',
  ]);

  const response = fakeResponse();
  middleware(fakeRequest('GET', 'http://localhost:5173'), response, () => {});
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('vary'), 'Origin');

  const stranger = fakeResponse();
  middleware(fakeRequest('GET', 'https://evil.example'), stranger, () => {});
  assert.equal(stranger.headers.has('access-control-allow-origin'), false);
});

test('CORS : la requête préalable d’une origine autorisée est close par un 204', () => {
  const middleware = corsMiddleware({ CORS_ALLOWED_ORIGINS: 'https://admin.example' });
  const response = fakeResponse();
  let called = false;
  middleware(fakeRequest('OPTIONS', 'https://admin.example'), response, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
  assert.match(response.headers.get('access-control-allow-methods'), /PATCH/);
});

// --- Liaison d'une page Facebook par un administrateur ----------------------------------------

test('l’adresse de retour de la console vient de la configuration, jamais du client', () => {
  assert.equal(adminWebReturnUrl({}), 'http://localhost:5173/#/pages');
  assert.equal(adminWebReturnUrl({ ADMIN_WEB_URL: 'https://admin.hootly.app' }), 'https://admin.hootly.app/#/pages');
  // Chemin, requête et fragment sont écartés : graph-api ajoute lui-même `?status=…` après `#/pages`.
  assert.equal(
    adminWebReturnUrl({ ADMIN_WEB_URL: 'https://admin.hootly.app/console/?a=1#/users' }),
    'https://admin.hootly.app/#/pages'
  );
  assert.equal(adminWebReturnUrl({ ADMIN_WEB_URL: '  http://127.0.0.1:5173/  ' }), 'http://127.0.0.1:5173/#/pages');
});

test('une adresse de console invalide ou dangereuse est refusée plutôt que d’ouvrir une redirection', () => {
  for (const value of ['javascript:alert(1)', 'ftp://exemple.fr', 'pas une adresse']) {
    assert.throws(() => adminWebReturnUrl({ ADMIN_WEB_URL: value }), (error) => error.status === 503 && error.code === 'provider_unavailable');
  }
});

test('la liaison d’une page exige un compte et une marque, rien d’autre', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const brandId = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(connectPageSchema.parse({ userId, brandId }), { userId, brandId });
  assert.throws(() => connectPageSchema.parse({ userId }));
  assert.throws(() => connectPageSchema.parse({ userId, brandId: 'pas-un-uuid' }));
  // Un client ne fournit jamais l'adresse de retour ni le réseau : champs inconnus refusés.
  assert.throws(() => connectPageSchema.parse({ userId, brandId, returnUrl: 'https://evil.example' }));
  assert.throws(() => connectPageSchema.parse({ userId, brandId, provider: 'instagram' }));
});

test('le choix des pages est borné et non vide', () => {
  assert.deepEqual(linkSelectionSchema.parse({ pageIds: [' 123456789 ', '42'] }), { pageIds: ['123456789', '42'] });
  assert.throws(() => linkSelectionSchema.parse({ pageIds: [] }));
  assert.throws(() => linkSelectionSchema.parse({ pageIds: [''] }));
  assert.throws(() => linkSelectionSchema.parse({ pageIds: Array.from({ length: 51 }, (_, index) => String(index)) }));
  assert.throws(() => linkSelectionSchema.parse({ pageIds: ['1'], allowReassign: true }), 'aucun transfert de marque possible');
});

test('les événements de liaison figurent au journal, famille « page »', () => {
  assert.equal(auditKindOf('admin.page.connect_started'), 'page');
  assert.equal(auditKindOf('admin.page.connected'), 'page');
});
