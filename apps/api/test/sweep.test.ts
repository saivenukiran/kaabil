import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepMissedDoses } from '../src/sweep';
import { addMetformin, familyWithGroup, HOUR, makeApp, MIN, pairPhone, phone, T0, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(() => t.close());

const alertsOf = async (f: Awaited<ReturnType<typeof familyWithGroup>>['f'], groupId: string) =>
  ((await (await f.call('GET', `/api/care/groups/${groupId}/alerts`)).json()) as { alerts: { kind: string; slotId: string }[] }).alerts;

describe('the server missed-dose check', () => {
  it('raises one alert 22 minutes after a slot with no dose, and never a second', async () => {
    const { f, groupId } = await familyWithGroup(t, 'sweep1@example.test');
    t.clock.t = T0 + 6 * HOUR;
    const med = await addMetformin(f, groupId); // created at 06:00, slots 08:00 and 21:00
    await pairPhone(t, f, groupId);

    t.clock.t = T0 + 8 * HOUR + 21 * MIN;
    expect(await sweepMissedDoses(t.deps)).toBe(0);
    t.clock.t = T0 + 8 * HOUR + 22 * MIN;
    expect(await sweepMissedDoses(t.deps)).toBe(1);
    expect(await sweepMissedDoses(t.deps)).toBe(0);
    const a = await alertsOf(f, groupId);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'missed_dose', slotId: `${med.id}|2026-11-28|08:00` });
  });

  it('does not alert for a slot whose dose was recorded', async () => {
    const { f, groupId } = await familyWithGroup(t, 'sweep2@example.test');
    t.clock.t = T0 + 6 * HOUR;
    const med = await addMetformin(f, groupId);
    const token = await pairPhone(t, f, groupId);
    await phone(t, token)('POST', '/api/device/doses', { slotId: `${med.id}|2026-11-28|08:00`, medicineId: med.id, atMs: T0 + 8 * HOUR + 3 * MIN, via: 'voice' });
    t.clock.t = T0 + 9 * HOUR;
    await sweepMissedDoses(t.deps);
    const kinds = (await alertsOf(f, groupId)).map((a) => a.slotId);
    expect(kinds).not.toContain(`${med.id}|2026-11-28|08:00`);
  });

  it('does not alert for slots from before the medicine existed', async () => {
    const { f, groupId } = await familyWithGroup(t, 'sweep3@example.test');
    t.clock.t = T0 + 12 * HOUR; // noon: the 08:00 slot is already past
    await addMetformin(f, groupId);
    await pairPhone(t, f, groupId);
    t.clock.t = T0 + 13 * HOUR;
    await sweepMissedDoses(t.deps);
    // neither today's 08:00 nor yesterday's 21:00 predates... both come before the medicine existed
    expect(await alertsOf(f, groupId)).toHaveLength(0);
  });

  it('does nothing without a paired phone or without consent', async () => {
    t.clock.t = T0 + 6 * HOUR;
    const noPhone = await familyWithGroup(t, 'sweep4@example.test');
    await addMetformin(noPhone.f, noPhone.groupId);
    const noConsent = await familyWithGroup(t, 'sweep5@example.test', { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: false, emergency: true } });
    await addMetformin(noConsent.f, noConsent.groupId);
    await pairPhone(t, noConsent.f, noConsent.groupId);
    t.clock.t = T0 + 9 * HOUR;
    await sweepMissedDoses(t.deps);
    expect(await alertsOf(noPhone.f, noPhone.groupId)).toHaveLength(0);
    expect(await alertsOf(noConsent.f, noConsent.groupId)).toHaveLength(0);
  });

  it('does not duplicate the alert the phone already raised for the same slot', async () => {
    const { f, groupId } = await familyWithGroup(t, 'sweep6@example.test');
    t.clock.t = T0 + 6 * HOUR;
    const med = await addMetformin(f, groupId);
    const token = await pairPhone(t, f, groupId);
    await phone(t, token)('POST', '/api/device/alerts', { kind: 'missed_dose', slotId: `${med.id}|2026-11-28|08:00`, medicineId: med.id, atMs: T0 + 8 * HOUR + 20 * MIN });
    t.clock.t = T0 + 8 * HOUR + 30 * MIN;
    await sweepMissedDoses(t.deps);
    const forSlot = (await alertsOf(f, groupId)).filter((a) => a.slotId === `${med.id}|2026-11-28|08:00`);
    expect(forSlot).toHaveLength(1);
  });
});
