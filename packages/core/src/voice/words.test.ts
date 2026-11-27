import { describe, expect, it } from 'vitest';
import { detectLang, interpret } from './words';

describe('interpret: Yes and No are decided by word rules', () => {
  const cases: [string, ReturnType<typeof interpret>][] = [
    ['అవును', 'yes'],
    ['సరే', 'yes'],
    ['Yes.', 'yes'],
    ['వద్దు', 'no'],
    ['కాదు', 'no'],
    ['వేసుకోలేదు', 'no'], // negation is a suffix on the verb
    ['వేసుకున్నాను', 'claim'],
    ['తీసుకున్నాను', 'claim'],
    ['I took it', 'claim'],
    ['ఇంకా లేదు', 'notyet'],
    ['not yet', 'notyet'],
    ['అవును కాదు', 'mixed'],
    ['yes no', 'mixed'],
    ['I did not take it', 'no'], // a claim word never overrides a No
    ['chest pain', 'emergency'],
    ['stop', 'stop'],
    ['ఛాతీ నొప్పి', 'emergency'],
    ['నాకు పడిపోయాను', 'emergency'],
    ['ఆపు', 'stop'],
    ['మళ్ళీ చెప్పు', 'repeat'],
    ['help', 'help'],
    ['', 'unclear'],
    ['blah blah', 'unclear'],
    ['ఏమో', 'unclear'],
  ];
  for (const [text, intent] of cases) {
    it(`"${text}" -> ${intent}`, () => expect(interpret(text)).toBe(intent));
  }

  it('does not treat a word list entry inside another word as a match', () => {
    expect(interpret('taken apart')).toBe('claim'); // whole words only: "taken" is a word here
    expect(interpret('takenover')).toBe('unclear');
  });
  it('does not treat "no" inside another word as a No', () => {
    expect(interpret('know')).toBe('unclear');
  });
});

describe('detectLang', () => {
  it('follows the script of the speech', () => {
    expect(detectLang('వేసుకున్నాను', 'en')).toBe('te');
  });
  it('keeps the current language for Latin-only text', () => {
    expect(detectLang('yes', 'te')).toBe('te');
    expect(detectLang('yes', 'en')).toBe('en');
  });
  it('uses the dominant script for mixed text', () => {
    expect(detectLang('అమ్మ medicine వేసుకున్నాను', 'en')).toBe('te');
  });
});
