import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { stableUuid } from '../../spatial/domain/spatial-identity.js';
import {
  ACTIVE_JOURNEY_REPOSITORY,
  type ActiveJourneyRepositoryPort,
} from './active-journey.repository.port.js';
import type {
  ActiveJourney,
  JourneyAlert,
  JourneyDependency,
} from '../domain/active-journey.js';
import { ActiveJourneyError } from '../domain/active-journey.js';
import type { JourneyAlternative } from '../domain/journey.js';
import { assertCanonicalStateBindings } from './journey-planner.service.js';

@Injectable()
export class ActiveJourneyService {
  constructor(
    @Inject(ACTIVE_JOURNEY_REPOSITORY)
    private readonly repository: ActiveJourneyRepositoryPort,
  ) {}

  async activate(input: {
    ownerRef: string;
    selectedJourney: JourneyAlternative;
    activatedAt?: string;
  }): Promise<ActiveJourney> {
    assertOwnerRef(input.ownerRef);
    assertCanonicalStateBindings(input.selectedJourney.legs);
    const activatedAt = input.activatedAt ?? new Date().toISOString();
    assertIsoDate(activatedAt, 'activatedAt');
    const journeyId = activeJourneyInstanceId(
      input.ownerRef,
      input.selectedJourney.journeyId,
    );
    return this.repository.activate({
      journeyId,
      ownerRef: input.ownerRef,
      selectedJourney: input.selectedJourney,
      planFingerprint: selectedJourneyFingerprint(input.selectedJourney),
      dependencies: extractJourneyDependencies(input.selectedJourney).map(
        (dependency) => ({ ...dependency, journeyId }),
      ),
      activatedAt,
    });
  }

  get(journeyId: string, ownerRef: string): Promise<ActiveJourney> {
    assertOwnerRef(ownerRef);
    return this.repository.get(journeyId, ownerRef);
  }

  async updateProgress(input: {
    journeyId: string;
    ownerRef: string;
    completedLegCount: number;
    currentLegSequence: number | null;
    recordedAt: string;
  }): Promise<ActiveJourney> {
    assertOwnerRef(input.ownerRef);
    assertIsoDate(input.recordedAt, 'recordedAt');
    if (
      !Number.isInteger(input.completedLegCount) ||
      input.completedLegCount < 0
    )
      throw new ActiveJourneyError(
        'INVALID_PROGRESS',
        'completedLegCount must be a non-negative integer.',
      );
    if (
      input.currentLegSequence !== null &&
      (!Number.isInteger(input.currentLegSequence) ||
        input.currentLegSequence < input.completedLegCount)
    )
      throw new ActiveJourneyError(
        'INVALID_PROGRESS',
        'currentLegSequence must identify the current or an upcoming leg.',
      );
    return this.repository.updateProgress(input);
  }

  listAlerts(
    journeyId: string,
    ownerRef: string,
  ): Promise<readonly JourneyAlert[]> {
    assertOwnerRef(ownerRef);
    return this.repository.listAlerts(journeyId, ownerRef);
  }
}

export function activeJourneyInstanceId(
  ownerRef: string,
  routingJourneyId: string,
): string {
  return stableUuid(
    'active-journey-instance',
    `${ownerRef}:${routingJourneyId}`,
  );
}

export function selectedJourneyFingerprint(
  journey: JourneyAlternative,
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(journey)))
    .digest('hex');
}

export function extractJourneyDependencies(
  journey: JourneyAlternative,
): readonly Omit<JourneyDependency, 'dependencyId'>[] {
  const dependencies = journey.legs.flatMap((leg) =>
    leg.entityBindings.map((binding) => {
      if (binding.mobilityEntityId === null)
        throw new ActiveJourneyError(
          'ACTIVATION_CONFLICT',
          `Entity ${binding.otpEntityId} has no state-bearing canonical identity.`,
        );
      return {
        journeyId: journey.journeyId,
        legSequence: leg.sequence,
        mobilityEntityId: binding.mobilityEntityId,
        canonicalEntityId: binding.canonicalEntityId,
        entityType: binding.entityType,
        productMode: binding.productMode,
        provenanceRef: binding.provenanceRef,
      };
    }),
  );
  return [
    ...new Map(
      dependencies.map((dependency) => [
        `${dependency.legSequence}:${dependency.mobilityEntityId}`,
        dependency,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      left.legSequence - right.legSequence ||
      left.mobilityEntityId.localeCompare(right.mobilityEntityId),
  );
}

export function dependencyId(
  journeyId: string,
  legSequence: number,
  mobilityEntityId: string,
): string {
  return stableUuid(
    'journey-dependency',
    `${journeyId}:${legSequence}:${mobilityEntityId}`,
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  return value;
}

function assertOwnerRef(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value))
    throw new ActiveJourneyError(
      'OWNER_SCOPE_MISMATCH',
      'ownerRef must be a bounded opaque session reference.',
    );
}

function assertIsoDate(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)))
    throw new ActiveJourneyError(
      'INVALID_PROGRESS',
      `${field} must be an ISO date-time.`,
    );
}
