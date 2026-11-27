/**
 * Custom voice: a family member records their own voice reading one of Kaabil's fixed sentences,
 * and the person's phone plays that recording instead of the synthetic voice.
 *
 * Safety rules kept here:
 *  - A recording can only be saved for a sentence Kaabil will actually say for this person (the
 *    12 fixed messages, rendered with the person's name and the medicines). Nothing else can be stored.
 *  - The recorder must agree (a consent header) that the recording is stored and played to the person.
 *  - The bytes must look like audio of an allowed type, and be a sensible size.
 *  - A recording is found only by its exact sentence, so Kaabil still speaks nothing it was not written to say.
 *  - Recordings are the family member's own voice and can be deleted one by one or all at once.
 */
import { and, eq } from 'drizzle-orm';
import { MESSAGE_KEYS, render } from '@kaabil/core';
import { schema } from '@kaabil/db';
import { VOICE_CONTENT_TYPES, VOICE_MAX_BYTES, VOICE_MAX_SECONDS, type DeviceClip, type VoiceOverview } from '@kaabil/contract';
import type { LangCode } from '@kaabil/core';
import { HttpError, notFound } from './http';
import { loadGroupRow, listMedicines } from './repo';
import { newId, sha256 } from './security';
import type { Deps } from './types';

const { voiceClips } = schema;

export const MIN_CLIP_BYTES = 200;

export interface Needed {
  key: (typeof MESSAGE_KEYS)[number];
  lang: LangCode;
  text: string;
  textHash: string;
  medicineName?: string;
}

export const textHash = (lang: string, text: string) => sha256(`${lang}|${text}`).slice(0, 16);

/** Every sentence Kaabil may say to this person, in their language, with their name and medicines filled in. */
export function neededSentences(group: { lang: string; address: string }, meds: { name: string; strength: string }[]): Needed[] {
  const lang = group.lang as LangCode;
  const variants = meds.length ? meds : [{ name: '', strength: '' }];
  const out = new Map<string, Needed>();
  for (const key of MESSAGE_KEYS) {
    for (const v of variants) {
      const text = render(lang, key, { address: group.address, name: v.name, strength: v.strength });
      if (out.has(text)) continue;
      out.set(text, { key, lang, text, textHash: textHash(lang, text), ...(v.name && text.includes(v.name) ? { medicineName: v.name } : {}) });
    }
  }
  return [...out.values()];
}

async function needed(d: Deps, groupId: string) {
  const g = await loadGroupRow(d.db, groupId);
  return neededSentences(g, await listMedicines(d.db, groupId));
}

export const baseType = (ct: string | undefined) => (ct ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

const ascii = (b: Uint8Array, from: number, n: number) => String.fromCharCode(...b.slice(from, from + n));

/** Do the first bytes look like the audio type they claim to be? Stops a web page or script being stored as a "recording". */
export function looksLikeAudio(bytes: Uint8Array, type: string): boolean {
  if (bytes.length < 12) return false;
  switch (type) {
    case 'audio/wav':
    case 'audio/x-wav':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
    case 'audio/webm':
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case 'audio/ogg':
      return ascii(bytes, 0, 4) === 'OggS';
    case 'audio/mp4':
      return ascii(bytes, 4, 4) === 'ftyp';
    case 'audio/mpeg':
      return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    default:
      return false;
  }
}

export async function voiceOverview(d: Deps, groupId: string): Promise<VoiceOverview> {
  const want = await needed(d, groupId);
  const rows = await d.db
    .select({ textHash: voiceClips.textHash, lang: voiceClips.lang, contentType: voiceClips.contentType, size: voiceClips.size, createdAt: voiceClips.createdAt })
    .from(voiceClips)
    .where(eq(voiceClips.groupId, groupId));
  const have = new Map(rows.map((r) => [`${r.lang}|${r.textHash}`, r]));
  return {
    sentences: want.map((n) => {
      const r = have.get(`${n.lang}|${n.textHash}`);
      return { ...n, clip: r ? { contentType: r.contentType, size: r.size, createdAt: r.createdAt.getTime() } : null };
    }),
    maxBytes: VOICE_MAX_BYTES,
    maxSeconds: VOICE_MAX_SECONDS,
  };
}

export async function saveClip(d: Deps, groupId: string, userId: string, hash: string, contentType: string | undefined, consent: string | undefined, bytes: Uint8Array): Promise<void> {
  if (consent !== 'yes') throw new HttpError(400, 'consent_required', 'The person recording must agree that the recording is stored and played to the person');
  const type = baseType(contentType);
  if (!(VOICE_CONTENT_TYPES as readonly string[]).includes(type)) throw new HttpError(415, 'unsupported_audio', 'That kind of audio is not accepted');
  if (bytes.length < MIN_CLIP_BYTES) throw new HttpError(400, 'too_short', 'That recording is empty or too short');
  if (bytes.length > VOICE_MAX_BYTES) throw new HttpError(413, 'too_large', 'That recording is too long');
  if (!looksLikeAudio(bytes, type)) throw new HttpError(400, 'not_audio', 'That file is not the audio it says it is');
  const sentence = (await needed(d, groupId)).find((n) => n.textHash === hash);
  if (!sentence) throw notFound('Kaabil does not say that sentence to this person');

  const values = { groupId, lang: sentence.lang, textHash: hash, messageKey: sentence.key, text: sentence.text, contentType: type, audio: bytes, size: bytes.length, recordedBy: userId, consentAt: new Date(d.now()) };
  await d.db
    .insert(voiceClips)
    .values({ id: newId(), ...values })
    .onConflictDoUpdate({ target: [voiceClips.groupId, voiceClips.lang, voiceClips.textHash], set: { ...values, createdAt: new Date(d.now()) } });
  d.log.info({ groupId, key: sentence.key, size: bytes.length }, 'voice clip saved'); // never the sentence or the audio
  announce(d, groupId);
}

export async function deleteClip(d: Deps, groupId: string, hash: string): Promise<void> {
  const gone = await d.db.delete(voiceClips).where(and(eq(voiceClips.groupId, groupId), eq(voiceClips.textHash, hash))).returning({ id: voiceClips.id });
  if (!gone.length) throw notFound('No such recording');
  announce(d, groupId);
}

export async function deleteAllClips(d: Deps, groupId: string): Promise<number> {
  const gone = await d.db.delete(voiceClips).where(eq(voiceClips.groupId, groupId)).returning({ id: voiceClips.id });
  if (gone.length) announce(d, groupId);
  return gone.length;
}

export async function getClipAudio(d: Deps, groupId: string, hash: string): Promise<{ type: string; bytes: Uint8Array }> {
  const [row] = await d.db.select({ type: voiceClips.contentType, bytes: voiceClips.audio }).from(voiceClips).where(and(eq(voiceClips.groupId, groupId), eq(voiceClips.textHash, hash))).limit(1);
  if (!row) throw notFound('No such recording');
  return row;
}

/** What the person's phone may play: only recordings whose sentence Kaabil still says (a renamed medicine retires its old clip). */
export async function deviceClips(d: Deps, groupId: string): Promise<DeviceClip[]> {
  const o = await voiceOverview(d, groupId);
  return o.sentences.filter((s) => s.clip).map((s) => ({ lang: s.lang, text: s.text, textHash: s.textHash, contentType: s.clip!.contentType, size: s.clip!.size }));
}

function announce(d: Deps, groupId: string): void {
  const e = { type: 'voice' as const, at: d.now() };
  d.bus.publish(groupId, 'device', e);
  d.bus.publish(groupId, 'family', e);
}
