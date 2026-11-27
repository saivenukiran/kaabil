/** Starts the API: connect to Postgres, run migrations, then serve. */
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import pino from 'pino';
import { migrationsFolder, schema } from '@kaabil/db';
import { createApp } from './app';
import { createAuth } from './auth';
import { Bus } from './bus';
import { loadConfig } from './config';
import { startSweep } from './sweep';

const config = loadConfig();
const log = pino({ level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] });

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
const db = drizzle(pool, { schema });

async function waitForDatabase(): Promise<void> {
  for (let i = 1; i <= 30; i++) {
    try {
      await pool.query('select 1');
      return;
    } catch (e) {
      log.warn({ attempt: i, err: (e as Error).message }, 'waiting for the database');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('the database did not come up');
}

await waitForDatabase();
await migrate(db, { migrationsFolder });
log.info('migrations applied');

const auth = createAuth({ db, secret: config.authSecret, baseUrl: config.baseUrl, trustedOrigins: config.trustedOrigins });
const deps = { db, auth, bus: new Bus(), config, now: () => Date.now(), log };
const app = createApp(deps);
startSweep(deps);

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (i) => log.info({ port: i.port, devConsole: config.devConsole }, 'kaabil api listening'));
