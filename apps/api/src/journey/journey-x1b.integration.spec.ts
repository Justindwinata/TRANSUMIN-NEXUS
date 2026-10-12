import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { sql } from 'kysely';

import { DisruptionIntelligenceService } from '../disruption/application/disruption-intelligence.service.js';
import { OperationalEventBus } from '../disruption/application/operational-event-bus.js';
import { KyselyIncidentLifecycleRepository } from '../disruption/infrastructure/kysely-incident-lifecycle.repository.js';
import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { KyselyMobilityStateRepository } from '../mobility-twin/infrastructure/kysely-mobility-state.repository.js';
import { OperationalContractValidator } from '../operational-data/application/operational-contract-validator.js';
import { OperationalIncidentService } from '../operational-data/application/operational-incident.service.js';
import type { IncidentEvidenceInput } from '../operational-data/domain/hazard-incident.js';
import {
  ActiveJourneyService,
  activeJourneyInstanceId,
} from './application/active-journey.service.js';
import { JourneyImpactService } from './application/journey-impact.service.js';
import type { JourneyAlternative, JourneyLeg } from './domain/journey.js';
import { KyselyActiveJourneyRepository } from './infrastructure/kysely-active-journey.repository.js';

/**
 * X1-B — real-DB proof that X1-A lifecycle ingestion reaches only relevant ACTIVE
 * journeys through `JourneyImpactService`. All evidence is explicitly SIMULATED
 * controlled fixtures; no real canonical IDs, schedules, or golden claims.
 */
const ids = {
  source: randomUUID(),
  version: randomUUID(),
  snapshot: randomUUID(),
  affectedEntity: randomUUID(),
  unrelatedEntity: randomUUID(),
  journeyA: randomUUID(),
  journeyB: randomUUID(),
  journeyC: randomUUID(),
  operationalSource: randomUUID(),
} as const;

const owners = {
  a: 'x1b-session-a',
  b: 'x1b-session-b',
  c: 'x1b-session-c',
} as const;
const activeA = activeJourneyInstanceId(owners.a, ids.journeyA);
const activeB = activeJourneyInstanceId(owners.b, ids.journeyB);
const activeC = activeJourneyInstanceId(owners.c, ids.journeyC);
const allActiveIds = [activeA, activeB, activeC] as const;

const database = createDatabase();
const validator = new OperationalContractValidator();
const states = new KyselyMobilityStateRepository(database, validator);
const repository = new KyselyActiveJourneyRepository(database);
const journeys = new ActiveJourneyService(repository);
const events = new OperationalEventBus();
const impacts = new JourneyImpactService(repository, states, events);
const incidents = new OperationalIncidentService(validator);
const lifecycle = new KyselyIncidentLifecycleRepository(
  database,
  incidents,
  states,
  events,
);
const intelligence = new DisruptionIntelligenceService(database);

const incidentIds = {
  unverified: randomUUID(),
  future: randomUUID(),
  expired: randomUUID(),
  active: randomUUID(),
  reactivated: randomUUID(),
} as const;

let hazardEventId: string | null = null;

