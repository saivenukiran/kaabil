import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { schema } from '@kaabil/db';
import type { Logger } from 'pino';
import type { Auth } from './auth';
import type { Bus } from './bus';
import type { Config } from './config';

/** Any Drizzle Postgres database: the real one (node-postgres) or the in-process one used in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface Deps {
  db: Db;
  auth: Auth;
  bus: Bus;
  config: Config;
  /** Epoch ms. Tests pass a fake clock. */
  now: () => number;
  log: Logger;
}
