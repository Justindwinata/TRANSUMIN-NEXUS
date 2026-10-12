import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
try {
  loadEnvFile(`${root}.env`);
} catch {
  // CI may inject environment variables directly.
}

const source = process.env.POSTGRES_DB ?? 'transum_in_nexus_product';
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const host = process.env.POSTGRES_HOST ?? '127.0.0.1';
const port = Number(process.env.POSTGRES_PORT ?? 5435);
const id = randomUUID();
const database = `tnx_lightweight_${id.replaceAll('-', '')}`;
const marker = `tnx_lightweight:${id}`;
const container = 'transum-in-nexus-postgres-1';
const reserveBytes = 1024 ** 3;

assert(user && password, 'POSTGRES_USER and POSTGRES_PASSWORD are required');
assert(
  host === '127.0.0.1' && port === 5435,
  'Lightweight acceptance requires product Postgres endpoint',
);
assert(
  source === 'transum_in_nexus_product',
  'Lightweight acceptance source must be product DB',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function availableBytes(): number {
  const output = execFileSync(
    'docker',
    [
      'exec',
      container,
      'df',
      '-k',
      '--output=avail',
      '/var/lib/postgresql/data',
    ],
    { encoding: 'utf8' },
  );
  return Number(output.trim().split('\n').at(-1)) * 1024;
}

function run(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

const admin = new Pool({
  host,
  port,
  database: 'postgres',
  user,
  password,
  max: 1,
});
let created = false;
let passed = false;
let databaseOid: number | null = null;
try {
  const before = availableBytes();
  assert(
    before > reserveBytes,
    `Lightweight acceptance rejected: Docker free space ${before}B below 1 GiB reserve`,
  );
  const sourceIdentity = await admin.query<{
    current_user: string;
    address: string;
    port: number;
  }>(
    'select current_user, inet_server_addr()::text as address, inet_server_port() as port',
  );
  assert.equal(sourceIdentity.rows[0]?.current_user, user);
  assert.equal(sourceIdentity.rows[0]?.port, 5432);
  assert.equal(
    execFileSync(
      'docker',
      ['inspect', container, '--format', '{{range .Mounts}}{{.Name}}{{end}}'],
      { encoding: 'utf8' },
    ).trim(),
    'transum-in-nexus-product-postgres-data',
  );
  assert.equal(
    (await admin.query('select 1 from pg_database where datname = $1', [database]))
      .rowCount,
    0,
  );
  await admin.query(`create database ${quoteIdentifier(database)}`);
  created = true;
  await admin.query(
    `comment on database ${quoteIdentifier(database)} is '${marker}'`,
  );
  databaseOid = await admin
    .query<{ oid: number }>('select oid from pg_database where datname = $1', [
      database,
    ])
    .then((result) => result.rows[0]?.oid ?? null);
  assert.ok(databaseOid !== null);

  const afterCreate = availableBytes();
  assert(
    afterCreate > reserveBytes,
    'Lightweight acceptance consumed 1 GiB Docker reserve',
  );
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  await run(
    'pnpm',
    [
      '--filter',
      '@transum-in/api',
      'exec',
      'node',
      '--import',
      'tsx',
      '--test',
      'src/journey/journey.integration.spec.ts',
    ],
    { ...process.env, DATABASE_URL: url },
  );
  passed = true;
  console.log(
    JSON.stringify({
      status: 'PASS',
      tier: 'LIGHTWEIGHT_ISOLATED',
      evidence:
        'real domain services and PostgreSQL migrations with controlled synthetic fixture records',
      database,
      source,
      peak_bytes_upper_bound: before - availableBytes(),
      routing: 'NOT_TESTED_BY_THIS_TIER',
      full_snapshot: 'BLOCKED_BY_ENVIRONMENT',
    }),
  );
} finally {
  await admin.end();
  if (created && passed) {
    const cleanup = new Pool({
      host,
      port,
      database: 'postgres',
      user,
      password,
      max: 1,
    });
    try {
      const identity = await cleanup.query<{
        oid: number;
        datname: string;
        owner: string;
        marker: string | null;
      }>(
        `select oid, datname, pg_get_userbyid(datdba) as owner,
          shobj_description(oid, 'pg_database') as marker
        from pg_database where datname = $1`,
        [database],
      );
      assert.deepEqual(identity.rows[0], {
        oid: databaseOid,
        datname: database,
        owner: user,
        marker,
      });
      assert.equal(
        Number(
          (
            await cleanup.query(
              'select count(*) from pg_stat_activity where datname = $1',
              [database],
            )
          ).rows[0]?.count,
        ),
        0,
      );
      await cleanup.query(`drop database ${quoteIdentifier(database)}`);
    } finally {
      await cleanup.end();
    }
  } else if (created) {
    console.error(
      `Preserving failed invocation database ${database}; marker ${marker}`,
    );
  }
}
