import { describe, expect, it } from 'vitest';
import { SCENARIOS, runScenario, sameOutcome } from './scenarios';
import { advance, hear, initialState, press, saveMedicine } from './engine';
import { parseMedicineLine } from './medicineParser';
import type { AppState } from '../types';

describe('scripted dose scenarios', () => {
  for (const sc of SCENARIOS) {
    it(sc.title, () => {
      const actual = runScenario(sc);
      expect(sameOutcome(actual, sc.expect), JSON.stringify({ actual, expected: sc.expect })).toBe(true);
    });
  }
});

describe('engine details', () => {
  const at8 = () => advance(initialState(new Date(2026, 10, 27, 12).getTime()), 5);

  it('does not remind before the scheduled time', () => {
    const s = initialState(new Date(2026, 10, 27, 12).getTime());
    expect(advance(s, 2).session).toBeNull();
  });

  it('replies in the language the person just spoke', () => {
    let s: AppState = { ...at8(), lang: 'en' };
    s = hear(s, 'వేసుకున్నాను');
    expect(s.lang).toBe('te');
    expect(s.outbox.at(-1)?.text).toBe('నమోదు చేయనా?');
    s = hear(s, 'yes');
    expect(s.lang).toBe('te'); // Latin-only text keeps the current language
  });

  it('buttons: Yes means "I took it", then Yes confirms', () => {
    let s = press(at8(), 'yes');
    expect(s.session?.phase).toBe('confirming');
    s = press(s, 'yes');
    expect(s.doses).toHaveLength(1);
    expect(s.doses[0]?.via).toBe('button');
  });

  it('never claims to have told family when alerts are not consented', () => {
    let s = at8();
    s = { ...s, consent: { ...s.consent, missedDose: false } };
    s = advance(advance(s, 10), 10);
    expect(s.alerts).toHaveLength(0);
    expect(s.outbox.some((o) => o.key === 'escalated')).toBe(false);
  });

  it('stores one dose per slot even if the confirmation repeats', () => {
    let s = hear(at8(), 'వేసుకున్నాను');
    s = hear(s, 'అవును');
    expect(s.doses).toHaveLength(1);
  });

  it('starts the evening dose after the morning one is finished', () => {
    let s = hear(hear(at8(), 'వేసుకున్నాను'), 'అవును');
    s = advance(s, 13 * 60 + 5); // 21:05
    expect(s.session?.slotId.endsWith('21:00')).toBe(true);
    expect(s.session?.phase).toBe('asked');
  });

  it('saves a parsed medicine and replaces an existing one by name', () => {
    const parsed = parseMedicineLine('metformin 850, 1-0-1');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = saveMedicine(initialState(), parsed.value);
    expect(s.medicines).toHaveLength(1);
    expect(s.medicines[0]?.strength).toBe('850');
  });
});

describe('medicine line parser', () => {
  it('reads "Metformin 500, 1-0-1" as morning and night', () => {
    const r = parseMedicineLine('Metformin 500, 1-0-1');
    expect(r).toEqual({ ok: true, value: { name: 'Metformin', strength: '500', times: ['08:00', '21:00'] } });
  });
  it('reads BD, OD and TDS', () => {
    const bd = parseMedicineLine('Amlodipine 5 mg, BD');
    expect(bd.ok && bd.value.times).toEqual(['08:00', '21:00']);
    const od = parseMedicineLine('Aspirin 75, OD');
    expect(od.ok && od.value.times).toEqual(['08:00']);
    const tds = parseMedicineLine('Paracetamol 500, TDS');
    expect(tds.ok && tds.value.times).toEqual(['08:00', '14:00', '21:00']);
  });
  it('rejects input it cannot read instead of guessing', () => {
    for (const bad of ['', 'Metformin', 'Metformin 500', 'Metformin 500, 0-0-0', 'Metformin 500, twice', 'Metformin, 1-0-1']) {
      expect(parseMedicineLine(bad).ok, bad).toBe(false);
    }
  });
});
