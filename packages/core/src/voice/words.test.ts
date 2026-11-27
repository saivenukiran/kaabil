import { describe, expect, it } from 'vitest';
import { detectLang, interpret } from './words';

describe('interpret: Yes and No are decided by word rules', () => {
  const cases: [string, ReturnType<typeof interpret>][] = [
    ['అవును', 'yes'],
    ['సరే', 'yes'],
    ['haan', 'yes'],
    ['हाँ', 'yes'],
    ['Yes.', 'yes'],
    ['వద్దు', 'no'],
    ['కాదు', 'no'],
    ['nahi', 'no'],
    ['వేసుకోలేదు', 'no'], // negation is a suffix on the verb
    ['వేసుకున్నాను', 'claim'],
    ['తీసుకున్నాను', 'claim'],
    ['li', 'claim'],
    ['दवाई ले ली', 'claim'],
    ['I took it', 'claim'],
    ['ఇంకా లేదు', 'notyet'],
    ['not yet', 'notyet'],
    ['abhi nahi', 'notyet'],
    ['అవును కాదు', 'mixed'],
    ['yes no', 'mixed'],
    ['haan nahi li', 'mixed'],
    ['nahi li', 'no'], // "did not take it": a claim word never overrides a No
    ['ఛాతీ నొప్పి', 'emergency'],
    ['నాకు పడిపోయాను', 'emergency'],
    ['seene mein dard', 'emergency'],
    ['ఆపు', 'stop'],
    ['रुको', 'stop'],
    ['మళ్ళీ చెప్పు', 'repeat'],
    ['help', 'help'],
    ['', 'unclear'],
    ['blah blah', 'unclear'],
    ['ఏమో', 'unclear'],
  ];
  for (const [text, intent] of cases) {
    it(`"${text}" -> ${intent}`, () => expect(interpret(text)).toBe(intent));
  }

  it('does not treat "li" inside another word as a claim', () => {
    expect(interpret('little')).toBe('unclear');
  });
  it('does not treat "no" inside another word as a No', () => {
    expect(interpret('know')).toBe('unclear');
  });
});

describe('detectLang', () => {
  it('follows the script of the speech', () => {
    expect(detectLang('వేసుకున్నాను', 'en')).toBe('te');
    expect(detectLang('दवाई ले ली', 'te')).toBe('hi');
  });
  it('keeps the current language for Latin-only text', () => {
    expect(detectLang('li', 'te')).toBe('te');
    expect(detectLang('yes', 'hi')).toBe('hi');
  });
  it('uses the dominant script for mixed text', () => {
    expect(detectLang('అమ్మ medicine వేసుకున్నాను', 'en')).toBe('te');
  });
});
