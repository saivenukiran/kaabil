import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMetformin, Family, familyWithGroup, GROUP, makeApp, ORIGIN, TEST_PASSPHRASE, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

describe('health and the error shape', () => {
  it('answers /api/health', async () => {
    const r = await t.app.request('/api/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: '0.1.0' });
  });
  it('returns the contract error body for an unknown path', async () => {
    const r = await t.app.request('/api/nope');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });
  it('sets security headers and never caches API answers', async () => {
    const r = await t.app.request('/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('signing in and the care group', () => {
  it('refuses family routes without a session', async () => {
    const r = await t.app.request('/api/care/me');
    expect(r.status).toBe(401);
  });

  it('refuses a short password', async () => {
    const f = new Family(t);
    const r = await f.call('POST', '/api/auth/sign-up/email', { name: 'X', email: 'short@example.test', password: 'short' });
    expect(r.ok).toBe(false);
  });

  it('creates a group and lists it under /me', async () => {
    const { f, groupId } = await familyWithGroup(t, 'one@example.test');
    const me = (await (await f.call('GET', '/api/care/me')).json()) as { groups: { id: string; role: string }[] };
    expect(me.groups).toEqual([{ id: groupId, personName: 'Amma', role: 'owner' }]);
    const g = (await (await f.call('GET', `/api/care/groups/${groupId}`)).json()) as { lang: string; consent: object; medicines: unknown[] };
    expect(g.lang).toBe('te');
    expect(g.consent).toEqual({ missedDose: true, emergency: true });
    expect(g.medicines).toEqual([]);
  });

  it('rejects a body with an unknown field or an unregistered language', async () => {
    const f = await new Family(t).signUp('two@example.test');
    expect((await f.call('POST', '/api/care/groups', { ...GROUP, admin: true })).status).toBe(400);
    expect((await f.call('POST', '/api/care/groups', { ...GROUP, lang: 'hi' })).status).toBe(400);
  });

  it('answers 404, not 403, when another family asks for the group', async () => {
    const a = await familyWithGroup(t, 'owner-a@example.test');
    const b = await new Family(t).signUp('other-b@example.test');
    expect((await b.call('GET', `/api/care/groups/${a.groupId}`)).status).toBe(404);
    expect((await b.call('GET', `/api/care/groups/${a.groupId}/doses`)).status).toBe(404);
    expect((await b.call('POST', `/api/care/groups/${a.groupId}/pairing-codes`)).status).toBe(404);
    expect((await b.call('POST', `/api/care/groups/${a.groupId}/medicines`, { line: 'Metformin 500, 1-0-1' })).status).toBe(404);
  });

  it('refuses a data-changing request from another origin', async () => {
    const { f } = await familyWithGroup(t, 'origin@example.test');
    const r = await f.call('POST', '/api/care/groups', GROUP, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('bad_origin');
  });

  it('refuses a data-changing request the browser marks cross-site and with no origin', async () => {
    const { f } = await familyWithGroup(t, 'site@example.test');
    const res = await t.app.request('/api/care/groups', { method: 'POST', headers: { cookie: f.cookie, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify(GROUP) });
    expect(res.status).toBe(403);
  });
});

describe('medicines', () => {
  it('turns the typed line into times and replaces a medicine of the same name', async () => {
    const { f, groupId } = await familyWithGroup(t, 'meds@example.test');
    const m = await addMetformin(f, groupId);
    expect(m.times).toEqual(['08:00', '21:00']);
    const again = await f.call('POST', `/api/care/groups/${groupId}/medicines`, { line: 'metformin 850, TDS' });
    expect(again.status).toBe(200);
    const g = (await (await f.call('GET', `/api/care/groups/${groupId}`)).json()) as { medicines: { strength: string; times: string[] }[] };
    expect(g.medicines).toHaveLength(1);
    expect(g.medicines[0]).toMatchObject({ strength: '850', times: ['08:00', '14:00', '21:00'] });
  });

  it('explains a line it cannot read', async () => {
    const { f, groupId } = await familyWithGroup(t, 'bad-line@example.test');
    const r = await f.call('POST', `/api/care/groups/${groupId}/medicines`, { line: 'just words' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string; message: string } }).error.code).toBe('invalid_medicine');
  });

  it('refuses invalid times and removes a medicine', async () => {
    const { f, groupId } = await familyWithGroup(t, 'remove@example.test');
    expect((await f.call('POST', `/api/care/groups/${groupId}/medicines`, { name: 'A', strength: '1', times: ['25:00'] })).status).toBe(400);
    const m = await addMetformin(f, groupId);
    expect((await f.call('DELETE', `/api/care/groups/${groupId}/medicines/${m.id}`)).status).toBe(200);
    expect((await f.call('DELETE', `/api/care/groups/${groupId}/medicines/${m.id}`)).status).toBe(404);
  });

  it('updates the plan and announces it to the family and the phones', async () => {
    const { f, groupId } = await familyWithGroup(t, 'plan@example.test');
    const seen: string[] = [];
    const off = t.deps.bus.subscribe(groupId, 'device', (e) => seen.push(e.type));
    await addMetformin(f, groupId);
    await f.call('PATCH', `/api/care/groups/${groupId}`, { consent: { missedDose: false, emergency: true } });
    off();
    expect(seen).toEqual(['plan', 'plan']);
    const g = (await (await f.call('GET', `/api/care/groups/${groupId}`)).json()) as { consent: { missedDose: boolean } };
    expect(g.consent.missedDose).toBe(false);
  });
});

describe('Better Auth is the only password and session code', () => {
  it('sets an HttpOnly cookie with SameSite', async () => {
    const f = new Family(t);
    const r = await f.call('POST', '/api/auth/sign-up/email', { name: 'Cookie', email: 'cookie@example.test', password: TEST_PASSPHRASE });
    const c = (r.headers.getSetCookie?.() ?? []).join(';').toLowerCase();
    expect(c).toContain('httponly');
    expect(c).toContain('samesite=lax');
    expect(ORIGIN.startsWith('http://')).toBe(true);
  });
});
