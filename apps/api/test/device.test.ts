import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMetformin, familyWithGroup, HOUR, makeApp, MIN, pairPhone, phone, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

const json = async <T>(r: Response) => (await r.json()) as T;

describe('pairing the person\'s phone', () => {
  it('turns a code into a device token and a plan, and the code works once', async () => {
    const { f, groupId } = await familyWithGroup(t, 'pair1@example.test');
    await addMetformin(f, groupId);
    const c = await f.call('POST', `/api/care/groups/${groupId}/pairing-codes`);
    const { code, expiresAt } = await json<{ code: string; expiresAt: number }>(c);
    expect(code).toMatch(/^\d{8}$/);
    expect(expiresAt).toBe(t.clock.t + 10 * MIN);

    const pair = () => t.app.request('/api/device/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.0.1' }, body: JSON.stringify({ code, deviceName: 'Amma phone' }) });
    const first = await pair();
    expect(first.status).toBe(201);
    const { deviceToken, groupId: gid } = await json<{ deviceToken: string; groupId: string }>(first);
    expect(gid).toBe(groupId);
    expect(deviceToken.length).toBeGreaterThanOrEqual(32);

    const second = await pair();
    expect(second.status).toBe(400);
    expect((await json<{ error: { code: string } }>(second)).error.code).toBe('invalid_code');

    const plan = await json<{ person: { name: string }; medicines: { name: string }[]; lang: string }>(await phone(t, deviceToken)('GET', '/api/device/plan'));
    expect(plan.person.name).toBe('Amma');
    expect(plan.lang).toBe('te');
    expect(plan.medicines.map((m) => m.name)).toEqual(['Metformin']);
  });

  it('gives a wrong code and an expired code the same answer', async () => {
    const { f, groupId } = await familyWithGroup(t, 'pair2@example.test');
    const { code } = await json<{ code: string }>(await f.call('POST', `/api/care/groups/${groupId}/pairing-codes`));
    const wrongCode = code === '00000000' ? '00000001' : '00000000';
    const wrong = await t.app.request('/api/device/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: wrongCode, deviceName: 'x' }) });
    t.clock.t += 11 * MIN;
    const expired = await t.app.request('/api/device/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceName: 'x' }) });
    t.clock.t -= 11 * MIN;
    expect(wrong.status).toBe(400);
    expect(expired.status).toBe(400);
    expect(await wrong.text()).toBe(await expired.text());
  });

  it('keeps only one live code per group: a new code replaces the old one', async () => {
    const { f, groupId } = await familyWithGroup(t, 'pair3@example.test');
    const a = await json<{ code: string }>(await f.call('POST', `/api/care/groups/${groupId}/pairing-codes`));
    const b = await json<{ code: string }>(await f.call('POST', `/api/care/groups/${groupId}/pairing-codes`));
    const tryCode = (code: string) => t.app.request('/api/device/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceName: 'x' }) });
    if (a.code !== b.code) expect((await tryCode(a.code)).status).toBe(400);
    expect((await tryCode(b.code)).status).toBe(201);
  });

  it('slows down guessing: the eleventh try in a minute is refused', async () => {
    const local = await makeApp();
    const codes = Array.from({ length: 11 }, (_, i) => String(10_000_000 + i));
    const statuses: number[] = [];
    for (const code of codes) {
      const r = await local.app.request('/api/device/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify({ code, deviceName: 'x' }) });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
    await local.close();
  });

  it('refuses the device routes without a token or with a made-up one', async () => {
    expect((await t.app.request('/api/device/plan')).status).toBe(401);
    expect((await phone(t, 'z'.repeat(43))('GET', '/api/device/plan')).status).toBe(401);
    expect((await t.app.request('/api/device/plan', { headers: { authorization: 'Bearer short' } })).status).toBe(401);
  });

  it('does not let a phone use the family routes, or a family cookie use the device routes', async () => {
    const { f, groupId } = await familyWithGroup(t, 'pair4@example.test');
    const token = await pairPhone(t, f, groupId);
    expect((await phone(t, token)('GET', `/api/care/groups/${groupId}`)).status).toBe(401);
    expect((await t.app.request('/api/device/plan', { headers: { cookie: f.cookie } })).status).toBe(401);
  });

  it('stops a revoked phone at once', async () => {
    const { f, groupId } = await familyWithGroup(t, 'pair5@example.test');
    const token = await pairPhone(t, f, groupId);
    const g = await json<{ devices: { id: string }[] }>(await f.call('GET', `/api/care/groups/${groupId}`));
    expect(g.devices).toHaveLength(1);
    expect((await phone(t, token)('GET', '/api/device/plan')).status).toBe(200);
    expect((await f.call('DELETE', `/api/care/groups/${groupId}/devices/${g.devices[0]?.id}`)).status).toBe(200);
    expect((await phone(t, token)('GET', '/api/device/plan')).status).toBe(401);
  });

  it('never stores the token or the code in clear', async () => {
    const { f, groupId } = await familyWithGroup(t, 'pair6@example.test');
    const c = await json<{ code: string }>(await f.call('POST', `/api/care/groups/${groupId}/pairing-codes`));
    const rows = await t.deps.db.execute(`select code_hash from pairing_codes where group_id = '${groupId}'`);
    expect(JSON.stringify(rows)).not.toContain(c.code);
    const token = await pairPhone(t, f, groupId);
    const dev = await t.deps.db.execute(`select token_hash from devices where group_id = '${groupId}'`);
    expect(JSON.stringify(dev)).not.toContain(token);
  });
});

describe('doses', () => {
  it('records a dose once and tells the family; a retry changes nothing', async () => {
    const { f, groupId } = await familyWithGroup(t, 'dose1@example.test');
    const med = await addMetformin(f, groupId);
    const token = await pairPhone(t, f, groupId);
    const seen: string[] = [];
    const off = t.deps.bus.subscribe(groupId, 'family', (e) => seen.push(e.type));
    const body = { slotId: `${med.id}|2026-11-28|08:00`, medicineId: med.id, atMs: T0 + 8 * HOUR, via: 'voice' };
    const a = await phone(t, token)('POST', '/api/device/doses', body);
    const b = await phone(t, token)('POST', '/api/device/doses', body);
    off();
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await json<{ id: string }>(a)).id).toBe((await json<{ id: string }>(b)).id);
    expect(seen).toEqual(['dose']);
    const list = await json<{ doses: unknown[] }>(await f.call('GET', `/api/care/groups/${groupId}/doses`));
    expect(list.doses).toHaveLength(1);
  });

  it('refuses a medicine from another family and a slot that does not match', async () => {
    const a = await familyWithGroup(t, 'dose2a@example.test');
    const b = await familyWithGroup(t, 'dose2b@example.test');
    const medA = await addMetformin(a.f, a.groupId);
    await addMetformin(b.f, b.groupId);
    const tokenB = await pairPhone(t, b.f, b.groupId);
    const post = (body: object) => phone(t, tokenB)('POST', '/api/device/doses', body);
    expect((await post({ slotId: `${medA.id}|2026-11-28|08:00`, medicineId: medA.id, atMs: T0, via: 'voice' })).status).toBe(400);
    const tokenA = await pairPhone(t, a.f, a.groupId);
    expect((await phone(t, tokenA)('POST', '/api/device/doses', { slotId: 'other|2026-11-28|08:00', medicineId: medA.id, atMs: T0, via: 'voice' })).status).toBe(400);
  });

  it('refuses an unknown field and a bad via', async () => {
    const { f, groupId } = await familyWithGroup(t, 'dose3@example.test');
    const med = await addMetformin(f, groupId);
    const token = await pairPhone(t, f, groupId);
    const ok = { slotId: `${med.id}|2026-11-28|08:00`, medicineId: med.id, atMs: T0, via: 'voice' };
    expect((await phone(t, token)('POST', '/api/device/doses', { ...ok, extra: 1 })).status).toBe(400);
    expect((await phone(t, token)('POST', '/api/device/doses', { ...ok, via: 'typed' })).status).toBe(400);
  });

  it('refuses a body that is too large', async () => {
    const { f, groupId } = await familyWithGroup(t, 'dose4@example.test');
    const token = await pairPhone(t, f, groupId);
    const r = await phone(t, token)('POST', '/api/device/doses', { junk: 'x'.repeat(70 * 1024) });
    expect(r.status).toBe(413);
  });
});

describe('alerts', () => {
  it('respects consent: no missed-dose alert without it, and the phone is told why', async () => {
    const { f, groupId } = await familyWithGroup(t, 'alert1@example.test', { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: false, emergency: true } });
    const token = await pairPhone(t, f, groupId);
    const r = await phone(t, token)('POST', '/api/device/alerts', { kind: 'missed_dose', slotId: 'm|2026-11-28|08:00', atMs: T0 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ created: false, reason: 'no_consent' });
    expect((await json<{ alerts: unknown[] }>(await f.call('GET', `/api/care/groups/${groupId}/alerts`))).alerts).toHaveLength(0);
  });

  it('creates one alert per slot and kind, and tells the family live', async () => {
    const { f, groupId } = await familyWithGroup(t, 'alert2@example.test');
    const token = await pairPhone(t, f, groupId);
    const seen: string[] = [];
    const off = t.deps.bus.subscribe(groupId, 'family', (e) => seen.push(e.type));
    const body = { kind: 'missed_dose', slotId: 'm1|2026-11-28|08:00', medicineId: 'm1', atMs: T0 + 8 * HOUR };
    const a = await phone(t, token)('POST', '/api/device/alerts', body);
    const b = await phone(t, token)('POST', '/api/device/alerts', body);
    off();
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await json<{ reason: string }>(b)).reason).toBe('duplicate');
    expect(seen).toEqual(['alert']);
  });

  it('records every emergency, and a repeated-dose flag even without consent', async () => {
    const { f, groupId } = await familyWithGroup(t, 'alert3@example.test', { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: false, emergency: true } });
    const token = await pairPhone(t, f, groupId);
    const send = (kind: string, slotId?: string) => phone(t, token)('POST', '/api/device/alerts', { kind, atMs: T0 + 1, ...(slotId ? { slotId } : {}) });
    expect((await send('emergency')).status).toBe(201);
    expect((await send('emergency')).status).toBe(201);
    expect((await send('double_dose', 'm|2026-11-28|08:00')).status).toBe(201);
    expect((await json<{ alerts: unknown[] }>(await f.call('GET', `/api/care/groups/${groupId}/alerts`))).alerts).toHaveLength(3);
  });

  it('lets the family acknowledge an alert, and not another family\'s', async () => {
    const a = await familyWithGroup(t, 'alert4a@example.test');
    const b = await familyWithGroup(t, 'alert4b@example.test');
    const tokenA = await pairPhone(t, a.f, a.groupId);
    const made = await json<{ alert: { id: string } }>(await phone(t, tokenA)('POST', '/api/device/alerts', { kind: 'emergency', atMs: T0 }));
    expect((await b.f.call('POST', `/api/care/groups/${b.groupId}/alerts/${made.alert.id}/ack`)).status).toBe(404);
    const ack = await json<{ acknowledgedAt: number | null }>(await a.f.call('POST', `/api/care/groups/${a.groupId}/alerts/${made.alert.id}/ack`));
    expect(ack.acknowledgedAt).toBe(t.clock.t);
  });
});

