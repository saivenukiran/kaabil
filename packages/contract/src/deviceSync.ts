/**
 * The glue between the server's plan and the dose dialogue in @kaabil/core, for the person's phone.
 * Pure functions with no browser or network in them, so they are tested without either:
 *
 *   planToState   the server's plan becomes the dialogue's starting state
 *   remindNow     make a dose due now (the "Remind now" button and the remind event)
 *   unsent        which doses and alerts the dialogue produced that the server has not heard yet
 *
 * The dialogue stays on the phone. The server stores its results.
 */
import { atTimeOfDay, initialState, slotId, type AlertRecord, type AppState, type DoseRecord } from '@kaabil/core';
import type { AlertInput, DoseInput, Plan } from './schemas';

/** Slots whose time has already passed when the page opens are marked handled, so opening the app at 3 pm does not replay the morning reminder. */
export function planToState(plan: Plan, nowMs: number): AppState {
  const base = initialState(nowMs);
  const handled: string[] = [];
  for (const m of plan.medicines) {
    for (const t of m.times) if (atTimeOfDay(nowMs, t) <= nowMs) handled.push(slotId(m.id, nowMs, t));
  }
  return {
    ...base,
    lang: plan.lang,
    person: { name: plan.person.name, address: plan.person.address },
    medicines: plan.medicines.map((m) => ({ id: m.id, name: m.name, strength: m.strength, times: [...m.times] })),
    consent: { ...plan.consent },
    clockMs: nowMs,
    handled,
  };
}

/** A new plan arrived while the app was running: keep the conversation, the log and the clock, change the plan. */
export function applyPlan(state: AppState, plan: Plan): AppState {
  const fresh = planToState(plan, state.clockMs);
  const handled = [...new Set([...state.handled, ...fresh.handled])];
  return { ...state, lang: fresh.lang, person: fresh.person, medicines: fresh.medicines, consent: fresh.consent, handled };
}

/**
 * Make a dose due right now. Picks the medicine asked for (or the first), takes its latest time of
 * day that has already passed (or its first time), moves the clock forward if that time is still
 * ahead, and clears the "already reminded" mark so the dialogue starts the reminder on its next tick.
 * Returns the state and the slot, or undefined when the plan has no medicine.
 */
export function remindNow(state: AppState, medicineId?: string): { state: AppState; slot: string } | undefined {
  const med = state.medicines.find((m) => m.id === medicineId) ?? state.medicines[0];
  if (!med || med.times.length === 0) return undefined;
  const sorted = [...med.times].sort();
  const past = sorted.filter((t) => atTimeOfDay(state.clockMs, t) <= state.clockMs);
  const time = past.at(-1) ?? sorted[0] ?? '08:00';
  const slot = slotId(med.id, state.clockMs, time);
  return {
    slot,
    state: {
      ...state,
      clockMs: Math.max(state.clockMs, atTimeOfDay(state.clockMs, time)),
      handled: state.handled.filter((h) => h !== slot),
    },
  };
}

export interface Sent {
  doses: Set<string>;
  alerts: Set<string>;
}

export const newSent = (): Sent => ({ doses: new Set(), alerts: new Set() });

export interface Unsent {
  doses: { key: string; body: DoseInput }[];
  alerts: { key: string; body: AlertInput }[];
}

const doseInput = (d: DoseRecord): DoseInput => ({ slotId: d.slotId, medicineId: d.medicineId, atMs: Math.round(d.atMs), via: d.via });

function alertInput(a: AlertRecord): AlertInput {
  return { kind: a.kind, atMs: Math.round(a.atMs), ...(a.slotId ? { slotId: a.slotId } : {}), ...(a.medicineId ? { medicineId: a.medicineId } : {}) };
}

/** What the dialogue has recorded that the server has not been told. Mark an item sent only after the server answers. */
export function unsent(state: AppState, sent: Sent): Unsent {
  return {
    doses: state.doses.filter((d) => !sent.doses.has(d.slotId)).map((d) => ({ key: d.slotId, body: doseInput(d) })),
    alerts: state.alerts.filter((a) => !sent.alerts.has(a.id)).map((a) => ({ key: a.id, body: alertInput(a) })),
  };
}
