/**
 * Turns a raw recording from a phone's microphone into a small, even clip that every phone can play:
 * mono, 16 kHz, trimmed of the silence at both ends, brought to a steady loudness, written as
 * 16-bit WAV. Speech does not need more, and a 5 second sentence comes to about 160 KB.
 *
 * The signal work is pure (it takes and returns sample arrays), so it is tested without a browser.
 * `processRecording` is the thin browser part that decodes the recorded blob first.
 */

export const TARGET_RATE = 16_000;

export interface ProcessOptions {
  /** Anything quieter than this, relative to the loudest sample, counts as silence at the ends. */
  silenceDb?: number;
  /** Silence kept around the speech so it does not sound clipped. */
  padMs?: number;
  /** The loudest sample is brought to this level (dB below full scale, so use a negative number). */
  peakDb?: number;
  /** Never boost by more than this factor, so a recording of room noise is not turned into loud noise. */
  maxGain?: number;
  maxSeconds?: number;
}

export interface ProcessReport {
  inputMs: number;
  outputMs: number;
  trimmedMs: number;
  gainDb: number;
}

export type ProcessResult = { ok: true; samples: Float32Array; sampleRate: number; report: ProcessReport } | { ok: false; reason: 'silent' | 'too_long' | 'empty' };

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(g);

export function toMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += (ch[i] ?? 0) / channels.length;
  return out;
}

export function peakOf(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i] ?? 0));
  return p;
}

/** Linear resampling. Good enough for speech, with no dependency. Averages when going down so high tones do not fold back. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = i * ratio;
    const end = Math.min(samples.length, start + ratio);
    if (ratio > 1) {
      let sum = 0;
      let n = 0;
      for (let j = Math.floor(start); j < end; j++) {
        sum += samples[j] ?? 0;
        n++;
      }
      out[i] = n ? sum / n : 0;
    } else {
      const j = Math.floor(start);
      const frac = start - j;
      out[i] = (samples[j] ?? 0) * (1 - frac) + (samples[Math.min(j + 1, samples.length - 1)] ?? 0) * frac;
    }
  }
  return out;
}

/** Cuts leading and trailing silence, keeping `padMs` of it. Works on 10 ms windows so a single click is not speech. */
export function trimSilence(samples: Float32Array, sampleRate: number, silenceDb: number, padMs: number): Float32Array {
  const peak = peakOf(samples);
  if (peak === 0) return samples.slice(0, 0);
  const threshold = peak * dbToGain(silenceDb);
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const loud = (w: number) => {
    let sum = 0;
    const from = w * win;
    const to = Math.min(samples.length, from + win);
    for (let i = from; i < to; i++) sum += (samples[i] ?? 0) ** 2;
    return Math.sqrt(sum / Math.max(1, to - from)) >= threshold / 2;
  };
  const windows = Math.ceil(samples.length / win);
  let first = 0;
  while (first < windows && !loud(first)) first++;
  let last = windows - 1;
  while (last > first && !loud(last)) last--;
  if (first >= windows) return samples.slice(0, 0);
  const pad = Math.round((sampleRate * padMs) / 1000);
  return samples.slice(Math.max(0, first * win - pad), Math.min(samples.length, (last + 1) * win + pad));
}

/** Brings the loudest sample to `peakDb`, never boosting by more than `maxGain`. Returns the gain used. */
export function normalizePeak(samples: Float32Array, peakDb: number, maxGain: number): { samples: Float32Array; gain: number } {
  const peak = peakOf(samples);
  if (peak === 0) return { samples, gain: 1 };
  const gain = Math.min(maxGain, dbToGain(peakDb) / peak);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, (samples[i] ?? 0) * gain));
  return { samples: out, gain };
}

/** 16-bit PCM WAV, mono. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}

/** The whole pipeline on decoded samples. */
export function processSamples(channels: readonly Float32Array[], sampleRate: number, opts: ProcessOptions = {}): ProcessResult {
  const maxSeconds = opts.maxSeconds ?? 15;
  const mono = toMono(channels);
  if (mono.length === 0) return { ok: false, reason: 'empty' };
  if (mono.length / sampleRate > maxSeconds + 1) return { ok: false, reason: 'too_long' };
  if (peakOf(mono) < 0.005) return { ok: false, reason: 'silent' }; // about -46 dB: nothing was said

  const trimmed = trimSilence(mono, sampleRate, opts.silenceDb ?? -45, opts.padMs ?? 80);
  if (trimmed.length === 0) return { ok: false, reason: 'silent' };
  const small = resample(trimmed, sampleRate, TARGET_RATE);
  const { samples, gain } = normalizePeak(small, opts.peakDb ?? -1, opts.maxGain ?? 12);
  const ms = (n: number, r: number) => Math.round((n / r) * 1000);
  return {
    ok: true,
    samples,
    sampleRate: TARGET_RATE,
    report: { inputMs: ms(mono.length, sampleRate), outputMs: ms(samples.length, TARGET_RATE), trimmedMs: ms(mono.length - trimmed.length, sampleRate), gainDb: Math.round(gainToDb(gain) * 10) / 10 },
  };
}

export type RecordingResult = { ok: true; wav: Blob; report: ProcessReport } | { ok: false; reason: 'silent' | 'too_long' | 'empty' | 'undecodable' };

/** Browser part: decode what the recorder produced, process it, and hand back a WAV. */
export async function processRecording(recording: Blob, opts: ProcessOptions = {}): Promise<RecordingResult> {
  const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return { ok: false, reason: 'undecodable' };
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await recording.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const r = processSamples(channels, buffer.sampleRate, opts);
    if (!r.ok) return r;
    return { ok: true, wav: new Blob([encodeWav16(r.samples, r.sampleRate) as unknown as BlobPart], { type: 'audio/wav' }), report: r.report };
  } catch {
    return { ok: false, reason: 'undecodable' };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
