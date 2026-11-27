/** Routes for the family, behind a Better Auth session. Every route checks that the caller belongs to the group in the path. */
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { parseMedicineLine } from '@kaabil/core';
import { CreateGroupSchema, MedicineInputSchema, UpdateGroupSchema, type Me } from '@kaabil/contract';
import { schema } from '@kaabil/db';
import { allowedOrigins } from '../config';
import { HttpError, notFound, parseBody, unauthorized } from '../http';
import { alertDto, doseDto, groupDto, listAlerts, listDoses, medicineDto, requireMember } from '../repo';
import { newId, newPairingCode, originAllowed, sha256 } from '../security';
import { deleteAllClips, deleteClip, getClipAudio, saveClip, voiceOverview } from '../voiceClips';
import type { Deps } from '../types';

const { careGroups, medicines, devices, pairingCodes, alerts, member } = schema;

type Vars = { user: { id: string; name: string; email: string } };

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
const PING_EVERY_MS = 15_000;

export function careRoutes(d: Deps) {
  const app = new Hono<{ Variables: Vars }>();

  // Cookie-authenticated requests that change data must come from our own origin.
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !originAllowed(c.req.header('origin'), c.req.header('sec-fetch-site'), allowedOrigins(d.config))) {
      throw new HttpError(403, 'bad_origin', 'This request did not come from the app');
    }
    await next();
  });

  app.use('*', async (c, next) => {
    const s = await d.auth.api.getSession({ headers: c.req.raw.headers });
    if (!s) throw unauthorized();
    c.set('user', { id: s.user.id, name: s.user.name, email: s.user.email });
    await next();
  });

  app.get('/me', async (c) => {
    const u = c.get('user');
    const rows = await d.db
      .select({ id: careGroups.id, personName: careGroups.personName, role: member.role })
      .from(member)
      .innerJoin(careGroups, eq(careGroups.id, member.organizationId))
      .where(eq(member.userId, u.id));
    const out: Me = { user: u, groups: rows.map((r) => ({ id: r.id, personName: r.personName, role: r.role.split(',').includes('owner') ? ('owner' as const) : ('member' as const) })) };
    return c.json(out);
  });

  app.post('/groups', async (c) => {
    const u = c.get('user');
    const input = await parseBody(c, CreateGroupSchema);
    const org = await d.auth.api.createOrganization({ body: { name: `${input.personName} family`, slug: `g-${newId().slice(0, 12)}` }, headers: c.req.raw.headers });
    if (!org?.id) throw new HttpError(500, 'group_failed', 'Could not create the group');
    try {
      await d.db.insert(careGroups).values({
        id: org.id,
        personName: input.personName,
        address: input.address,
        lang: input.lang,
        consentMissedDose: input.consent.missedDose,
        consentEmergency: input.consent.emergency,
      });
    } catch (e) {
      await d.db.delete(schema.organization).where(eq(schema.organization.id, org.id));
      throw e;
    }
    d.log.info({ groupId: org.id, userId: u.id }, 'care group created');
    return c.json(await groupDto(d.db, org.id, 'owner'), 201);
  });

  app.get('/groups/:id', async (c) => {
    const role = await requireMember(d.db, c.get('user').id, c.req.param('id'));
    return c.json(await groupDto(d.db, c.req.param('id'), role));
  });

  app.patch('/groups/:id', async (c) => {
    const id = c.req.param('id');
    const role = await requireMember(d.db, c.get('user').id, id);
    const v = await parseBody(c, UpdateGroupSchema);
    const set: Partial<typeof careGroups.$inferInsert> = {};
    if (v.personName !== undefined) set.personName = v.personName;
    if (v.address !== undefined) set.address = v.address;
    if (v.lang !== undefined) set.lang = v.lang;
    if (v.consent) {
      set.consentMissedDose = v.consent.missedDose;
      set.consentEmergency = v.consent.emergency;
    }
    if (Object.keys(set).length) await d.db.update(careGroups).set(set).where(eq(careGroups.id, id));
    publishPlan(d, id);
    return c.json(await groupDto(d.db, id, role));
  });

  app.post('/groups/:id/medicines', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    const v = await parseBody(c, MedicineInputSchema);
    let med: { name: string; strength: string; times: string[] };
    if ('line' in v) {
      const parsed = parseMedicineLine(v.line);
      if (!parsed.ok) throw new HttpError(400, 'invalid_medicine', parsed.error);
      med = parsed.value;
    } else {
      med = v;
    }
    const existing = (await d.db.select().from(medicines).where(eq(medicines.groupId, id))).find((m) => m.name.toLowerCase() === med.name.toLowerCase());
    let row;
    if (existing) {
      [row] = await d.db.update(medicines).set({ strength: med.strength, times: med.times }).where(and(eq(medicines.id, existing.id), eq(medicines.groupId, id))).returning();
    } else {
      [row] = await d.db.insert(medicines).values({ id: newId(), groupId: id, name: med.name, strength: med.strength, times: med.times, createdAt: new Date(d.now()) }).returning();
    }
    if (!row) throw new HttpError(500, 'medicine_failed', 'Could not save the medicine');
    publishPlan(d, id);
    return c.json(medicineDto(row), existing ? 200 : 201);
  });

  app.delete('/groups/:id/medicines/:mid', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    const gone = await d.db.delete(medicines).where(and(eq(medicines.id, c.req.param('mid')), eq(medicines.groupId, id))).returning({ id: medicines.id });
    if (!gone.length) throw notFound('No such medicine');
    publishPlan(d, id);
    return c.json({ ok: true as const });
  });

  app.post('/groups/:id/pairing-codes', async (c) => {
    const id = c.req.param('id');
    const u = c.get('user');
    await requireMember(d.db, u.id, id);
    // One live code at a time: a new code replaces any unused one.
    await d.db.delete(pairingCodes).where(and(eq(pairingCodes.groupId, id), isNull(pairingCodes.usedAt)));
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode();
      const expiresAt = new Date(d.now() + PAIRING_CODE_TTL_MS);
      try {
        await d.db.insert(pairingCodes).values({ id: newId(), groupId: id, codeHash: sha256(code), expiresAt, createdBy: u.id });
        return c.json({ code, expiresAt: expiresAt.getTime() }, 201);
      } catch {
        /* the hash was already in use: draw another code */
      }
    }
    throw new HttpError(500, 'code_failed', 'Could not make a pairing code, try again');
  });

  app.delete('/groups/:id/devices/:did', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    const did = c.req.param('did');
    const gone = await d.db.update(devices).set({ revokedAt: new Date(d.now()) }).where(and(eq(devices.id, did), eq(devices.groupId, id), isNull(devices.revokedAt))).returning({ id: devices.id });
    if (!gone.length) throw notFound('No such phone');
    d.bus.publish(id, 'family', { type: 'device', device: null, removedId: did });
    return c.json({ ok: true as const });
  });

  app.get('/groups/:id/doses', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    const since = Number(c.req.query('since') ?? 0);
    return c.json({ doses: (await listDoses(d.db, id, Number.isFinite(since) ? since : 0)).map(doseDto) });
  });

  app.get('/groups/:id/alerts', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    return c.json({ alerts: (await listAlerts(d.db, id)).map(alertDto) });
  });

  app.post('/groups/:id/alerts/:aid/ack', async (c) => {
    const id = c.req.param('id');
    const u = c.get('user');
    await requireMember(d.db, u.id, id);
    const [row] = await d.db
      .update(alerts)
      .set({ acknowledgedAt: new Date(d.now()), acknowledgedBy: u.id })
      .where(and(eq(alerts.id, c.req.param('aid')), eq(alerts.groupId, id)))
      .returning();
    if (!row) throw notFound('No such alert');
    return c.json(alertDto(row));
  });

  app.get('/groups/:id/events', async (c) => {
    const id = c.req.param('id');
    const u = c.get('user');
    await requireMember(d.db, u.id, id);
    c.header('Cache-Control', 'no-store');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const off = d.bus.subscribe(id, 'family', (e) => void stream.writeSSE({ data: JSON.stringify(e) }));
      stream.onAbort(off);
      try {
        while (!stream.aborted) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'ping', at: d.now() }) });
          await stream.sleep(PING_EVERY_MS);
          // A signed-out or removed user must not keep listening.
          const s = await d.auth.api.getSession({ headers: c.req.raw.headers });
          if (!s || !(await requireMember(d.db, s.user.id, id).catch(() => undefined))) break;
        }
      } finally {
        off();
      }
    });
  });

  // ---- Custom voice: the family member's own recordings of Kaabil's fixed sentences
  app.get('/groups/:id/voice', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    return c.json(await voiceOverview(d, id));
  });

  app.put('/groups/:id/voice/:hash', async (c) => {
    const id = c.req.param('id');
    const u = c.get('user');
    await requireMember(d.db, u.id, id);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    await saveClip(d, id, u.id, c.req.param('hash'), c.req.header('content-type'), c.req.header('x-voice-consent'), bytes);
    return c.body(null, 204);
  });

  app.get('/groups/:id/voice/:hash/audio', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    const clip = await getClipAudio(d, id, c.req.param('hash'));
    return new Response(clip.bytes as unknown as ConstructorParameters<typeof Response>[0], { status: 200, headers: { 'Content-Type': clip.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  });

  app.delete('/groups/:id/voice/:hash', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    await deleteClip(d, id, c.req.param('hash'));
    return c.json({ ok: true as const });
  });

  app.delete('/groups/:id/voice', async (c) => {
    const id = c.req.param('id');
    await requireMember(d.db, c.get('user').id, id);
    await deleteAllClips(d, id);
    return c.json({ ok: true as const });
  });

  return app;
}

export function publishPlan(d: Deps, groupId: string): void {
  const e = { type: 'plan' as const, at: d.now() };
  d.bus.publish(groupId, 'device', e);
  d.bus.publish(groupId, 'family', e);
}
