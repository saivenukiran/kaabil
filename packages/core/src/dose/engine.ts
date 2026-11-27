/**
 * Applies the dose dialogue to the whole app state. Every function takes a state and
 * returns a new one; nothing here touches the browser, so the same code runs in the
 * app, in the test panel and in unit tests.
 */
import { detectLang, interpret, type Intent } from '../voice/words';
import { render } from '../i18n/messages';
import { DEFAULT_LANG, isLangCode } from '../i18n/languages';
import { atTimeOfDay, dayKey, MINUTE, slotId } from '../time';
import type { AlertKind, AppState, MessageKey } from '../types';
import { newSession, step, type Effect, type StepContext, type StepInput, type StepResult } from './dialogue';
import type { ParsedMedicine } from './medicineParser';

const MAX_OUTBOX = 50;
const MAX_TRANSCRIPTS = 200;

export function initialState(nowMs: number = Date.now()): AppState {
  const d = new Date(nowMs);
  d.setHours(7, 55, 0, 0); // five minutes before the first dose
  return {
    v: 1,
    lang: DEFAULT_LANG,
    person: { name: 'Amma', address: 'అమ్మ' },
    medicines: [{ id: 'm1', name: 'Metformin', strength: '500', times: ['08:00', '21:00'] }],
    consent: { missedDose: true, emergency: true },
    clockMs: d.getTime(),
    session: null,
    handled: [],
    doses: [],
    alerts: [],
    transcripts: [],
    outbox: [],
    nextId: 1,
    show112: false,
  };
}

/** "Delete my data": everything is erased, including the medicine list and the person. */
export function deleteAllData(state: AppState): AppState {
  const blank = initialState(state.clockMs);
  return {
    ...blank,
    person: { name: '', address: '' },
    medicines: [],
    consent: { missedDose: false, emergency: false },
    clockMs: state.clockMs,
  };
}

