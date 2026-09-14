import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalDecisionSchema, approvalListSchema, approvalRejectionSchema, requestApprovalSchema } from '../src/approvals/schemas.js';
import { notificationPreferenceAllows } from '../src/notifications/service.js';

const id = 'bbf82932-3f71-4031-ad89-c8f678705811';
test('approval payloads require a current request ID and reject role spoofing', () => {
  assert.equal(approvalDecisionSchema.safeParse({}).success, false);
  assert.equal(approvalDecisionSchema.safeParse({ approvalId: id }).success, true);
  assert.equal(requestApprovalSchema.safeParse({ role: 'OWNER' }).success, false);
  assert.equal(requestApprovalSchema.safeParse({ reviewerId: 'not-a-user' }).success, false);
  assert.equal(approvalRejectionSchema.safeParse({ approvalId: id, comment: ' ' }).success, false);
  assert.equal(approvalRejectionSchema.parse({ approvalId: id, comment: ' Corriger ' }).comment, 'Corriger');
  assert.equal(approvalListSchema.parse({}).status, 'pending');
  assert.equal(approvalListSchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(approvalListSchema.safeParse({ reviewerId: 'other' }).success, false);
});

test('all approval pushes respect the dedicated notification preference and priority threshold', () => {
  for (const type of ['PUBLICATION_APPROVAL_REQUESTED', 'PUBLICATION_APPROVED', 'PUBLICATION_REJECTED', 'PUBLICATION_CHANGES_REQUESTED']) {
    assert.equal(notificationPreferenceAllows(null, type, 'MEDIUM'), true);
    assert.equal(notificationPreferenceAllows({ publicationApproval: false, minimumPriority: 'LOW' }, type, 'MEDIUM'), false);
    assert.equal(notificationPreferenceAllows({ publicationApproval: true, minimumPriority: 'HIGH' }, type, 'MEDIUM'), false);
    assert.equal(notificationPreferenceAllows({ publicationApproval: true, minimumPriority: 'LOW' }, type, 'MEDIUM'), true);
  }
});
