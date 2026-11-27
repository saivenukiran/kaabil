import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMetformin, familyWithGroup, makeApp, pairPhone, phone, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

type Poll = { events: { id: number; event: { type: string } }[]; last: number };
const json = async <T>(r: Response) => (await r.json()) as T;

async function setup(email: string) {
  const { f, groupId } = await familyWithGroup(t, email);
  const med = await addMetformin(f, groupId);
  const token = await pairPhone(t, f, groupId);
  return { f, groupId, med, token };
}

describe('long polling for a family that cannot hold a stream open', () => {
  it('starts from the current position with no events, then returns what happened after it', async () => {
    const { f, groupId, med, token } = await setup('poll1@example.test');
    const start = await json<Poll>(await f.call('GET', `/api/care/groups/${groupId}/poll`));
    expect(start.events).toEqual([]);
    expect(start.last).toBeGreaterThan(0);

    await phone(t, token)('POST', '/api/device/doses', { slotId: `${med.id}|2026-11-28|08:00`, medicineId: med.id, atMs: T0, via: 'voice' });
    const next = await json<Poll>(await f.call('GET', `/api/care/groups/${groupId}/poll?after=${start.last}`));
    expect(next.events.map((e) => e.event.type)).toEqual(['dose']);
    expect(next.last).toBe(next.events[0]?.id);

    const again = await json<Poll>(await f.call('GET', `/api/care/groups/${groupId}/poll?after=${next.last}`));
    expect(again.events).toEqual([]);
    expect(again.last).toBe(next.last);
  });

  it('waits for news and answers as soon as it comes', async () => {
    const { f, groupId, token } = await setup('poll2@example.test');
    const start = await json<Poll>(await f.call('GET', `/api/care/groups/${groupId}/poll`));
    const t0 = Date.now();
    const waiting = f.call('GET', `/api/care/groups/${groupId}/poll?after=${start.last}&wait=5000`);
    await new Promise((r) => setTimeout(r, 80));
    await phone(t, token)('POST', '/api/device/alerts', { kind: 'emergency', atMs: T0 });
    const got = await json<Poll>(await waiting);
    expect(got.events.map((e) => e.event.type)).toEqual(['alert']);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('gives an empty answer when nothing happens in the time asked', async () => {
    const { f, groupId } = await setup('poll3@example.test');
    const start = await json<Poll>(await f.call('GET', `/api/care/groups/${groupId}/poll`));
    const got = await json<Poll>(await f.call('GET', `/api/care/groups/${groupId}/poll?after=${start.last}&wait=100`));
    expect(got.events).toEqual([]);
    expect(got.last).toBe(start.last);
  });

  it('treats a bad cursor as a fresh start, never as an error', async () => {
    const { f, groupId } = await setup('poll4@example.test');
    for (const q of ['after=-3', 'after=abc', 'after=1.5']) {
      const r = await f.call('GET', `/api/care/groups/${groupId}/poll?${q}`);
      expect(r.status).toBe(200);
      expect((await json<Poll>(r)).events).toEqual([]);
    }
  });

  it('is only for the group\'s own family, with a session', async () => {
    const a = await setup('poll5a@example.test');
    const b = await setup('poll5b@example.test');
    expect((await b.f.call('GET', `/api/care/groups/${a.groupId}/poll`)).status).toBe(404);
    expect((await t.app.request(`/api/care/groups/${a.groupId}/poll`)).status).toBe(401);
    expect((await t.app.request(`/api/care/groups/${a.groupId}/poll`, { headers: { authorization: `Bearer ${a.token}` } })).status).toBe(401);
  });

  it('never shows one family the events of another', async () => {
    const a = await setup('poll6a@example.test');
    const b = await setup('poll6b@example.test');
    const start = await json<Poll>(await b.f.call('GET', `/api/care/groups/${b.groupId}/poll`));
    await phone(t, a.token)('POST', '/api/device/alerts', { kind: 'emergency', atMs: T0 });
    const got = await json<Poll>(await b.f.call('GET', `/api/care/groups/${b.groupId}/poll?after=${start.last}`));
    expect(got.events).toEqual([]);
  });
});

describe('long polling for the person\'s phone', () => {
  it('delivers "remind now" and plan changes to the phone', async () => {
    const { f, groupId, token } = await setup('poll7@example.test');
    const call = phone(t, token);
    const start = await json<Poll>(await call('GET', '/api/device/poll'));
    const waiting = call('GET', `/api/device/poll?after=${start.last}&wait=5000`);
    await new Promise((r) => setTimeout(r, 80));
    expect((await f.call('POST', '/api/dev/remind-now', { groupId })).status).toBe(200);
    const got = await json<Poll>(await waiting);
    expect(got.events.map((e) => e.event.type)).toEqual(['remind']);

    await f.call('PATCH', `/api/care/groups/${groupId}`, { consent: { missedDose: false, emergency: true } });
    const plan = await json<Poll>(await call('GET', `/api/device/poll?after=${got.last}`));
    expect(plan.events.map((e) => e.event.type)).toEqual(['plan']);
  });

  it('needs the phone\'s own token, and stops at once when the phone is revoked', async () => {
    const { f, groupId, token } = await setup('poll8@example.test');
    expect((await t.app.request('/api/device/poll')).status).toBe(401);
    expect((await phone(t, token)('GET', '/api/device/poll')).status).toBe(200);
    const g = await json<{ devices: { id: string }[] }>(await f.call('GET', `/api/care/groups/${groupId}`));
    await f.call('DELETE', `/api/care/groups/${groupId}/devices/${g.devices[0]?.id}`);
    expect((await phone(t, token)('GET', '/api/device/poll')).status).toBe(401);
  });
});
