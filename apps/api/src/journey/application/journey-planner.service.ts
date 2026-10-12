import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Inject, Injectable } from '@nestjs/common';

import {
  MOBILITY_STATE_PORT,
  type MobilityStatePort,
} from '../../mobility-twin/application/mobility-state.port.js';
import type { EffectiveMobilityState } from '../../mobility-twin/domain/mobility-twin.js';
import {
  type JourneyAlternative,
  type JourneyCandidateRejection,
  type JourneyLeg,
  type JourneyPlanRequest,
  type JourneyPlanResult,
  JourneyRoutingError,
} from '../domain/journey.js';
import {
  JOURNEY_ROUTING_PORT,
  type JourneyRoutingPort,
} from './journey-routing.port.js';
import {
  ROUTING_IDENTITY_PORT,
  type RoutingIdentityPort,
} from './routing-identity.port.js';

const MAX_ROUTER_ATTEMPTS = 2;

@Injectable()
export class JourneyPlannerService {
  constructor(
    @Inject(JOURNEY_ROUTING_PORT)
    private readonly router: JourneyRoutingPort,
    @Inject(ROUTING_IDENTITY_PORT)
    private readonly identities: RoutingIdentityPort,
    @Inject(MOBILITY_STATE_PORT)
    private readonly mobilityState: MobilityStatePort,
  ) {}

  async plan(request: JourneyPlanRequest): Promise<JourneyPlanResult> {
    return this.execute(request, 'INITIAL_PLAN');
  }

  async fullReplan(request: JourneyPlanRequest): Promise<JourneyPlanResult> {
    return this.execute(request, 'FULL_REPLAN');
  }

  async health() {
    return this.router.routerHealth();
  }

  async validateOperationalState(legs: readonly JourneyLeg[]): Promise<{
    blockedEntityIds: readonly string[];
    stateByEntity: ReadonlyMap<string, EffectiveMobilityState>;
  }> {
    assertCanonicalStateBindings(legs);
    return this.validateState(legs);
  }

  private async execute(
    request: JourneyPlanRequest,
    strategy: JourneyPlanResult['strategy'],
  ): Promise<JourneyPlanResult> {
    const totalStarted = performance.now();
    const snapshot = await this.mobilityState.getSnapshot(
      request.networkSnapshotId,
    );
    if (snapshot.status !== 'FINALIZED')
      throw new JourneyRoutingError(
        'DATASET_NOT_READY',
        'Network snapshot is not finalized.',
      );

    const excludedRoutes = new Set<string>();
    const accepted: JourneyAlternative[] = [];
    const acceptedFingerprints = new Set<string>();
    let rejectedCandidateCount = 0;
    const candidateRejections: JourneyCandidateRejection[] = [];
    let stateValidationMilliseconds = 0;
    let routingMilliseconds = 0;

    for (let attempt = 1; attempt <= MAX_ROUTER_ATTEMPTS; attempt += 1) {
      const routingStarted = performance.now();
      const candidates = await this.router.planJourney({
        ...request,
        excludedRouteIds: [...excludedRoutes].sort(),
        attempt,
      });
      routingMilliseconds += performance.now() - routingStarted;
      if (candidates.length === 0 && attempt === 1)
        throw new JourneyRoutingError(
          'NO_ROUTE',
          'Router returned no journey.',
        );

      for (const candidate of candidates) {
        const identityResolvedLegs = await this.identities.resolveLegs(
          candidate.legs,
          snapshot,
        );
        assertCanonicalStateBindings(identityResolvedLegs);
        const validationStarted = performance.now();
        const validation = await this.validateState(identityResolvedLegs);
        stateValidationMilliseconds += performance.now() - validationStarted;
        if (validation.blockedEntityIds.length > 0) {
          rejectedCandidateCount += 1;
          candidateRejections.push({
            attempt,
            routeIds: identityResolvedLegs
              .map((leg) => leg.routeId)
              .filter((value): value is string => value !== null)
              .sort(),
            blockedEntityIds: [...validation.blockedEntityIds].sort(),
            reason: 'CURRENT_UNAVAILABLE_CANONICAL_ENTITY',
          });
          for (const routeId of identityResolvedLegs
            .map((leg) => leg.routeId)
            .filter((value): value is string => value !== null))
            excludedRoutes.add(routeId);
          continue;
        }

        const legs = identityResolvedLegs.map((leg) => ({
          ...leg,
          operationalFlags: leg.entityBindings
            .map((binding) =>
              binding.mobilityEntityId === null
                ? undefined
                : validation.stateByEntity.get(binding.mobilityEntityId),
            )
            .filter(
              (state): state is EffectiveMobilityState =>
                state !== undefined &&
                (state.operationalState === 'DEGRADED' ||
                  state.operationalState === 'DISRUPTED'),
            )
            .map((state) => ({
              mobilityEntityId: state.mobilityEntityId,
              operationalState: state.operationalState as
                'DEGRADED' | 'DISRUPTED',
              evidenceType: state.evidenceType,
              freshnessStatus: state.freshnessStatus,
              provenanceRef: state.provenanceRef,
            })),
        }));
        const fingerprint = meaningfulFingerprint(legs);
        if (acceptedFingerprints.has(fingerprint)) continue;
        acceptedFingerprints.add(fingerprint);
        accepted.push({
          ...candidate,
          journeyId: deterministicJourneyId(request, legs, strategy),
          legs,
          routingContext: {
            ...candidate.routingContext,
            networkSnapshotId: snapshot.snapshotId,
            networkSnapshotHash: snapshot.contentHash,
            mobilityProjectionVersion: snapshot.processingVersion,
            attemptCount: attempt,
            excludedRouteIds: [...excludedRoutes].sort(),
          },
        });
      }

      if (accepted.length >= (request.maximumAlternatives ?? 3)) break;
      if (excludedRoutes.size === 0) break;
    }

    if (accepted.length === 0)
      throw new JourneyRoutingError(
        'NO_VALID_ROUTE_AFTER_STATE_VALIDATION',
        'Every routed candidate is blocked by current authoritative state.',
        {
          rejectedCandidateCount,
          candidateRejections,
          excludedRouteIds: [...excludedRoutes].sort(),
          maximumAttempts: MAX_ROUTER_ATTEMPTS,
        },
      );

    return {
      alternatives: rankAlternatives(accepted, request.preference).slice(
        0,
        request.maximumAlternatives ?? 3,
      ),
      rejectedCandidateCount,
      candidateRejections,
      stateValidationMilliseconds: round(stateValidationMilliseconds),
      routingMilliseconds: round(routingMilliseconds),
      totalMilliseconds: round(performance.now() - totalStarted),
      strategy,
    };
  }

