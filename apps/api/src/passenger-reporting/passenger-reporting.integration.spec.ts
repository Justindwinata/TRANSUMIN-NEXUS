import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { sql } from 'kysely';

import { createDatabase } from '../infrastructure/database/database.client.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';
import { PassengerReportService } from './passenger-report.service.js';

const database = createDatabase();
const suffix = randomUUID();
const sourceId = randomUUID();
const versionId = randomUUID();
const snapshotId = randomUUID();
const entityId = randomUUID();
const journeyId = randomUUID();
const ownerRef = `m5-owner:${suffix}`;
const sourceKey = `m5-fixture-${suffix}`;
let service: PassengerReportService;

describe('M5 passenger report service persistence boundary', () => {
  before(async () => {
    const identity = await sql<{ name: string }>`select current_database() as name`.execute(database);
    assert.match(identity.rows[0]?.name ?? '', /^tnx_lightweight_[0-9a-f]{32}$/, 'M5 mutation tests require Tier A scratch database.');
    await migrateToLatest(database);
    await sql`insert into meta.dataset_source (id, source_key, name, provider, source_type, verification_status) values (${sourceId}::uuid, ${sourceKey}, 'M5 SAMPLE fixture', 'TEST', 'CONTROLLED_REPLAY', 'VERIFIED')`.execute(database);
    await sql`insert into meta.dataset_version (id, source_id, version_label, checksum_sha256, retrieved_at, raw_path_ref, manifest_path, validation_status) values (${versionId}::uuid, ${sourceId}::uuid, ${sourceKey}, ${'b'.repeat(64)}, now(), 'fixture:m5', 'fixture:m5', 'VALID')`.execute(database);
    await sql`insert into twin.mobility_entity (id, entity_type, creation_dataset_version_id) values (${entityId}::uuid, 'STOP', ${versionId}::uuid)`.execute(database);
    await sql`insert into twin.network_snapshot (id, transit_dataset_version_id, spatial_dataset_version_id, processing_version, state_cutoff_at, configuration_json, manifest_ref, content_hash, status, finalized_at) values (${snapshotId}::uuid, ${versionId}::uuid, ${versionId}::uuid, 'M5', now(), '{}'::jsonb, 'fixture:M5', ${'a'.repeat(64)}, 'FINALIZED', now())`.execute(database);
    await sql`insert into journey.journey_plan (id, owner_ref, plan_fingerprint, original_plan_json, origin_lat, origin_lon, destination_lat, destination_lon, planned_start_at, planned_end_at, routing_snapshot_id, routing_manifest_sha256, graph_sha256, network_snapshot_id, network_snapshot_hash, mobility_projection_version, service_date, timezone, planned_at) values (${journeyId}::uuid, ${ownerRef}, ${createHash('sha256').update(journeyId).digest('hex')}, '{}'::jsonb, 0, 0, 0, 0, now(), now() + interval '1 hour', 'fixture:M5', ${'a'.repeat(64)}, ${'b'.repeat(64)}, ${snapshotId}::uuid, ${'c'.repeat(64)}, 'M5', '2026-10-03'::date, 'Asia/Jakarta', now())`.execute(database);
    await sql`insert into journey.journey_leg (id, journey_id, sequence, mode, start_at, end_at, timing_precision, leg_fingerprint, original_leg_json) values (${randomUUID()}::uuid, ${journeyId}::uuid, 0, 'TRANSJAKARTA', now(), now() + interval '1 hour', 'ESTIMATED', ${'d'.repeat(64)}, '{}'::jsonb)`.execute(database);
    await sql`insert into journey.journey_dependency (id, journey_id, leg_sequence, mobility_entity_id, canonical_entity_id, entity_type, product_mode, provenance_ref) values (${randomUUID()}::uuid, ${journeyId}::uuid, 0, ${entityId}::uuid, ${entityId}::uuid, 'STOP', 'TRANSJAKARTA', 'SAMPLE:m5')`.execute(database);
    service = new PassengerReportService(database, { ingest: async () => { throw new Error('not used'); } } as never, { whenIdle: async () => undefined } as never);
  });

  after(async () => database.destroy());

  it('persists idempotently and lists only matching owner plus journey', async () => {
    const input = { ownerRef, journeyId, category: 'SAFETY', observedAt: new Date(Date.now() - 1_000).toISOString(), entityId, entityType: 'STOP', description: 'SAMPLE passenger observation.', key: `m5-key-${suffix}` };
    const [first, replay] = await Promise.all([service.submit(input), service.submit(input)]);
    assert.equal(first.report_id, replay.report_id);
    const own = await service.list(ownerRef, journeyId);
    const other = await service.list(`other:${suffix}`, journeyId);
    assert.equal(own.length, 1);
    assert.equal(other.length, 0);
    assert.equal(own[0]?.verification_status, 'REPORTED_UNVERIFIED');
  });

  it('keeps rate limit persistent and owner scoped', async () => {
    for (let index = 1; index < 10; index += 1)
      await service.submit({ ownerRef, journeyId, category: 'SERVICE', observedAt: new Date(Date.now() - 1_000).toISOString(), entityId, entityType: 'STOP', description: `SAMPLE report ${index}.`, key: `m5-rate-${index}-${suffix}` });
    await assert.rejects(service.submit({ ownerRef, journeyId, category: 'SERVICE', observedAt: new Date(Date.now() - 1_000).toISOString(), entityId, entityType: 'STOP', description: 'SAMPLE over limit.', key: `m5-rate-over-${suffix}` }), /Passenger report limit reached/);
  });
});
