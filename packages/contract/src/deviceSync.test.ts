import { describe, expect, it } from 'vitest';
import { advance, hear, press, sos, type AppState } from '@kaabil/core';
import { applyPlan, newSent, planToState, remindNow, unsent } from './deviceSync';
import type { Plan } from './schemas';

const plan: Plan = {
  groupId: 'g1',
  person: { name: 'Amma', address: 'అమ్మ' },
  lang: 'te',
  consent: { missedDose: true, emergency: true },
  medicines: [{ id: 'med-1', name: 'Metformin', strength: '500', times: ['08:00', '21:00'] }],
};

/** 28 Nov 2026, 15:00 local time. */
const at = (h: number, m = 0) => new Date(2026, 10, 28, h, m, 0, 0).getTime();

describe('planToState', () => {
  it('uses the server plan and its medicine ids', () => {
    const s = planToState(plan, at(7, 50));
    expect(s.person).toEqual({ name: 'Amma', address: 'అమ్మ' });
    expect(s.lang).toBe('te');
    expect(s.medicines[0]).toMatchObject({ id: 'med-1', name: 'Metformin', times: ['08:00', '21:00'] });
    expect(s.consent).toEqual({ missedDose: true, emergency: true });
  });

  it('does not replay reminders for times that already passed when the page opened', () => {
    const s = planToState(plan, at(15));
    expect(s.handled).toEqual(['med-1|2026-11-28|08:00']);
    expect(advance(s, 0).session).toBeNull();
  });

  it('starts the reminder when the next slot arrives', () => {
    const s = advance(planToState(plan, at(20, 59)), 2);
    expect(s.session?.slotId).toBe('med-1|2026-11-28|21:00');
    expect(s.outbox.at(-1)?.key).toBe('remind');
  });
});

describe('remindNow', () => {
  it('makes the latest passed slot due and starts the reminder', () => {
    const r = remindNow(planToState(plan, at(15)), 'med-1');
    expect(r?.slot).toBe('med-1|2026-11-28|08:00');
    const s = advance(r!.state, 0);
    expect(s.session?.slotId).toBe('med-1|2026-11-28|08:00');
    expect(s.outbox.at(-1)?.key).toBe('remind');
  });

  it('moves the clock forward when every slot is still ahead', () => {
    const s0 = planToState(plan, at(6));
    const r = remindNow(s0, undefined);
    expect(r?.slot).toBe('med-1|2026-11-28|08:00');
    expect(r!.state.clockMs).toBe(at(8));
  });

  it('does nothing without a medicine', () => {
    expect(remindNow({ ...planToState(plan, at(15)), medicines: [] })).toBeUndefined();
  });
});

describe('unsent', () => {
  function takenDose(): AppState {
    let s = remindNow(planToState(plan, at(15)))!.state;
    s = advance(s, 0);
    s = hear(s, 'వేసుకున్నాను');
    return press(s, 'yes');
  }

  it('reports a logged dose once the person confirms, and not before', () => {
    let s = advance(remindNow(planToState(plan, at(15)))!.state, 0);
    expect(unsent(s, newSent()).doses).toEqual([]);
    s = hear(s, 'వేసుకున్నాను');
    expect(unsent(s, newSent()).doses).toEqual([]);
    s = press(s, 'yes');
    const u = unsent(s, newSent());
    expect(u.doses).toHaveLength(1);
    expect(u.doses[0]?.body).toMatchObject({ slotId: 'med-1|2026-11-28|08:00', medicineId: 'med-1', via: 'button' });
  });

  it('does not repeat what was already sent', () => {
    const s = takenDose();
    const sent = newSent();
    for (const d of unsent(s, sent).doses) sent.doses.add(d.key);
    expect(unsent(s, sent).doses).toEqual([]);
  });

  it('turns an emergency into an alert with no slot, once', () => {
    const s = sos(planToState(plan, at(15)));
    const sent = newSent();
    const u = unsent(s, sent);
    expect(u.alerts).toHaveLength(1);
    expect(u.alerts[0]?.body.kind).toBe('emergency');
    expect(u.alerts[0]?.body.slotId).toBeUndefined();
    sent.alerts.add(u.alerts[0]!.key);
    expect(unsent(s, sent).alerts).toEqual([]);
  });

  it('sends a missed-dose alert for the slot after twenty minutes of silence', () => {
    let s = advance(remindNow(planToState(plan, at(15)))!.state, 0);
    s = advance(s, 10);
    s = advance(s, 10);
    const a = unsent(s, newSent()).alerts;
    expect(a).toHaveLength(1);
    expect(a[0]?.body).toMatchObject({ kind: 'missed_dose', slotId: 'med-1|2026-11-28|08:00', medicineId: 'med-1' });
  });

  it('keeps the family from being told when they did not consent', () => {
    const noConsent: Plan = { ...plan, consent: { missedDose: false, emergency: false } };
    let s = advance(remindNow(planToState(noConsent, at(15)))!.state, 0);
    s = advance(advance(s, 10), 10);
    expect(unsent(s, newSent()).alerts).toEqual([]);
  });
});

describe('applyPlan', () => {
  it('keeps the conversation and the log when the plan changes', () => {
    let s = advance(remindNow(planToState(plan, at(15)))!.state, 0);
    const changed: Plan = { ...plan, medicines: [...plan.medicines, { id: 'med-2', name: 'Aspirin', strength: '75', times: ['09:00'] }] };
    const next = applyPlan(s, changed);
    expect(next.session?.slotId).toBe(s.session?.slotId);
    expect(next.medicines.map((m) => m.name)).toEqual(['Metformin', 'Aspirin']);
    expect(next.handled).toContain('med-2|2026-11-28|09:00'); // 09:00 already passed at 15:00
    s = next;
    expect(s.outbox.length).toBeGreaterThan(0);
  });
});
