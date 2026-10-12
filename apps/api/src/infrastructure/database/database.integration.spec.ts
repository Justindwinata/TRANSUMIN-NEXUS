import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

import { AppModule } from '../../app.module.js';
import { configureApplication } from '../../application.js';
import { ReadinessController } from '../../health/readiness.controller.js';
import { ReadinessService } from '../../health/readiness.service.js';
import { createDatabase } from './database.client.js';
import {
  FOUNDATION_SCHEMAS,
  type FoundationDatabase,
} from './database.constants.js';
import { getMigrationStatus, migrateToLatest } from './database.migrator.js';

const unavailableDatabase = new Kysely<FoundationDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({
      host: '127.0.0.1',
      port: 1,
      database: 'unavailable',
      user: 'unavailable',
      password: 'unavailable',
      connectionTimeoutMillis: 250,
    }),
  }),
});

@Module({
  controllers: [ReadinessController],
  providers: [
    {
      provide: ReadinessService,
      useFactory: () => new ReadinessService(unavailableDatabase),
    },
  ],
})
class UnavailableReadinessTestModule {}

async function listenLocally(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address !== null);
  return `http://127.0.0.1:${address.port}`;
}

describe('PostgreSQL/PostGIS foundation', () => {
  const database = createDatabase();

  before(async () => {
    await migrateToLatest(database);
  });

  after(async () => {
    await database.destroy();
    await unavailableDatabase.destroy();
  });

  it('connects to PostgreSQL and executes a real PostGIS geometry operation', async () => {
    const result = await sql<{
      postgresVersion: string;
      postgisVersion: string;
      geometryText: string;
      srid: number;
    }>`
      select
        current_setting('server_version') as "postgresVersion",
        PostGIS_Lib_Version() as "postgisVersion",
        ST_AsText(ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326)) as "geometryText",
        ST_SRID(ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326)) as srid
    `.execute(database);
    const row = result.rows[0];

    assert.ok(row !== undefined);
    assert.match(row.postgresVersion, /^17\./);
    assert.match(row.postgisVersion, /^3\.6/);
    assert.equal(row.geometryText, 'POINT(106.8456 -6.2088)');
    assert.equal(row.srid, 4326);
  });

  it('applies the initial migration once and exposes every canonical logical schema', async () => {
    const secondRun = await migrateToLatest(database);
    const status = await getMigrationStatus(database);
    const schemas = await sql<{ schemaName: string }>`
      select schema_name as "schemaName"
      from information_schema.schemata
      where schema_name in (
        'meta', 'transit', 'spatial', 'twin', 'disruption',
        'simulation', 'journey', 'research', 'auth', 'ai'
      )
      order by schema_name
    `.execute(database);

    assert.equal(secondRun.length, 0);
    assert.equal(status.length, 12);
    assert.deepEqual(
      status.map((migration) => migration.name),
      [
        '202609280001_foundation',
        '202609280002_data_provenance_and_transit',
        '202609290001_gtfs_source_fidelity',
        '202609290002_phase1_transit_hardening',
        '202609300001_spatial_pedestrian_foundation',
        '202610010001_hybrid_mobility_twin',
        '202610010002_live_operational_gateway',
        '202610010003_disruption_and_simulation_intelligence',
        '202610030001_active_journey_targeted_alerts',
        '202610050001_state_aware_journey_recovery',
        '202610060001_active_journey_instance_identity',
        '202610080001_ext_x1_incident_lifecycle',
      ],
    );
    assert.ok(
      status.every((migration) => migration.executedAt instanceof Date),
    );
    assert.deepEqual(
      schemas.rows.map((row) => row.schemaName).sort(),
      [...FOUNDATION_SCHEMAS].sort(),
    );
  });

  it('serves independent liveness and database-backed readiness endpoints', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    const baseUrl = await listenLocally(app);

    try {
      const [liveness, readiness, prefixedReadiness] = await Promise.all([
        fetch(`${baseUrl}/health/live`),
        fetch(`${baseUrl}/health/ready`),
        fetch(`${baseUrl}/api/v1/health/ready`),
      ]);
      const readinessBody = (await readiness.json()) as {
        status: string;
        dependencies: { database: { status: string; postgis: string } };
      };

      assert.equal(liveness.status, 200);
      assert.equal(readiness.status, 200);
      assert.equal(readinessBody.status, 'ready');
      assert.equal(readinessBody.dependencies.database.status, 'up');
      assert.equal(readinessBody.dependencies.database.postgis, 'available');
      assert.equal(prefixedReadiness.status, 404);
    } finally {
      await app.close();
    }
  });

  it('returns 503 without leaking connection details when PostgreSQL is unavailable', async () => {
    const app = await NestFactory.create(UnavailableReadinessTestModule, {
      logger: false,
    });
    const baseUrl = await listenLocally(app);

    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      const body = (await response.json()) as {
        status: string;
        dependencies: { database: { status: string } };
      };

      assert.equal(response.status, 503);
      assert.equal(body.status, 'not_ready');
      assert.equal(body.dependencies.database.status, 'down');
      assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
    } finally {
      await app.close();
    }
  });
});
