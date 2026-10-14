import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { FoundationDatabase } from '../infrastructure/database/database.constants.js';
import { migrateToLatest } from '../infrastructure/database/database.migrator.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTAINER = 'transum-in-nexus-postgres-1';
const SOURCE = 'transum_in_nexus_product';
const SNAPSHOT = '43fb9a29-0c89-5c72-8826-e3dc2adcfb1f';
const ROUTING_VERSION = 'bf7e3650-6af7-5bee-b25a-26f763f7fe4c';
const SPATIAL_VERSION = 'e6aa5be0-0cf4-5e33-8581-696af9a2045f';
const RAIL_VERSION = '19dde3d7-a359-5457-bea5-a6db1704543d';

type Identity = { name: string; oid: number; owner: string; marker: string };
const id = randomUUID();
const database = `tnx_cp2_${id.replaceAll('-', '')}`;
const marker = `tnx_cp2:${id}`;

function q(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
function redact(value: string) {
  return value.replace(
    /(postgres(?:ql)?:\/\/[^\s:/@]+:)[^\s@]+@/gi,
    '$1[REDACTED]@',
  );
}
function urlFor(base: URL, name: string) {
  const value = new URL(base);
  value.pathname = `/${name}`;
  return value.toString();
}
async function identity(pool: Pool): Promise<Identity | null> {
  return (
    (
      await pool.query<Identity>(
        `select datname as name, oid::int, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid,'pg_database'),'') as marker from pg_database where datname=$1`,
        [database],
      )
    ).rows[0] ?? null
  );
}
async function copyTable(
  source: Pool,
  target: Pool,
  table: string,
  where: string,
  params: unknown[] = [],
) {
  const [schema, name] = table.split('.');
  const columns = (
    await source.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema=$1 and table_name=$2 and is_generated='NEVER' order by ordinal_position`,
      [schema, name],
    )
  ).rows.map((r: { column_name: string }) => r.column_name);
  const rows = (
    await source.query(
      `select ${columns.map(q).join(',')} from ${table} where ${where}`,
      params,
    )
  ).rows as Record<string, unknown>[];
  for (const row of rows) {
    const values = columns.map((column: string) => row[column]);
    await target.query(
      `insert into ${table} (${columns.map(q).join(',')}) values (${values.map((_: unknown, i: number) => `$${i + 1}`).join(',')}) on conflict do nothing`,
      values,
    );
  }
  return rows.length;
}
async function wait(url: string, child: ChildProcess) {
  for (let i = 0; i < 120; i += 1) {
    assert.equal(
      child.exitCode,
      null,
      `Owned service exited: ${new URL(url).host}`,
    );
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Owned service readiness timeout: ${new URL(url).host}`);
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once('close', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10000)),
  ]);
}

