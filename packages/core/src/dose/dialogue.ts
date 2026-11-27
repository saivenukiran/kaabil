/**
 * The medicine-dose dialogue as a pure state machine. No clock, storage or speech in
 * here: the caller passes the time in, and gets back the next session, the message
 * keys to speak and the side effects to apply. That keeps every branch unit-testable.
 *
 * Rules the prompt sets: a dose is logged only after an explicit Yes; "not yet" snoozes
 * for 10 minutes; no answer for 10 minutes repeats once, then alerts family; a second
 * claim within 4 hours is refused and flagged; unclear speech is never treated as Yes.
 */
import type { AlertKind, DoseSession, MessageKey } from '../types';
import type { Intent } from '../voice/words';
import { HOUR, MINUTE } from '../time';

export const REPEAT_AFTER_MS = 10 * MINUTE;
export const SNOOZE_MS = 10 * MINUTE;
export const CONFIRM_TIMEOUT_MS = 2 * MINUTE;
export const DOUBLE_DOSE_WINDOW_MS = 4 * HOUR;
export const MAX_SILENCES = 2; // re-prompt twice, then show buttons
export const MAX_UNCLEAR = 2;

export type Effect =
  | { type: 'log'; via: 'voice' | 'button' }
  | { type: 'alert'; kind: AlertKind }
  | { type: 'show_buttons' };

export type StepInput =
  | { kind: 'heard'; intent: Intent; via: 'voice' | 'button' }
  | { kind: 'silence' }
  | { kind: 'tick' };

export interface StepContext {
  nowMs: number;
  /** When this medicine was last logged, if ever. */
  lastLoggedMs: number | undefined;
}

export interface StepResult {
  session: DoseSession;
  say: MessageKey[];
  effects: Effect[];
}

export function newSession(slotId: string, medicineId: string, nowMs: number): DoseSession {
  return {
    slotId,
    medicineId,
    phase: 'asked',
    sinceMs: nowMs,
    snoozeUntilMs: 0,
    repeats: 0,
    silences: 0,
    unclear: 0,
    showButtons: false,
  };
}

const withinDoubleWindow = (ctx: StepContext) =>
  ctx.lastLoggedMs !== undefined && ctx.nowMs - ctx.lastLoggedMs < DOUBLE_DOSE_WINDOW_MS;

function misunderstood(r: StepResult, key: MessageKey): StepResult {
  r.session.unclear += 1;
  if (r.session.unclear >= MAX_UNCLEAR && !r.session.showButtons) {
    r.session.showButtons = true;
    r.say.push(key, 'buttons');
    r.effects.push({ type: 'show_buttons' });
  } else {
    r.say.push(key);
  }
  return r;
}

function onHeard(r: StepResult, intent: Intent, via: 'voice' | 'button', ctx: StepContext): StepResult {
  const s = r.session;
  s.silences = 0;

  // Controls work in every phase.
  if (intent === 'help') return { ...r, say: ['help'] };
  if (intent === 'stop') return { ...r, say: ['stopped'] };
  if (intent === 'repeat') {
    if (s.phase === 'asked') return { ...r, say: ['remind'] };
    if (s.phase === 'confirming') return { ...r, say: ['confirm_log'] };
    return r;
  }
  if (intent === 'emergency') return r; // handled before the dialogue by the engine

  if (s.phase === 'confirming') {
    if (intent === 'yes') {
      s.phase = 'logged';
      s.sinceMs = ctx.nowMs;
      r.effects.push({ type: 'log', via });
      r.say.push('logged');
      return r;
    }
    if (intent === 'no') {
      s.phase = 'asked';
      s.sinceMs = ctx.nowMs;
      r.say.push('not_logged');
      return r;
    }
    if (intent === 'claim') return { ...r, say: ['confirm_log'] };
    return misunderstood(r, 'clarify'); // notyet, mixed, unclear: never act
  }

  if (s.phase === 'logged') {
    if (intent === 'claim') {
      r.say.push('already_logged');
      if (withinDoubleWindow(ctx)) r.effects.push({ type: 'alert', kind: 'double_dose' });
      return r;
    }
    return r;
  }

  // asked, snoozed or escalated: waiting for the person to say whether they took it.
  if (intent === 'claim') {
    if (withinDoubleWindow(ctx)) {
      r.say.push('already_logged');
      r.effects.push({ type: 'alert', kind: 'double_dose' });
      return r;
    }
    s.phase = 'confirming';
    s.sinceMs = ctx.nowMs;
    s.unclear = 0;
    r.say.push('confirm_log');
    return r;
  }
  if (intent === 'no' || intent === 'notyet') {
    s.phase = 'snoozed';
    s.snoozeUntilMs = ctx.nowMs + SNOOZE_MS;
    s.sinceMs = ctx.nowMs;
    s.unclear = 0;
    r.say.push('snooze');
    return r;
  }
  return misunderstood(r, 'clarify'); // a bare yes, mixed or unclear: ask again
}

function onSilence(r: StepResult): StepResult {
  const s = r.session;
  if (s.phase !== 'asked' && s.phase !== 'confirming') return r;
  if (s.showButtons) return r;
  s.silences += 1;
  if (s.silences <= MAX_SILENCES) {
    r.say.push(s.phase === 'asked' ? 'remind' : 'confirm_log');
  } else {
    s.showButtons = true;
    r.say.push('buttons');
    r.effects.push({ type: 'show_buttons' });
  }
  return r;
}

function onTick(r: StepResult, ctx: StepContext): StepResult {
  const s = r.session;
  const elapsed = ctx.nowMs - s.sinceMs;
  if (s.phase === 'asked' && elapsed >= REPEAT_AFTER_MS) {
    if (s.repeats < 1) {
      s.repeats = 1;
      s.sinceMs = ctx.nowMs;
      r.say.push('remind');
    } else {
      s.phase = 'escalated';
      s.sinceMs = ctx.nowMs;
      r.effects.push({ type: 'alert', kind: 'missed_dose' });
      r.say.push('escalated');
    }
  } else if (s.phase === 'snoozed' && ctx.nowMs >= s.snoozeUntilMs) {
    s.phase = 'asked';
    s.repeats = 1; // the snooze counts as the one repeat
    s.sinceMs = ctx.nowMs;
    s.silences = 0;
    r.say.push('remind');
  } else if (s.phase === 'confirming' && elapsed >= CONFIRM_TIMEOUT_MS) {
    s.phase = 'asked'; // an unanswered confirmation never logs anything
    s.sinceMs = ctx.nowMs;
  }
  return r;
}

export function step(session: DoseSession, input: StepInput, ctx: StepContext): StepResult {
  const r: StepResult = { session: { ...session }, say: [], effects: [] };
  switch (input.kind) {
    case 'heard':
      return onHeard(r, input.intent, input.via, ctx);
    case 'silence':
      return onSilence(r);
    case 'tick':
      return onTick(r, ctx);
  }
}
