/**
 * The shapes that cross the wire between the web app (or any client) and the API.
 * The server validates every request body against these, and the client validates every
 * response, so a drift between the two shows up as an error instead of a silent bug.
 * Every object is strict: an unknown field is rejected.
 */
import { z } from 'zod';
import { isLangCode, MESSAGE_KEYS, type LangCode } from '@kaabil/core';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const LangSchema = z.custom<LangCode>((v) => typeof v === 'string' && isLangCode(v), 'unknown language');
export const TimeOfDaySchema = z.string().regex(HHMM, 'use HH:MM');
export const ConsentSchema = z.object({ missedDose: z.boolean(), emergency: z.boolean() }).strict();
export const MessageKeySchema = z.enum(MESSAGE_KEYS);
export const AlertKindSchema = z.enum(['missed_dose', 'double_dose', 'emergency']);
export const ViaSchema = z.enum(['voice', 'button']);

export const MedicineSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    strength: z.string().max(20),
    times: z.array(TimeOfDaySchema).min(1).max(6),
  })
  .strict();
export type MedicineDto = z.infer<typeof MedicineSchema>;

/** Add a medicine either as the typed line the family writes ("Metformin 500, 1-0-1") or as fields. */
export const MedicineInputSchema = z.union([
  z.object({ line: z.string().min(1).max(120) }).strict(),
  z
    .object({
      name: z.string().min(1).max(80),
      strength: z.string().max(20),
      times: z.array(TimeOfDaySchema).min(1).max(6),
    })
    .strict(),
]);
export type MedicineInput = z.infer<typeof MedicineInputSchema>;

export const PersonSchema = z.object({ name: z.string().min(1).max(60), address: z.string().max(40) }).strict();

export const CreateGroupSchema = z
  .object({ personName: z.string().min(1).max(60), address: z.string().max(40), lang: LangSchema, consent: ConsentSchema })
  .strict();
export type CreateGroup = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z
  .object({ personName: z.string().min(1).max(60), address: z.string().max(40), lang: LangSchema, consent: ConsentSchema })
  .partial()
  .strict();
export type UpdateGroup = z.infer<typeof UpdateGroupSchema>;

export const DeviceSchema = z
  .object({ id: z.string(), name: z.string(), createdAt: z.number(), lastSeenAt: z.number().nullable() })
  .strict();
export type DeviceDto = z.infer<typeof DeviceSchema>;

export const RoleSchema = z.enum(['owner', 'member']);

export const GroupSchema = z
  .object({
    id: z.string(),
    personName: z.string(),
    address: z.string(),
    lang: LangSchema,
    consent: ConsentSchema,
    medicines: z.array(MedicineSchema),
    devices: z.array(DeviceSchema),
    role: RoleSchema,
  })
  .strict();
export type GroupDto = z.infer<typeof GroupSchema>;

export const MeSchema = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }).strict(),
    groups: z.array(z.object({ id: z.string(), personName: z.string(), role: RoleSchema }).strict()),
  })
  .strict();
export type Me = z.infer<typeof MeSchema>;

export const PairingCodeSchema = z.object({ code: z.string().regex(/^\d{8}$/), expiresAt: z.number() }).strict();
export type PairingCode = z.infer<typeof PairingCodeSchema>;

export const PairRequestSchema = z.object({ code: z.string().regex(/^\d{8}$/), deviceName: z.string().min(1).max(40) }).strict();
export const PairResponseSchema = z.object({ deviceToken: z.string().min(32), groupId: z.string() }).strict();
export type PairResponse = z.infer<typeof PairResponseSchema>;

