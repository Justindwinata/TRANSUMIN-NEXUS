import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { FoundationDatabase } from './database.constants.js';
import { getDatabaseConfig } from './database.config.js';

export function createDatabase(): Kysely<FoundationDatabase> {
  return new Kysely<FoundationDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool(getDatabaseConfig()),
    }),
  });
}
