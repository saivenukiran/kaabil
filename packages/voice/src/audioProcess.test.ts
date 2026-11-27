import { describe, expect, it } from 'vitest';
import { dbToGain, encodeWav16, normalizePeak, peakOf, processSamples, resample, toMono, trimSilence } from './audioProcess';

const RATE = 48_000;
/** A tone of `ms` milliseconds at amplitude `amp`. */
const tone = (ms: number, amp: number, rate = RATE, hz = 440) => Float32Array.from({ length: Math.round((rate * ms) / 1000) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const silence = (ms: number, rate = RATE) => new Float32Array(Math.round((rate * ms) / 1000));
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('mixing and resampling', () => {
  it('mixes two channels down to one', () => {
    const m = toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)]);
    expect([...m]).toEqual([0.5, 0.5]);
  });
  it('changes the length by the ratio of the rates', () => {
    expect(resample(tone(1000, 0.5, 48_000), 48_000, 16_000).length).toBe(16_000);
    expect(resample(tone(1000, 0.5, 8_000), 8_000, 16_000).length).toBe(16_000);
  });
  it('keeps a tone\'s level when going down', () => {
    const out = resample(tone(500, 0.5, 48_000, 200), 48_000, 16_000);
    expect(peakOf(out)).toBeGreaterThan(0.45);
    expect(peakOf(out)).toBeLessThanOrEqual(0.5);
  });
  it('leaves samples alone when the rate is already right', () => {
    const s = tone(100, 0.3, 16_000);
    expect(resample(s, 16_000, 16_000)).toBe(s);
  });
});

describe('trimming silence', () => {
  it('cuts the quiet at both ends and keeps the padding', () => {
    const speech = tone(500, 0.6);
    const out = trimSilence(join(silence(800), speech, silence(900)), RATE, -45, 80);
    const ms = (out.length / RATE) * 1000;
    expect(ms).toBeGreaterThan(500 + 100);
    expect(ms).toBeLessThan(500 + 2 * 80 + 40);
  });
  it('is not fooled by a short click in the silence', () => {
    const click = tone(2, 0.9);
    const out = trimSilence(join(silence(500), click, silence(500), tone(300, 0.5), silence(500)), RATE, -45, 0);
    expect((out.length / RATE) * 1000).toBeGreaterThan(300);
  });
  it('returns nothing for pure silence', () => {
    expect(trimSilence(silence(1000), RATE, -45, 80)).toHaveLength(0);
  });
});

describe('loudness', () => {
  it('brings the peak to the target', () => {
    const { samples, gain } = normalizePeak(tone(200, 0.25), -1, 12);
    expect(peakOf(samples)).toBeCloseTo(dbToGain(-1), 2);
    expect(gain).toBeGreaterThan(1);
  });
  it('lowers a clipped recording', () => {
    expect(normalizePeak(tone(200, 1), -1, 12).gain).toBeLessThan(1);
  });
  it('never boosts by more than the limit, so noise is not made loud', () => {
    const { samples, gain } = normalizePeak(tone(200, 0.01), -1, 12);
    expect(gain).toBe(12);
    expect(peakOf(samples)).toBeLessThan(0.2);
  });
});

describe('the WAV file', () => {
  it('has a valid header and the right size', () => {
    const wav = encodeWav16(tone(100, 0.5, 16_000), 16_000);
    const text = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(text(36, 4)).toBe('data');
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(16_000); // sample rate
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint16(34, true)).toBe(16); // bits
    expect(wav.length).toBe(44 + 1600 * 2);
    expect(v.getUint32(40, true)).toBe(1600 * 2);
  });
  it('clips safely and does not wrap around', () => {
    const wav = encodeWav16(Float32Array.of(2, -2, 0), 16_000);
    const v = new DataView(wav.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
});

describe('the whole pipeline', () => {
  it('trims, resamples and evens out a quiet recording with silence around it', () => {
    const r = processSamples([join(silence(700), tone(2000, 0.08), silence(700))], RATE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sampleRate).toBe(16_000);
    expect(r.report.inputMs).toBe(3400);
    expect(r.report.outputMs).toBeGreaterThan(2000);
    expect(r.report.outputMs).toBeLessThan(2300);
    expect(r.report.trimmedMs).toBeGreaterThan(1000);
    expect(r.report.gainDb).toBeGreaterThan(10);
    expect(peakOf(r.samples)).toBeGreaterThan(0.85);
  });
  it('refuses a recording where nothing was said', () => {
    expect(processSamples([silence(2000)], RATE)).toEqual({ ok: false, reason: 'silent' });
    expect(processSamples([join(silence(1000), tone(1000, 0.001))], RATE)).toEqual({ ok: false, reason: 'silent' });
  });
  it('refuses an empty one and one that is far too long', () => {
    expect(processSamples([new Float32Array(0)], RATE)).toEqual({ ok: false, reason: 'empty' });
    expect(processSamples([tone(20_000, 0.5, 8_000)], 8_000, { maxSeconds: 15 })).toEqual({ ok: false, reason: 'too_long' });
  });
  it('keeps a five second sentence small', () => {
    const r = processSamples([tone(5000, 0.4)], RATE);
    expect(r.ok && encodeWav16(r.samples, r.sampleRate).length).toBeLessThan(170_000);
  });
});
