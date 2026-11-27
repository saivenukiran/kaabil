// API checks for `npm run smoke`: the real flow through the real proxy, with a throwaway family.
// A person signs up, makes a care group, adds a medicine, pairs a phone with a code, the phone
// logs a dose and raises an alert, and the family sees both, live. Fictional data only.

import { randomUUID } from 'node:crypto';

class Jar {
  cookie = '';
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0];
      const name = pair.split('=')[0];
      this.cookie = [...this.cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`)), pair].join('; ');
    }
  }
}

// Dummy passwords made fresh for each smoke run. They protect nothing but a throwaway family.
const PASSPHRASE_ONE = `dummy-${randomUUID()}`;
const PASSPHRASE_TWO = `dummy-${randomUUID()}`;

export async function apiChecks(base, check) {
  const origin = new URL(base).origin;
  const family = new Jar();
  const call = async (jar, method, path, body, headers = {}) => {
    const h = { origin, ...headers };
    if (jar?.cookie) h.cookie = jar.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    jar?.absorb(res);
    return res;
  };
  const json = async (res) => {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  };

  const health = await call(null, 'GET', '/api/health');
  const hb = await json(health);
  check('GET /api/health answers through the proxy', health.status === 200 && hb?.ok === true, `status ${health.status}`);
  const h = health.headers;
  check('API answers are never cached', h.get('cache-control') === 'no-store', h.get('cache-control') ?? 'missing');
  check('API answers carry nosniff and a locked-down policy', h.get('x-content-type-options') === 'nosniff' && (h.get('content-security-policy') ?? '').includes("default-src 'none'"), h.get('content-security-policy') ?? 'missing');
  check('each API security header appears once', (h.get('x-frame-options') ?? '').split(',').length === 1);

  const stamp = Date.now();
  const email = `smoke-${stamp}@example.test`;
  const signUp = await call(family, 'POST', '/api/auth/sign-up/email', { name: 'Smoke Family', email, password: PASSPHRASE_ONE });
  check('a family member can sign up', signUp.ok, `status ${signUp.status}`);
  check('the session cookie is HttpOnly with SameSite', /httponly/i.test((signUp.headers.getSetCookie?.() ?? []).join(';')) && /samesite=lax/i.test((signUp.headers.getSetCookie?.() ?? []).join(';')));

  const noSession = await call(null, 'GET', '/api/care/me');
  check('family routes refuse a caller with no session', noSession.status === 401, `status ${noSession.status}`);

  const created = await call(family, 'POST', '/api/care/groups', { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: true, emergency: true } });
  const group = await json(created);
  check('a care group can be created', created.status === 201 && Boolean(group?.id), `status ${created.status}`);
  if (!group?.id) return;
  const g = `/api/care/groups/${group.id}`;

  const med = await call(family, 'POST', `${g}/medicines`, { line: 'Metformin 500, 1-0-1' });
  const medicine = await json(med);
  check('the typed medicine line becomes two daily times', med.status === 201 && JSON.stringify(medicine?.times) === '["08:00","21:00"]', JSON.stringify(medicine));

  const codeRes = await call(family, 'POST', `${g}/pairing-codes`);
  const code = await json(codeRes);
  check('the family gets an 8-digit pairing code', codeRes.status === 201 && /^\d{8}$/.test(code?.code ?? ''));

  const pair = await call(null, 'POST', '/api/device/pair', { code: code?.code, deviceName: 'Smoke phone' });
  const paired = await json(pair);
  check('the person\'s phone pairs with the code', pair.status === 201 && (paired?.deviceToken ?? '').length >= 32, `status ${pair.status}`);
  const again = await call(null, 'POST', '/api/device/pair', { code: code?.code, deviceName: 'Second phone' });
  check('the same code does not work twice', again.status === 400, `status ${again.status}`);
  if (!paired?.deviceToken) return;
  const auth = { authorization: `Bearer ${paired.deviceToken}` };

  const plan = await json(await call(null, 'GET', '/api/device/plan', undefined, auth));
  check('the phone gets the plan: person, language and medicine', plan?.person?.name === 'Amma' && plan?.lang === 'te' && plan?.medicines?.[0]?.name === 'Metformin');

  // Open the family's live stream, then have the phone log a dose and raise an emergency.
  const ctl = new AbortController();
  const events = [];
  const stream = await fetch(base + `${g}/events`, { headers: { cookie: family.cookie, accept: 'text/event-stream' }, signal: ctl.signal });
  check('the family live stream opens', stream.status === 200 && (stream.headers.get('content-type') ?? '').includes('text/event-stream'), `status ${stream.status}`);
  const reading = (async () => {
    const reader = stream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        for (const m of buf.matchAll(/data: (\{.*\})\n\n/g)) events.push(JSON.parse(m[1]).type);
        buf = buf.replace(/[\s\S]*\n\n/, '');
      }
    } catch {
      /* aborted */
    }
  })();
  await new Promise((r) => setTimeout(r, 400));

  const slotId = `${medicine.id}|2026-11-28|08:00`;
  const dose = { slotId, medicineId: medicine.id, atMs: Date.now(), via: 'voice' };
  const d1 = await call(null, 'POST', '/api/device/doses', dose, auth);
  const d2 = await call(null, 'POST', '/api/device/doses', dose, auth);
  check('the phone logs a dose, and a retry does not record it twice', d1.status === 201 && d2.status === 200, `${d1.status} then ${d2.status}`);

  const al = await call(null, 'POST', '/api/device/alerts', { kind: 'emergency', atMs: Date.now() }, auth);
  const alert = await json(al);
  check('an emergency alert is created (the family consented)', al.status === 201 && alert?.created === true, `status ${al.status}`);

  for (let i = 0; i < 20 && !(events.includes('dose') && events.includes('alert')); i++) await new Promise((r) => setTimeout(r, 200));
  ctl.abort();
  await reading;
  check('the family sees the dose and the alert live, without asking', events.includes('dose') && events.includes('alert'), events.join(','));

  const doses = await json(await call(family, 'GET', `${g}/doses`));
  check('the family can list the dose, once', doses?.doses?.length === 1, JSON.stringify(doses));
  const ack = await call(family, 'POST', `${g}/alerts/${alert?.alert?.id}/ack`);
  check('the family can acknowledge the alert', ack.status === 200, `status ${ack.status}`);

  const other = new Jar();
  await call(other, 'POST', '/api/auth/sign-up/email', { name: 'Other Family', email: `other-${stamp}@example.test`, password: PASSPHRASE_TWO });
  const peek = await call(other, 'GET', g);
  check('another family cannot see this group (404)', peek.status === 404, `status ${peek.status}`);
  const forged = await call(family, 'POST', '/api/care/groups', { personName: 'X', address: 'x', lang: 'te', consent: { missedDose: false, emergency: false } }, { origin: 'https://evil.example' });
  check('a data-changing request from another origin is refused', forged.status === 403, `status ${forged.status}`);

  const dev = await fetch(base + '/dev');
  const devCsp = dev.headers.get('content-security-policy') ?? '';
  check('the test console is served at /dev with its own policy', dev.status === 200 && devCsp.includes("script-src 'self' 'unsafe-inline'"), `status ${dev.status}`);
  // Custom voice: a family member records a fixed sentence; the phone gets exactly that sentence and its audio.
  const overview = await json(await call(family, 'GET', `${g}/voice`));
  const remind = overview?.sentences?.find((x) => x.key === 'remind');
  check('the family can list the sentences Kaabil says to the person', Boolean(remind) && /^[0-9a-f]{16}$/.test(remind?.textHash ?? ''), JSON.stringify(overview)?.slice(0, 120));
  const fakeWav = new Uint8Array(600).fill(5);
  fakeWav.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  fakeWav.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
  const put = (hash, headers) => fetch(base + `${g}/voice/${hash}`, { method: 'PUT', headers: { origin, cookie: family.cookie, 'content-type': 'audio/wav', ...headers }, body: fakeWav });
  check('a recording needs the recorder\'s consent', (await put(remind?.textHash, {})).status === 400);
  check('a sentence Kaabil does not say cannot be recorded', (await put('0123456789abcdef', { 'x-voice-consent': 'yes' })).status === 404);
  check('a recording with consent is saved', (await put(remind?.textHash, { 'x-voice-consent': 'yes' })).status === 204);
  const clips = await json(await call(null, 'GET', '/api/device/voice', undefined, auth));
  check('the phone is given the sentence to match, not a way to say anything else', clips?.clips?.length === 1 && clips.clips[0].text === remind?.text, JSON.stringify(clips)?.slice(0, 120));
  const audio = await fetch(base + `/api/device/voice/${remind?.textHash}/audio`, { headers: auth });
  check('the phone can fetch the recording, served as audio and not sniffed', audio.status === 200 && audio.headers.get('content-type') === 'audio/wav' && audio.headers.get('x-content-type-options') === 'nosniff', `status ${audio.status}`);
  check('the other family cannot fetch it', (await call(other, 'GET', `${g}/voice`)).status === 404);
  check('the family can delete all recordings', (await call(family, 'DELETE', `${g}/voice`)).status === 200 && (await json(await call(null, 'GET', '/api/device/voice', undefined, auth)))?.clips?.length === 0);

  const status = await json(await call(null, 'GET', '/api/voice/status'));
  check('cloud voice says "key not set" when there is no key', status?.stt === 'key not set' && status?.tts === 'key not set', JSON.stringify(status));
}

/** The API and the database must not be reachable from outside the compose network. */
export async function closedPorts(check) {
  for (const [name, port] of [['the API', 3000], ['the database', 5432]]) {
    const open = await new Promise((resolve) => {
      import('node:net').then(({ createConnection }) => {
        const s = createConnection({ host: '127.0.0.1', port, timeout: 1500 });
        s.on('connect', () => (s.destroy(), resolve(true)));
        s.on('error', () => resolve(false));
        s.on('timeout', () => (s.destroy(), resolve(false)));
      });
    });
    check(`${name} is not published on port ${port}`, !open);
  }
}
