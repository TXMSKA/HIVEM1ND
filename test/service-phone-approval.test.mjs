import assert from 'node:assert/strict';
import test from 'node:test';
import { answerApproval } from '../engine/service/approvals.mjs';

test('a phone cannot create a standing approval before any persistence access', async () => {
  await assert.rejects(answerApproval({ principal: { unitId: 'root:master', audience: 'phone' } },
    '11111111-1111-4111-8111-111111111111', { decision: 'approve-always', expectedRevision: '0'.repeat(64) }),
  (error) => error.status === 403 && error.code === 'phone_read_only');
});
