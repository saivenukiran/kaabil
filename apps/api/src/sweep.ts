/**
 * The server's own check for missed doses. The person's phone normally raises the alert itself,
 * but the phone may be closed or dead, so the server looks at every slot whose time is long past
 * and raises one alert when no dose was recorded. The database's unique key per slot means the
 * phone's alert and this one can never both exist.
 */
import { and, eq, gte, isNull } from 'drizzle-orm';
import { schema } from '@kaabil/db';
import { createAlert } from './alertsService';
import type { Deps } from './types';

const { careGroups, medicines, devices, doseEvents } = schema;

const DAY = 24 * 60 * 60_000;

/** Local calendar day and clock minutes in a time zone, from an epoch ms. */
export function localParts(ms: number, timeZone: string): { day: string; minutes: number } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Epoch ms of "HH:MM" on the local day that contains `ms`. */
export function slotTimeMs(ms: number, hhmm: string, timeZone: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const now = localParts(ms, timeZone);
  return ms - (now.minutes - (h * 60 + m)) * 60_000 - (ms % 60_000);
}

/** The slot id the phone uses: `medicineId|YYYY-MM-DD|HH:MM`, the same form as `slotId` in @kaabil/core. */
export const slotKey = (medicineId: string, ms: number, hhmm: string, timeZone: string) => `${medicineId}|${localParts(ms, timeZone).day}|${hhmm}`;

export async function sweepMissedDoses(d: Deps, nowMs = d.now()): Promise<number> {
  const groups = await d.db.select().from(careGroups).where(eq(careGroups.consentMissedDose, true));
  let raised = 0;
  for (const g of groups) {
    const [phone] = await d.db.select({ id: devices.id }).from(devices).where(and(eq(devices.groupId, g.id), isNull(devices.revokedAt))).limit(1);
    if (!phone) continue; // nobody to remind, so nothing can be "missed"
    const meds = await d.db.select().from(medicines).where(eq(medicines.groupId, g.id));
    const doses = await d.db.select({ slotId: doseEvents.slotId }).from(doseEvents).where(and(eq(doseEvents.groupId, g.id), gte(doseEvents.atMs, nowMs - 2 * DAY)));
    const done = new Set(doses.map((x) => x.slotId));

    for (const m of meds) {
      for (const t of m.times) {
        for (const probe of [nowMs, nowMs - DAY]) {
          const slotMs = slotTimeMs(probe, t, d.config.timeZone);
          const overdue = nowMs - slotMs >= d.config.missedAfterMs;
          const recent = nowMs - slotMs < DAY;
          // A medicine added after its slot time on the same day must not raise an alert for that slot.
          const existedThen = m.createdAt.getTime() <= slotMs;
          const id = slotKey(m.id, slotMs, t, d.config.timeZone);
          if (!overdue || !recent || !existedThen || done.has(id)) continue;
          const r = await createAlert(d, g.id, { kind: 'missed_dose', slotId: id, medicineId: m.id, atMs: nowMs }, null);
          if (r.created) raised += 1;
        }
      }
    }
  }
  if (raised) d.log.info({ raised }, 'missed-dose sweep raised alerts');
  return raised;
}

export function startSweep(d: Deps): () => void {
  const timer = setInterval(() => {
    sweepMissedDoses(d).catch((e: Error) => d.log.error({ err: e.message }, 'sweep failed'));
  }, d.config.sweepEveryMs);
  timer.unref();
  return () => clearInterval(timer);
}
