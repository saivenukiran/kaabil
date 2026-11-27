import { describe, expect, it } from 'vitest';
import { detectLang, interpret } from '../../voice/words';
import type { MessageKey } from '../../types';
import { defineLanguage, type MessageTable, type UiStrings, type WordLists } from '../language';
import { render, ui } from '../messages';
import { getLanguage, isLangCode, LANGUAGES } from './index';

const KEYS: MessageKey[] = ['remind', 'confirm_log', 'logged', 'snooze', 'already_logged', 'not_logged', 'clarify', 'escalated', 'emergency', 'buttons', 'help', 'stopped'];
const WORD_KEYS: (keyof WordLists)[] = ['yes', 'no', 'claim', 'later', 'stop', 'help', 'repeat', 'emergency'];
const UI_KEYS: (keyof UiStrings)[] = ['startHint', 'tryHint', 'typedLabel', 'typedPlaceholder', 'send', 'sos', 'disclaimer', 'close', 'speakAria', 'micBlocked', 'micUnsupported', 'noVoice'];
const VARS = { address: 'Amma', name: 'Metformin', strength: '500' };

describe('the registry', () => {
  it('has unique codes and English as the fallback', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('en');
  });
  it('knows its own codes and nothing else', () => {
    expect(isLangCode('te')).toBe(true);
    expect(isLangCode('en')).toBe(true);
    expect(isLangCode('hi')).toBe(false);
    expect(isLangCode(undefined)).toBe(false);
  });
});

describe.each(LANGUAGES)('language "$code" is complete', (l) => {
  it('names itself and has a speech locale', () => {
    expect(l.name).not.toBe('');
    expect(l.nativeName).not.toBe('');
    expect(l.locale).toMatch(/^[a-z]{2,3}-[A-Z]{2}$/);
    expect(l.locale.startsWith(l.code)).toBe(true);
  });

  it('speaks every message, none empty', () => {
    for (const k of KEYS) expect(l.messages[k](VARS).trim(), k).not.toBe('');
  });

  it('puts the person, medicine and strength into the reminder', () => {
    const t = l.messages.remind(VARS);
    expect(t).toContain('Amma');
    expect(t).toContain('Metformin');
    expect(t).toContain('500');
  });

  it('names the emergency number in the emergency message', () => {
    expect(l.messages.emergency(VARS)).toContain('112');
  });

  it('has state words and button words', () => {
    for (const v of [...Object.values(l.stateWords), ...Object.values(l.buttonWords)]) expect(v.trim()).not.toBe('');
  });

  it('has word lists with no empty entries', () => {
    for (const k of WORD_KEYS) {
      expect(l.words[k].length, k).toBeGreaterThan(0);
      for (const w of l.words[k]) expect(w.trim(), k).not.toBe('');
    }
  });

  it('never lists a word as both Yes and No', () => {
    const yes = new Set(l.words.yes.map((w) => w.toLowerCase()));
    for (const w of l.words.no) expect(yes.has(w.toLowerCase()), w).toBe(false);
  });

  it('understands its own button words as Yes and No', () => {
    expect(interpret(l.buttonWords.yes)).toBe('yes');
    expect(interpret(l.buttonWords.no)).toBe('no');
  });

  it('understands its own emergency phrases', () => {
    for (const p of l.words.emergency) expect(interpret(p), p).toBe('emergency');
  });

  it('has valid script ranges', () => {
    for (const [lo, hi] of l.scripts) expect(lo).toBeLessThanOrEqual(hi);
  });
});

describe('English is the full set of person-screen strings', () => {
  it('has every key', () => {
    const en = getLanguage('en');
    for (const k of UI_KEYS) expect(en.ui[k], k).toBeDefined();
  });
});

describe('adding a language needs only one new definition', () => {
  // A stand-in language written in Greek letters, defined here and never in the registry.
  const xx = defineLanguage({
    code: 'xx',
    name: 'Testish',
    nativeName: 'Τεστ',
    locale: 'xx-IN',
    scripts: [[0x0370, 0x03ff]],
    review: 'draft',
    messages: Object.fromEntries(KEYS.map((k) => [k, () => `xx ${k}`])) as unknown as MessageTable,
    stateWords: { listening: 'α', thinking: 'β', done: 'γ', ready: 'δ' },
    buttonWords: { yes: 'ναι', no: 'οχι', start: 'αρχη' },
    words: { yes: ['ναι'], no: ['οχι'], noSuffix: [], claim: ['πηρα'], later: ['μετα'], stop: ['σταμα'], help: ['βοηθεια'], repeat: ['ξανα'], emergency: ['πονος στηθους'] },
    ui: {},
  });
  const withXx = [...LANGUAGES, xx];

  it('speaks the new language', () => {
    expect(render('xx', 'logged', VARS, withXx)).toBe('xx logged');
  });
  it('understands it, and the built-in registry does not', () => {
    expect(interpret('ναι', withXx)).toBe('yes');
    expect(interpret('πηρα', withXx)).toBe('claim');
    expect(interpret('ναι')).toBe('unclear');
  });
  it('still understands the other languages in the same sentence', () => {
    expect(interpret('ναι అవును', withXx)).toBe('yes');
    expect(interpret('ναι వద్దు', withXx)).toBe('mixed');
  });
  it('switches to it when the person speaks its script', () => {
    expect(detectLang('ναι', 'en', withXx)).toBe('xx');
    expect(detectLang('వేసుకున్నాను', 'xx', withXx)).toBe('te');
  });
  it('falls back to English for a string not translated yet', () => {
    expect(ui('xx', 'send', withXx)).toBe('Send');
  });
  it('falls back to English for an unknown code instead of failing', () => {
    expect(render('zz', 'logged', VARS)).toBe('Recorded.');
  });
});
