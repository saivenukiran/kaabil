import { describe, expect, it } from 'vitest';
import { formatReport, pickVoice, verdictFor, voicesFor, type VoiceFacts, type VoiceInfo } from './voiceReport';

const TE = { code: 'te', name: 'Telugu', locale: 'te-IN' };
const EN = { code: 'en', name: 'English', locale: 'en-IN' };

const facts = (over: Partial<VoiceFacts> = {}): VoiceFacts => ({
  secureContext: true,
  synthesis: true,
  recognition: true,
  voices: [],
  userAgent: 'TestBrowser/1.0',
  ...over,
});

describe('pickVoice', () => {
  it('finds nothing when there are no voices', () => {
    expect(pickVoice([], 'te-IN')).toBeUndefined();
  });

  it('prefers the exact locale over another voice of the same language', () => {
    const voices: VoiceInfo[] = [{ name: 'A', lang: 'te-US' }, { name: 'B', lang: 'te-IN' }];
    expect(pickVoice(voices, 'te-IN')?.name).toBe('B');
  });

  it('falls back to the same language when the region differs', () => {
    expect(pickVoice([{ name: 'A', lang: 'te-US' }], 'te-IN')?.name).toBe('A');
  });

  it('reads the underscore tags some Android browsers report', () => {
    expect(pickVoice([{ name: 'A', lang: 'te_IN' }], 'te-IN')?.name).toBe('A');
  });

  it('matches whole language codes, not prefixes ("tet" is not Telugu)', () => {
    expect(pickVoice([{ name: 'Tetum', lang: 'tet-TL' }], 'te-IN')).toBeUndefined();
  });

  it('ignores other languages', () => {
    expect(pickVoice([{ name: 'Hindi', lang: 'hi-IN' }], 'te-IN')).toBeUndefined();
  });
});

describe('voicesFor', () => {
  it('lists exact matches first, then the rest of the language', () => {
    const voices: VoiceInfo[] = [{ name: 'A', lang: 'en-US' }, { name: 'B', lang: 'en-IN' }, { name: 'C', lang: 'hi-IN' }];
    expect(voicesFor(voices, 'en-IN').map((v) => v.name)).toEqual(['B', 'A']);
  });
});

describe('verdictFor', () => {
  it('speaks and listens when a voice, recognition and a secure page exist', () => {
    const v = verdictFor(facts({ voices: [{ name: 'Telugu', lang: 'te-IN' }] }), TE);
    expect(v.speaks).toBe(true);
    expect(v.listens).toBe(true);
    expect(v.notes).toEqual([]);
  });

  it('says what happens when no voice is installed', () => {
    const v = verdictFor(facts(), TE);
    expect(v.speaks).toBe(false);
    expect(v.notes.join(' ')).toContain('te-IN');
    expect(v.notes.join(' ')).toContain('shown large');
  });

  it('does not speak when the browser has no speech output, even if voices are listed', () => {
    const v = verdictFor(facts({ synthesis: false, voices: [{ name: 'Telugu', lang: 'te-IN' }] }), TE);
    expect(v.speaks).toBe(false);
  });

  it('does not listen without recognition, and points to the buttons', () => {
    const v = verdictFor(facts({ recognition: false }), EN);
    expect(v.listens).toBe(false);
    expect(v.notes.join(' ')).toContain('buttons');
  });

  it('does not listen on an insecure page', () => {
    const v = verdictFor(facts({ secureContext: false }), EN);
    expect(v.listens).toBe(false);
    expect(v.notes.join(' ')).toContain('https');
  });
});

describe('formatReport', () => {
  it('has one line per language and states the result plainly', () => {
    const text = formatReport(facts({ voices: [{ name: 'Google Telugu', lang: 'te-IN' }] }), [TE, EN]);
    expect(text).toContain('Kaabil voice check');
    expect(text).toContain('Telugu (te-IN): speaks yes, voice "Google Telugu" (te-IN); listens yes');
    expect(text).toContain('English (en-IN): speaks no, no voice; listens yes');
  });

  it('cuts a very long browser string', () => {
    const text = formatReport(facts({ userAgent: 'x'.repeat(500) }), [TE]);
    expect(text.split('\n')[1]?.length).toBeLessThan(160);
  });
});
