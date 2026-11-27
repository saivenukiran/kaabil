import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PollResultSchema, type CallSignal } from '@kaabil/contract';
import { loadConfig } from '../src/config';
import { RINGS_PER_WINDOW, RING_WINDOW_MS, SIGNALS_PER_MINUTE } from '../src/routes/calls';
import { familyWithGroup, makeApp, MIN, pairPhone, phone, type Family, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

const callId = (n = 1) => `call-0000000${n}`;
const ring = (from: 'family' | 'person', n = 1): CallSignal => ({ kind: 'ring', callId: callId(n), from, withVideo: false });
const hangup = (from: 'family' | 'person'): CallSignal => ({ kind: 'hangup', callId: callId(), from });

async function setup(email: string, app: TestApp = t) {
  const { f, groupId } = await familyWithGroup(app, email);
  const token = await pairPhone(app, f, groupId);
  return { f, groupId, token, p: phone(app, token) };
}

/** Everything one side has been sent so far, read from the same poll endpoint the apps use. */
async function received(side: 'family' | 'person', s: { f: Family; groupId: string; p: ReturnType<typeof phone> }) {
  const res = side === 'family' ? await s.f.call('GET', `/api/care/groups/${s.groupId}/poll?after=0`) : await s.p('GET', '/api/device/poll?after=0');
  const parsed = PollResultSchema.parse(await res.json());
  return parsed.events.map((e) => e.event).filter((e) => e.type === 'call').map((e) => (e as { signal: CallSignal }).signal);
}

describe('passing call messages between the two sides', () => {
  it("a family ring reaches the person's phone and nobody else", async () => {
    const a = await setup('call1@example.test');
    const b = await setup('call2@example.test');
    const r = await a.f.call('POST', `/api/care/groups/${a.groupId}/call`, ring('family'));
    expect(r.status).toBe(200);
    expect(await received('person', a)).toEqual([ring('family')]);
    expect(await received('family', a)).toEqual([]); // not echoed back to the sender
    expect(await received('person', b)).toEqual([]); // another group hears nothing
    expect(await received('family', b)).toEqual([]);
  });

  it("the phone's answer, offer and network candidates reach the family in order", async () => {
    const s = await setup('call3@example.test');
    const msgs: CallSignal[] = [
      ring('person'),
      { kind: 'accept', callId: callId(), from: 'person' },
      { kind: 'offer', callId: callId(), from: 'person', sdp: 'v=0\r\n' },
      { kind: 'ice', callId: callId(), from: 'person', candidate: { candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } },
      { kind: 'ice', callId: callId(), from: 'person', candidate: null },
      hangup('person'),
    ];
    for (const m of msgs) expect((await s.p('POST', '/api/device/call', m)).status).toBe(200);
    expect(await received('family', s)).toEqual(msgs);
  });

  it('refuses a message that claims to be from the other side', async () => {
    const s = await setup('call4@example.test');
    const asPerson = await s.f.call('POST', `/api/care/groups/${s.groupId}/call`, hangup('person'));
    expect(asPerson.status).toBe(400);
    expect(((await asPerson.json()) as { error: { code: string } }).error.code).toBe('wrong_sender');
    expect((await s.p('POST', '/api/device/call', hangup('family'))).status).toBe(400);
    expect(await received('person', s)).toEqual([]);
    expect(await received('family', s)).toEqual([]);
  });

  it('refuses bad JSON, wrong shapes, oversized text and unknown fields, and passes none of them on', async () => {
    const s = await setup('call5@example.test');
    const bad: unknown[] = [
      {},
      { kind: 'ring' },
      { ...ring('family'), extra: 1 },
      { ...ring('family'), callId: 'x' },
      { kind: 'offer', callId: callId(), from: 'family', sdp: 'x'.repeat(20_001) },
      { kind: 'boom', callId: callId(), from: 'family' },
      [],
      'ring',
    ];
    for (const b of bad) expect((await s.f.call('POST', `/api/care/groups/${s.groupId}/call`, b)).status, JSON.stringify(b)?.slice(0, 60)).toBe(400);
    const notJson = await t.app.request(`/api/care/groups/${s.groupId}/call`, { method: 'POST', headers: { cookie: s.f.cookie, origin: 'http://localhost:8080', 'content-type': 'application/json' }, body: '{not json' });
    expect(notJson.status).toBe(400);
    expect(await received('person', s)).toEqual([]);
  });

  it("another family cannot ring this person, and a phone cannot reach another group's family", async () => {
    const a = await setup('call6@example.test');
    const b = await setup('call7@example.test');
    const r = await b.f.call('POST', `/api/care/groups/${a.groupId}/call`, ring('family'));
    expect(r.status).toBe(404);
    expect(await received('person', a)).toEqual([]);
    // A phone only ever reaches its own group's family.
    await a.p('POST', '/api/device/call', ring('person'));
    expect(await received('family', b)).toEqual([]);
    expect((await received('family', a)).length).toBe(1);
  });

  it('says at once when no phone is paired, but still lets the family hang up', async () => {
    const { f, groupId } = await familyWithGroup(t, 'call8@example.test');
    const r = await f.call('POST', `/api/care/groups/${groupId}/call`, ring('family'));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('no_phone');
    expect((await f.call('POST', `/api/care/groups/${groupId}/call`, hangup('family'))).status).toBe(200);
  });

  it('refuses calls without credentials', async () => {
    const s = await setup('call9@example.test');
    expect((await t.app.request(`/api/care/groups/${s.groupId}/call`, { method: 'POST', headers: { origin: 'http://localhost:8080', 'content-type': 'application/json' }, body: JSON.stringify(ring('family')) })).status).toBe(401);
    expect((await t.app.request('/api/device/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ring('person')) })).status).toBe(401);
  });

  it('a revoked phone can no longer send', async () => {
    const s = await setup('call10@example.test');
    const g = (await (await s.f.call('GET', `/api/care/groups/${s.groupId}`)).json()) as { devices: { id: string }[] };
    await s.f.call('DELETE', `/api/care/groups/${s.groupId}/devices/${g.devices[0]!.id}`);
    expect((await s.p('POST', '/api/device/call', ring('person'))).status).toBe(401);
  });
});

describe('limits', () => {
  it(`allows ${RINGS_PER_WINDOW} rings in a few minutes, refuses the next, and allows again later`, async () => {
    const s = await setup('limit1@example.test');
    for (let i = 1; i <= RINGS_PER_WINDOW; i++) expect((await s.f.call('POST', `/api/care/groups/${s.groupId}/call`, ring('family', i))).status).toBe(200);
    const over = await s.f.call('POST', `/api/care/groups/${s.groupId}/call`, ring('family', 9));
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('too_many_calls');
    // Other messages still pass (a call in progress must be able to hang up).
    expect((await s.f.call('POST', `/api/care/groups/${s.groupId}/call`, hangup('family'))).status).toBe(200);
    t.clock.t += RING_WINDOW_MS + 1000;
    expect((await s.f.call('POST', `/api/care/groups/${s.groupId}/call`, ring('family', 10))).status).toBe(200);
  });

  it(`refuses more than ${SIGNALS_PER_MINUTE} messages a minute for one group, then recovers`, async () => {
    const s = await setup('limit2@example.test');
    let last = 200;
    for (let i = 0; i < SIGNALS_PER_MINUTE; i++) last = (await s.p('POST', '/api/device/call', hangup('person'))).status;
    expect(last).toBe(200);
    const over = await s.p('POST', '/api/device/call', hangup('person'));
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
    t.clock.t += MIN + 1000;
    expect((await s.p('POST', '/api/device/call', hangup('person'))).status).toBe(200);
  });
});

describe('which servers to use to connect', () => {
  const stunOnly = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] };

  it('gives public STUN only when no relay is configured, to both sides', async () => {
    const s = await setup('ice1@example.test');
    const fam = await s.f.call('GET', `/api/care/groups/${s.groupId}/ice`);
    expect(fam.status).toBe(200);
    expect(fam.headers.get('cache-control')).toBe('no-store');
    expect(await fam.json()).toEqual(stunOnly);
    expect(await (await s.p('GET', '/api/device/ice')).json()).toEqual(stunOnly);
  });

  it("does not show one family another's ice servers route", async () => {
    const a = await setup('ice2@example.test');
    const b = await setup('ice3@example.test');
    expect((await b.f.call('GET', `/api/care/groups/${a.groupId}/ice`)).status).toBe(404);
  });

  describe('with a relay key', () => {
    const KEY_ID = 'test-key-id';
    const API_TOKEN = `tok-${Math.random().toString(36).slice(2)}`;
    const relay = {
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' },
      ],
    };
    let r: TestApp;
    let calls: { url: string; auth: string | null; body: string }[];
    let mode: 'ok' | 'down' | 'weird';
    beforeAll(async () => {
      r = await makeApp({ turn: { keyId: KEY_ID, apiToken: API_TOKEN } });
      calls = [];
      mode = 'ok';
      r.deps.fetch = (async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: String(init?.body) });
        if (mode === 'down') return new Response('nope', { status: 503 });
        if (mode === 'weird') return Response.json({ nothing: true });
        return Response.json(relay, { status: 201 });
      }) as typeof fetch;
    });
    afterAll(() => r.close());

    it('adds short-lived relay credentials, drops the port browsers block, and asks the relay once for many callers', async () => {
      const s = await setup('ice4@example.test', r);
      const a = (await (await s.f.call('GET', `/api/care/groups/${s.groupId}/ice`)).json()) as typeof relay;
      const b = (await (await s.p('GET', '/api/device/ice')).json()) as typeof relay;
      expect(a).toEqual(b);
      expect(a.iceServers[0]!.urls).toEqual(['stun:stun.cloudflare.com:3478']);
      expect(a.iceServers[1]!.urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp']);
      expect(a.iceServers[1]).toMatchObject({ username: 'u1', credential: 'c1' });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe(`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`);
      expect(calls[0]!.auth).toBe(`Bearer ${API_TOKEN}`);
      expect(JSON.parse(calls[0]!.body)).toEqual({ ttl: 3600 });
      expect(JSON.stringify(a)).not.toContain(API_TOKEN); // the key never leaves the server
    });

    it('asks again after half the lifetime, and falls back to STUN (never an error) when the relay is down or odd', async () => {
      const s = await setup('ice5@example.test', r);
      r.clock.t += 31 * MIN;
      mode = 'down';
      const down = await s.f.call('GET', `/api/care/groups/${s.groupId}/ice`);
      expect(down.status).toBe(200);
      expect(await down.json()).toEqual(stunOnly);
      mode = 'weird';
      expect(await (await s.p('GET', '/api/device/ice')).json()).toEqual(stunOnly);
      mode = 'ok';
      const before = calls.length;
      const ok = (await (await s.p('GET', '/api/device/ice')).json()) as typeof relay;
      expect(ok.iceServers).toHaveLength(2);
      expect(calls.length).toBe(before + 1);
    });
  });
});

describe('configuration of the relay key', () => {
  const base = { AUTH_SECRET: 'x', DATABASE_URL: 'postgres://x' };
  it('is off unless both the key id and the token are given', () => {
    expect(loadConfig(base).turn).toBeUndefined();
    expect(loadConfig({ ...base, CF_TURN_KEY_ID: 'k' }).turn).toBeUndefined();
    expect(loadConfig({ ...base, CF_TURN_API_TOKEN: 't' }).turn).toBeUndefined();
  });
  it('reads the token directly or from a file', () => {
    expect(loadConfig({ ...base, CF_TURN_KEY_ID: 'k', CF_TURN_API_TOKEN: 't' }).turn).toEqual({ keyId: 'k', apiToken: 't' });
    const fromFile = `file-${Math.random().toString(36).slice(2)}`; // made up here, so no fixed secret-looking value sits in the source
    expect(loadConfig({ ...base, CF_TURN_KEY_ID: 'k', CF_TURN_API_TOKEN_FILE: '/s/turn' }, () => `${fromFile}\n`).turn).toEqual({ keyId: 'k', apiToken: fromFile });
  });
});
