import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ActiveJourneyService } from './application/active-journey.service.js';
import type { JourneyPlannerService } from './application/journey-planner.service.js';
import type { RecoveryRepositoryPort } from './application/recovery.repository.port.js';
import { RecoveryService } from './application/recovery.service.js';
import {
  normalizedRecoveryLeg,
  planChangeCount,
  preservedFutureLegCount,
} from './application/recovery-research-metrics.js';
import type { ActiveJourney } from './domain/active-journey.js';
import type {
  JourneyAlternative,
  JourneyLeg,
  JourneyPlanResult,
} from './domain/journey.js';

describe('RUN 5B state-aware recovery', () => {
  it('uses canonical normalized leg edit distance for insertion, deletion and substitution', () => {
    const a = leg(0, 'route-a', -6.2, 106.8, -6.21, 106.81);
    const b = leg(1, 'route-b', -6.21, 106.81, -6.22, 106.82);
    const c = leg(2, 'route-c', -6.22, 106.82, -6.23, 106.83);
    const replacement = leg(1, 'route-other', -6.21, 106.81, -6.22, 106.82);
    assert.equal(planChangeCount([a, b, c], [a, b, c]), 0);
    assert.equal(planChangeCount([a, b, c], [a, c]), 1);
    assert.equal(planChangeCount([a, c], [a, b, c]), 1);
    assert.equal(planChangeCount([a, b, c], [a, replacement, c]), 1);
    assert.notEqual(
      normalizedRecoveryLeg(b),
      normalizedRecoveryLeg(replacement),
    );
    assert.equal(preservedFutureLegCount([a, b, c], [a, c]), 2);
  });

  it('repairs an invalid middle leg and reconnects to a state-valid original suffix', async () => {
    const active = activeJourneyWithSuffix();
    const planner = plannerFixture([
      result(baselineAlternative()),
      result(
        alternative('connector', [
          leg(2, 'entity-connector', -6.22, 106.82, -6.23, 106.83),
        ]),
      ),
    ]);
    const proposal = await recoveryService(active, planner).create(input());
    assert.equal(proposal.rejoinStatus, 'REJOINED');
    assert.deepEqual(
      proposal.preservedLegs.map((leg) => leg.sequence),
      [1],
    );
    assert.deepEqual(
      proposal.invalidatedLegs.map((leg) => leg.sequence),
      [2],
    );
    assert.deepEqual(
      proposal.rejoinedLegs.map((leg) => leg.sequence),
      [3],
    );
    assert.deepEqual(
      proposal.proposedJourney?.legs.map((leg) => leg.routeId),
      ['route-entity-valid', 'route-entity-connector', 'route-entity-suffix'],
    );
    assert.equal(proposal.completedLegs.length, 1);
    assert.equal(proposal.metrics.preservedLegRatio, 0.667);
    assert.equal(proposal.metrics.stateAware.planChangeCount, 1);
    assert.equal(proposal.metrics.stateAware.addedTravelTimeSeconds, 0);
    assert.equal(proposal.metrics.stateAware.addedTransfers, 0);
    assert.equal(proposal.metrics.fullReplan.planChangeCount, 3);
    assert.equal(proposal.metrics.fullReplan.addedTravelTimeSeconds, -1200);
    assert.equal(proposal.metrics.fullReplan.addedTransfers, -2);
    assert.ok(proposal.metrics.stateAware.timing.totalMs >= 0);
    assert.ok(proposal.metrics.fullReplan.timing.totalMs >= 0);
    assert.equal(
      proposal.proposedJourney?.legs.some((leg) =>
        leg.entityBindings.some(
          (binding) => binding.mobilityEntityId === blockedEntity,
        ),
      ),
      false,
    );
  });

  it('records failed temporal reconnection and replans the entire suffix', async () => {
    const active = activeJourneyWithSuffix();
    const lateConnector = alternative('late', [
      {
        ...leg(2, 'entity-connector', -6.22, 106.82, -6.23, 106.83),
        endAt: '2026-10-02T08:35:00+07:00',
      },
    ]);
    const planner = plannerFixture([
      result(baselineAlternative()),
      result(lateConnector),
      result(repairAlternative()),
    ]);
    const proposal = await recoveryService(active, planner).create(input());
    assert.equal(proposal.rejoinStatus, 'SUFFIX_REPLANNED');
    assert.equal(
      proposal.rejoinReason,
      'ROUTED_CONNECTION_MISSES_FUTURE_SUFFIX',
    );
    assert.equal(proposal.rejoinedLegs.length, 0);
    assert.deepEqual(
      proposal.invalidatedLegs.map((leg) => leg.sequence),
      [2, 3],
    );
  });

  it('preserves completed history and valid remaining structure without retaining a blocked entity', async () => {
    const active = activeJourney();
    const planner = plannerFixture([
      result(repairAlternative()),
      result(baselineAlternative()),
    ]);
    // RecoveryService executes baseline first, then the repair-boundary request.
    planner.results.reverse();
    const service = recoveryService(active, planner);
    const proposal = await service.create(input());
    assert.equal(proposal.status, 'COMPLETED');
    assert.deepEqual(
      proposal.completedLegs.map((leg) => leg.sequence),
      [0],
    );
    assert.deepEqual(
      proposal.preservedLegs.map((leg) => leg.sequence),
      [1],
    );
    assert.deepEqual(
      proposal.invalidatedLegs.map((leg) => leg.sequence),
      [2],
    );
    assert.equal(proposal.metrics.preservedLegRatio, 0.5);
    assert.equal(proposal.metrics.eligibleRemainingLegCount, 2);
    assert.equal(proposal.metrics.disruptedEntityAvoidance, true);
    assert.equal(
      proposal.proposedJourney?.legs.some((leg) =>
        leg.entityBindings.some(
          (binding) => binding.mobilityEntityId === blockedEntity,
        ),
      ),
      false,
    );
    assert.deepEqual(planner.requests[0]?.origin, {
      latitude: -6.21,
      longitude: 106.81,
    });
    assert.deepEqual(planner.requests[1]?.origin, {
      latitude: -6.22,
      longitude: 106.82,
    });
  });

  it('keeps normalized research fingerprints deterministic across identical inputs', async () => {
    const firstPlanner = plannerFixture([
      result(baselineAlternative()),
      result(repairAlternative()),
    ]);
    const secondPlanner = plannerFixture([
      result(baselineAlternative()),
      result(repairAlternative()),
    ]);
    const first = await recoveryService(activeJourney(), firstPlanner).create(
      input(),
    );
    const second = await recoveryService(activeJourney(), secondPlanner).create(
      input(),
    );
    assert.equal(first.proposedFingerprint, second.proposedFingerprint);
    assert.equal(first.baselineFingerprint, second.baselineFingerprint);
    assert.notEqual(first.proposedFingerprint, first.baselineFingerprint);
  });

  it('returns explicit NO_PATH without substituting the FULL_REPLAN baseline', async () => {
    const planner = plannerFixture([result(baselineAlternative()), null]);
    const proposal = await recoveryService(activeJourney(), planner).create(
      input(),
    );
    assert.equal(proposal.status, 'NO_PATH');
    assert.equal(proposal.proposedJourney, null);
    assert.notEqual(proposal.baselineJourney, null);
    assert.equal(proposal.metrics.recoverySuccess, false);
  });
});

