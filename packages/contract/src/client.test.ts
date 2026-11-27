import { describe, expect, it } from 'vitest';
import { ApiError, createClient } from './client';

type Call = { url: string; init?: RequestInit };

function fake(responder: (c: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return responder(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the family client', () => {
  it('sends the typed medicine line and validates the answer', async () => {
    const { f, calls } = fake(() => json({ id: 'm1', name: 'Metformin', strength: '500', times: ['08:00', '21:00'] }));
    const c = createClient({ fetch: f });
    const m = await c.family.addMedicine('g1', { line: 'Metformin 500, 1-0-1' });
    expect(m.times).toEqual(['08:00', '21:00']);
    expect(calls[0]?.url).toBe('/api/care/groups/g1/medicines');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ line: 'Metformin 500, 1-0-1' });
  });

  it('turns an error body into an ApiError', async () => {
    const { f } = fake(() => json({ error: { code: 'not_found', message: 'No such group' } }, 404));
    const c = createClient({ fetch: f });
    await expect(c.family.group('nope')).rejects.toMatchObject({ status: 404, code: 'not_found', message: 'No such group' });
  });

  it('fails loudly when the server drifts from the contract', async () => {
    const { f } = fake(() => json({ id: 'm1', name: 'X' }));
    const c = createClient({ fetch: f });
    await expect(c.family.addMedicine('g1', { line: 'x' })).rejects.toThrow();
  });

  it('encodes ids in paths', async () => {
    const { f, calls } = fake(() => json({ ok: true }));
    await createClient({ fetch: f }).family.removeMedicine('a/b', 'c d');
    expect(calls[0]?.url).toBe('/api/care/groups/a%2Fb/medicines/c%20d');
  });
});

describe('the device client', () => {
  it('refuses to call before pairing', async () => {
    const { f } = fake(() => json({}));
    await expect(createClient({ fetch: f }).device.plan()).rejects.toBeInstanceOf(ApiError);
  });

  it('keeps the token from pairing and sends it as a bearer header', async () => {
    const token = 'x'.repeat(40);
    const { f, calls } = fake((c) =>
      c.url.endsWith('/pair')
        ? json({ deviceToken: token, groupId: 'g1' })
        : json({ groupId: 'g1', person: { name: 'Amma', address: 'అమ్మ' }, lang: 'te', consent: { missedDose: true, emergency: true }, medicines: [] }),
    );
    const c = createClient({ fetch: f });
    await c.device.pair('12345678', 'Amma phone');
    await c.device.plan();
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${token}`);
  });

  it('reports a dose that was refused as consent-free alert result shapes', async () => {
    const { f } = fake(() => json({ created: false, reason: 'no_consent' }));
    const c = createClient({ fetch: f, deviceToken: 'y'.repeat(40) });
    const r = await c.device.postAlert({ kind: 'missed_dose', atMs: 1 });
    expect(r).toEqual({ created: false, reason: 'no_consent' });
  });
});