describe('X1-B lifecycle-driven targeted alerts (SIMULATED)', () => {
  before(async () => {
    await migrateToLatest(database);
    await clearFixture();
    await sql`
      insert into meta.dataset_source (
        id, source_key, name, provider, source_type, verification_status
      ) values (
        ${ids.source}::uuid, ${`x1b-fixture-${ids.source}`}, 'X1-B fixture',
        'Test', 'SYNTHETIC_TEST', 'VERIFIED'
      )
    `.execute(database);
    await sql`
      insert into meta.dataset_version (
        id, source_id, version_label, checksum_sha256, retrieved_at,
        raw_path_ref, manifest_path, validation_status
      ) values (
        ${ids.version}::uuid, ${ids.source}::uuid, 'x1b-fixture', ${'a'.repeat(64)},
        now(), 'fixture:SIMULATED', 'fixture:SIMULATED', 'VALID'
      )
    `.execute(database);
    await sql`
      insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id)
      values
        (${ids.affectedEntity}::uuid, 'ROUTE', ${ids.version}::uuid),
        (${ids.unrelatedEntity}::uuid, 'ROUTE', ${ids.version}::uuid)
    `.execute(database);
    await sql`
      insert into twin.network_snapshot (
        id, transit_dataset_version_id, spatial_dataset_version_id,
        processing_version, state_cutoff_at, configuration_json, manifest_ref,
        content_hash, status, finalized_at
      ) values (
        ${ids.snapshot}::uuid, ${ids.version}::uuid, ${ids.version}::uuid,
        'X1B_TEST', now(), '{}'::jsonb, 'fixture:SIMULATED',
        ${'b'.repeat(64)}, 'FINALIZED', now()
      )
    `.execute(database);
    impacts.onModuleInit();
  });

  after(async () => {
    impacts.onModuleDestroy();
    await clearFixture();
    await database.destroy();
  });

  it('targets only relevant ACTIVE future dependencies and honours the lifecycle matrix', async () => {
    assert.ok(activeA !== activeB && activeB !== activeC);
    const activatedAt = new Date().toISOString();
    const nowMs = Date.now();

    // Journey A depends on the affected route in a FUTURE leg; B is unrelated; C is completed-only.
    await journeys.activate({
      ownerRef: owners.a,
      selectedJourney: plan(ids.journeyA, [
        ids.unrelatedEntity,
        ids.affectedEntity,
      ]),
      activatedAt,
    });
    await journeys.activate({
      ownerRef: owners.b,
      selectedJourney: plan(ids.journeyB, [ids.unrelatedEntity]),
      activatedAt,
    });
    await journeys.activate({
      ownerRef: owners.c,
      selectedJourney: plan(ids.journeyC, [ids.affectedEntity]),
      activatedAt,
    });
    await journeys.updateProgress({
      journeyId: activeC,
      ownerRef: owners.c,
      completedLegCount: 1,
      currentLegSequence: null,
      recordedAt: new Date(Date.parse(activatedAt) + 1000).toISOString(),
    });
    assert.equal(
      (await journeys.get(activeC, owners.c)).lifecycleStatus,
      'COMPLETED',
    );
    assert.equal(
      (await journeys.get(activeA, owners.a)).progress.completedLegCount,
      0,
    );

    // Control A: hazard-only FLOOD event never reaches transit impact or alerts.
    hazardEventId = (
      await intelligence.createControlledEvent({
        incidentType: 'FLOOD',
        sourceId: ids.source,
        evidenceType: 'OBSERVED',
        operationalState: 'UNKNOWN',
        effectiveFrom: new Date(nowMs).toISOString(),
        effectiveTo: new Date(nowMs + 6 * 3_600_000).toISOString(),
        receivedAt: new Date(nowMs).toISOString(),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [106.8, -6.2],
              [106.801, -6.2],
              [106.801, -6.199],
              [106.8, -6.199],
              [106.8, -6.2],
            ],
          ],
        },
        reason: 'X1-B controlled flood exposure fixture (SIMULATED).',
        provenanceRef: 'fixture:SIMULATED:x1b:hazard',
        rawReference: 'fixture:SIMULATED:x1b:hazard',
      })
    ).eventId;
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNKNOWN',
    );
    assert.equal((await journeys.listAlerts(activeA, owners.a)).length, 0);

    // Control B: unverified incident never blocks.
    await lifecycle.ingest(
      exactly({
        incidentId: incidentIds.unverified,
        observedAt: new Date(nowMs - 60_000).toISOString(),
        receivedAt: new Date(nowMs).toISOString(),
        effectiveFrom: new Date(nowMs - 60_000).toISOString(),
        expiresAt: new Date(nowMs + 3_600_000).toISOString(),
      }),
      'UNVERIFIED',
    );
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNKNOWN',
    );
    assert.equal((await journeys.listAlerts(activeA, owners.a)).length, 0);

    // Control C: verified incident whose effective window is in the future never blocks.
    await lifecycle.ingest(
      exactly({
        incidentId: incidentIds.future,
        observedAt: new Date(nowMs - 60_000).toISOString(),
        receivedAt: new Date(nowMs).toISOString(),
        effectiveFrom: new Date(nowMs + 2 * 3_600_000).toISOString(),
        expiresAt: new Date(nowMs + 3 * 3_600_000).toISOString(),
      }),
      'VERIFIED',
    );
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNKNOWN',
    );
    assert.equal((await journeys.listAlerts(activeA, owners.a)).length, 0);

    // Control D: verified incident whose effective window has expired never blocks.
    await lifecycle.ingest(
      exactly({
        incidentId: incidentIds.expired,
        observedAt: new Date(nowMs - 2 * 3_600_000).toISOString(),
        receivedAt: new Date(nowMs).toISOString(),
        effectiveFrom: new Date(nowMs - 2 * 3_600_000).toISOString(),
        expiresAt: new Date(nowMs - 3_600_000).toISOString(),
      }),
      'VERIFIED',
    );
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNKNOWN',
    );
    assert.equal((await journeys.listAlerts(activeA, owners.a)).length, 0);
    assert.equal((await journeys.listAlerts(activeB, owners.b)).length, 0);

    // Positive: verified active restriction on the future dependency creates exactly one blocking alert.
    const activeEvidence = exactly({
      incidentId: incidentIds.active,
      observedAt: new Date(nowMs - 60_000).toISOString(),
      receivedAt: new Date(nowMs).toISOString(),
      effectiveFrom: new Date(nowMs - 60_000).toISOString(),
      expiresAt: new Date(nowMs + 3_600_000).toISOString(),
    });
    const ingested = await lifecycle.ingest(activeEvidence, 'VERIFIED');
    assert.equal(ingested.status, 'INSERTED');
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNAVAILABLE',
    );

    const alertsA = await journeys.listAlerts(activeA, owners.a);
    assert.equal(alertsA.length, 1);
    assert.equal(alertsA[0]?.alertType, 'BLOCKING');
    assert.equal(alertsA[0]?.evidenceType, 'SIMULATED');
    assert.equal(alertsA[0]?.operationalState, 'UNAVAILABLE');
    assert.deepEqual(alertsA[0]?.affectedLegSequences, [1]);
    assert.equal(alertsA[0]?.ownerRef, owners.a);
    // Unrelated and completed-only journeys receive zero targeted alerts.
    assert.equal((await journeys.listAlerts(activeB, owners.b)).length, 0);
    assert.equal((await journeys.listAlerts(activeC, owners.c)).length, 0);

    // Duplicate ingest of the exact same evidence yields zero extra impacts/alerts.
    const duplicate = await lifecycle.ingest(activeEvidence, 'VERIFIED');
    assert.equal(duplicate.status, 'ALREADY_PERSISTED');
    await impacts.whenIdle();
    assert.equal((await journeys.listAlerts(activeA, owners.a)).length, 1);
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNAVAILABLE',
    );

    // Resolve removes the current Twin restriction and closes its targeted alert.
    await lifecycle.transition({
      incidentId: incidentIds.active,
      toStatus: 'RESOLVED',
      changedAt: new Date().toISOString(),
      reason: 'X1-B controlled resolution fixture (SIMULATED).',
      provenanceRef: 'fixture:SIMULATED:x1b:resolve',
    });
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNKNOWN',
    );
    const alertsAfterResolve = await journeys.listAlerts(activeA, owners.a);
    assert.equal(alertsAfterResolve.length, 1);
    assert.notEqual(alertsAfterResolve[0]?.resolvedAt, null);

    // A fresh verified active restriction re-blocks the future dependency.
    const reactivatedAt = Date.now();
    await lifecycle.ingest(
      exactly({
        incidentId: incidentIds.reactivated,
        observedAt: new Date(reactivatedAt - 1).toISOString(),
        receivedAt: new Date(reactivatedAt).toISOString(),
        effectiveFrom: new Date(reactivatedAt - 1).toISOString(),
        expiresAt: new Date(reactivatedAt + 3_600_000).toISOString(),
      }),
      'VERIFIED',
    );
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNAVAILABLE',
    );
    assert.equal((await journeys.listAlerts(activeA, owners.a)).length, 2);

    // Retraction removes the current Twin restriction and closes its targeted alert.
    await lifecycle.transition({
      incidentId: incidentIds.reactivated,
      toStatus: 'RETRACTED',
      changedAt: new Date().toISOString(),
      reason: 'X1-B controlled retraction fixture (SIMULATED).',
      provenanceRef: 'fixture:SIMULATED:x1b:retract',
    });
    await impacts.whenIdle();
    assert.equal(
      (await states.getCurrentState(ids.affectedEntity)).operationalState,
      'UNKNOWN',
    );
    const alertsAfterRetraction = await journeys.listAlerts(activeA, owners.a);
    assert.equal(alertsAfterRetraction.length, 2);
    assert.ok(
      alertsAfterRetraction.every((alert) => alert.resolvedAt !== null),
    );

    // SSE publication is scoped to the single relevant journey, no unrelated/completed audience.
    const scoped = events
      .snapshot('journey.alert.created')
      .filter((event) =>
        allActiveIds.includes(event.audienceJourneyId as never),
      );
    assert.equal(scoped.length, 2);
    assert.ok(scoped.every((event) => event.audienceJourneyId === activeA));
    assert.ok(scoped.every((event) => event.audienceOwnerRef === owners.a));
  });
});