// AppState is plain JSON (it is saved as JSON), so a JSON round trip is a full copy.
// structuredClone is avoided on purpose: core must run on any JavaScript engine, not only browsers.
function clone(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function say(w: AppState, key: MessageKey): void {
  const med = w.medicines.find((m) => m.id === w.session?.medicineId) ?? w.medicines[0];
  const text = render(w.lang, key, {
    address: w.person.address,
    name: med?.name ?? '',
    strength: med?.strength ?? '',
  });
  w.outbox.push({ id: w.nextId++, key, text, lang: w.lang });
  w.transcripts.push({ atMs: w.clockMs, who: 'app', text });
  if (w.outbox.length > MAX_OUTBOX) w.outbox = w.outbox.slice(-MAX_OUTBOX);
  if (w.transcripts.length > MAX_TRANSCRIPTS) w.transcripts = w.transcripts.slice(-MAX_TRANSCRIPTS);
}

function addAlert(w: AppState, kind: AlertKind, slot?: string): void {
  if (kind === 'missed_dose' && slot && w.alerts.some((a) => a.kind === kind && a.slotId === slot)) return;
  w.alerts.push({
    id: `a${w.nextId++}`,
    kind,
    medicineId: w.session?.medicineId,
    slotId: slot,
    atMs: w.clockMs,
    acknowledged: false,
    delivery: { inApp: 'delivered', push: 'not set up in this prototype' },
  });
}

function context(w: AppState): StepContext {
  const medId = w.session?.medicineId;
  const times = w.doses.filter((d) => d.medicineId === medId).map((d) => d.atMs);
  return { nowMs: w.clockMs, lastLoggedMs: times.length ? Math.max(...times) : undefined };
}

function applyEffects(w: AppState, effects: Effect[]): { familyNotified: boolean } {
  let familyNotified = true;
  for (const e of effects) {
    if (e.type === 'log' && w.session && !w.doses.some((d) => d.slotId === w.session?.slotId)) {
      w.doses.push({ slotId: w.session.slotId, medicineId: w.session.medicineId, atMs: w.clockMs, via: e.via });
    } else if (e.type === 'alert') {
      if (e.kind === 'missed_dose' && !w.consent.missedDose) familyNotified = false;
      else addAlert(w, e.kind, w.session?.slotId);
    }
  }
  return { familyNotified };
}

function commit(w: AppState, r: StepResult): void {
  w.session = r.session;
  const { familyNotified } = applyEffects(w, r.effects);
  for (const key of r.say) {
    if (key === 'escalated' && !familyNotified) continue; // never claim we told family when we did not
    say(w, key);
  }
}

function run(w: AppState, input: StepInput): void {
  if (!w.session) return;
  commit(w, step(w.session, input, context(w)));
}

function nextDueSlot(w: AppState): { slotId: string; medicineId: string } | undefined {
  const due: { slotId: string; medicineId: string; at: number }[] = [];
  for (const m of w.medicines) {
    for (const t of m.times) {
      const id = slotId(m.id, w.clockMs, t);
      const at = atTimeOfDay(w.clockMs, t);
      if (at <= w.clockMs && !w.handled.includes(id)) due.push({ slotId: id, medicineId: m.id, at });
    }
  }
  due.sort((a, b) => a.at - b.at);
  return due[0];
}

function process(w: AppState): void {
  run(w, { kind: 'tick' });
  const idle = !w.session || w.session.phase === 'logged' || w.session.phase === 'escalated';
  if (!idle) return;
  const due = nextDueSlot(w);
  if (!due) return;
  w.session = newSession(due.slotId, due.medicineId, w.clockMs);
  w.handled.push(due.slotId);
  say(w, 'remind');
}

/** "Advance demo time": move the demo clock and fire whatever is now due. */
export function advance(state: AppState, minutes: number): AppState {
  const w = clone(state);
  w.clockMs += minutes * MINUTE;
  process(w);
  return w;
}

/** Jump the demo clock to a time of day (same day, never backwards past the current time). */
export function jumpTo(state: AppState, hhmm: string): AppState {
  const w = clone(state);
  const target = atTimeOfDay(w.clockMs, hhmm);
  if (target > w.clockMs) w.clockMs = target;
  process(w);
  return w;
}

function dispatch(w: AppState, intent: Intent, via: 'voice' | 'button'): void {
  if (intent === 'emergency') {
    w.show112 = true;
    if (w.consent.emergency) addAlert(w, 'emergency');
    say(w, 'emergency');
    return;
  }
  if (!w.session) {
    if (intent === 'help') say(w, 'help');
    if (intent === 'stop') say(w, 'stopped');
    return;
  }
  run(w, { kind: 'heard', intent, via });
}

/** The person spoke (or typed, or dictated). Word rules decide what it means. */
export function hear(state: AppState, text: string, via: 'voice' | 'button' = 'voice'): AppState {
  const w = clone(state);
  const t = text.trim();
  if (t === '') return w;
  const detected = detectLang(t, w.lang);
  if (isLangCode(detected)) w.lang = detected;
  w.transcripts.push({ atMs: w.clockMs, who: 'person', text: t });
  dispatch(w, interpret(t), via);
  return w;
}

/**
 * The large Yes and No buttons. While the app is waiting to hear whether the dose was
 * taken, Yes means "I took it" and No means "not yet"; while it is asking to confirm,
 * they answer the confirmation.
 */
export function press(state: AppState, value: 'yes' | 'no'): AppState {
  const w = clone(state);
  const asking = w.session?.phase === 'confirming' || w.session?.phase === 'logged';
  const intent: Intent = asking ? value : value === 'yes' ? 'claim' : 'notyet';
  w.transcripts.push({ atMs: w.clockMs, who: 'person', text: `[button] ${value}` });
  dispatch(w, intent, 'button');
  return w;
}

/** The red SOS button: 112 call button, plus a family alert if the family consented. */
export function sos(state: AppState): AppState {
  const w = clone(state);
  w.transcripts.push({ atMs: w.clockMs, who: 'person', text: '[button] SOS' });
  dispatch(w, 'emergency', 'button');
  return w;
}

/** The microphone heard nothing for 6 seconds. */
export function silence(state: AppState): AppState {
  const w = clone(state);
  run(w, { kind: 'silence' });
  return w;
}

/** Mic or camera denied, speech unsupported: show the buttons and keep going. */
export function forceButtons(state: AppState): AppState {
  if (!state.session || state.session.showButtons) return state;
  const w = clone(state);
  if (w.session) w.session.showButtons = true;
  return w;
}

export function acknowledge(state: AppState, alertId: string): AppState {
  const w = clone(state);
  const a = w.alerts.find((x) => x.id === alertId);
  if (a) a.acknowledged = true;
  return w;
}

export function dismiss112(state: AppState): AppState {
  return { ...state, show112: false };
}

export function setLang(state: AppState, lang: AppState['lang']): AppState {
  return { ...state, lang };
}

export function setConsent(state: AppState, consent: Partial<AppState['consent']>): AppState {
  return { ...state, consent: { ...state.consent, ...consent } };
}

export function setPerson(state: AppState, person: Partial<AppState['person']>): AppState {
  return { ...state, person: { ...state.person, ...person } };
}

/** Saved only after the family confirms the proposed times on screen. */
export function saveMedicine(state: AppState, med: ParsedMedicine): AppState {
  const w = clone(state);
  const existing = w.medicines.find((m) => m.name.toLowerCase() === med.name.toLowerCase());
  if (existing) {
    existing.strength = med.strength;
    existing.times = med.times; // edits apply from the next dose
  } else {
    w.medicines.push({ id: `m${w.nextId++}`, ...med });
  }
  return w;
}

export function removeMedicine(state: AppState, id: string): AppState {
  const w = clone(state);
  w.medicines = w.medicines.filter((m) => m.id !== id);
  if (w.session?.medicineId === id) w.session = null;
  return w;
}

export function dayOf(state: AppState): string {
  return dayKey(state.clockMs);
}
