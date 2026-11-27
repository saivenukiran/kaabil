/**
 * Routes for the person's phone. Pairing needs no credential but a one-time code that the family
 * member types; after that the phone sends its device token. A device can only act for its own
 * group, and a revoked device is refused at once.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AlertInputSchema, DoseInputSchema, PairRequestSchema } from '@kaabil/contract';
import { schema } from '@kaabil/db';
import { createAlert } from '../alertsService';
import { HttpError, parseBody, unauthorized } from '../http';
import { deviceDto, doseDto, listMedicines, planFor } from '../repo';
import { bearer, newDeviceToken, newId, RateLimiter, sha256 } from '../security';
import { deviceClips, getClipAudio } from '../voiceClips';
import type { Deps } from '../types';

const { devices, pairingCodes, doseEvents } = schema;

type Vars = { device: { id: string; groupId: string } };
const PING_EVERY_MS = 15_000;
const SEEN_EVERY_MS = 60_000;

export function deviceRoutes(d: Deps) {
  const app = new Hono<{ Variables: Vars }>();
  // 10 pairing attempts a minute per address: an 8-digit code that lives 10 minutes cannot be guessed at that rate.
  const pairLimit = new RateLimiter(10, 60_000, d.now);

  app.post('/pair', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? 'local').split(',')[0]?.trim() ?? 'local';
    if (!pairLimit.take(ip)) throw new HttpError(429, 'rate_limited', 'Too many tries. Wait a minute and try again.');
    const v = await parseBody(c, PairRequestSchema);
    const token = newDeviceToken();
    const now = new Date(d.now());

    const result = await d.db.transaction(async (tx) => {
      const [code] = await tx
        .update(pairingCodes)
        .set({ usedAt: now })
        .where(and(eq(pairingCodes.codeHash, sha256(v.code)), isNull(pairingCodes.usedAt)))
        .returning();
      if (!code || code.expiresAt.getTime() < now.getTime()) return undefined;
      const id = newId();
      await tx.insert(devices).values({ id, groupId: code.groupId, name: v.deviceName, tokenHash: sha256(token) });
      return { id, groupId: code.groupId };
    });
    // The same message for a wrong, used or expired code, so a guess learns nothing.
    if (!result) throw new HttpError(400, 'invalid_code', 'That code is not right or has run out. Ask your family for a new one.');

    const [row] = await d.db.select().from(devices).where(eq(devices.id, result.id)).limit(1);
    if (row) d.bus.publish(result.groupId, 'family', { type: 'device', device: deviceDto(row) });
    d.log.info({ groupId: result.groupId, deviceId: result.id }, 'phone paired');
    return c.json({ deviceToken: token, groupId: result.groupId }, 201);
  });

  app.use('*', async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    if (!token) throw unauthorized('This phone is not paired');
    const [dev] = await d.db.select().from(devices).where(and(eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt))).limit(1);
    if (!dev) throw unauthorized('This phone is not paired');
    c.set('device', { id: dev.id, groupId: dev.groupId });
    if (!dev.lastSeenAt || d.now() - dev.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await d.db.update(devices).set({ lastSeenAt: new Date(d.now()) }).where(eq(devices.id, dev.id));
    }
    await next();
  });

  app.get('/plan', async (c) => c.json(await planFor(d.db, c.get('device').groupId)));

  app.post('/doses', async (c) => {
    const dev = c.get('device');
    const v = await parseBody(c, DoseInputSchema);
    const meds = await listMedicines(d.db, dev.groupId);
    if (!meds.some((m) => m.id === v.medicineId)) throw new HttpError(400, 'unknown_medicine', 'That medicine is not on this phone\'s plan');
    if (!v.slotId.startsWith(`${v.medicineId}|`)) throw new HttpError(400, 'invalid_slot', 'The slot does not belong to that medicine');

    const [inserted] = await d.db
      .insert(doseEvents)
      .values({ id: newId(), groupId: dev.groupId, medicineId: v.medicineId, slotId: v.slotId, atMs: v.atMs, via: v.via, deviceId: dev.id })
      .onConflictDoNothing({ target: [doseEvents.groupId, doseEvents.slotId] })
      .returning();
    if (inserted) {
      const dto = doseDto(inserted);
      d.bus.publish(dev.groupId, 'family', { type: 'dose', dose: dto });
      return c.json(dto, 201);
    }
    // A retry: the first record stands.
    const [existing] = await d.db.select().from(doseEvents).where(and(eq(doseEvents.groupId, dev.groupId), eq(doseEvents.slotId, v.slotId))).limit(1);
    if (!existing) throw new HttpError(500, 'dose_failed', 'Could not save the dose');
    return c.json(doseDto(existing), 200);
  });

  app.post('/alerts', async (c) => {
    const dev = c.get('device');
    const v = await parseBody(c, AlertInputSchema);
    const r = await createAlert(d, dev.groupId, v, dev.id);
    return c.json(r, r.created ? 201 : 200);
  });

  app.get('/events', async (c) => {
    const dev = c.get('device');
    c.header('Cache-Control', 'no-store');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const off = d.bus.subscribe(dev.groupId, 'device', (e) => void stream.writeSSE({ data: JSON.stringify(e) }));
      stream.onAbort(off);
      try {
        while (!stream.aborted) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'ping', at: d.now() }) });
          await stream.sleep(PING_EVERY_MS);
          const [still] = await d.db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, dev.id), isNull(devices.revokedAt))).limit(1);
          if (!still) break; // a revoked phone stops listening
        }
      } finally {
        off();
      }
    });
  });

  // The family's recordings: the phone lists them (with the sentence each one says) and fetches the audio.
  app.get('/voice', async (c) => c.json({ clips: await deviceClips(d, c.get('device').groupId) }));

  app.get('/voice/:hash/audio', async (c) => {
    const groupId = c.get('device').groupId;
    const hash = c.req.param('hash');
    // Only a recording of a sentence Kaabil still says can be fetched.
    if (!(await deviceClips(d, groupId)).some((k) => k.textHash === hash)) throw new HttpError(404, 'not_found', 'No such recording');
    const clip = await getClipAudio(d, groupId, hash);
    return new Response(clip.bytes as unknown as ConstructorParameters<typeof Response>[0], { status: 200, headers: { 'Content-Type': clip.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  });

  return app;
}
