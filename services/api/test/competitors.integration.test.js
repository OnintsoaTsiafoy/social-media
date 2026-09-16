import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import { createAccessToken } from '../src/auth/tokens.js';
import { prisma } from '../src/db/prisma.js';
import { app } from '../src/server.js';

/**
 * Parcours fonctionnel de l'analyse concurrentielle, contre un vrai PostgreSQL.
 *
 * Ce que les tests unitaires ne peuvent pas prouver et qui se joue ici : la
 * contrainte d'unicité qui empêche réellement un doublon, l'isolation par
 * marque (404 et non 403), la cascade de suppression, et le fait que la
 * comparaison lit bien nos publications et celles du concurrent dans la même
 * fenêtre avant de restreindre les composantes.
 *
 * `COMPETITORS_INTEGRATION=1 node --test test/competitors.integration.test.js`
 * depuis `services/api/`, avec la pile démarrée.
 */
test('concurrents : vérification Meta, doublons, isolation, indicateurs et comparaison', {
  skip: process.env.COMPETITORS_INTEGRATION !== '1',
}, async () => {
  const users = [];
  const brands = [];
  const nativeFetch = globalThis.fetch;
  const savedSocialUrl = process.env.SOCIAL_SERVICE_URL;
  const savedAiUrl = process.env.AI_SERVICE_URL;
  process.env.SOCIAL_SERVICE_URL = 'http://competitors-social.invalid';
  process.env.AI_SERVICE_URL = 'http://competitors-ai.invalid';

  // graph-api et ai-service sont simulés : ce test porte sur Express et la
  // base, pas sur Meta. Le profil renvoyé suit exactement la forme contractuelle
  // de /internal/v1/competitors/profile, statut compris.
  let profileStatus = 'ACTIVE';
  const socialCalls = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith(process.env.SOCIAL_SERVICE_URL)) {
      const body = JSON.parse(options.body);
      socialCalls.push(body);
      return new Response(
        JSON.stringify({
          status: profileStatus,
          externalId: profileStatus === 'ACTIVE' ? `ext-${body.handle}` : null,
          username: body.handle,
          name: `Rival ${body.handle}`,
          profileUrl: `https://example.invalid/${body.handle}`,
          avatarUrl: null,
          accountType: 'Compte professionnel',
          followersCount: profileStatus === 'ACTIVE' ? 10_000 : null,
          postsCount: null,
          unavailableFields: ['postsCount'],
          errorCode: profileStatus === 'ACTIVE' ? null : 'forbidden',
          errorMessage: profileStatus === 'ACTIVE' ? null : 'Permission manquante.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (target.startsWith(process.env.AI_SERVICE_URL)) {
      const facts = JSON.parse(options.body);
      // Contrôle du contrat IA : aucune métrique indisponible ne doit être
      // transmise, même à null (section 10 du TODO).
      for (const competitor of facts.competitors) {
        for (const metric of competitor.metrics) {
          assert.notEqual(metric.brand, null);
          assert.notEqual(metric.competitor, null);
        }
      }
      return new Response(
        JSON.stringify({ text: 'Résumé.', recommendations: ['Publier plus souvent.'], generator: 'local-template-1.0.0', warnings: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return nativeFetch(url, options);
  };

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/competitors`;

  async function actor() {
    const user = await prisma.user.create({
      data: {
        email: `competitors-${randomUUID()}@example.invalid`,
        passwordHash: 'unused',
        firstName: 'Competitor',
        lastName: 'Test',
        displayName: 'Competitor Test',
      },
    });
    users.push(user.id);
    const session = await prisma.userSession.create({
      data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { id: user.id, token: createAccessToken(user.id, session.id) };
  }

  async function request(who, path, method = 'GET', body, expected = 200) {
    const result = await nativeFetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json', 'x-request-id': 'competitors-integration' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(result.status, expected, `${method} ${path} → ${result.status}`);
    if (result.status === 204) return undefined;
    const json = await result.json();
    return json.data ?? json;
  }

  try {
    const owner = await actor();
    const viewer = await actor();
    const outsider = await actor();

    const brand = await prisma.brand.create({
      data: {
        name: 'Concurrents integration',
        ownerUserId: owner.id,
        members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: viewer.id, role: 'VIEWER' }] },
      },
    });
    brands.push(brand.id);
    const other = await prisma.brand.create({
      data: { name: 'Autre marque', ownerUserId: outsider.id, members: { create: { userId: outsider.id, role: 'OWNER' } } },
    });
    brands.push(other.id);

    // Sans compte social connecté, aucun concurrent n'est analysable : le
    // message doit le dire, pas laisser Meta répondre une erreur illisible.
    await request(owner, '', 'POST', { brandId: brand.id, platform: 'instagram', handle: '@rival' }, 409);
    assert.equal(socialCalls.length, 0);

    const account = await prisma.socialAccount.create({
      data: {
        brandId: brand.id,
        provider: 'INSTAGRAM',
        name: 'Studio Vega',
        externalAccountId: randomUUID(),
        connectedByUserId: owner.id,
        authMethod: 'FACEBOOK_PAGE',
        followersCount: 5_000,
        followersSyncedAt: new Date(),
      },
    });

    // Vérification sans enregistrement.
    const verified = await request(owner, '/verify', 'POST', { brandId: brand.id, platform: 'instagram', handle: 'https://instagram.com/Rival/' });
    assert.equal(verified.status, 'active');
    // L'URL a été réduite au nom d'utilisateur, en minuscules, côté serveur.
    assert.equal(verified.handle, 'rival');
    assert.equal(verified.alreadyAdded, false);
    assert.equal(await prisma.competitor.count({ where: { brandId: brand.id } }), 0);

    const created = await request(owner, '', 'POST', { brandId: brand.id, platform: 'instagram', handle: '@Rival' }, 201);
    assert.equal(created.username, 'rival');
    assert.equal(created.status, 'active');

    // Doublon : refusé sans même interroger Meta une seconde fois.
    const callsBefore = socialCalls.length;
    await request(owner, '', 'POST', { brandId: brand.id, platform: 'instagram', handle: 'instagram.com/rival' }, 409);
    assert.equal(socialCalls.length, callsBefore);

    // Un VIEWER lit mais ne modifie pas.
    await request(viewer, `?brandId=${brand.id}`);
    await request(viewer, '', 'POST', { brandId: brand.id, platform: 'instagram', handle: 'autre' }, 403);

    // Isolation : l'existence d'un concurrent d'une autre marque ne fuit pas.
    await request(outsider, `/${created.id}?brandId=${other.id}`, 'GET', undefined, 404);
    await request(outsider, `/${created.id}?brandId=${brand.id}`, 'GET', undefined, 404);

    // Un concurrent en PERMISSION_REQUIRED est enregistré (réparable par une
    // App Review) ; un concurrent illisible ne l'est pas.
    profileStatus = 'PERMISSION_REQUIRED';
    const pending = await request(owner, '', 'POST', { brandId: brand.id, platform: 'instagram', handle: 'pending' }, 201);
    assert.equal(pending.status, 'permission_required');
    profileStatus = 'UNAVAILABLE';
    await request(owner, '', 'POST', { brandId: brand.id, platform: 'instagram', handle: 'gone' }, 409);
    profileStatus = 'ACTIVE';

    const filtered = await request(owner, `?brandId=${brand.id}&status=permission_required`);
    assert.deepEqual(filtered.items.map((item) => item.id), [pending.id]);

    // Publications du concurrent et de la marque sur la même fenêtre. Le
    // concurrent n'a pas de partages : la comparaison doit les exclure des
    // deux côtés.
    const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);
    for (const [index, age] of [2, 5, 9].entries()) {
      await prisma.competitorPost.create({
        data: {
          competitorId: created.id,
          externalPostId: `rival-post-${index}`,
          message: `Publication ${index}`,
          publishedAt: daysAgo(age),
          reactionsCount: 200 + index,
          commentsCount: 40,
          sharesCount: null,
        },
      });
    }
    await prisma.competitorMetric.create({
      data: { competitorId: created.id, collectedAt: daysAgo(1), followersCount: 10_000, postsCount: 3, reactionsCount: 601, commentsCount: 120 },
    });
    for (const age of [3, 6]) {
      await prisma.publication.create({
        data: {
          brandId: brand.id,
          createdByUserId: owner.id,
          content: 'Notre publication',
          status: 'PUBLISHED',
          publishedAt: daysAgo(age),
          targets: {
            create: {
              provider: 'INSTAGRAM',
              socialAccountId: account.id,
              status: 'SENT',
              sentAt: daysAgo(age),
              externalPublicationId: `own-${age}`,
              metrics: { create: { collectedAt: new Date(), reactions: 100, comments: 20, shares: 10, reach: 3_000, impressions: 5_000 } },
            },
          },
        },
      });
    }

    const posts = await request(owner, `/${created.id}/posts?brandId=${brand.id}&period=30d`);
    assert.equal(posts.page.total, 3);

    const analytics = await request(owner, `/${created.id}/analytics?brandId=${brand.id}&period=30d`);
    assert.equal(analytics.indicators.postsCount, 3);
    assert.equal(analytics.indicators.avgComments.value, 40);
    // Partages jamais renseignés : indisponibles, jamais 0.
    assert.equal(analytics.indicators.avgShares.value, null);
    assert.equal(analytics.indicators.avgShares.availability, 'unavailable');
    assert.equal(analytics.topPosts.length, 3);

    const comparison = await request(owner, `/comparison?brandId=${brand.id}&period=30d&platform=instagram`);
    const entry = comparison.comparisons.find((item) => item.competitor.id === created.id);
    // Les partages manquent côté concurrent : exclus des DEUX côtés.
    assert.deepEqual(entry.interactionComponents, ['reactions', 'comments']);
    assert.equal(entry.brand.avgInteractions.value, 120);
    assert.equal(entry.competitorIndicators.avgInteractions.value, 241);
    const byKey = Object.fromEntries(entry.metrics.map((metric) => [metric.key, metric]));
    // 120 / 5000 = 2,4 % pour la marque ; 241 / 10000 = 2,41 % pour le concurrent.
    assert.equal(byKey.engagementRate.brand, 2.4);
    assert.equal(byKey.engagementRate.competitor, 2.41);
    // La ligne « partages » existe toujours, marquée indisponible.
    assert.equal(byKey.avgShares.availability, 'unavailable');
    assert.ok(entry.notes.some((note) => note.includes('partages')));

    const explained = await request(owner, '/comparison/explain', 'POST', { brandId: brand.id, period: '30d', platform: 'instagram', limit: 5 });
    assert.equal(explained.recommendations.length, 1);
    assert.ok(explained.facts.competitors.length >= 1);

    // Renommage local, puis suppression avec cascade.
    const renamed = await request(owner, `/${created.id}`, 'PATCH', { brandId: brand.id, name: 'Rival SA' });
    assert.equal(renamed.name, 'Rival SA');

    await request(owner, `/${created.id}?brandId=${brand.id}`, 'DELETE', undefined, 204);
    assert.equal(await prisma.competitorPost.count({ where: { competitorId: created.id } }), 0);
    assert.equal(await prisma.competitorMetric.count({ where: { competitorId: created.id } }), 0);

    assert.equal(
      await prisma.auditLog.count({ where: { resourceId: created.id, action: 'competitor.removed', requestId: 'competitors-integration' } }),
      1
    );
  } finally {
    globalThis.fetch = nativeFetch;
    if (savedSocialUrl === undefined) delete process.env.SOCIAL_SERVICE_URL;
    else process.env.SOCIAL_SERVICE_URL = savedSocialUrl;
    if (savedAiUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = savedAiUrl;
    await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