function exactly(
  overrides: Pick<
    IncidentEvidenceInput,
    'incidentId' | 'observedAt' | 'receivedAt' | 'effectiveFrom' | 'expiresAt'
  >,
): IncidentEvidenceInput {
  return {
    incidentType: 'SERVICE_SUSPENSION',
    affectedEntityIds: [ids.affectedEntity],
    affectedModes: ['MRT_JAKARTA'],
    operationalState: 'UNAVAILABLE',
    sourceClass: 'SIMULATED',
    sourceId: ids.operationalSource,
    sourceAuthority: 'SIMULATION',
    sourceChannel: 'CONTROLLED_SIMULATION',
    evidenceType: 'SIMULATED',
    sourceClassification: 'NOT_AVAILABLE',
    reason: 'Controlled X1-B lifecycle targeting fixture (SIMULATED).',
    provenanceRef: 'fixture:SIMULATED:x1b',
    rawReference: 'fixture:SIMULATED:x1b',
    supportingHazardEventId: null,
    ...overrides,
  };
}

function plan(
  journeyId: string,
  entities: readonly string[],
): JourneyAlternative {
  const legs = entities.map((entityId, sequence) => leg(entityId, sequence));
  return {
    journeyId,
    origin: { latitude: -6.2, longitude: 106.8 },
    destination: { latitude: -6.3, longitude: 106.9 },
    startAt: legs[0]!.startAt,
    endAt: legs.at(-1)!.endAt,
    durationSeconds: entities.length * 600,
    transferCount: Math.max(0, entities.length - 1),
    walkingDistanceMeters: 0,
    fareStatus: 'UNKNOWN',
    legs,
    routingContext: {
      provider: 'OTP',
      providerVersion: '2.10.0',
      routingSnapshotId: 'x1b-router-input-20261008',
      routingManifestSha256: 'c'.repeat(64),
      graphSha256: 'd'.repeat(64),
      networkSnapshotId: ids.snapshot,
      networkSnapshotHash: 'b'.repeat(64),
      mobilityProjectionVersion: 'PHASE_2B_V1',
      plannedAt: '2026-10-08T07:00:00.000Z',
      commonServiceDate: '2026-10-08',
      timezone: 'Asia/Jakarta',
      attemptCount: 1,
      excludedRouteIds: [],
    },
  };
}