/** What the person's phone needs to run the dose dialogue. Server medicine ids are used in slot ids. */
export const PlanSchema = z
  .object({
    groupId: z.string(),
    person: PersonSchema,
    lang: LangSchema,
    consent: ConsentSchema,
    medicines: z.array(MedicineSchema),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;

export const DoseInputSchema = z
  .object({ slotId: z.string().min(3).max(120), medicineId: z.string().min(1), atMs: z.number().int().positive(), via: ViaSchema })
  .strict();
export type DoseInput = z.infer<typeof DoseInputSchema>;

export const DoseSchema = DoseInputSchema.extend({ id: z.string(), createdAt: z.number() }).strict();
export type DoseDto = z.infer<typeof DoseSchema>;

export const AlertInputSchema = z
  .object({ kind: AlertKindSchema, slotId: z.string().max(120).optional(), medicineId: z.string().optional(), atMs: z.number().int().positive() })
  .strict();
export type AlertInput = z.infer<typeof AlertInputSchema>;

export const AlertSchema = z
  .object({
    id: z.string(),
    kind: AlertKindSchema,
    slotId: z.string().optional(),
    medicineId: z.string().optional(),
    atMs: z.number(),
    acknowledgedAt: z.number().nullable(),
    delivery: z.object({ inApp: z.enum(['delivered', 'failed']), push: z.literal('not set up in this prototype') }).strict(),
  })
  .strict();
export type AlertDto = z.infer<typeof AlertSchema>;

/** The result of posting an alert: the alert, or the reason none was created. */
export const AlertResultSchema = z.union([
  z.object({ created: z.literal(true), alert: AlertSchema }).strict(),
  z.object({ created: z.literal(false), reason: z.enum(['no_consent', 'duplicate']), alert: AlertSchema.optional() }).strict(),
]);
export type AlertResult = z.infer<typeof AlertResultSchema>;

export const DoseListSchema = z.object({ doses: z.array(DoseSchema) }).strict();
export const AlertListSchema = z.object({ alerts: z.array(AlertSchema) }).strict();

/** Live events. Family streams get dose, alert, plan, device and ping; device streams get plan, remind and ping. */
export const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dose'), dose: DoseSchema }).strict(),
  z.object({ type: z.literal('alert'), alert: AlertSchema }).strict(),
  z.object({ type: z.literal('plan'), at: z.number() }).strict(),
  z.object({ type: z.literal('device'), device: DeviceSchema.nullable(), removedId: z.string().optional() }).strict(),
  z.object({ type: z.literal('remind'), medicineId: z.string().optional(), at: z.number() }).strict(),
  z.object({ type: z.literal('voice'), at: z.number() }).strict(),
  z.object({ type: z.literal('ping'), at: z.number() }).strict(),
]);
export type ServerEvent = z.infer<typeof EventSchema>;

export const RemindNowSchema = z.object({ groupId: z.string(), medicineId: z.string().optional() }).strict();

export const VoiceStatusSchema = z
  .object({ stt: z.enum(['ready', 'key not set']), tts: z.enum(['ready', 'key not set']) })
  .strict();
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const SttResultSchema = z.object({ text: z.string() }).strict();
/** Speech out is only ever one of the fixed messages, so the server can never speak free text. */
export const TtsRequestSchema = z
  .object({ key: MessageKeySchema, lang: LangSchema, vars: z.object({ address: z.string().max(40), name: z.string().max(80), strength: z.string().max(20) }).partial().strict() })
  .strict();

/**
 * Custom voice: a family member records their own voice reading one of Kaabil's fixed sentences.
 * The person's phone plays the recording instead of the synthetic voice, only for that exact sentence.
 */
export const VOICE_MAX_BYTES = 1_500_000;
export const VOICE_MAX_SECONDS = 15;
export const VOICE_CONTENT_TYPES = ['audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'] as const;

const TextHashSchema = z.string().regex(/^[0-9a-f]{16}$/);

export const VoiceSentenceSchema = z
  .object({
    key: MessageKeySchema,
    lang: LangSchema,
    text: z.string(),
    textHash: TextHashSchema,
    medicineName: z.string().optional(),
    clip: z.object({ contentType: z.string(), size: z.number(), createdAt: z.number() }).strict().nullable(),
  })
  .strict();
export type VoiceSentence = z.infer<typeof VoiceSentenceSchema>;

export const VoiceOverviewSchema = z
  .object({ sentences: z.array(VoiceSentenceSchema), maxBytes: z.number(), maxSeconds: z.number() })
  .strict();
export type VoiceOverview = z.infer<typeof VoiceOverviewSchema>;

/** What the person's phone needs to find a recording: the sentence, to match against what it is about to say. */
export const DeviceClipSchema = z.object({ lang: LangSchema, text: z.string(), textHash: TextHashSchema, contentType: z.string(), size: z.number() }).strict();
export const DeviceClipListSchema = z.object({ clips: z.array(DeviceClipSchema) }).strict();
export type DeviceClip = z.infer<typeof DeviceClipSchema>;

export const HealthSchema = z.object({ ok: z.literal(true), version: z.string() }).strict();

export const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }).strict() }).strict();
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
