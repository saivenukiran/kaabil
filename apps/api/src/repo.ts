/** Reads and writes for the care tables, and the conversion of rows into contract objects. Every query is scoped by group. */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { schema } from '@kaabil/db';
import type { AlertDto, DeviceDto, DoseDto, GroupDto, MedicineDto, Plan } from '@kaabil/contract';
import type { LangCode } from '@kaabil/core';
import { notFound } from './http';
import type { Db } from './types';

const { careGroups, medicines, devices, doseEvents, alerts, member } = schema;

type GroupRow = typeof careGroups.$inferSelect;
type MedicineRow = typeof medicines.$inferSelect;
type DeviceRow = typeof devices.$inferSelect;
type DoseRow = typeof doseEvents.$inferSelect;
type AlertRow = typeof alerts.$inferSelect;

export const medicineDto = (m: MedicineRow): MedicineDto => ({ id: m.id, name: m.name, strength: m.strength, times: m.times });
export const deviceDto = (d: DeviceRow): DeviceDto => ({ id: d.id, name: d.name, createdAt: d.createdAt.getTime(), lastSeenAt: d.lastSeenAt?.getTime() ?? null });
export const doseDto = (d: DoseRow): DoseDto => ({ id: d.id, slotId: d.slotId, medicineId: d.medicineId, atMs: d.atMs, via: d.via as DoseDto['via'], createdAt: d.createdAt.getTime() });
export const alertDto = (a: AlertRow): AlertDto => ({
  id: a.id,
  kind: a.kind as AlertDto['kind'],
  ...(a.slotId ? { slotId: a.slotId } : {}),
  ...(a.medicineId ? { medicineId: a.medicineId } : {}),
  atMs: a.atMs,
  acknowledgedAt: a.acknowledgedAt?.getTime() ?? null,
  delivery: { inApp: 'delivered', push: 'not set up in this prototype' },
});

export async function roleOf(db: Db, userId: string, groupId: string): Promise<'owner' | 'member' | undefined> {
  const [row] = await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, groupId), eq(member.userId, userId))).limit(1);
  if (!row) return undefined;
  return row.role.split(',').includes('owner') ? 'owner' : 'member';
}

/** The caller's role in the group, or a 404 so another family's id is indistinguishable from a missing one. */
export async function requireMember(db: Db, userId: string, groupId: string) {
  const role = await roleOf(db, userId, groupId);
  if (!role) throw notFound('No such group');
  return role;
}

export async function loadGroupRow(db: Db, groupId: string): Promise<GroupRow> {
  const [g] = await db.select().from(careGroups).where(eq(careGroups.id, groupId)).limit(1);
  if (!g) throw notFound('No such group');
  return g;
}

export const listMedicines = (db: Db, groupId: string) => db.select().from(medicines).where(eq(medicines.groupId, groupId)).orderBy(medicines.createdAt);
export const listDevices = (db: Db, groupId: string) => db.select().from(devices).where(and(eq(devices.groupId, groupId), isNull(devices.revokedAt))).orderBy(devices.createdAt);

export async function groupDto(db: Db, groupId: string, role: 'owner' | 'member'): Promise<GroupDto> {
  const g = await loadGroupRow(db, groupId);
  const [meds, devs] = await Promise.all([listMedicines(db, groupId), listDevices(db, groupId)]);
  return {
    id: g.id,
    personName: g.personName,
    address: g.address,
    lang: g.lang as LangCode,
    consent: { missedDose: g.consentMissedDose, emergency: g.consentEmergency },
    medicines: meds.map(medicineDto),
    devices: devs.map(deviceDto),
    role,
  };
}

export async function planFor(db: Db, groupId: string): Promise<Plan> {
  const g = await loadGroupRow(db, groupId);
  const meds = await listMedicines(db, groupId);
  return {
    groupId: g.id,
    person: { name: g.personName, address: g.address },
    lang: g.lang as LangCode,
    consent: { missedDose: g.consentMissedDose, emergency: g.consentEmergency },
    medicines: meds.map(medicineDto),
  };
}

export const listDoses = (db: Db, groupId: string, since = 0) =>
  db.select().from(doseEvents).where(and(eq(doseEvents.groupId, groupId), gte(doseEvents.atMs, since))).orderBy(desc(doseEvents.atMs)).limit(500);

export const listAlerts = (db: Db, groupId: string) => db.select().from(alerts).where(eq(alerts.groupId, groupId)).orderBy(desc(alerts.atMs)).limit(200);
