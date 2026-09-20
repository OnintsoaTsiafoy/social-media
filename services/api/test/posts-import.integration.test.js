import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import { createAccessToken } from '../src/auth/tokens.js';
import { prisma } from '../src/db/prisma.js';
import { stopBoss } from '../src/lib/jobs.js';
import { app } from '../src/server.js';

// Base PostgreSQL réelle (celle de Compose), comme admin.integration.test.js :
// lancer avec POSTS_IMPORT_INTEGRATION=1 depuis un conteneur du réseau Compose.
// Ni Meta ni graph-api ne sont sollicités — l'import lui-même est couvert côté
// graph-api (tests/test_posts_sync.py) et côté worker (test/posts-sync.test.js) ;
// ici on vérifie ce que l'API en fait : l'action « Synchroniser », et ce qu'une
// publication IMPORTÉE peut ou ne peut pas subir.
test('import des publications : action de synchronisation et gardes sur les publications importées', {
  skip: process.env.POSTS_IMPORT_INTEGRATION !== '1',
}, async () => {
  const tag = randomUUID().slice(0, 8);
  const userIds = [];
  const brandIds = [];
  const accountIds = [];

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}/api/v1`;

  async function actor(name, extra = {}) {
    const user = await prisma.user.create({
      data: { email: `posts-it-${tag}-${name.toLowerCase()}@example.invalid`, passwordHash: 'unused', firstName: name, lastName: 'Test', displayName: `${name} Test ${tag}`, ...extra },
    });
    userIds.push(user.id);
    const session = await prisma.userSession.create({
      data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { id: user.id, token: createAccessToken(user.id, session.id) };
  }
  async function call(who, path, { method = 'GET', body, headers = {} } = {}) {
    const result = await fetch(`${root}${path}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: result.status, json: result.status === 204 ? null : await result.json() };
  }
  async function ok(who, path, options, expected = 200) {
    const result = await call(who, path, options);
    assert.equal(result.status, expected, `${options?.method ?? 'GET'} ${path} → ${result.status} ${JSON.stringify(result.json)}`);
    return result.json.data;
  }
  const queuedJobs = (accountId) =>
    prisma.$queryRawUnsafe(
      "SELECT id FROM pgboss.job WHERE name = 'sync-social-posts' AND data->>'socialAccountId' = $1",
      accountId
    );

  try {
    const admin = await actor('Admin', { platformRole: 'PLATFORM_ADMIN' });
    const owner = await actor('Owner');
    const viewer = await actor('Viewer');

    const brand = await prisma.brand.create({
      data: {
        ownerUserId: owner.id,
        name: `Marque import ${tag}`,
        members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: viewer.id, role: 'VIEWER' }] },
      },
    });
    brandIds.push(brand.id);

    const account = async (provider, name, extra = {}) => {
      const created = await prisma.socialAccount.create({
        data: { brandId: brand.id, provider, externalAccountId: `${name}-${tag}`, name, authMethod: 'FACEBOOK_PAGE', connectedByUserId: owner.id, ...extra },
      });
      accountIds.push(created.id);
      return created;
    };
    const page = await account('FACEBOOK', 'Page');
    const expiredPage = await account('FACEBOOK', 'Expiree', { status: 'REAUTH_REQUIRED' });
    const instagram = await account('INSTAGRAM', 'Insta');

    // --- « Synchroniser » : réservé à l'administrateur de la plateforme ---------------------------------------
    const sync = (who, id) => call(who, `/admin/pages/${id}/sync`, { method: 'POST' });
    assert.equal((await sync(null, page.id)).status, 401);
    assert.equal((await sync(owner, page.id)).status, 403, 'le propriétaire de la marque n’est pas administrateur de la plateforme');
    assert.equal((await sync(admin, 'pas-un-uuid')).status, 400);
    assert.equal((await sync(admin, randomUUID())).status, 404);
    assert.equal((await queuedJobs(page.id)).length, 0, 'aucun refus ne met un job en file');

    const refusedInstagram = await sync(admin, instagram.id);
    assert.equal(refusedInstagram.status, 409);
    assert.match(refusedInstagram.json.error.message, /Instagram/);
    const refusedExpired = await sync(admin, expiredPage.id);
    assert.equal(refusedExpired.status, 409, 'une page à reconnecter n’est pas synchronisable');
    assert.equal((await queuedJobs(instagram.id)).length + (await queuedJobs(expiredPage.id)).length, 0);

    // --- Demande acceptée : asynchrone, dédoublonnée, tracée ------------------------------------------------------
    const queued = await sync(admin, page.id);
    assert.equal(queued.status, 202, 'l’import est asynchrone');
    assert.deepEqual(queued.json.data, { status: 'queued' });
    const [job] = await prisma.$queryRawUnsafe(
      "SELECT data FROM pgboss.job WHERE name = 'sync-social-posts' AND data->>'socialAccountId' = $1",
      page.id
    );
    assert.deepEqual(job.data, { socialAccountId: page.id, requestedBy: admin.id }, 'le job n’emporte que l’identifiant du compte');

    const again = await sync(admin, page.id);
    assert.equal(again.status, 202);
    assert.deepEqual(again.json.data, { status: 'already_queued' }, 'deux clics rapprochés ne relancent pas tout le parcours du fil');
    assert.equal((await queuedJobs(page.id)).length, 1);

    // Chaque demande acceptée est tracée (qui a cliqué), qu'elle ait créé un job ou non.
    const trail = await prisma.auditLog.findMany({ where: { action: 'admin.page.sync_requested', resourceId: page.id } });
    assert.equal(trail.length, 2);
    assert.ok(trail.every((entry) => entry.userId === admin.id));

    // --- La liste des pages dit ce que l'import a ramené -------------------------------------------------------------
    const before = (await ok(admin, '/admin/pages')).items.find((item) => item.id === page.id);
    assert.equal(before.lastPostsSyncAt, null, 'jamais importée en entier');
    assert.equal(before.postsCount, 0);

    // --- Une publication importée : lisible, jamais rééditée ni renvoyée ------------------------------------------------
    const postedAt = new Date('2024-11-24T03:53:17.000Z');
    const imported = await prisma.publication.create({
      data: {
        brandId: brand.id,
        createdByUserId: owner.id,
        content: 'Ne ratez pas ça #promo',
        hashtags: ['#promo'],
        status: 'PUBLISHED',
        origin: 'IMPORTED',
        publishedAt: postedAt,
        createdAt: postedAt,
        targets: {
          create: {
            socialAccountId: page.id,
            provider: 'FACEBOOK',
            status: 'SENT',
            externalPublicationId: `${page.externalAccountId}_100`,
            externalUrl: 'https://www.facebook.com/page/posts/100',
            sentAt: postedAt,
          },
        },
      },
    });
    await prisma.socialAccount.update({ where: { id: page.id }, data: { lastPostsSyncAt: new Date() } });

    const after = (await ok(admin, '/admin/pages')).items.find((item) => item.id === page.id);
    assert.equal(after.postsCount, 1);
    assert.ok(after.lastPostsSyncAt);

    for (const [label, who] of [['propriétaire', owner], ['lecteur', viewer]]) {
      const shown = await ok(who, `/publications/${imported.id}`);
      assert.equal(shown.origin, 'imported', label);
      assert.equal(shown.status, 'published');
      assert.equal(shown.content, 'Ne ratez pas ça #promo');
      assert.deepEqual(shown.hashtags, ['#promo']);
      assert.equal(new Date(shown.publishedAt).toISOString(), postedAt.toISOString());
      assert.equal(shown.targets[0].externalUrl, 'https://www.facebook.com/page/posts/100');
      assert.equal(shown.targets[0].status, 'sent');
    }
    const listed = await ok(owner, `/publications?brandId=${brand.id}`);
    assert.ok(listed.items.some((item) => item.id === imported.id && item.origin === 'imported'));
    assert.equal((await ok(owner, `/publications/counts?brandId=${brand.id}`)).published, 1);

    const headers = () => ({ 'Idempotency-Key': randomUUID() });
    assert.equal((await call(owner, `/publications/${imported.id}`, { method: 'PATCH', body: { content: 'réécrit' } })).status, 409);
    const republish = await call(owner, `/publications/${imported.id}/publish`, { method: 'POST', headers: headers() });
    assert.ok(republish.status >= 400 && republish.status < 500, `republier une importée est refusé (${republish.status})`);
    const retried = await call(owner, `/publications/${imported.id}/retry`, { method: 'POST', body: {}, headers: headers() });
    assert.ok(retried.status >= 400 && retried.status < 500, `relancer une importée est refusé (${retried.status})`);
    assert.equal((await call(owner, `/publications/${imported.id}/schedule`, { method: 'POST', body: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), timezone: 'Europe/Paris' } })).status >= 400, true);

    // Rien n'est reparti vers Facebook : ni statut, ni compteur d'envois, ni contenu modifiés.
    const untouched = await prisma.publication.findUnique({ where: { id: imported.id }, include: { targets: true } });
    assert.equal(untouched.status, 'PUBLISHED');
    assert.equal(untouched.content, 'Ne ratez pas ça #promo');
    assert.equal(untouched.targets[0].status, 'SENT');
    assert.equal(untouched.targets[0].attemptCount, 0);

    // Clé de dédoublonnage : un même post Facebook n'a jamais deux cibles pour un compte, qu'il ait été
    // publié par Hootly ou importé — c'est ce qui rend une relecture du fil sans effet.
    const otherPublication = await prisma.publication.create({
      data: { brandId: brand.id, createdByUserId: owner.id, content: 'doublon', status: 'PUBLISHED' },
    });
    await assert.rejects(
      prisma.publicationTarget.create({
        data: { publicationId: otherPublication.id, socialAccountId: page.id, provider: 'FACEBOOK', status: 'SENT', externalPublicationId: `${page.externalAccountId}_100` },
      }),
      (error) => error.code === 'P2002'
    );
    // …alors que les cibles sans identifiant externe (brouillons, envois en cours) restent libres.
    const draftA = await prisma.publication.create({ data: { brandId: brand.id, createdByUserId: owner.id, content: 'brouillon A' } });
    const draftB = await prisma.publication.create({ data: { brandId: brand.id, createdByUserId: owner.id, content: 'brouillon B' } });
    for (const draft of [draftA, draftB]) {
      await prisma.publicationTarget.create({ data: { publicationId: draft.id, socialAccountId: page.id, provider: 'FACEBOOK' } });
    }
  } finally {
    await prisma.$executeRawUnsafe(
      "DELETE FROM pgboss.job WHERE name = 'sync-social-posts' AND data->>'socialAccountId' = ANY($1::text[])",
      accountIds
    );
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.close();
    // La mise en file ouvre pg-boss, qui garde le processus en vie tant qu'il n'est pas arrêté.
    await stopBoss();
    await prisma.$disconnect();
  }
});
