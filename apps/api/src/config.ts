/**
 * Configuration comes from environment variables. A secret may also be given as a file
 * (`NAME_FILE`), which is how the compose file passes the random secrets that its `init` service
 * writes on first start, so no secret ever sits in the repository or in an image.
 */
import { readFileSync } from 'node:fs';

export interface Config {
  port: number;
  /** The public origin of the app, for example http://localhost:8080. */
  baseUrl: string;
  /** Extra origins allowed to send cookie-authenticated requests (a tunnel, a LAN address). */
  trustedOrigins: string[];
  databaseUrl: string;
  authSecret: string;
  devConsole: boolean;
  /** Time zone in which medicine times such as 08:00 are read. */
  timeZone: string;
  /** How long after a slot time with no dose the server raises a missed-dose alert. */
  missedAfterMs: number;
  /** How often the server checks for missed doses. */
  sweepEveryMs: number;
  logLevel: string;
  /** A Cloudflare Realtime TURN key, so calls can connect through a relay when a direct path is blocked. Optional. */
  turn?: { keyId: string; apiToken: string };
}

type Env = Record<string, string | undefined>;

export function readSecret(env: Env, name: string, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): string | undefined {
  const direct = env[name];
  if (direct && direct.trim() !== '') return direct.trim();
  const file = env[`${name}_FILE`];
  if (file) return read(file).trim();
  return undefined;
}

function need(v: string | undefined, name: string): string {
  if (!v) throw new Error(`${name} is not set (give it directly or as ${name}_FILE)`);
  return v;
}

export function loadConfig(env: Env = process.env, read?: (p: string) => string): Config {
  const baseUrl = (env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  const dbPassword = readSecret(env, 'DB_PASSWORD', read);
  const databaseUrl =
    env.DATABASE_URL ??
    `postgres://${env.DB_USER ?? 'kaabil'}:${encodeURIComponent(need(dbPassword, 'DB_PASSWORD'))}@${env.DB_HOST ?? 'db'}:${env.DB_PORT ?? '5432'}/${env.DB_NAME ?? 'kaabil'}`;
  const turnToken = readSecret(env, 'CF_TURN_API_TOKEN', read);
  const turn = env.CF_TURN_KEY_ID && turnToken ? { keyId: env.CF_TURN_KEY_ID, apiToken: turnToken } : undefined;
  return {
    port: Number(env.PORT ?? 3000),
    baseUrl,
    trustedOrigins: (env.TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    databaseUrl,
    authSecret: need(readSecret(env, 'AUTH_SECRET', read), 'AUTH_SECRET'),
    devConsole: env.KAABIL_DEV_CONSOLE === '1',
    timeZone: env.KAABIL_TZ ?? 'Asia/Kolkata',
    missedAfterMs: Number(env.MISSED_AFTER_MS ?? 22 * 60_000),
    sweepEveryMs: Number(env.SWEEP_EVERY_MS ?? 60_000),
    logLevel: env.LOG_LEVEL ?? 'info',
    ...(turn ? { turn } : {}),
  };
}

export function allowedOrigins(c: Pick<Config, 'baseUrl' | 'trustedOrigins'>): string[] {
  return [c.baseUrl, ...c.trustedOrigins];
}