function leg(entityId: string, sequence: number): JourneyLeg {
  const start = new Date(
    Date.parse('2026-10-08T07:00:00.000Z') + sequence * 600_000,
  );
  const end = new Date(start.getTime() + 600_000);
  return {
    sequence,
    mode: 'MRT_JAKARTA',
    otpMode: 'SUBWAY',
    from: {
      name: `A${sequence}`,
      otpStopId: null,
      latitude: -6.2 - sequence * 0.01,
      longitude: 106.8 + sequence * 0.01,
    },
    to: {
      name: `B${sequence}`,
      otpStopId: null,
      latitude: -6.21 - sequence * 0.01,
      longitude: 106.81 + sequence * 0.01,
    },
    intermediateStops: [],
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationSeconds: 600,
    distanceMeters: 1000,
    routeId: `route-${sequence}`,
    routeShortName: 'MRT',
    tripId: `trip-${sequence}`,
    serviceDate: '2026-10-08',
    timingPrecision: 'FREQUENCY_DERIVED',
    entityBindings: [
      {
        otpEntityId: `route-${sequence}`,
        productMode: 'MRT_JAKARTA',
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

async function clearFixture(): Promise<void> {
  const journeyIds = sql.join(
    allActiveIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const incidentList = sql.join(
    Object.values(incidentIds).map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  await sql`delete from journey.targeted_alert where journey_id in (${journeyIds})`.execute(
    database,
  );
  await sql`delete from journey.journey_impact_dependency where impact_id in (select id from journey.journey_impact where journey_id in (${journeyIds}))`.execute(
    database,
  );
  await sql`delete from journey.journey_impact where journey_id in (${journeyIds})`.execute(
    database,
  );
  await sql`delete from journey.journey_state_event where journey_id in (${journeyIds})`.execute(
    database,
  );
  await sql`delete from journey.journey_progress where journey_id in (${journeyIds})`.execute(
    database,
  );
  await sql`delete from journey.active_journey where journey_id in (${journeyIds})`.execute(
    database,
  );
  for (const table of ['journey_dependency', 'journey_leg', 'journey_plan'])
    await sql
      .raw(`alter table journey.${table} disable trigger ${table}_immutable`)
      .execute(database);
  await sql`delete from journey.journey_dependency where journey_id in (${journeyIds})`.execute(
    database,
  );
  await sql`delete from journey.journey_leg where journey_id in (${journeyIds})`.execute(
    database,
  );
  await sql`delete from journey.journey_plan where id in (${journeyIds})`.execute(
    database,
  );
  for (const table of ['journey_dependency', 'journey_leg', 'journey_plan'])
    await sql
      .raw(`alter table journey.${table} enable trigger ${table}_immutable`)
      .execute(database);

  await sql`alter table disruption.operational_incident_journal disable trigger operational_incident_journal_append_only`.execute(
    database,
  );
  await sql`delete from disruption.operational_incident_journal where incident_id in (${incidentList}) or hazard_event_id=${hazardEventId}::uuid`.execute(
    database,
  );
  await sql`alter table disruption.operational_incident_journal enable trigger operational_incident_journal_append_only`.execute(
    database,
  );
  await sql`delete from disruption.operational_incident_entity where incident_id in (${incidentList})`.execute(
    database,
  );
  await sql`delete from disruption.operational_incident where id in (${incidentList})`.execute(
    database,
  );
  if (hazardEventId !== null) {
    await sql`delete from disruption.entity_impact where impact_analysis_id in (select id from disruption.impact_analysis where disruption_event_id=${hazardEventId}::uuid)`.execute(
      database,
    );
    await sql`delete from disruption.impact_analysis where disruption_event_id=${hazardEventId}::uuid`.execute(
      database,
    );
    await sql`delete from disruption.event where id=${hazardEventId}::uuid`.execute(
      database,
    );
    hazardEventId = null;
  }

  await sql`delete from twin.mobility_state_history where mobility_entity_id in (${ids.affectedEntity}::uuid, ${ids.unrelatedEntity}::uuid)`.execute(
    database,
  );
  await sql`delete from twin.mobility_state where mobility_entity_id in (${ids.affectedEntity}::uuid, ${ids.unrelatedEntity}::uuid)`.execute(
    database,
  );
  await sql`alter table twin.operational_observation disable trigger operational_observation_append_only`.execute(
    database,
  );
  await sql`delete from twin.operational_observation where mobility_entity_id in (${ids.affectedEntity}::uuid, ${ids.unrelatedEntity}::uuid)`.execute(
    database,
  );
  await sql`alter table twin.operational_observation enable trigger operational_observation_append_only`.execute(
    database,
  );
  await sql`alter table twin.network_snapshot disable trigger network_snapshot_immutable_update`.execute(
    database,
  );
  await sql`delete from twin.network_snapshot where id=${ids.snapshot}::uuid`.execute(
    database,
  );
  await sql`alter table twin.network_snapshot enable trigger network_snapshot_immutable_update`.execute(
    database,
  );
  await sql`delete from twin.mobility_entity where id in (${ids.affectedEntity}::uuid, ${ids.unrelatedEntity}::uuid)`.execute(
    database,
  );
  await sql`delete from meta.dataset_version where id=${ids.version}::uuid`.execute(
    database,
  );
  await sql`delete from meta.dataset_source where id=${ids.source}::uuid`.execute(
    database,
  );
}
