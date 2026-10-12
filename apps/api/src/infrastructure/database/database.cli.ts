import { createDatabase } from './database.client.js';
import { getMigrationStatus, migrateToLatest } from './database.migrator.js';

type Command = 'migrate' | 'status';

function parseCommand(value: string | undefined): Command {
  if (value === 'migrate' || value === 'status') {
    return value;
  }

  throw new Error('Expected database command: migrate or status');
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const database = createDatabase();

  try {
    if (command === 'migrate') {
      const results = await migrateToLatest(database);
      const applied = results.filter(
        (result) => result.status === 'Success',
      ).length;
      process.stdout.write(
        `Database migrations complete (${applied} applied).\n`,
      );
      return;
    }

    const migrations = await getMigrationStatus(database);
    for (const migration of migrations) {
      const status = migration.executedAt === undefined ? 'pending' : 'applied';
      process.stdout.write(`${migration.name}: ${status}\n`);
    }
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown database error';
  process.stderr.write(`Database command failed: ${message}\n`);
  process.exitCode = 1;
});
