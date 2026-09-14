import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { app } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { createAccessToken } from '../src/auth/tokens.js';
import { stopBoss } from '../src/lib/jobs.js';
import { createNotification } from '../src/notifications/service.js';
import { createDeliveryService } from '../../worker/src/delivery.js';

// Real PostgreSQL + isolated pg-boss queues. All social deliveries are mocked.
test('publication approval: permissions, decisions, history, jobs and concurrent requests', {
  skip: process.env.APPROVAL_INTEGRATION !== '1',
}, async () => {
  const users = [], brands = [], publicationIds = [];
  const oldSchema = process.env.PGBOSS_SCHEMA;
  const queueSchema = `approval_test_${randomUUID().replaceAll('-', '')}`;
  process.env.PGBOSS_SCHEMA = queueSchema;
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function actor(name) {
    const user = await prisma.user.create({ data: { email: `approval-${randomUUID()}@example.invalid`,
      passwordHash: 'unused', firstName: name, lastName: 'Test', displayName: name } });
    users.push(user.id);
    const session = await prisma.userSession.create({ data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
    return { id: user.id, token: createAccessToken(user.id, session.id) };
  }
  async function response(actor_, path, method = 'GET', body) {
    const result = await fetch(`${base}${path}`, { method,
      headers: { Authorization: `Bearer ${actor_.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, json: result.status === 204 ? null : await result.json() };
  }
  async function request(actor_, path, method = 'GET', body, expected = 200) {
    const result = await response(actor_, path, method, body);
    assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(result.json)}`);
    return result.json?.data;
  }
  try {
    const owner = await actor('Owner'), admin = await actor('Admin'), cm = await actor('CM');
    const viewer = await actor('Viewer'), outsider = await actor('Outsider'), colleague = await actor('Colleague');
    const brand = await prisma.brand.create({ data: { ownerUserId: owner.id, name: 'Approval integration',
      members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: admin.id, role: 'ADMIN' },
        { userId: cm.id, role: 'COMMUNITY_MANAGER' }, { userId: colleague.id, role: 'COMMUNITY_MANAGER' }, { userId: viewer.id, role: 'VIEWER' }] } } });
    brands.push(brand.id);
    const foreignBrand = await prisma.brand.create({ data: { ownerUserId: outsider.id, name: 'Other brand',
      members: { create: { userId: outsider.id, role: 'OWNER' } } } });
    brands.push(foreignBrand.id);
    const draftPayload = { brandId: brand.id, content: 'Publication à valider', targets: [{ provider: 'facebook' }] };
    const create = async () => {
      const pub = await request(cm, '/publications', 'POST', draftPayload, 201);
      publicationIds.push(pub.id);
      return pub;
    };
    const p = await create();
    const path = `/publications/${p.id}`;
    assert.equal(p.status, 'draft');
    assert.equal(p.approvalValid, false);
    const future = { scheduledAt: new Date(Date.now() + 86400000).toISOString() };
    await request(cm, `${path}/publish`, 'POST', {}, 409);
    await request(owner, `${path}/schedule`, 'POST', future, 409);
    await request(viewer, '/publications', 'POST', draftPayload, 403);
    await request(outsider, '/publications', 'POST', draftPayload, 404);
    await request(outsider, `${path}/approval-history`, 'GET', undefined, 404);
    await request(outsider, `${path}/request-approval`, 'POST', {}, 404);
    await request(viewer, `${path}/request-approval`, 'POST', {}, 403);
    await request(cm, `${path}/request-approval`, 'POST', { reviewerId: outsider.id }, 422);
    await request(cm, `${path}/request-approval`, 'POST', { reviewerId: cm.id }, 422);
    await request(cm, `${path}/request-approval`, 'POST', { role: 'OWNER' }, 400);
    await request(cm, `/approvals?brandId=${brand.id}`, 'GET', undefined, 403);
    const members = await request(cm, `/approvals/members?brandId=${brand.id}`);
    assert.equal(members.find((member) => member.id === admin.id).role, 'admin');

    const submitted = await request(cm, `${path}/request-approval`, 'POST', { reviewerId: admin.id, comment: 'Campagne de septembre' }, 201);
    assert.equal(submitted.status, 'pending_approval');
    assert.equal(submitted.approval.reviewerId, admin.id);
    const firstId = submitted.approval.id;
    await request(cm, path, 'PATCH', { content: 'Interdit pendant validation' }, 409);
    await request(owner, path, 'PATCH', { hashtags: ['interdit'] }, 409);
    await request(cm, path, 'DELETE', undefined, 409);
    await request(cm, `${path}/publish`, 'POST', {}, 409);
    await request(cm, `${path}/schedule`, 'POST', future, 409);
    await request(cm, `${path}/approve`, 'POST', { approvalId: firstId }, 403);
    await request(viewer, `${path}/approve`, 'POST', { approvalId: firstId }, 403);
    await request(outsider, `${path}/approve`, 'POST', { approvalId: firstId }, 404);
    await request(admin, `${path}/reject`, 'POST', { approvalId: firstId, comment: '   ' }, 400);
    await request(admin, `${path}/request-changes`, 'POST', { approvalId: firstId }, 400);
    const pendingList = await request(admin, `/approvals?brandId=${brand.id}&status=pending&authorId=${cm.id}&reviewerId=${admin.id}&pageSize=1`);
    assert.equal(pendingList.total, 1);
    assert.equal(pendingList.items[0].publication.content, draftPayload.content);
    assert.equal((await request(outsider, '/approvals')).total, 0);

    const rejected = await request(admin, `${path}/reject`, 'POST', { approvalId: firstId, comment: 'Remplacer le visuel.' });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.approval.comment, 'Remplacer le visuel.');
    await request(cm, `${path}/publish`, 'POST', {}, 409);
    await request(cm, `${path}/request-approval`, 'POST', {}, 409);
    await request(cm, path, 'PATCH', { content: 'Version corrigée' });
    const second = await request(cm, `${path}/request-approval`, 'POST', {}, 201);
    const changed = await request(owner, `${path}/request-changes`, 'POST', { approvalId: second.approval.id, comment: 'Préciser les horaires.' });
    assert.equal(changed.approval.status, 'changes_requested');
    assert.equal(changed.status, 'rejected');
    await request(cm, path, 'PATCH', { content: 'Ouverture à 9h' });
    const third = await request(cm, `${path}/request-approval`, 'POST', {}, 201);
    await request(colleague, `${path}/cancel-approval`, 'POST', { approvalId: third.approval.id }, 403);
    const cancelled = await request(cm, `${path}/cancel-approval`, 'POST', { approvalId: third.approval.id });
    assert.equal(cancelled.status, 'draft');
    assert.equal(cancelled.approval.status, 'cancelled');

    // Only one of two simultaneous submissions may win.
    const submissions = await Promise.all([1, 2].map(() => response(cm, `${path}/request-approval`, 'POST', { reviewerId: admin.id })));
    assert.deepEqual(submissions.map((result) => result.status).sort(), [201, 409]);
    const fourth = submissions.find((result) => result.status === 201).json.data;
    // A delayed response from the old review screen must not decide the new request.
    await request(admin, `${path}/approve`, 'POST', { approvalId: third.approval.id }, 409);
    const decisions = await Promise.all([1, 2].map(() => response(admin, `${path}/approve`, 'POST', { approvalId: fourth.approval.id, comment: 'Bon pour publication.' })));
    assert.deepEqual(decisions.map((result) => result.status).sort(), [200, 409]);
    const approved = decisions.find((result) => result.status === 200).json.data;
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvalValid, true);
    const scheduled = await request(cm, `${path}/schedule`, 'POST', future, 201);
    assert.equal(scheduled.status, 'scheduled');
    const approvedAgain = await request(cm, `${path}/schedule`, 'DELETE');
    assert.equal(approvedAgain.status, 'approved');
    await request(cm, `${path}/schedule`, 'POST', future, 201);
    const oldRevision = approved.approval.revision;
    const edited = await request(cm, path, 'PATCH', { hashtags: ['#nouveau'] });
    assert.equal(edited.status, 'draft');
    assert.equal(edited.approvalValid, false);
    assert.equal(edited.scheduledAt, null);
    assert.equal((await prisma.scheduledPublication.findUnique({ where: { publicationId: p.id } })).status, 'CANCELLED');
    await request(cm, `${path}/publish`, 'POST', {}, 409);
    const fifth = await request(cm, `${path}/request-approval`, 'POST', {}, 201);
    const ownerApproved = await request(owner, `${path}/approve`, 'POST', { approvalId: fifth.approval.id });
    assert.equal(ownerApproved.approval.reviewerId, owner.id);

    let deliveries = 0;
    const service = createDeliveryService({ query: async (sql, params) => prisma.$queryRawUnsafe(sql, ...params),
      provider: { deliver: async () => { deliveries++; return { externalPublicationId: 'mock-post' }; } }, logger: { log() {}, warn() {} } });
    // Uses the actual worker SQL: no fake DB can accidentally accept a broken guard.
    assert.equal((await service.publish({ publicationId: p.id, revision: oldRevision })).skipped, 'approval_invalid_or_stale_job');
    assert.equal(deliveries, 0);
    const publicationNow = await request(cm, `${path}/publish`, 'POST', {}, 202);
    assert.equal(publicationNow.publication.status, 'publishing');
    await request(cm, path, 'PATCH', { content: 'Changement pendant envoi' }, 409);
    assert.equal((await service.publish({ publicationId: p.id, revision: ownerApproved.approval.revision })).status, 'PUBLISHED');
    assert.equal(deliveries, 1);

    // Cancellation between the schedule read and publication claim must win.
    const scheduledRace = await create();
    const scheduledPath = `/publications/${scheduledRace.id}`;
    const scheduledRequest = await request(cm, `${scheduledPath}/request-approval`, 'POST', {}, 201);
    const scheduledApproval = await request(owner, `${scheduledPath}/approve`, 'POST', { approvalId: scheduledRequest.approval.id });
    await request(cm, `${scheduledPath}/schedule`, 'POST', future, 201);
    const cancelledService = createDeliveryService({
      query: async (sql, params) => {
        const rows = await prisma.$queryRawUnsafe(sql, ...params);
        if (sql.includes('SELECT status, scheduled_at FROM scheduled_publications')) {
          await request(cm, `${scheduledPath}/schedule`, 'DELETE');
        }
        return rows;
      },
      provider: { deliver: async () => { throw new Error('A cancelled schedule must never send.'); } },
      logger: { log() {}, warn() {} },
    });
    assert.equal((await cancelledService.publish({ publicationId: scheduledRace.id,
      revision: scheduledApproval.approval.revision, requireSchedule: true, scheduledAt: future.scheduledAt })).skipped, 'not_publishable');
    assert.equal((await request(cm, scheduledPath)).status, 'approved');
    await service.publish({ publicationId: p.id, revision: ownerApproved.approval.revision });
    assert.equal(deliveries, 1);

    const notifications = await prisma.notification.findMany({ where: { resourceId: p.id } });
    assert.equal(notifications.filter((n) => n.eventId === `approval:${firstId}:PUBLICATION_APPROVAL_REQUESTED`).length, 1);
    assert.equal(notifications.find((n) => n.eventId === `approval:${firstId}:PUBLICATION_APPROVAL_REQUESTED`).userId, admin.id);
    assert.equal(notifications.find((n) => n.type === 'PUBLICATION_REJECTED').userId, cm.id);
    assert.equal(notifications.find((n) => n.type === 'PUBLICATION_CHANGES_REQUESTED').userId, cm.id);
    assert.equal(notifications.filter((n) => n.eventId === `approval:${fourth.approval.id}:PUBLICATION_APPROVED`).length, 1);
    const existing = notifications.find((n) => n.type === 'PUBLICATION_APPROVED');
    assert.equal((await createNotification(existing)).deduplicated, true);
    const publicNotifications = await request(cm, '/notifications');
    assert.ok(publicNotifications.items.some((n) => n.type === 'publication_approved' && n.href === `/publications/${p.id}`));
    const prefs = await request(cm, '/notification-settings', 'PATCH', { publicationApproval: false });
    assert.equal(prefs.publicationApproval, false);

    const history = await request(viewer, `${path}/approval-history?pageSize=100`);
    assert.ok(history.items.some((event) => event.action === 'publication.created'));
    assert.ok(history.items.some((event) => event.action === 'publication.reject' && event.actorId === admin.id && event.comment === 'Remplacer le visuel.' && event.fromStatus === 'pending_approval' && event.toStatus === 'rejected'));
    assert.ok(history.items.some((event) => event.action === 'publication.delivery_completed'));
    assert.equal((await request(viewer, `${path}/approval-history?pageSize=1`)).items.length, 1);
    assert.equal(await prisma.publicationApproval.count({ where: { publicationId: p.id } }), 5);

    // Concurrent edit/submission has one serial outcome; approval never covers a stale edit.
    const race = await create();
    await Promise.all([response(cm, `/publications/${race.id}`, 'PATCH', { content: 'Concurrent edit' }),
      response(cm, `/publications/${race.id}/request-approval`, 'POST', {})]);
    const raceStored = await prisma.publication.findUnique({ where: { id: race.id }, include: { approvals: true } });
    assert.equal(raceStored.status, 'PENDING_APPROVAL');
    assert.equal(raceStored.approvals[0].revision, raceStored.contentRevision);
    assert.equal(raceStored.approvedRevision, null);
    assert.equal((await service.publish({ publicationId: race.id, revision: raceStored.contentRevision })).skipped, 'approval_invalid_or_stale_job');
    assert.equal(deliveries, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await stopBoss();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${queueSchema}" CASCADE`);
    await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { resourceId: { in: publicationIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (oldSchema === undefined) delete process.env.PGBOSS_SCHEMA; else process.env.PGBOSS_SCHEMA = oldSchema;
    await prisma.$disconnect();
  }
});
