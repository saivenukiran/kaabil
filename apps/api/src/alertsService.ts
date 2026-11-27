/**
 * The one place an alert is created, so the phone's report and the server's own check cannot
 * disagree. A missed or repeated-dose alert is unique per slot (the database enforces it), and an
 * alert that needs the family's consent is not created without it.
 */
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@kaabil/db';
import type { AlertInput, AlertResult } from '@kaabil/contract';
import { alertDto, loadGroupRow } from './repo';
import { newId } from './security';
import type { Deps } from './types';

const { alerts } = schema;

export async function createAlert(d: Deps, groupId: string, input: AlertInput, deviceId: string | null): Promise<AlertResult> {
  const group = await loadGroupRow(d.db, groupId);
  const needsConsent = input.kind === 'missed_dose' ? group.consentMissedDose : input.kind === 'emergency' ? group.consentEmergency : true;
  if (!needsConsent) return { created: false, reason: 'no_consent' };

  const [row] = await d.db
    .insert(alerts)
    .values({ id: newId(), groupId, kind: input.kind, slotId: input.slotId ?? null, medicineId: input.medicineId ?? null, atMs: input.atMs, deviceId })
    .onConflictDoNothing({ target: [alerts.groupId, alerts.kind, alerts.slotId], where: sql`slot_id is not null` })
    .returning();

  if (!row) {
    const [existing] = await d.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.groupId, groupId), eq(alerts.kind, input.kind), eq(alerts.slotId, input.slotId ?? '')))
      .limit(1);
    return existing ? { created: false, reason: 'duplicate', alert: alertDto(existing) } : { created: false, reason: 'duplicate' };
  }
  const alert = alertDto(row);
  d.bus.publish(groupId, 'family', { type: 'alert', alert });
  return { created: true, alert };
}
