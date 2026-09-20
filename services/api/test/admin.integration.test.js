import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import jwt from 'jsonwebtoken';

import { createAccessToken } from '../src/auth/tokens.js';
import { prisma } from '../src/db/prisma.js';
import { app } from '../src/server.js';

// Base PostgreSQL réelle (celle de Compose) : les agrégats SQL de la console ne
// se vérifient pas contre un double. Lancer avec ADMIN_INTEGRATION=1 depuis un
// conteneur du réseau Compose (voir docs/ADMIN_CONSOLE.md).
//
// Le test ne touche que ses propres lignes, SAUF `platform_settings` qui est
// global à la plateforme : il en prend un instantané et le restaure.
test('console d’administration : accès, lectures agrégées et actions sur base réelle', {
  skip: process.env.ADMIN_INTEGRATION !== '1',
}, async () => {
  const tag = randomUUID().slice(0, 8);
  const userIds = [];
  const brandIds = [];
  const settingsSnapshot = await prisma.platformSetting.findMany();

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;

  async function actor(name, extra = {}) {
    const user = await prisma.user.create({
      data: {
        email: `admin-it-${tag}-${name.toLowerCase()}@example.invalid`,
        passwordHash: 'unused',
        firstName: name,
        lastName: 'Test',
        displayName: `${name} Test ${tag}`,
        ...extra,
      },
    });
    userIds.push(user.id);
    const session = await prisma.userSession.create({
      data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { id: user.id, sessionId: session.id, token: createAccessToken(user.id, session.id) };
  }

  async function call(who, path, { method = 'GET', body } = {}) {
    const result = await fetch(`${base}${path}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: result.status, json: await result.json() };
  }

  async function ok(who, path, options, expected = 200) {
    const result = await call(who, path, options);
    assert.equal(result.status, expected, `${options?.method ?? 'GET'} ${path} → ${result.status} ${JSON.stringify(result.json)}`);
    return result.json.data;
  }

  try {
    const admin = await actor('Admin', { platformRole: 'PLATFORM_ADMIN' });
    const owner = await actor('Owner');
    const manager = await actor('Manager');

    const brand = await prisma.brand.create({
      data: {
        ownerUserId: owner.id,
        name: `Marque admin ${tag}`,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: manager.id, role: 'COMMUNITY_MANAGER' },
          ],
        },
      },
    });
    brandIds.push(brand.id);

    const account = await prisma.socialAccount.create({
      data: {
        brandId: brand.id,
        provider: 'FACEBOOK',
        externalAccountId: `it-${tag}`,
        name: `Page ${tag}`,
        username: `page.${tag}`,
        authMethod: 'FACEBOOK_PAGE',
        connectedByUserId: owner.id,
        followersCount: 1234,
      },
    });

    const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);
    async function comment({ content, status = 'NEW', sentiment, intent = 'OTHER', priority = 'LOW', urgent = false, ageMinutes = 5 }) {
      const created = await prisma.socialComment.create({
        data: {
          socialAccountId: account.id,
          externalCommentId: `c-${randomUUID()}`,
          authorName: 'Claire D.',
          content,
          status,
          createdAt: minutesAgo(ageMinutes),
          metaCreatedAt: minutesAgo(ageMinutes),
        },
      });
      if (sentiment) {
        const analysis = await prisma.commentAnalysis.create({
          data: {
            commentId: created.id,
            sentiment,
            intent,
            priority,
            isUrgent: urgent,
            confidence: 0.9,
            sentimentConfidence: 0.9,
            intentConfidence: 0.9,
            recommendedAction: 'Répondre',
            explanation: 'test',
            modelVersion: 'it',
            datasetVersion: 'it',
          },
        });
        await prisma.socialComment.update({ where: { id: created.id }, data: { latestAnalysisId: analysis.id } });
      }
      return created;
    }
    const suggestion = (commentId, extra = {}) =>
      prisma.responseSuggestion.create({
        data: {
          commentId,
          version: 1,
          text: 'Bonjour Claire, nous regardons cela.',
          originalText: 'Bonjour Claire, nous regardons cela.',
          generatedText: 'Bonjour Claire, nous regardons cela.',
          generator: 'test',
          promptVersion: 'test',
          createdByUserId: manager.id,
          confidenceScore: 0.71,
          durationMs: 1200,
          ...extra,
        },
      });

    const negative = await comment({ content: 'Troisième commande abîmée', sentiment: 'NEGATIVE', priority: 'HIGH', ageMinutes: 30 });
    const positive = await comment({ content: 'Merci, service impeccable', sentiment: 'POSITIVE', ageMinutes: 20 });
    const unanalysed = await comment({ content: 'Pas encore analysé', ageMinutes: 2 });
    const escalated = await comment({ content: 'Rumeur de rappel produit', status: 'ESCALATED', sentiment: 'NEGATIVE', priority: 'HIGH', urgent: true, ageMinutes: 200 });
    await prisma.commentStatusHistory.create({
      data: { commentId: escalated.id, fromStatus: 'NEW', toStatus: 'ESCALATED', changedByUserId: manager.id, changedAt: minutesAgo(190) },
    });
    const answered = await comment({ content: 'Question déjà traitée', status: 'PROCESSED', sentiment: 'NEUTRAL', intent: 'QUESTION', ageMinutes: 60 });

    const draft = await suggestion(negative.id);
    const draftToEscalate = await suggestion(positive.id, { confidenceScore: 0.9 });
    await suggestion(answered.id, { status: 'SENT' });
    await prisma.sentResponse.create({
      data: {
        commentId: answered.id,
        socialAccountId: account.id,
        sentByUserId: manager.id,
        content: 'Réponse envoyée',
        status: 'SUCCEEDED',
        startedAt: minutesAgo(50),
        finishedAt: minutesAgo(50),
      },
    });

    // --- Contrôle d'accès -----------------------------------------------------
    assert.equal((await call(null, '/session')).status, 401);
    const denied = await call(manager, '/session');
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, 'forbidden');
    for (const path of ['/summary', '/overview', '/supervision', '/users', '/pages', '/settings', '/audit']) {
      assert.equal((await call(manager, path)).status, 403, `${path} doit refuser un simple utilisateur`);
    }
    const session = await ok(admin, '/session');
    assert.equal(session.platformRole, 'platform_admin');
    assert.equal(session.user.id, admin.id);

    // --- Résumé de la coque ----------------------------------------------------
    const summary = await ok(admin, '/summary');
    assert.ok(summary.pages.all >= 1 && summary.pages.facebook >= 1);
    assert.ok(summary.users.total >= 3 && summary.users.online >= 3, 'trois sessions récentes ont été créées');
    assert.ok(summary.supervision.pendingDrafts >= 2);
    assert.ok(summary.supervision.openEscalations >= 1);
    assert.equal(typeof summary.sla.targetMinutes, 'number');
    assert.ok(summary.lastEventAt);

    // --- Vue d'ensemble ---------------------------------------------------------
    const overview = await ok(admin, '/overview?period=7d');
    assert.equal(overview.kpis.processed.spark.length, 8);
    assert.ok(overview.kpis.processed.value >= 4, 'quatre commentaires analysés créés');
    assert.ok(overview.sentiment.negative >= 2 && overview.sentiment.positive >= 1);
    assert.equal(overview.daily.length, 14);
    assert.ok(overview.daily.reduce((total, day) => total + day.negative, 0) >= 2);
    assert.equal(typeof overview.kpis.firstResponse.medianSeconds, 'number');
    assert.ok(overview.kpis.aiResolved.rate !== null && overview.kpis.aiResolved.sentByAi >= 1);
    assert.ok(overview.kpis.escalations.open >= 1);
    assert.equal(typeof overview.health.webhooks.total24h, 'number');
    assert.ok(overview.health.moderationBacklog >= 3);
    const escalation = overview.escalations.find((item) => item.id === escalated.id);
    assert.ok(escalation, 'l’escalade ouverte figure dans la liste');
    assert.equal(escalation.severity, 'critical');
    assert.equal(escalation.raisedBy, `Manager Test ${tag}`);
    assert.equal(escalation.page, `Page ${tag}`);
    assert.ok((await ok(admin, '/overview?period=30d&network=instagram')).escalations.every((item) => item.network === 'instagram'));
    assert.equal((await call(admin, '/overview?period=1y')).status, 400);

    const live = await ok(admin, '/live');
    // Créés dans l'heure : négatif (30 min), positif (20 min), non analysé (2 min).
    assert.ok(live.commentsLastHour >= 3);
    assert.ok(live.feed.length >= 1 && live.feed.length <= 6);
    assert.equal(live.feed.find((item) => item.text === 'Pas encore analysé')?.tag, 'pending');
    assert.equal((await ok(admin, '/live?network=instagram')).feed.every((item) => item.network === 'instagram'), true);

    // --- Supervision IA -----------------------------------------------------------
    const supervision = await ok(admin, '/supervision');
    const queued = supervision.queue.items.find((item) => item.id === draft.id);
    assert.ok(queued, 'le brouillon proposé est dans la file');
    assert.equal(queued.status, 'proposed');
    assert.equal(queued.confidence, 71);
    assert.equal(queued.sentiment, 'negative');
    assert.equal(queued.network, 'facebook');
    assert.equal(queued.author, 'Claire D.');
    assert.equal(
      supervision.queue.items.find((item) => item.commentId === answered.id),
      undefined,
      'un commentaire déjà traité n’est jamais dans la file'
    );
    assert.equal(supervision.confidenceDistribution.length, 100);
    // 0,71 × 100 peut tomber sur 70 ou 71 selon l'arrondi flottant : on vérifie le voisinage.
    assert.ok(supervision.confidenceDistribution[70] + supervision.confidenceDistribution[71] >= 1);
    assert.ok(supervision.analysis.waiting >= 1, `commentaire non analysé ${unanalysed.id}`);
    assert.ok(supervision.pipeline.detected >= 5 && supervision.pipeline.published >= 1);
    assert.equal(typeof supervision.settings.threshold, 'number');

    // Rejet : motif conservé comme retour humain, brouillon sorti de la file.
    const rejected = await ok(admin, `/supervision/drafts/${draft.id}/reject`, { method: 'POST', body: { reason: 'wrong_tone' } });
    assert.equal(rejected.status, 'rejected');
    assert.equal((await prisma.responseSuggestion.findUnique({ where: { id: draft.id } })).status, 'REJECTED');
    const feedback = await prisma.aiFeedback.findUnique({ where: { responseId: draft.id } });
    assert.equal(feedback.reason, 'wrong_tone');
    assert.equal(feedback.userId, admin.id);
    assert.equal((await call(admin, `/supervision/drafts/${draft.id}/reject`, { method: 'POST', body: { reason: 'nope' } })).status, 400);
    assert.equal((await call(admin, `/supervision/drafts/${randomUUID()}/reject`, { method: 'POST', body: { reason: 'wrong_tone' } })).status, 404);
    assert.equal((await ok(admin, '/supervision')).queue.items.some((item) => item.id === draft.id), false);

    // Escalade d'un brouillon : le commentaire passe à ESCALATED, l'administrateur est dans l'historique.
    const escalatedDraft = await ok(admin, `/supervision/drafts/${draftToEscalate.id}/escalate`, { method: 'POST', body: { note: 'À voir' } });
    assert.equal(escalatedDraft.status, 'escalated');
    assert.equal((await prisma.socialComment.findUnique({ where: { id: positive.id } })).status, 'ESCALATED');
    const history = await prisma.commentStatusHistory.findFirst({ where: { commentId: positive.id, toStatus: 'ESCALATED' } });
    assert.equal(history.changedByUserId, admin.id);
    assert.equal(history.note, 'À voir');

    // Clôture d'une escalade : traitée une fois, refusée la seconde.
    const resolved = await ok(admin, `/escalations/${escalated.id}/resolve`, { method: 'POST', body: {} });
    assert.equal(resolved.status, 'processed');
    assert.equal((await call(admin, `/escalations/${escalated.id}/resolve`, { method: 'POST', body: {} })).status, 409);
    assert.equal((await ok(admin, '/overview?period=7d')).escalations.some((item) => item.id === escalated.id), false);

    // --- Analytique ---------------------------------------------------------------
    for (const metric of ['engagement', 'response_time', 'sentiment', 'ai_performance']) {
      const trend = await ok(admin, `/analytics/trend?metric=${metric}&period=7d&pageId=${account.id}`);
      assert.equal(trend.points.length, 7, metric);
      assert.equal(trend.previous.length, 7, metric);
      assert.equal(trend.unit, metric === 'response_time' ? 'seconds' : 'percent');
    }
    assert.equal((await ok(admin, `/analytics/trend?metric=engagement&period=30d`)).points.length, 10);
    const engagement = await ok(admin, `/analytics/trend?metric=engagement&period=7d&pageId=${account.id}`);
    assert.equal(engagement.summary.value, null, 'aucune publication : « Non disponible », jamais 0');
    const responseTime = await ok(admin, `/analytics/trend?metric=response_time&period=7d&pageId=${account.id}`);
    assert.ok(Math.abs(responseTime.summary.value - 10 * 60) < 5, 'commentaire à −60 min, réponse à −50 min → 10 min');
    const aiPerformance = await ok(admin, `/analytics/trend?metric=ai_performance&period=7d&pageId=${account.id}`);
    assert.equal(aiPerformance.summary.value, 1);
    const sentimentShare = await ok(admin, `/analytics/trend?metric=sentiment&period=7d&pageId=${account.id}`);
    // Analysés : négatif ×2 (dont l'escaladé), positif ×1, neutre ×1 → 25 % de positifs.
    assert.equal(sentimentShare.summary.value, 0.25);
    const negativeShare = await ok(admin, `/analytics/trend?metric=sentiment&period=7d&pageId=${account.id}&sentiment=negative`);
    assert.equal(negativeShare.summary.value, 0.5);
    assert.equal((await call(admin, '/analytics/trend?metric=revenue')).status, 400);

    const perPage = await ok(admin, `/analytics/pages?period=7d&pageId=${account.id}`);
    assert.equal(perPage.pages.length, 1);
    assert.equal(perPage.pages[0].comments, 5);
    assert.equal(perPage.pages[0].sentimentScore, 25);
    assert.equal(perPage.pages[0].aiShare, 1);
    assert.ok(Math.abs(perPage.pages[0].firstReplySeconds - 600) < 5);
    assert.equal(perPage.hourly.length, 24);
    assert.ok(perPage.hourly.reduce((total, hour) => total + hour.average, 0) * 7 >= 4.99);
    assert.ok(perPage.options.some((option) => option.id === account.id));

    // --- Pages ----------------------------------------------------------------------
    const pages = await ok(admin, '/pages?network=facebook');
    const page = pages.items.find((item) => item.id === account.id);
    assert.ok(page);
    assert.equal(page.status, 'healthy');
    assert.equal(page.handle, `@page.${tag}`);
    assert.equal(page.followers, 1234);
    assert.equal(page.autoReply, false);
    assert.equal(page.brand.name, `Marque admin ${tag}`);
    assert.equal(page.teamCount, 2, 'propriétaire + community manager');
    assert.equal(page.token.state, 'unknown', 'aucun jeton actif enregistré pour cette page de test');
    assert.ok(page.backlog >= 2 && page.comments24h >= 5);
    assert.equal((await ok(admin, '/pages?network=instagram')).items.some((item) => item.id === account.id), false);
    assert.deepEqual(await ok(admin, `/pages/${account.id}`, { method: 'PATCH', body: { autoReply: true } }), { id: account.id, autoReply: true });
    assert.equal((await ok(admin, '/pages')).items.find((item) => item.id === account.id).autoReply, true);
    await ok(admin, `/pages/${account.id}`, { method: 'PATCH', body: { autoReply: false } });
    assert.equal((await ok(admin, '/pages')).items.find((item) => item.id === account.id).autoReply, false);
    assert.equal((await call(admin, `/pages/${randomUUID()}`, { method: 'PATCH', body: { autoReply: true } })).status, 404);

    // --- Réglages ---------------------------------------------------------------------
    const word = `mot${tag}`;
    assert.ok((await ok(admin, '/settings/keywords', { method: 'POST', body: { word: ` ${word.toUpperCase()} ` } }, 201)).keywords.includes(word));
    assert.equal((await call(admin, '/settings/keywords', { method: 'POST', body: { word } })).status, 409);
    // Deux ajouts simultanés ne s'écrasent pas (verrou de ligne).
    const [a, b] = [`aa${tag}`, `bb${tag}`];
    await Promise.all([
      ok(admin, '/settings/keywords', { method: 'POST', body: { word: a } }, 201),
      ok(admin, '/settings/keywords', { method: 'POST', body: { word: b } }, 201),
    ]);
    const settings = await ok(admin, '/settings');
    for (const expected of [word, a, b]) assert.ok(settings.keywords.includes(expected), `${expected} présent`);
    assert.equal((await ok(admin, `/settings/keywords/${a}`, { method: 'DELETE' })).keywords.includes(a), false);
    assert.equal((await call(admin, `/settings/keywords/${a}`, { method: 'DELETE' })).status, 404);

    const levels = await ok(admin, '/settings/service-levels', { method: 'PATCH', body: { firstResponseMinutes: 20 } });
    assert.equal(levels.serviceLevels.firstResponseMinutes, 20);
    assert.equal(levels.serviceLevels.escalationMinutes, settings.serviceLevels.escalationMinutes, 'les autres délais sont conservés');
    assert.equal((await call(admin, '/settings/service-levels', { method: 'PATCH', body: { firstResponseMinutes: 3 } })).status, 400);
    assert.equal((await ok(admin, '/overview')).kpis.firstResponse.targetMinutes, 20, 'le SLA modifié est appliqué au calcul');

    const supervisionSettings = await ok(admin, '/settings/supervision', { method: 'PATCH', body: { threshold: 90, rules: { lang: true } } });
    assert.equal(supervisionSettings.supervision.threshold, 90);
    assert.equal(supervisionSettings.supervision.rules.lang, true);
    assert.equal(supervisionSettings.supervision.rules.negative, settings.supervision.rules.negative);
    assert.equal((await call(admin, '/settings/supervision', { method: 'PATCH', body: { threshold: 100 } })).status, 400);
    assert.equal((await ok(admin, '/supervision')).settings.threshold, 90);

    // --- Utilisateurs et rôles ----------------------------------------------------------
    const users = await ok(admin, `/users?q=${tag}`);
    assert.equal(users.total, 3);
    assert.equal(users.counts.all, 3);
    const listedOwner = users.items.find((item) => item.id === owner.id);
    assert.equal(listedOwner.role, 'owner');
    assert.equal(listedOwner.memberships[0].brandName, `Marque admin ${tag}`);
    assert.equal(listedOwner.pagesCount, 1);
    assert.equal(users.items.find((item) => item.id === admin.id).platformRole, 'platform_admin');
    const listedManager = users.items.find((item) => item.id === manager.id);
    assert.equal(listedManager.replies30d, 1);
    assert.ok(Math.abs(listedManager.averageResponseSeconds - 600) < 5);
    assert.ok(listedManager.lastSeenAt);
    assert.equal((await ok(admin, `/users?q=${tag}&status=suspended`)).total, 0);

    // Garde-fous : ni auto-suspension, ni auto-rétrogradation, ni changement du propriétaire.
    assert.equal((await call(admin, `/users/${admin.id}`, { method: 'PATCH', body: { status: 'suspended' } })).status, 409);
    assert.equal((await call(admin, `/users/${admin.id}`, { method: 'PATCH', body: { platformRole: 'user' } })).status, 409);
    assert.equal((await call(admin, `/users/${owner.id}`, { method: 'PATCH', body: { memberships: [{ brandId: brand.id, role: 'viewer' }] } })).status, 409);
    assert.equal((await call(admin, `/users/${manager.id}`, { method: 'PATCH', body: { memberships: [{ brandId: randomUUID(), role: 'viewer' }] } })).status, 404);
    assert.equal((await call(admin, `/users/${manager.id}`, { method: 'PATCH', body: {} })).status, 400);
    assert.equal((await call(admin, `/users/${randomUUID()}`, { method: 'PATCH', body: { status: 'active' } })).status, 404);

    const promoted = await ok(admin, `/users/${manager.id}`, { method: 'PATCH', body: { memberships: [{ brandId: brand.id, role: 'admin' }] } });
    assert.equal(promoted.memberships[0].role, 'admin');
    assert.equal((await prisma.brandMember.findFirst({ where: { userId: manager.id, brandId: brand.id } })).role, 'ADMIN');

    // Suspension : la session est révoquée, le jeton en cours cesse de fonctionner tout de suite.
    const suspended = await ok(admin, `/users/${manager.id}`, { method: 'PATCH', body: { status: 'suspended' } });
    assert.equal(suspended.status, 'suspended');
    assert.equal((await prisma.userSession.findUnique({ where: { id: manager.sessionId } })).revokedAt !== null, true);
    assert.equal((await call(manager, '/session')).status, 401);
    assert.equal((await ok(admin, `/users?q=${tag}&status=suspended`)).total, 1);
    assert.equal((await ok(admin, `/users/${manager.id}`, { method: 'PATCH', body: { status: 'active' } })).status, 'active');

    // Rôle plateforme : l'accès à la console suit la ligne `users`, pas le jeton.
    const freshSession = await prisma.userSession.create({
      data: { userId: manager.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const managerAgain = { ...manager, token: createAccessToken(manager.id, freshSession.id) };
    assert.equal((await call(managerAgain, '/session')).status, 403);
    await ok(admin, `/users/${manager.id}`, { method: 'PATCH', body: { platformRole: 'platform_admin' } });
    assert.equal((await call(managerAgain, '/session')).status, 200);
    await ok(admin, `/users/${manager.id}`, { method: 'PATCH', body: { platformRole: 'user' } });
    assert.equal((await call(managerAgain, '/session')).status, 403);

    // --- Journal d'audit ------------------------------------------------------------------
    const audit = await ok(admin, '/audit?pageSize=100');
    const actions = audit.items.filter((item) => item.actor?.id === admin.id).map((item) => item.action);
    for (const expected of [
      'admin.settings.keyword_added',
      'admin.settings.keyword_removed',
      'admin.settings.service_levels_updated',
      'admin.settings.supervision_updated',
      'admin.page.auto_reply_changed',
      'admin.membership.role_changed',
      'admin.user.suspended',
      'admin.user.reactivated',
      'admin.user.platform_role_changed',
    ]) {
      assert.ok(actions.includes(expected), `${expected} est journalisé`);
    }
    const keywordEntry = audit.items.find((item) => item.action === 'admin.settings.keyword_added' && item.metadata.keyword === word);
    assert.equal(keywordEntry.kind, 'rule');
    assert.equal(keywordEntry.actor.name, `Admin Test ${tag}`);
    assert.ok(audit.items.every((item) => item.kind !== null), 'seuls les événements d’administration sont exposés');
    const roleEntry = audit.items.find((item) => item.action === 'admin.membership.role_changed' && item.metadata.brandName === `Marque admin ${tag}`);
    assert.deepEqual([roleEntry.metadata.from, roleEntry.metadata.to], ['community_manager', 'admin']);
    assert.equal('requestId' in roleEntry, false);
  } finally {
    // Instantané des réglages globaux : on supprime ce que le test a créé, on restaure le reste.
    await prisma.platformSetting.deleteMany({ where: { key: { notIn: settingsSnapshot.map((row) => row.key) } } });
    for (const row of settingsSnapshot) {
      await prisma.platformSetting.update({
        where: { key: row.key },
        data: { value: row.value, version: row.version, updatedByUserId: row.updatedByUserId, updatedAt: row.updatedAt },
      });
    }
    // Les marques d'abord (cascade : comptes, commentaires, propositions, retours IA), puis les utilisateurs.
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.close();
    await prisma.$disconnect();
  }
});

// ---------------------------------------------------------------------------------------------------
// Liaison d'un compte utilisateur à une page Facebook par un administrateur. graph-api est REMPLACÉ
// par un serveur local qui joue son contrat interne (`/internal/v1/oauth/...`) et enregistre ce qu'il
// reçoit : la base est réelle, Meta ne l'est pas.
test('console d’administration : liaison d’un compte utilisateur à une page Facebook', {
  skip: process.env.ADMIN_INTEGRATION !== '1',
}, async () => {
  const tag = randomUUID().slice(0, 8);
  const userIds = [];
  const brandIds = [];
  const previousEnv = { url: process.env.SOCIAL_SERVICE_URL, web: process.env.ADMIN_WEB_URL };

  // --- Faux graph-api -----------------------------------------------------------------------------
  const received = [];
  const selections = new Map();
  let authorizationFailure = null;
  const graph = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const claims = jwt.verify(request.headers.authorization.replace('Bearer ', ''), process.env.SERVICE_JWT_SECRET, {
        audience: 'social-service',
      });
      const call = { method: request.method, path: request.url, scope: claims.scope, body: raw ? JSON.parse(raw) : undefined };
      received.push(call);
      const reply = (status, body) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };

      if (call.path === '/internal/v1/oauth/facebook/authorization-url') {
        if (authorizationFailure) return reply(authorizationFailure.status, { error: authorizationFailure.error });
        return reply(200, {
          authorizationUrl: 'https://www.facebook.com/v25.0/dialog/oauth?state=SECRET-STATE',
          state: 'SECRET-STATE',
          expiresAt: '2030-01-01T00:00:00.000Z',
        });
      }
      const selectionMatch = call.path.match(/^\/internal\/v1\/oauth\/selections\/([^/]+)(\/link)?$/);
      const selection = selectionMatch && selections.get(selectionMatch[1]);
      if (!selection) return reply(404, { error: { code: 'not_found', message: 'Sélection introuvable.' } });
      if (!selectionMatch[2]) return reply(200, selection);
      return reply(200, {
        accounts: call.body.pageIds.map((pageId) => ({
          id: randomUUID(),
          provider: 'FACEBOOK',
          externalAccountId: pageId,
          name: selection.pages.find((page) => page.externalId === pageId).name,
          username: null,
        })),
      });
    });
  });
  graph.listen(0, '127.0.0.1');
  await once(graph, 'listening');
  process.env.SOCIAL_SERVICE_URL = `http://127.0.0.1:${graph.address().port}`;

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;

  async function actor(name, extra = {}) {
    const user = await prisma.user.create({
      data: { email: `page-it-${tag}-${name.toLowerCase()}@example.invalid`, passwordHash: 'unused', firstName: name, lastName: 'Test', displayName: `${name} Test ${tag}`, ...extra },
    });
    userIds.push(user.id);
    const session = await prisma.userSession.create({
      data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { id: user.id, token: createAccessToken(user.id, session.id) };
  }
  async function call(who, path, { method = 'GET', body } = {}) {
    const result = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: result.status, json: await result.json() };
  }
  async function ok(who, path, options, expected = 200) {
    const result = await call(who, path, options);
    assert.equal(result.status, expected, `${options?.method ?? 'GET'} ${path} → ${result.status} ${JSON.stringify(result.json)}`);
    return result.json.data;
  }

  try {
    const admin = await actor('Admin', { platformRole: 'PLATFORM_ADMIN' });
    const otherAdmin = await actor('Autre', { platformRole: 'PLATFORM_ADMIN' });
    const owner = await actor('Owner');
    const manager = await actor('Manager');
    const outsider = await actor('Outsider');

    const brand = await prisma.brand.create({
      data: {
        ownerUserId: owner.id,
        name: `Marque liaison ${tag}`,
        members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: manager.id, role: 'COMMUNITY_MANAGER' }] },
      },
    });
    const otherBrand = await prisma.brand.create({
      data: { ownerUserId: outsider.id, name: `Autre marque ${tag}`, members: { create: [{ userId: outsider.id, role: 'OWNER' }] } },
    });
    brandIds.push(brand.id, otherBrand.id);

    const account = (brandId, externalAccountId, name, extra = {}) =>
      prisma.socialAccount.create({
        data: { brandId, provider: 'FACEBOOK', externalAccountId, name, authMethod: 'FACEBOOK_PAGE', connectedByUserId: owner.id, ...extra },
      });
    await account(otherBrand.id, `elsewhere-${tag}`, 'Page d’un autre client');
    await account(brand.id, `same-${tag}`, 'Page déjà liée ici');

    const START = { userId: owner.id, brandId: brand.id };

    // --- Démarrage ------------------------------------------------------------------------------------
    assert.equal((await call(owner, '/pages/connect', { method: 'POST', body: START })).status, 403, 'un simple utilisateur ne lie rien');
    assert.equal((await call(admin, '/pages/connect', { method: 'POST', body: { userId: owner.id } })).status, 400);
    assert.equal(
      (await call(admin, '/pages/connect', { method: 'POST', body: { ...START, returnUrl: 'https://evil.example' } })).status,
      400,
      'le client ne choisit pas l’adresse de retour'
    );
    // Le compte doit être membre de la marque, puis propriétaire ou administrateur.
    assert.equal((await call(admin, '/pages/connect', { method: 'POST', body: { userId: outsider.id, brandId: brand.id } })).status, 404);
    const notAdminOfBrand = await call(admin, '/pages/connect', { method: 'POST', body: { userId: manager.id, brandId: brand.id } });
    assert.equal(notAdminOfBrand.status, 409);
    assert.equal(notAdminOfBrand.json.error.code, 'conflict');
    assert.equal(received.length, 0, 'aucun appel à graph-api tant que la demande est refusée');

    const started = await ok(admin, '/pages/connect', { method: 'POST', body: START }, 201);
    assert.equal(started.authorizationUrl, 'https://www.facebook.com/v25.0/dialog/oauth?state=SECRET-STATE');
    assert.equal('state' in started, false, 'le state reste côté serveur');
    const request = received.at(-1);
    assert.deepEqual(request.scope, ['social:write']);
    assert.deepEqual(request.body, {
      userId: owner.id,
      brandId: brand.id,
      mobileRedirectUri: 'http://localhost:5173/#/pages',
      selectPages: true,
      initiatedByUserId: admin.id,
    });

    process.env.ADMIN_WEB_URL = 'https://console.example/anywhere?x=1';
    await ok(admin, '/pages/connect', { method: 'POST', body: START }, 201);
    assert.equal(received.at(-1).body.mobileRedirectUri, 'https://console.example/#/pages');
    delete process.env.ADMIN_WEB_URL;

    authorizationFailure = { status: 503, error: { code: 'OAUTH_CONFIGURATION_ERROR', message: 'Application Meta non configurée' } };
    const unavailable = await call(admin, '/pages/connect', { method: 'POST', body: START });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.json.error.code, 'provider_unavailable');
    authorizationFailure = null;

    // --- Pages proposées ----------------------------------------------------------------------------------
    const selectionId = randomUUID();
    selections.set(selectionId, {
      id: selectionId,
      userId: owner.id,
      brandId: brand.id,
      initiatedByUserId: admin.id,
      expiresAt: '2030-01-01T00:00:00.000Z',
      pages: [
        { externalId: `new-${tag}`, name: 'Nouvelle page', pictureUrl: 'https://cdn.example/n.jpg', instagram: { externalId: `ig-${tag}`, username: 'nouvelle', name: 'Nouvelle' } },
        { externalId: `elsewhere-${tag}`, name: 'Page d’un autre client', pictureUrl: null, instagram: null },
        { externalId: `same-${tag}`, name: 'Page déjà liée ici', pictureUrl: null, instagram: null },
      ],
    });
    const path = `/pages/connect/selections/${selectionId}`;

    const proposed = await ok(admin, path);
    assert.deepEqual(received.at(-1).scope, ['social:read']);
    assert.equal(proposed.user.name, `Owner Test ${tag}`);
    assert.equal(proposed.brand.name, `Marque liaison ${tag}`);
    const byName = Object.fromEntries(proposed.pages.map((page) => [page.name, page]));
    assert.equal(byName['Nouvelle page'].alreadyLinked, false);
    assert.equal(byName['Nouvelle page'].linkedElsewhere, null);
    assert.deepEqual(byName['Nouvelle page'].instagram, { username: 'nouvelle', name: 'Nouvelle' });
    assert.deepEqual(byName['Page d’un autre client'].linkedElsewhere, { brandName: `Autre marque ${tag}` });
    assert.equal(byName['Page déjà liée ici'].alreadyLinked, true);
    assert.equal(byName['Page déjà liée ici'].linkedElsewhere, null);
    assert.equal(JSON.stringify(proposed).includes('accessToken'), false);

    // Seul l'administrateur qui a lancé la liaison peut la terminer.
    assert.equal((await call(otherAdmin, path)).status, 404);
    assert.equal((await call(otherAdmin, `${path}/link`, { method: 'POST', body: { pageIds: [`new-${tag}`] } })).status, 404);
    assert.equal((await call(admin, `/pages/connect/selections/${randomUUID()}`)).status, 404, 'sélection inconnue ou expirée');
    assert.equal((await call(admin, '/pages/connect/selections/pas-un-uuid')).status, 400);

    // --- Liaison -------------------------------------------------------------------------------------------
    assert.equal((await call(admin, `${path}/link`, { method: 'POST', body: { pageIds: [] } })).status, 400);
    const conflict = await call(admin, `${path}/link`, { method: 'POST', body: { pageIds: [`new-${tag}`, `elsewhere-${tag}`] } });
    assert.equal(conflict.status, 409, 'une page d’une autre marque ne se déplace pas');
    assert.deepEqual(conflict.json.error.details, [{ pageId: `elsewhere-${tag}`, name: 'Page d’un autre client', brandName: `Autre marque ${tag}` }]);
    assert.equal(received.filter((entry) => entry.path.endsWith('/link')).length, 0, 'rien n’est envoyé à graph-api en cas de conflit');

    // Le rôle peut changer pendant la redirection vers Meta.
    await prisma.brandMember.update({ where: { brandId_userId: { brandId: brand.id, userId: owner.id } }, data: { role: 'VIEWER' } });
    assert.equal((await call(admin, `${path}/link`, { method: 'POST', body: { pageIds: [`new-${tag}`] } })).status, 409);
    await prisma.brandMember.update({ where: { brandId_userId: { brandId: brand.id, userId: owner.id } }, data: { role: 'OWNER' } });

    const linked = await ok(admin, `${path}/link`, { method: 'POST', body: { pageIds: [`new-${tag}`, `same-${tag}`] } });
    const linkCall = received.at(-1);
    assert.deepEqual(linkCall.scope, ['social:write']);
    assert.deepEqual(linkCall.body, { pageIds: [`new-${tag}`, `same-${tag}`] });
    assert.deepEqual(linked.accounts.map((entry) => entry.name), ['Nouvelle page', 'Page déjà liée ici']);
    assert.equal(linked.user.id, owner.id);
    assert.equal(linked.brand.id, brand.id);

    // --- Audit et liste des pages ------------------------------------------------------------------------------
    const audit = await ok(admin, '/audit?pageSize=100');
    const mine = audit.items.filter((item) => item.actor?.id === admin.id);
    assert.ok(mine.some((item) => item.action === 'admin.page.connect_started' && item.metadata.brandName === `Marque liaison ${tag}`));
    const connected = mine.filter((item) => item.action === 'admin.page.connected');
    assert.equal(connected.length, 2);
    assert.deepEqual(connected.map((item) => item.metadata.pageName).sort(), ['Nouvelle page', 'Page déjà liée ici']);
    assert.equal(connected[0].metadata.userName, `Owner Test ${tag}`);
    assert.equal(connected[0].kind, 'page');

    const pages = await ok(admin, '/pages');
    const listed = pages.items.find((item) => item.name === 'Page déjà liée ici');
    assert.deepEqual(listed.connectedBy, { id: owner.id, name: `Owner Test ${tag}` });
  } finally {
    if (previousEnv.url === undefined) delete process.env.SOCIAL_SERVICE_URL;
    else process.env.SOCIAL_SERVICE_URL = previousEnv.url;
    if (previousEnv.web === undefined) delete process.env.ADMIN_WEB_URL;
    else process.env.ADMIN_WEB_URL = previousEnv.web;
    graph.close();
    server.close();
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
