// Seeds a fictional demo family on a running copy of the app, so a demo starts in seconds:
//
//   docker compose up -d --build
//   npm run seed                          # http://localhost:8080
//   npm run seed -- http://localhost:8080
//
// It signs up (or signs in) a demo family member, makes the care group for "Amma" in Telugu with two
// medicines, and prints a fresh pairing code to type on the person's phone. The password is made up
// on the first run and kept in .demo-account.json (ignored by git); it protects nothing but demo data.
// Safe to run again: it reuses the account and the group, and makes a new code.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const base = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:8080').replace(/\/$/, '');
const origin = new URL(base).origin;
const FILE = '.demo-account.json';

const account = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { email: 'demo@example.test', name: 'Demo Family', password: `dummy-${randomUUID()}` };
if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify(account, null, 2));

let cookie = '';
async function call(method, path, body) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    cookie = [...cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`)), pair].join('; ');
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { res, json };
}

function fail(msg) {
  console.log(`FAILED: ${msg}`);
  process.exit(1);
}

if (!(await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false))) {
  console.log(`Nothing answers at ${base}/api/health. Start the app first: docker compose up -d --build`);
  process.exit(2);
}

let r = await call('POST', '/api/auth/sign-up/email', { name: account.name, email: account.email, password: account.password });
if (!r.res.ok) {
  r = await call('POST', '/api/auth/sign-in/email', { email: account.email, password: account.password });
  if (!r.res.ok) fail(`could not sign in the demo family (${r.res.status}). If the database was reset, delete ${FILE} and run again.`);
}

const me = (await call('GET', '/api/care/me')).json;
let groupId = me?.groups?.[0]?.id;
if (!groupId) {
  const g = await call('POST', '/api/care/groups', { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: true, emergency: true } });
  if (g.res.status !== 201) fail(`could not create the care group (${g.res.status})`);
  groupId = g.json.id;
}

for (const line of ['Metformin 500, 1-0-1', 'Amlodipine 5, 0-0-1']) {
  const m = await call('POST', `/api/care/groups/${groupId}/medicines`, { line });
  if (!m.res.ok) fail(`could not add "${line}": ${m.json?.error?.message ?? m.res.status}`);
}

const code = await call('POST', `/api/care/groups/${groupId}/pairing-codes`);
if (code.res.status !== 201) fail(`could not make a pairing code (${code.res.status})`);

console.log(`Demo family ready on ${base}

  Family sign-in   ${account.email}
  Password         ${account.password}   (kept in ${FILE}, fictional)
  Person           Amma, Telugu, alerts on for missed doses and emergencies
  Medicines        Metformin 500 at 08:00 and 21:00; Amlodipine 5 at 21:00

  Pairing code     ${code.json.code}   (type it on the person's phone; works once, valid 10 minutes)

Next: open ${base}/test/ , sign in as the family member, and pair the person's phone with the code.`);