const blockedEntity = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function recoveryService(active: ActiveJourney, planner: PlannerFixture) {
  const journeys = {
    get: async () => active,
  } as unknown as ActiveJourneyService;
  const repository: RecoveryRepositoryPort = {
    findByIdempotency: async () => null,
    getCurrentImpact: async () => ({
      impactId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      journeyId: active.journeyId,
      mobilityEntityId: blockedEntity,
      stateTransitionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      operationalState: 'UNAVAILABLE',
      projectionVersion: 'PHASE_2B_V1',
      provenanceRef: 'fixture:SIMULATED',
    }),
    save: async (proposal) => proposal,
    get: async () => {
      throw new Error('unused');
    },
  };
  return new RecoveryService(
    journeys,
    planner as unknown as JourneyPlannerService,
    repository,
  );
}

type PlannerFixture = {
  results: Array<JourneyPlanResult | null>;
  requests: Array<{ origin: { latitude: number; longitude: number } }>;
  fullReplan(request: {
    origin: { latitude: number; longitude: number };
  }): Promise<JourneyPlanResult>;
  validateOperationalState(): Promise<{
    blockedEntityIds: readonly string[];
    stateByEntity: ReadonlyMap<string, unknown>;
  }>;
};

function plannerFixture(
  results: Array<JourneyPlanResult | null>,
): PlannerFixture {
  return {
    results,
    requests: [],
    async validateOperationalState() {
      return {
        blockedEntityIds: [],
        stateByEntity: new Map<string, unknown>(),
      };
    },
    async fullReplan(request) {
      this.requests.push({ origin: request.origin });
      const next = this.results.shift();
      if (next === null || next === undefined) {
        const { JourneyRoutingError } = await import('./domain/journey.js');
        throw new JourneyRoutingError('NO_ROUTE', 'fixture no route');
      }
      return next;
    },
  };
}

function input() {
  return {
    activeJourneyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    impactId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    ownerRef: 'owner-a',
    idempotencyKey: 'recovery-key-a',
    recoveryAt: '2026-10-02T08:10:00+07:00',
  };
}

