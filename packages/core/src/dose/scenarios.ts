/**
 * Scripted dose scenarios. The test panel in the app and the unit tests run the same
 * list, so what the panel shows (expected versus actual) is also what CI checks.
 */
import type { AlertKind, MessageKey, Phase } from '../types';
import { advance, hear, initialState, silence } from './engine';

type Action = { do: 'advance'; minutes: number } | { do: 'hear'; text: string } | { do: 'silence' };

export interface Outcome {
  phase: Phase | 'none';
  doses: number;
  alerts: AlertKind[];
  show112: boolean;
  showButtons: boolean;
  lastSay: MessageKey | 'none';
}

export interface Scenario {
  id: string;
  title: string;
  actions: Action[];
  expect: Outcome;
}

const base: Outcome = { phase: 'asked', doses: 0, alerts: [], show112: false, showButtons: false, lastSay: 'remind' };
const claim = 'వేసుకున్నాను';

export const SCENARIOS: Scenario[] = [
  {
    id: 'log-telugu',
    title: 'Telugu claim, then Yes: the dose is logged',
    actions: [{ do: 'hear', text: claim }, { do: 'hear', text: 'అవును' }],
    expect: { ...base, phase: 'logged', doses: 1, lastSay: 'logged' },
  },
  {
    id: 'confirm-no',
    title: 'Telugu claim, then No: nothing is logged',
    actions: [{ do: 'hear', text: claim }, { do: 'hear', text: 'వద్దు' }],
    expect: { ...base, lastSay: 'not_logged' },
  },
  {
    id: 'negated-verb',
    title: 'వేసుకోలేదు (did not take): the verb ending counts as No, snoozed',
    actions: [{ do: 'hear', text: 'వేసుకోలేదు' }],
    expect: { ...base, phase: 'snoozed', lastSay: 'snooze' },
  },
  {
    id: 'not-yet',
    title: 'ఇంకా లేదు (not yet): snoozed for 10 minutes',
    actions: [{ do: 'hear', text: 'ఇంకా లేదు' }],
    expect: { ...base, phase: 'snoozed', lastSay: 'snooze' },
  },
  {
    id: 'snooze-returns',
    title: 'Snoozed, then 10 minutes pass: reminded once more',
    actions: [{ do: 'hear', text: 'ఇంకా లేదు' }, { do: 'advance', minutes: 10 }],
    expect: { ...base, phase: 'asked', lastSay: 'remind' },
  },
  {
    id: 'no-answer-alert',
    title: 'No answer: repeat once at 10 minutes, alert family at 20',
    actions: [{ do: 'advance', minutes: 10 }, { do: 'advance', minutes: 10 }],
    expect: { ...base, phase: 'escalated', alerts: ['missed_dose'], lastSay: 'escalated' },
  },
  {
    id: 'claimed-again',
    title: 'Claimed again within 4 hours: refused and family flagged',
    actions: [{ do: 'hear', text: claim }, { do: 'hear', text: 'అవును' }, { do: 'hear', text: claim }],
    expect: { ...base, phase: 'logged', doses: 1, alerts: ['double_dose'], lastSay: 'already_logged' },
  },
  {
    id: 'mixed-yes-no',
    title: 'Yes and No in one sentence while confirming: never act',
    actions: [{ do: 'hear', text: claim }, { do: 'hear', text: 'అవును కాదు' }],
    expect: { ...base, phase: 'confirming', lastSay: 'clarify' },
  },
  {
    id: 'bare-yes',
    title: 'A bare Yes before any claim is not a dose: ask again',
    actions: [{ do: 'hear', text: 'అవును' }],
    expect: { ...base, lastSay: 'clarify' },
  },
  {
    id: 'emergency',
    title: 'ఛాతీ నొప్పి (chest pain): 112 button and family alert',
    actions: [{ do: 'hear', text: 'ఛాతీ నొప్పి' }],
    expect: { ...base, alerts: ['emergency'], show112: true, lastSay: 'emergency' },
  },
  {
    id: 'hindi',
    title: 'Hindi claim and Yes: logged, reply in Hindi',
    actions: [{ do: 'hear', text: 'दवाई ले ली' }, { do: 'hear', text: 'हाँ' }],
    expect: { ...base, phase: 'logged', doses: 1, lastSay: 'logged' },
  },
  {
    id: 'english',
    title: 'English claim and Yes: logged',
    actions: [{ do: 'hear', text: 'I took it' }, { do: 'hear', text: 'yes' }],
    expect: { ...base, phase: 'logged', doses: 1, lastSay: 'logged' },
  },
  {
    id: 'silence-buttons',
    title: 'Silence three times: re-prompt twice, then show the buttons',
    actions: [{ do: 'silence' }, { do: 'silence' }, { do: 'silence' }],
    expect: { ...base, showButtons: true, lastSay: 'buttons' },
  },
];

export function runScenario(sc: Scenario): Outcome {
  let s = advance(initialState(new Date(2026, 10, 27, 12).getTime()), 5); // 07:55 -> 08:00
  for (const a of sc.actions) {
    if (a.do === 'advance') s = advance(s, a.minutes);
    else if (a.do === 'hear') s = hear(s, a.text);
    else s = silence(s);
  }
  return {
    phase: s.session?.phase ?? 'none',
    doses: s.doses.length,
    alerts: s.alerts.map((x) => x.kind),
    show112: s.show112,
    showButtons: s.session?.showButtons ?? false,
    lastSay: s.outbox.at(-1)?.key ?? 'none',
  };
}

export function sameOutcome(a: Outcome, b: Outcome): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
