/**
 * Safety properties, checked on thousands of generated inputs instead of hand-picked ones.
 * The generator is seeded, so a failure reproduces exactly. Each property states a rule from
 * the PRD: a dose is logged only after a claim and an explicit Yes; uncertainty is never Yes;
 * any No beats any Yes; a slot is recorded once; alerts need consent.
 */
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../i18n/languages';
import type { WordLists } from '../i18n/language';
import type { AppState } from '../types';
import { interpret, normalize, type Intent } from '../voice/words';
import { advance, hear, initialState, press, silence, sos } from './engine';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

const words = (k: keyof WordLists) => LANGUAGES.flatMap((l) => l.words[k]).flatMap((w) => normalize(w).split(' ')).filter(Boolean);
const YES = words('yes');
const NO = words('no');
const CLAIM = words('claim');
const LATER = words('later');
const SUFFIX = LANGUAGES.flatMap((l) => l.words.noSuffix).map((w) => normalize(w));
const CONTROL = [...words('stop'), ...words('help'), ...words('repeat'), ...words('emergency')];

const NOISE = ['banana', 'pillow', 'amma', 'good', 'morning', 'water', 'today', '123'];
const NEGATED_VERB = SUFFIX.map((s) => `abc${s}`);

/** The rules written again, independently of `interpret`, from the lists alone. */
function oracle(text: string) {
  const tokens = normalize(text).split(' ').filter(Boolean);
  const has = (list: string[]) => tokens.some((t) => list.includes(t));
  return {
    negated: has(NO) || tokens.some((t) => SUFFIX.some((s) => t.endsWith(s))),
    yes: has(YES),
    claim: has(CLAIM),
    later: has(LATER),
    control: has(CONTROL) || tokens.join(' ').includes('chest pain'),
  };
}

const sentence = (r: () => number, vocab: readonly string[], max = 6) => Array.from({ length: 1 + Math.floor(r() * max) }, () => pick(r, vocab)).join(' ');

const VOCAB_NO_CONTROL = [...YES, ...NO, ...CLAIM, ...LATER, ...NOISE, ...NEGATED_VERB];
const isAct = (i: Intent) => i === 'yes' || i === 'claim';

describe('word rules: properties over generated sentences', () => {
  const r = rng(20261127);
  const texts = Array.from({ length: 4000 }, () => sentence(r, VOCAB_NO_CONTROL));

  it('never reads a sentence that has a No as Yes or as a claim', () => {
    for (const t of texts) {
      if (oracle(t).negated) expect(isAct(interpret(t)), t).toBe(false);
    }
  });

  it('never reads a sentence as Yes or claim unless it contains a Yes or claim word', () => {
    for (const t of texts) {
      const o = oracle(t);
      if (isAct(interpret(t))) expect(o.yes || o.claim, t).toBe(true);
    }
  });

  it('calls a sentence with both a Yes and a No "mixed", and never acts on it', () => {
    for (const t of texts) {
      const o = oracle(t);
      if (o.negated && o.yes) expect(interpret(t), t).toBe('mixed');
    }
  });

  it('never reads random characters as Yes or claim without a matching word', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz ఀఁంఃఅఆఇఈఉఊఎఏఐఒఓఔకఖగఘచఛజటడతదనపబమయరలవశసహ‌ 0123456789';
    const rr = rng(7);
    for (let i = 0; i < 6000; i++) {
      const t = Array.from({ length: 1 + Math.floor(rr() * 14) }, () => alphabet[Math.floor(rr() * alphabet.length)]).join('');
      const o = oracle(t);
      if (!o.control && isAct(interpret(t))) expect(o.yes || o.claim, t).toBe(true);
    }
  });

  it('treats empty and whitespace-only input as unclear', () => {
    for (const t of ['', ' ', '   ', '\n', '‌‍', '...']) expect(interpret(t), JSON.stringify(t)).toBe('unclear');
  });
});

type Event =
  | { kind: 'hear'; text: string }
  | { kind: 'press'; value: 'yes' | 'no' }
  | { kind: 'silence' }
  | { kind: 'advance'; minutes: number }
  | { kind: 'sos' };