function activeJourney(): ActiveJourney {
  const legs = [
    leg(0, 'entity-completed', -6.2, 106.8, -6.21, 106.81),
    leg(1, 'entity-valid', -6.21, 106.81, -6.22, 106.82),
    leg(2, blockedEntity, -6.22, 106.82, -6.23, 106.83),
  ];
  return {
    journeyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ownerRef: 'owner-a',
    lifecycleStatus: 'ACTIVE',
    planFingerprint: 'a'.repeat(64),
    originalPlan: alternative('original', legs),
    activatedAt: '2026-10-02T08:00:00+07:00',
    completedAt: null,
    progress: {
      completedLegCount: 1,
      currentLegSequence: 1,
      method: 'CONTROLLED_MANUAL',
      recordedAt: '2026-10-02T08:10:00+07:00',
      revision: 2,
      boardingConfirmedLegSequence: null,
      boardingConfirmedAt: null,
      alightingConfirmedLegSequence: null,
      alightingConfirmedAt: null,
    },
    dependencies: [],
  };
}

function activeJourneyWithSuffix(): ActiveJourney {
  const base = activeJourney();
  return {
    ...base,
    originalPlan: alternative('original-suffix', [
      ...base.originalPlan.legs,
      leg(3, 'entity-suffix', -6.23, 106.83, -6.24, 106.84),
    ]),
  };
}

function repairAlternative() {
  return alternative('repair', [
    leg(0, 'entity-repair', -6.22, 106.82, -6.23, 106.83),
  ]);
}

function baselineAlternative() {
  return alternative('baseline', [
    {
      ...leg(0, 'entity-baseline', -6.21, 106.81, -6.23, 106.83),
      startAt: '2026-10-02T08:10:00+07:00',
      endAt: '2026-10-02T08:20:00+07:00',
    },
  ]);
}

function alternative(
  id: string,
  legs: readonly JourneyLeg[],
): JourneyAlternative {
  return {
    journeyId: `11111111-1111-4111-8111-${id.padEnd(12, '1').slice(0, 12)}`,
    origin: {
      latitude: legs[0]!.from.latitude!,
      longitude: legs[0]!.from.longitude!,
    },
    destination: {
      latitude: legs.at(-1)!.to.latitude!,
      longitude: legs.at(-1)!.to.longitude!,
    },
    startAt: legs[0]!.startAt,
    endAt: legs.at(-1)!.endAt,
    durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
    transferCount: Math.max(0, legs.length - 1),
    walkingDistanceMeters: 0,
    legs,
    fareStatus: 'UNKNOWN',
    routingContext: {
      provider: 'OTP',
      providerVersion: '2.10.0',
      routingSnapshotId: 'router-v1',
      routingManifestSha256: 'a'.repeat(64),
      graphSha256: 'b'.repeat(64),
      networkSnapshotId: '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f',
      networkSnapshotHash: 'c'.repeat(64),
      mobilityProjectionVersion: 'PHASE_2B_V1',
      plannedAt: '2026-10-02T01:00:00Z',
      commonServiceDate: '2026-10-02',
      timezone: 'Asia/Jakarta',
      attemptCount: 1,
      excludedRouteIds: [],
    },
  };
}

function leg(
  sequence: number,
  entityId: string,
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): JourneyLeg {
  return {
    sequence,
    mode: 'TRANSJAKARTA',
    otpMode: 'BUS',
    from: {
      name: `from-${sequence}`,
      otpStopId: `from-${sequence}`,
      latitude: fromLat,
      longitude: fromLon,
    },
    to: {
      name: `to-${sequence}`,
      otpStopId: `to-${sequence}`,
      latitude: toLat,
      longitude: toLon,
    },
    intermediateStops: [],
    startAt: `2026-10-02T08:${String(sequence * 10).padStart(2, '0')}:00+07:00`,
    endAt: `2026-10-02T08:${String((sequence + 1) * 10).padStart(2, '0')}:00+07:00`,
    durationSeconds: 600,
    distanceMeters: 1000,
    routeId: `route-${entityId}`,
    routeShortName: 'R',
    tripId: `trip-${sequence}`,
    serviceDate: '2026-10-02',
    timingPrecision: 'SOURCE_GTFS_WITH_FREQUENCIES',
    entityBindings: [
      {
        otpEntityId: `otp-${entityId}`,
        productMode: 'TRANSJAKARTA',
        entityType: 'ROUTE',
        canonicalEntityId: entityId,
        mobilityEntityId: entityId,
        resolutionMethod: 'EXACT_SOURCE_REFERENCE',
        provenanceRef: 'fixture:SIMULATED',
      },
    ],
    operationalFlags: [],
  };
}

function result(alternative: JourneyAlternative): JourneyPlanResult {
  return {
    alternatives: [alternative],
    rejectedCandidateCount: 0,
    stateValidationMilliseconds: 1,
    routingMilliseconds: 2,
    totalMilliseconds: 3,
    strategy: 'FULL_REPLAN',
  };
}
