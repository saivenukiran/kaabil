import { describe, expect, it } from 'vitest';
import { createClient, ApiError } from './client';
import { DeviceClipListSchema, EventSchema, VOICE_CONTENT_TYPES, VoiceOverviewSchema } from './schemas';

type Call = { url: string; init?: RequestInit };
function fake(responder: (c: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder({ url, init });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sentence = { key: 'remind', lang: 'te', text: 'అమ్మ, మందు వేసుకోండి', textHash: '0123456789abcdef', clip: null };

describe('voice schemas', () => {
  it('accepts the overview and refuses an unknown field', () => {
    expect(VoiceOverviewSchema.safeParse({ sentences: [sentence], maxBytes: 1, maxSeconds: 15 }).success).toBe(true);
    expect(VoiceOverviewSchema.safeParse({ sentences: [{ ...sentence, extra: 1 }], maxBytes: 1, maxSeconds: 15 }).success).toBe(false);
  });
  it('needs a 16-character hash and a fixed message key', () => {
    expect(VoiceOverviewSchema.safeParse({ sentences: [{ ...sentence, textHash: 'short' }], maxBytes: 1, maxSeconds: 1 }).success).toBe(false);
    expect(VoiceOverviewSchema.safeParse({ sentences: [{ ...sentence, key: 'say_anything' }], maxBytes: 1, maxSeconds: 1 }).success).toBe(false);
  });
  it('lists only recordings, with the sentence to match', () => {
    expect(DeviceClipListSchema.safeParse({ clips: [{ lang: 'te', text: 'x', textHash: '0123456789abcdef', contentType: 'audio/wav', size: 10 }] }).success).toBe(true);
  });
  it('knows the voice event and the audio types it will accept', () => {
    expect(EventSchema.safeParse({ type: 'voice', at: 1 }).success).toBe(true);
    expect(VOICE_CONTENT_TYPES).toContain('audio/wav');
    expect(VOICE_CONTENT_TYPES).not.toContain('text/html');
  });
});

describe('voice client', () => {
  it('uploads a recording with its type and the recorder\'s consent', async () => {
    const { f, calls } = fake(() => new Response(null, { status: 204 }));
    const c = createClient({ fetch: f });
    await c.family.uploadClip('g1', '0123456789abcdef', new Blob([new Uint8Array(300)], { type: 'audio/wav' }), true);
    const h = calls[0]?.init?.headers as Record<string, string>;
    expect(calls[0]?.url).toBe('/api/care/groups/g1/voice/0123456789abcdef');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(h['content-type']).toBe('audio/wav');
    expect(h['x-voice-consent']).toBe('yes');
  });

  it('sends no consent header when consent was not given, so the server refuses', async () => {
    const { f, calls } = fake(() => json({ error: { code: 'consent_required', message: 'The person recording must agree' } }, 400));
    const c = createClient({ fetch: f });
    await expect(c.family.uploadClip('g1', '0123456789abcdef', new Blob([new Uint8Array(300)], { type: 'audio/wav' }), false)).rejects.toMatchObject({ status: 400, code: 'consent_required' });
    expect((calls[0]?.init?.headers as Record<string, string>)['x-voice-consent']).toBeUndefined();
  });

  it('reads the overview and downloads a clip as a blob', async () => {
    const { f } = fake((c) => (c.url.endsWith('/audio') ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/wav' } }) : json({ sentences: [sentence], maxBytes: 1_500_000, maxSeconds: 15 })));
    const c = createClient({ fetch: f });
    expect((await c.family.voice('g1')).sentences).toHaveLength(1);
    const blob = await c.family.clipAudio('g1', '0123456789abcdef');
    expect(blob.size).toBe(3);
  });

  it('lets the phone list and fetch clips with its token, and not without one', async () => {
    const { f, calls } = fake((c) => (c.url.endsWith('/audio') ? new Response(new Uint8Array([9]), { headers: { 'content-type': 'audio/wav' } }) : json({ clips: [] })));
    const c = createClient({ fetch: f });
    await expect(c.device.voiceClips()).rejects.toBeInstanceOf(ApiError);
    c.device.setToken('t'.repeat(43));
    expect((await c.device.voiceClips()).clips).toEqual([]);
    await c.device.clipAudio('0123456789abcdef');
    expect((calls.at(-1)?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${'t'.repeat(43)}`);
  });

  it('turns a server error on download into an ApiError', async () => {
    const { f } = fake(() => json({ error: { code: 'not_found', message: 'No such recording' } }, 404));
    await expect(createClient({ fetch: f }).family.clipAudio('g1', '0123456789abcdef')).rejects.toMatchObject({ status: 404 });
  });
});
