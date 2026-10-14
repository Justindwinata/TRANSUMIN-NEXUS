import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptanceReconcileOutcome,
  canCommitRecovery,
  recoveryProposalKey,
  recoverySource,
  sameRecoverySource,
} from './passenger-api.ts';

const journey = (id, revision, accepted_recovery_id = null) => ({
  journey_id: id,
  accepted_recovery_id,
  progress: { revision },
});

test('G1-A guards reject stale generation/source and scope proposal after acceptance', () => {
  const original = recoverySource(journey('j1', 4));
  const accepted = recoverySource(journey('j1', 4, 'r1'));
  assert.notEqual(
    recoveryProposalKey({
      journeyId: 'j1',
      impactId: 'i1',
      revision: 4,
      acceptedRecoveryId: null,
    }),
    recoveryProposalKey({
      journeyId: 'j1',
      impactId: 'i1',
      revision: 4,
      acceptedRecoveryId: 'r1',
    }),
  );
  assert.equal(sameRecoverySource(original, original), true);
  assert.equal(sameRecoverySource(original, accepted), false);
  const valid = {
    requestId: 2,
    latestRequestId: 2,
    generation: 7,
    latestGeneration: 7,
    captured: original,
    latest: original,
  };
  assert.equal(canCommitRecovery(valid), true);
  assert.equal(canCommitRecovery({ ...valid, latestGeneration: 8 }), false);
  assert.equal(canCommitRecovery({ ...valid, latest: accepted }), false);
  assert.equal(canCommitRecovery({ ...valid, requestId: 1 }), false);
});

test('G1-A reconcile distinguishes applied, safe retry, and unreadable state', () => {
  assert.equal(
    acceptanceReconcileOutcome({
      journey: { accepted_recovery_id: 'r1' },
      recoveryId: 'r1',
    }),
    'APPLIED',
  );
  assert.equal(
    acceptanceReconcileOutcome({
      journey: { accepted_recovery_id: null },
      recoveryId: 'r1',
    }),
    'NOT_APPLIED',
  );
  assert.equal(
    acceptanceReconcileOutcome({ journey: null, recoveryId: 'r1' }),
    'UNKNOWN',
  );
});