  private async validateState(legs: readonly JourneyLeg[]): Promise<{
    blockedEntityIds: readonly string[];
    stateByEntity: ReadonlyMap<string, EffectiveMobilityState>;
  }> {
    const entityIds = [
      ...new Set(
        legs.flatMap((leg) =>
          leg.entityBindings.flatMap((binding) =>
            binding.mobilityEntityId === null ? [] : [binding.mobilityEntityId],
          ),
        ),
      ),
    ].sort();
    const states = await this.mobilityState.getStates(entityIds);
    const stateByEntity = new Map(
      states.map((state) => [state.mobilityEntityId, state]),
    );
    return {
      blockedEntityIds: states
        .filter(
          (state) =>
            state.operationalState === 'UNAVAILABLE' &&
            state.freshnessStatus !== 'EXPIRED' &&
            state.freshnessStatus !== 'NOT_YET_VALID',
        )
        .map((state) => state.mobilityEntityId)
        .sort(),
      stateByEntity,
    };
  }
}

export function assertCanonicalStateBindings(
  legs: readonly JourneyLeg[],
): void {
  for (const leg of legs) {
    if (leg.mode === 'WALK') continue;
    const expectedOtpIds = [
      ...(leg.from.otpStopId === null ? [] : [leg.from.otpStopId]),
      ...leg.intermediateStops.map((stop) => stop.otpStopId),
      ...(leg.to.otpStopId === null ? [] : [leg.to.otpStopId]),
      ...(leg.routeId === null ? [] : [leg.routeId]),
    ];
    const byOtpId = new Map(
      leg.entityBindings.map((binding) => [binding.otpEntityId, binding]),
    );
    for (const otpEntityId of expectedOtpIds) {
      const binding = byOtpId.get(otpEntityId);
      if (binding === undefined || binding.mobilityEntityId === null)
        throw new JourneyRoutingError(
          'IDENTITY_UNRESOLVED',
          `Router entity ${otpEntityId} has no canonical state-bearing identity.`,
          { otpEntityId, productMode: leg.mode },
        );
    }
  }
}

function meaningfulFingerprint(legs: readonly JourneyLeg[]): string {
  return JSON.stringify(
    legs.map((leg) => ({
      mode: leg.mode,
      routeId: leg.routeId,
      from: leg.from.otpStopId ?? leg.from.name,
      to: leg.to.otpStopId ?? leg.to.name,
    })),
  );
}

function deterministicJourneyId(
  request: JourneyPlanRequest,
  legs: readonly JourneyLeg[],
  strategy: JourneyPlanResult['strategy'],
): string {
  const bytes = createHash('sha256')
    .update(
      JSON.stringify({
        origin: request.origin,
        destination: request.destination,
        departureAt: request.departureAt,
        networkSnapshotId: request.networkSnapshotId,
        strategy,
        legs: meaningfulFingerprint(legs),
      }),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rankAlternatives(
  alternatives: readonly JourneyAlternative[],
  preference: JourneyPlanRequest['preference'],
): JourneyAlternative[] {
  return [...alternatives].sort((left, right) => {
    const metric =
      preference === 'FEWEST_TRANSFERS'
        ? left.transferCount - right.transferCount
        : preference === 'LEAST_WALKING'
          ? left.walkingDistanceMeters - right.walkingDistanceMeters
          : left.durationSeconds - right.durationSeconds;
    return metric || left.journeyId.localeCompare(right.journeyId);
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