const VOCAB_ALL = [...VOCAB_NO_CONTROL, ...CONTROL];

function randomEvent(r: () => number): Event {
  const x = r();
  if (x < 0.4) return { kind: 'hear', text: sentence(r, VOCAB_ALL, 4) };
  if (x < 0.55) return { kind: 'press', value: r() < 0.5 ? 'yes' : 'no' };
  if (x < 0.65) return { kind: 'silence' };
  if (x < 0.68) return { kind: 'sos' };
  return { kind: 'advance', minutes: pick(r, [1, 2, 5, 10, 11, 20, 90, 4 * 60, 13 * 60]) };
}

function apply(s: AppState, e: Event): AppState {
  switch (e.kind) {
    case 'hear': return hear(s, e.text);
    case 'press': return press(s, e.value);
    case 'silence': return silence(s);
    case 'sos': return sos(s);
    case 'advance': return advance(s, e.minutes);
  }
}

const START = new Date(2026, 10, 27, 12).getTime();

function run(seed: number, consent: { missedDose: boolean; emergency: boolean }, check: (before: AppState, e: Event, after: AppState) => void): void {
  const r = rng(seed);
  let s: AppState = { ...initialState(START), consent };
  for (let i = 0; i < 60; i++) {
    const e = randomEvent(r);
    const next = apply(s, e);
    check(s, e, next);
    s = next;
  }
}

describe('engine: invariants over random conversations', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => 1000 + i);

  it('records a dose only after a claim and an explicit Yes, once per slot', () => {
    for (const seed of seeds) {
      run(seed, { missedDose: true, emergency: true }, (before, e, after) => {
        const grew = after.doses.length - before.doses.length;
        expect(grew, `seed ${seed}`).toBeLessThanOrEqual(1);
        if (grew === 1) {
          expect(before.session?.phase, `seed ${seed}: dose recorded outside confirming`).toBe('confirming');
          const yes = e.kind === 'press' ? e.value === 'yes' : e.kind === 'hear' && interpret(e.text) === 'yes';
          expect(yes, `seed ${seed}: dose recorded without an explicit Yes (${JSON.stringify(e)})`).toBe(true);
        }
        const ids = after.doses.map((d) => d.slotId);
        expect(new Set(ids).size, `seed ${seed}: a slot was recorded twice`).toBe(ids.length);
        expect(after.doses.length).toBeLessThanOrEqual(after.handled.length);
      });
    }
  });

  it('creates at most one missed-dose alert per slot', () => {
    for (const seed of seeds) {
      run(seed, { missedDose: true, emergency: true }, (_b, _e, after) => {
        const slots = after.alerts.filter((a) => a.kind === 'missed_dose').map((a) => a.slotId);
        expect(new Set(slots).size, `seed ${seed}`).toBe(slots.length);
      });
    }
  });

  it('creates no family alert and says nothing about telling the family when consent is off', () => {
    for (const seed of seeds) {
      run(seed, { missedDose: false, emergency: false }, (_b, _e, after) => {
        expect(after.alerts.filter((a) => a.kind === 'missed_dose' || a.kind === 'emergency'), `seed ${seed}`).toHaveLength(0);
        expect(after.outbox.some((o) => o.key === 'escalated'), `seed ${seed}: claimed the family was told`).toBe(false);
      });
    }
  });

  it('never logs a dose from a sentence that contains a No', () => {
    for (const seed of seeds) {
      run(seed, { missedDose: true, emergency: true }, (before, e, after) => {
        if (e.kind === 'hear' && oracle(e.text).negated) {
          expect(after.doses.length, `seed ${seed}: ${e.text}`).toBe(before.doses.length);
        }
      });
    }
  });

  it('keeps every spoken message and the saved state free of undefined values', () => {
    for (const seed of seeds.slice(0, 60)) {
      run(seed, { missedDose: true, emergency: true }, (_b, _e, after) => {
        for (const o of after.outbox) expect(o.text.trim(), `seed ${seed}`).not.toBe('');
        expect(JSON.parse(JSON.stringify(after)), `seed ${seed}`).toEqual(after);
      });
    }
  });
});