describe('live events over the real HTTP stream', () => {
  async function firstEvents(res: Response, want: (types: string[]) => boolean, ms = 5000): Promise<string[]> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const dec = new TextDecoder();
    const types: string[] = [];
    const deadline = Date.now() + ms;
    let buf = '';
    while (Date.now() < deadline && !want(types)) {
      const r = await Promise.race([reader.read(), new Promise<{ done: true; value: undefined }>((ok) => setTimeout(() => ok({ done: true, value: undefined }), 300))]);
      if (r.value) buf += dec.decode(r.value, { stream: true });
      for (const m of buf.matchAll(/data: (\{.*\})\n\n/g)) {
        const type = (JSON.parse(m[1] ?? '{}') as { type: string }).type;
        if (type) types.push(type);
      }
      buf = buf.replace(/[\s\S]*\n\n/, '');
    }
    await reader.cancel();
    return types;
  }

  it('shows a dose on the family stream as it happens', async () => {
    const { f, groupId } = await familyWithGroup(t, 'sse1@example.test');
    const med = await addMetformin(f, groupId);
    const token = await pairPhone(t, f, groupId);
    const res = await f.call('GET', `/api/care/groups/${groupId}/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const pending = firstEvents(res, (ty) => ty.includes('dose'));
    await new Promise((r) => setTimeout(r, 150));
    await phone(t, token)('POST', '/api/device/doses', { slotId: `${med.id}|2026-11-28|08:00`, medicineId: med.id, atMs: T0, via: 'button' });
    const types = await pending;
    expect(types[0]).toBe('ping');
    expect(types).toContain('dose');
  });

  it('sends "remind now" to the phone stream and not to anyone else\'s', async () => {
    const a = await familyWithGroup(t, 'sse2a@example.test');
    const b = await familyWithGroup(t, 'sse2b@example.test');
    const tokenA = await pairPhone(t, a.f, a.groupId);
    const tokenB = await pairPhone(t, b.f, b.groupId);
    const resA = await phone(t, tokenA)('GET', '/api/device/events');
    const resB = await phone(t, tokenB)('GET', '/api/device/events');
    const pa = firstEvents(resA, (ty) => ty.includes('remind'), 2500);
    const pb = firstEvents(resB, (ty) => ty.includes('remind'), 1500);
    await new Promise((r) => setTimeout(r, 150));
    const rn = await a.f.call('POST', '/api/dev/remind-now', { groupId: a.groupId });
    expect(rn.status).toBe(200);
    expect(await pa).toContain('remind');
    expect(await pb).not.toContain('remind');
    // another family cannot trigger a reminder for this group
    expect((await b.f.call('POST', '/api/dev/remind-now', { groupId: a.groupId })).status).toBe(404);
  });

  it('refuses a stream without a session', async () => {
    const { groupId } = await familyWithGroup(t, 'sse3@example.test');
    expect((await t.app.request(`/api/care/groups/${groupId}/events`)).status).toBe(401);
  });
});
