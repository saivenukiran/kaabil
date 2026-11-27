import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VOICE_MAX_BYTES } from '@kaabil/contract';
import { addMetformin, familyWithGroup, makeApp, ORIGIN, pairPhone, phone, type Family, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

/** The bytes of a tiny, valid-looking WAV file. */
function wav(size = 1000, fill = 7): Uint8Array {
  const b = new Uint8Array(size).fill(fill);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WAVE'].map((c) => c.charCodeAt(0)), 8);
  return b;
}

type Sentence = { key: string; text: string; textHash: string; medicineName?: string; clip: null | { size: number } };
const overview = async (f: Family, groupId: string) => (await (await f.call('GET', `/api/care/groups/${groupId}/voice`)).json()) as { sentences: Sentence[]; maxBytes: number; maxSeconds: number };

/** A raw (non-JSON) upload as the signed-in family member. */
const put = (t: TestApp, f: Family, groupId: string, hash: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  t.app.request(`/api/care/groups/${groupId}/voice/${hash}`, { method: 'PUT', headers: { cookie: f.cookie, origin: ORIGIN, 'content-type': 'audio/wav', 'x-voice-consent': 'yes', ...headers }, body });

async function setup(email: string) {
  const { f, groupId } = await familyWithGroup(t, email);
  await addMetformin(f, groupId);
  const token = await pairPhone(t, f, groupId);
  const o = await overview(f, groupId);
  const remind = o.sentences.find((s) => s.key === 'remind')!;
  return { f, groupId, token, o, remind };
}

describe('which sentences can be recorded', () => {
  it('lists the fixed messages with the person and the medicine filled in, each with a short hash', async () => {
    const { o, remind } = await setup('voice1@example.test');
    expect(o.sentences.map((s) => s.key)).toEqual(expect.arrayContaining(['remind', 'confirm_log', 'logged', 'emergency', 'help']));
    expect(remind.text).toContain('అమ్మ');
    expect(remind.text).toContain('Metformin');
    expect(remind.medicineName).toBe('Metformin');
    expect(remind.textHash).toMatch(/^[0-9a-f]{16}$/);
    expect(o.sentences.every((s) => s.clip === null)).toBe(true);
    expect(o.maxBytes).toBe(VOICE_MAX_BYTES);
  });

  it('has no duplicate sentences', async () => {
    const { o } = await setup('voice2@example.test');
    expect(new Set(o.sentences.map((s) => s.text)).size).toBe(o.sentences.length);
  });
});

describe('saving a recording', () => {
  it('needs the recorder\'s consent', async () => {
    const { f, groupId, remind } = await setup('voice3@example.test');
    const r = await put(t, f, groupId, remind.textHash, wav(), { 'x-voice-consent': 'no' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('consent_required');
    const none = await t.app.request(`/api/care/groups/${groupId}/voice/${remind.textHash}`, { method: 'PUT', headers: { cookie: f.cookie, origin: ORIGIN, 'content-type': 'audio/wav' }, body: wav() });
    expect(none.status).toBe(400);
  });

  it('saves it, shows it to the family, and gives the phone the sentence and the audio', async () => {
    const { f, groupId, token, remind } = await setup('voice4@example.test');
    const seen: string[] = [];
    const off = t.deps.bus.subscribe(groupId, 'device', (e) => seen.push(e.type));
    const audio = wav(1234, 9);
    expect((await put(t, f, groupId, remind.textHash, audio)).status).toBe(204);
    off();
    expect(seen).toEqual(['voice']);

    const after = await overview(f, groupId);
    expect(after.sentences.find((s) => s.textHash === remind.textHash)?.clip?.size).toBe(1234);

    const list = (await (await phone(t, token)('GET', '/api/device/voice')).json()) as { clips: { text: string; textHash: string; contentType: string }[] };
    expect(list.clips).toHaveLength(1);
    expect(list.clips[0]).toMatchObject({ text: remind.text, textHash: remind.textHash, contentType: 'audio/wav' });

    const bytes = await phone(t, token)('GET', `/api/device/voice/${remind.textHash}/audio`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('audio/wav');
    expect(bytes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(audio);

    const mine = await f.call('GET', `/api/care/groups/${groupId}/voice/${remind.textHash}/audio`);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(audio);
  });

  it('replaces an earlier recording of the same sentence', async () => {
    const { f, groupId, remind } = await setup('voice5@example.test');
    await put(t, f, groupId, remind.textHash, wav(500));
    await put(t, f, groupId, remind.textHash, wav(900));
    const o = await overview(f, groupId);
    expect(o.sentences.filter((s) => s.clip)).toHaveLength(1);
    expect(o.sentences.find((s) => s.textHash === remind.textHash)?.clip?.size).toBe(900);
  });

  it('refuses a sentence Kaabil does not say to this person', async () => {
    const { f, groupId } = await setup('voice6@example.test');
    const r = await put(t, f, groupId, '0123456789abcdef', wav());
    expect(r.status).toBe(404);
  });

  it('refuses things that are not audio, are the wrong type, empty or too large', async () => {
    const { f, groupId, remind } = await setup('voice7@example.test');
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>'.padEnd(400, ' '));
    expect((await put(t, f, groupId, remind.textHash, html)).status).toBe(400); // claims wav, is html
    expect((await put(t, f, groupId, remind.textHash, wav(), { 'content-type': 'text/html' })).status).toBe(415);
    expect((await put(t, f, groupId, remind.textHash, wav(), { 'content-type': 'application/octet-stream' })).status).toBe(415);
    expect((await put(t, f, groupId, remind.textHash, wav(50))).status).toBe(400);
    expect((await put(t, f, groupId, remind.textHash, wav(VOICE_MAX_BYTES + 10))).status).toBe(413);
    expect((await overview(f, groupId)).sentences.some((s) => s.clip)).toBe(false);
  });

  it('accepts the other allowed audio types when their first bytes match', async () => {
    const { f, groupId, remind } = await setup('voice8@example.test');
    const webm = new Uint8Array(400).fill(1);
    webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);
    expect((await put(t, f, groupId, remind.textHash, webm, { 'content-type': 'audio/webm;codecs=opus' })).status).toBe(204);
    const ogg = new Uint8Array(400).fill(1);
    ogg.set([...'OggS'].map((c) => c.charCodeAt(0)), 0);
    expect((await put(t, f, groupId, remind.textHash, ogg, { 'content-type': 'audio/ogg' })).status).toBe(204);
    // a webm claiming to be ogg is refused
    expect((await put(t, f, groupId, remind.textHash, webm, { 'content-type': 'audio/ogg' })).status).toBe(400);
  });
});

describe('who can use it', () => {
  it('keeps another family out, and a phone off the family routes', async () => {
    const a = await setup('voice9a@example.test');
    const b = await setup('voice9b@example.test');
    await put(t, a.f, a.groupId, a.remind.textHash, wav());
    expect((await b.f.call('GET', `/api/care/groups/${a.groupId}/voice`)).status).toBe(404);
    expect((await put(t, b.f, a.groupId, a.remind.textHash, wav())).status).toBe(404);
    expect((await b.f.call('GET', `/api/care/groups/${a.groupId}/voice/${a.remind.textHash}/audio`)).status).toBe(404);
    // another family's phone cannot fetch this family's recording
    expect((await phone(t, b.token)('GET', `/api/device/voice/${a.remind.textHash}/audio`)).status).toBe(404);
    // a phone token on a family route, and no session at all
    expect((await t.app.request(`/api/care/groups/${a.groupId}/voice`, { headers: { authorization: `Bearer ${a.token}` } })).status).toBe(401);
    expect((await t.app.request('/api/device/voice')).status).toBe(401);
  });

  it('refuses an upload from another origin', async () => {
    const { f, groupId, remind } = await setup('voice10@example.test');
    expect((await put(t, f, groupId, remind.textHash, wav(), { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('stops a revoked phone from fetching recordings', async () => {
    const { f, groupId, token, remind } = await setup('voice11@example.test');
    await put(t, f, groupId, remind.textHash, wav());
    const g = (await (await f.call('GET', `/api/care/groups/${groupId}`)).json()) as { devices: { id: string }[] };
    await f.call('DELETE', `/api/care/groups/${groupId}/devices/${g.devices[0]?.id}`);
    expect((await phone(t, token)('GET', `/api/device/voice/${remind.textHash}/audio`)).status).toBe(401);
  });
});

describe('deleting and keeping recordings in step with the plan', () => {
  it('deletes one recording, then all of them', async () => {
    const { f, groupId, token, o } = await setup('voice12@example.test');
    const [first, second] = [o.sentences[0]!, o.sentences[1]!];
    await put(t, f, groupId, first.textHash, wav());
    await put(t, f, groupId, second.textHash, wav());
    expect((await f.call('DELETE', `/api/care/groups/${groupId}/voice/${first.textHash}`)).status).toBe(200);
    expect((await f.call('DELETE', `/api/care/groups/${groupId}/voice/${first.textHash}`)).status).toBe(404);
    expect(((await (await phone(t, token)('GET', '/api/device/voice')).json()) as { clips: unknown[] }).clips).toHaveLength(1);
    expect((await f.call('DELETE', `/api/care/groups/${groupId}/voice`)).status).toBe(200);
    expect(((await (await phone(t, token)('GET', '/api/device/voice')).json()) as { clips: unknown[] }).clips).toHaveLength(0);
    const rows = await t.deps.db.execute(`select count(*)::int as n from voice_clips where group_id = '${groupId}'`);
    expect(JSON.stringify(rows)).toContain('"n":0');
  });

  it('retires a recording when the sentence changes, so the phone never plays an out-of-date one', async () => {
    const { f, groupId, token, remind } = await setup('voice13@example.test');
    await put(t, f, groupId, remind.textHash, wav());
    expect(((await (await phone(t, token)('GET', '/api/device/voice')).json()) as { clips: unknown[] }).clips).toHaveLength(1);
    await f.call('POST', `/api/care/groups/${groupId}/medicines`, { line: 'Metformin 850, 1-0-1' }); // strength is in the sentence
    expect(((await (await phone(t, token)('GET', '/api/device/voice')).json()) as { clips: unknown[] }).clips).toHaveLength(0);
    expect((await phone(t, token)('GET', `/api/device/voice/${remind.textHash}/audio`)).status).toBe(404);
  });

  it('removes the recordings with the group', async () => {
    const { f, groupId, remind } = await setup('voice14@example.test');
    await put(t, f, groupId, remind.textHash, wav());
    await t.deps.db.execute(`delete from organization where id = '${groupId}'`);
    const rows = await t.deps.db.execute(`select count(*)::int as n from voice_clips where group_id = '${groupId}'`);
    expect(JSON.stringify(rows)).toContain('"n":0');
  });
});