async function main() {
  try {
    loadEnvFile(`${ROOT}.env`);
  } catch {
    /* env may be injected */
  }
  const env = process.env;
  assert.equal(env.POSTGRES_HOST, '127.0.0.1');
  assert.equal(env.POSTGRES_PORT, '5435');
  assert.equal(env.POSTGRES_DB, SOURCE);
  assert.ok(env.POSTGRES_USER && env.POSTGRES_PASSWORD);
  const base = new URL(
    `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:5435/${SOURCE}`,
  );
  const admin = new Pool({
    connectionString: urlFor(base, 'postgres'),
    max: 1,
  });
  const source = new Pool({ connectionString: base.toString(), max: 2 });
  let target: Pool | undefined;
  let scratch: Identity | null = null;
  let api: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  let passed = false;
  try {
    const dockerFree =
      Number(
        execFileSync(
          'docker',
          [
            'exec',
            CONTAINER,
            'df',
            '-k',
            '--output=avail',
            '/var/lib/postgresql/data',
          ],
          {
            encoding: 'utf8',
          },
        )
          .trim()
          .split('\n')
          .at(-1),
      ) * 1024;
    const hostFree =
      Number(
        execFileSync('df', ['-k', ROOT], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .at(-1)
          ?.trim()
          .split(/\s+/)
          .at(-3),
      ) * 1024;
    assert.ok(
      Number.isSafeInteger(dockerFree) && dockerFree > 1024 ** 3,
      'Insufficient Docker headroom; scratch creation refused',
    );
    assert.ok(
      Number.isSafeInteger(hostFree) && hostFree > 1024 ** 3,
      'Insufficient host headroom; scratch creation refused',
    );
    const inspect = JSON.parse(
      execFileSync('docker', ['inspect', CONTAINER], { encoding: 'utf8' }),
    )[0];
    assert.equal(inspect.Config.Image, 'transum-in-nexus/postgis:17.11-3.6');
    assert.equal(
      inspect.Mounts.find(
        (m: { Destination: string }) =>
          m.Destination === '/var/lib/postgresql/data',
      )?.Name,
      env.POSTGRES_VOLUME_NAME,
    );
    const server = (
      await admin.query(
        'select system_identifier::text from pg_control_system()',
      )
    ).rows[0].system_identifier;
    const dockerServer = execFileSync(
      'docker',
      [
        'exec',
        '-u',
        'postgres',
        CONTAINER,
        'psql',
        '-U',
        env.POSTGRES_USER,
        '-d',
        'postgres',
        '-Atqc',
        'select system_identifier::text from pg_control_system()',
      ],
      { encoding: 'utf8' },
    ).trim();
    assert.equal(
      server,
      dockerServer,
      'Endpoint is not authorized product Docker server',
    );
    assert.equal(
      (
        await admin.query('select 1 from pg_database where datname=$1', [
          database,
        ])
      ).rowCount,
      0,
    );
    await admin.query(`create database ${q(database)}`);
    scratch = await identity(admin);
    assert.ok(scratch);
    await admin.query(`comment on database ${q(database)} is '${marker}'`);
    scratch = await identity(admin);
    assert.deepEqual(scratch, { ...scratch, marker });
    const migrationPool = new Pool({
      connectionString: urlFor(base, database),
      max: 1,
    });
    const db = new Kysely<FoundationDatabase>({
      dialect: new PostgresDialect({ pool: migrationPool }),
    });
    await migrateToLatest(db);
    await db.destroy();
    target = new Pool({ connectionString: urlFor(base, database), max: 4 });
    const versions = [ROUTING_VERSION, SPATIAL_VERSION, RAIL_VERSION];
    await source.query('begin transaction read only');
    try {
      const versionRows = await source.query(
        `select * from meta.dataset_version where id = any($1::uuid[])`,
        [versions],
      );
      const sourceIds = [
        ...new Set(versionRows.rows.map((row) => row.source_id)),
      ];
      await copyTable(
        source,
        target,
        'meta.dataset_source',
        `id = any($1::uuid[])`,
        [sourceIds],
      );
      await copyTable(
        source,
        target,
        'meta.dataset_version',
        `id = any($1::uuid[])`,
        [versions],
      );
      const entityIds = (
        await source.query(
          `select distinct canonical_entity_id from meta.source_entity_reference where source_dataset_version_id = any($1::uuid[])`,
          [versions],
        )
      ).rows.map((r) => r.canonical_entity_id);
      await copyTable(
        source,
        target,
        'twin.mobility_entity',
        'id = any($1::uuid[])',
        [entityIds],
      );
      await copyTable(
        source,
        target,
        'meta.source_entity_reference',
        'source_dataset_version_id = any($1::uuid[])',
        [versions],
      );
      await copyTable(source, target, 'twin.network_snapshot', 'id=$1::uuid', [
        SNAPSHOT,
      ]);
      await source.query('commit');
    } catch (error) {
      await source.query('rollback');
      throw error;
    }
    assert.equal(
      (
        await target.query(
          'select count(*) from twin.network_snapshot where id=$1',
          [SNAPSHOT],
        )
      ).rows[0].count,
      '1',
    );
    assert.ok(
      Number(
        (
          await target.query(
            'select count(*) from meta.source_entity_reference',
          )
        ).rows[0].count,
      ) > 0,
    );
    const childEnv = {
      ...env,
      DATABASE_URL: urlFor(base, database),
      POSTGRES_DB: database,
      PRODUCT_P1R_ACCEPTANCE: '1',
      PRODUCT_P1R_PORT: '3303',
      API_PORT: '3303',
      PASSENGER_API_BASE_URL: 'http://127.0.0.1:3303/api/v1',
      PASSENGER_API_URL: 'http://127.0.0.1:3303/api/v1',
      PASSENGER_NETWORK_SNAPSHOT_ID: SNAPSHOT,
      PASSENGER_WEB_URL: 'http://127.0.0.1:3302',
      M7_API_URL: 'http://127.0.0.1:3303/api/v1',
      M7_WEB_URL: 'http://127.0.0.1:3302',
      NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3303/api/v1',
      WEB_PORT: '3302',
      PRODUCT_ACCEPTANCE_DIST_DIR: '.next-cp2-acceptance-dev',
      CP2_EXPECTED_INVOCATION: id,
      CP2_EXPECTED_DB: database,
      CP2_EXPECTED_MARKER: marker,
      CP2_EXPECTED_OID: String(scratch.oid),
      CP2_EXPECTED_OWNER: scratch.owner,
    };
    api = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/journey/product-p1r-browser.cli.ts'],
      {
        cwd: `${ROOT}/apps/api`,
        env: childEnv,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const ownedApi = api;
    const readyLine = await new Promise<string>((resolve, reject) => {
      const chunks: Array<string> = [];
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `Owned API identity timeout: ${chunks.join('').slice(-200)}`,
            ),
          ),
        60000,
      );
      ownedApi.stdout!.setEncoding('utf8');
      ownedApi.stdout!.on('data', (chunk: string) => {
        chunks.push(chunk);
        const line = chunks
          .join('')
          .split('\n')
          .find((candidate) => candidate.includes('P1R_ACCEPTANCE_READY'));
        if (line) {
          clearTimeout(timeout);
          resolve(line);
        }
      });
      ownedApi.stderr!.setEncoding('utf8');
      ownedApi.stderr!.on('data', (chunk: string) => chunks.push(chunk));
      ownedApi.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      ownedApi.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Owned API exited before readiness: ${code}`));
      });
    });
    console.log(redact(readyLine.trim()));
    await wait('http://127.0.0.1:3303/health/ready', api);
    // Local HTTP isolated runtime: next dev binds plain HTTP so the proxy's
    // production-mode Secure cookie/https origin guard does not two-face an
    // http web port. Guard severity is unchanged elsewhere.
    web = spawn(
      'pnpm',
      [
        '--filter',
        '@transum-in/web',
        'exec',
        'next',
        'dev',
        '--webpack',
        '--port',
        '3302',
      ],
      {
        cwd: ROOT,
        env: { ...childEnv, NODE_ENV: 'development' },
        detached: true,
        stdio: 'ignore',
      },
    );
    await wait('http://127.0.0.1:3302', web);
    const browserEnv = { ...childEnv, CP2_API_PID: String(api.pid) };
    const cp2 = spawn(
      process.execPath,
      ['apps/web/scripts/passenger-cp2-walk-navigation-acceptance.mjs'],
      {
        cwd: ROOT,
        env: browserEnv,
        stdio: 'inherit',
      },
    );
    cp2.stdout?.pipe(process.stdout);
    cp2.stderr?.pipe(process.stderr);
    const cp2Code = await new Promise<number | null>((resolve, reject) => {
      cp2.once('error', reject);
      cp2.once('close', resolve);
    });
    assert.equal(cp2Code, 0, 'CP2 browser proof failed');
    const r4 = spawn(
      process.execPath,
      ['apps/web/scripts/passenger-r4-f04-acceptance.mjs'],
      {
        cwd: ROOT,
        env: browserEnv,
        stdio: 'inherit',
      },
    );
    const r4Code = await new Promise<number | null>((resolve, reject) => {
      r4.once('error', reject);
      r4.once('close', resolve);
    });
    assert.equal(r4Code, 0, 'R4 browser proof failed');
    passed = true;
    console.log(
      JSON.stringify({
        status: 'PASS',
        tier: 'CP2_ISOLATED_SUBSET',
        database,
        marker,
        oid: scratch.oid,
        owner: scratch.owner,
        source_read_only: true,
        api_port: 3303,
        web_port: 3302,
      }),
    );
  } catch (error) {
    console.error(
      redact(
        `NOT VERIFIED: ${error instanceof Error ? error.message : String(error)}; scratch retained: ${database}`,
      ),
    );
    process.exitCode = 1;
  } finally {
    await stop(web);
    await stop(api);
    await target?.end().catch(() => undefined);
    await source.end();
    const cleanup = new Pool({
      connectionString: urlFor(base, 'postgres'),
      max: 1,
    });
    let dropReported = false;
    const canDrop = async (): Promise<boolean> => {
      if (!scratch || !passed) return false;
      const actual = await cleanup
        .query<Identity>(
          `select datname as name, oid::int, pg_get_userbyid(datdba) as owner, coalesce(shobj_description(oid,'pg_database'),'') as marker from pg_database where datname=$1`,
          [database],
        )
        .then((r) => r.rows[0] ?? null)
        .catch(() => null);
      if (
        !actual ||
        JSON.stringify(actual) !== JSON.stringify(scratch) ||
        actual.marker !== marker
      )
        return false;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const sessions = Number(
          await cleanup
            .query('select count(*) from pg_stat_activity where datname=$1', [
              database,
            ])
            .catch(() => ({ rows: [{ count: 1 }] }))
            .then(
              (r) =>
                (r as { rows: Array<{ count: unknown }> }).rows[0]?.count ?? 1,
            ),
        );
        if (Number.isFinite(sessions) && sessions === 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    };
    if (await canDrop()) {
      await cleanup.query(`drop database ${q(database)}`);
      const confirmed = await cleanup
        .query('select 1 from pg_database where datname=$1', [database])
        .then((r) => r.rowCount);
      assert.equal(confirmed, 0, 'DROP reported success but database persists');
      dropReported = true;
      console.log(JSON.stringify({ cleanup: 'DROP_SUCCESS', database }));
    } else {
      console.error(
        redact(`CP2 cleanup refused; scratch retained: ${database}`),
      );
    }
    await cleanup.end();
    await admin.end();
    assert.ok(
      passed ? dropReported : true,
      'Successful run kept no scratch drop evidence',
    );
  }
}
await main();
