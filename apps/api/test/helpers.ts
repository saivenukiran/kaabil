import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import pino from 'pino';
import { migrationsFolder, schema } from '@kaabil/db';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { Bus } from '../src/bus';
import type { Config } from '../src/config';
import type { Deps } from '../src/types';

export const ORIGIN = 'http://localhost:8080';
/** Dummy values made fresh for every test run. They protect nothing: the database lives in memory and disappears with the run. */
export const TEST_PASSPHRASE = `dummy-${randomUUID()}`;
const TEST_SIGNING_KEY = randomBytes(32).toString('hex');
/** 28 November 2026, 00:00 in India (UTC+5:30): a fixed, known start for every test. */
export const T0 = Date.UTC(2026, 10, 27, 18, 30);
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export async function makeApp(overrides: Partial<Config> = {}) {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  const config: Config = {
    port: 0,
    baseUrl: ORIGIN,
    trustedOrigins: [],
    databaseUrl: 'unused',
    authSecret: TEST_SIGNING_KEY,
    devConsole: true,
    timeZone: 'Asia/Kolkata',
    missedAfterMs: 22 * MIN,
    sweepEveryMs: 60_000,
    logLevel: 'silent',
    ...overrides,
  };
  const clock = { t: T0 + 6 * HOUR };
  const auth = createAuth({ db, secret: config.authSecret, baseUrl: config.baseUrl, trustedOrigins: [], rateLimit: false });
  const deps: Deps = { db, auth, bus: new Bus(), config, now: () => clock.t, log: pino({ level: 'silent' }) };
  const app = createApp(deps);
  return { app, deps, clock, close: () => client.close() };
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

/** A signed-in family member: keeps the session cookie between calls. */
export class Family {
  cookie = '';
  constructor(private t: TestApp) {}

  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.t.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair) this.cookie = this.cookie ? mergeCookie(this.cookie, pair) : pair;
    }
    return res;
  }

  async signUp(email: string, name = 'Ravi') {
    const r = await this.call('POST', '/api/auth/sign-up/email', { name, email, password: TEST_PASSPHRASE });
    if (!r.ok) throw new Error(`sign up failed: ${r.status} ${await r.text()}`);
    return this;
  }
}

function mergeCookie(jar: string, pair: string): string {
  const [name] = pair.split('=');
  const rest = jar.split('; ').filter((p) => !p.startsWith(`${name}=`));
  return [...rest, pair].join('; ');
}

export const GROUP = { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: true, emergency: true } };

export async function familyWithGroup(t: TestApp, email = 'ravi@example.test', group: object = GROUP) {
  const f = await new Family(t).signUp(email);
  const r = await f.call('POST', '/api/care/groups', group);
  if (r.status !== 201) throw new Error(`create group failed: ${r.status} ${await r.text()}`);
  const g = (await r.json()) as { id: string };
  return { f, groupId: g.id };
}

export async function addMetformin(f: Family, groupId: string) {
  const r = await f.call('POST', `/api/care/groups/${groupId}/medicines`, { line: 'Metformin 500, 1-0-1' });
  return (await r.json()) as { id: string; times: string[] };
}

let ipCounter = 0;

/** Make a pairing code as the family and use it as the person's phone. Returns the device token. */
export async function pairPhone(t: TestApp, f: Family, groupId: string, name = 'Amma phone') {
  const c = await f.call('POST', `/api/care/groups/${groupId}/pairing-codes`);
  const { code } = (await c.json()) as { code: string };
  const r = await t.app.request('/api/device/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipCounter}` }, body: JSON.stringify({ code, deviceName: name }) });
  if (r.status !== 201) throw new Error(`pair failed: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { deviceToken: string }).deviceToken;
}

export const phone = (t: TestApp, token: string) => (method: string, path: string, body?: unknown) =>
  t.app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
