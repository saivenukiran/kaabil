/**
 * The database schema. Two parts:
 *
 * 1. Better Auth's tables (user, session, account, verification, and the organization plugin's
 *    organization, member, invitation). Better Auth owns their meaning; we only declare them so
 *    Drizzle can create them and so the library's adapter finds them.
 * 2. Our own tables: the care group (one person and their family), medicines, paired phones,
 *    pairing codes, dose records and alerts.
 *
 * Every domain row carries `groupId`, and every query in the API filters on it.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// ---- Better Auth ----------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  logo: text('logo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: text('metadata'),
});

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('member_org_user_idx').on(t.organizationId, t.userId)],
);

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

// ---- Kaabil ---------------------------------------------------------------------------------

/** The care group. Its id is the Better Auth organization id, so membership and roles come from the library. */
export const careGroups = pgTable('care_groups', {
  id: text('id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  personName: text('person_name').notNull(),
  address: text('address').notNull().default(''),
  lang: text('lang').notNull(),
  consentMissedDose: boolean('consent_missed_dose').notNull().default(false),
  consentEmergency: boolean('consent_emergency').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const medicines = pgTable(
  'medicines',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => careGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    strength: text('strength').notNull().default(''),
    times: jsonb('times').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('medicines_group_idx').on(t.groupId)],
);

/** A paired phone. Only the hash of its token is stored. */
export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => careGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('devices_group_idx').on(t.groupId)],
);

/** One-time pairing code. Only the hash is stored; it expires and works once. */
export const pairingCodes = pgTable(
  'pairing_codes',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => careGroups.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('pairing_group_idx').on(t.groupId)],
);

/** One row per dose slot. The unique key makes a retry harmless. */
export const doseEvents = pgTable(
  'dose_events',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => careGroups.id, { onDelete: 'cascade' }),
    medicineId: text('medicine_id').notNull(),
    slotId: text('slot_id').notNull(),
    atMs: bigint('at_ms', { mode: 'number' }).notNull(),
    via: text('via').notNull(),
    deviceId: text('device_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('dose_group_slot_idx').on(t.groupId, t.slotId), index('dose_group_time_idx').on(t.groupId, t.atMs)],
);

/** An alert for the family. A missed or repeated-dose alert is unique per slot; emergencies are not. */
export const alerts = pgTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => careGroups.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    slotId: text('slot_id'),
    medicineId: text('medicine_id'),
    atMs: bigint('at_ms', { mode: 'number' }).notNull(),
    deviceId: text('device_id'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: text('acknowledged_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('alert_group_kind_slot_idx')
      .on(t.groupId, t.kind, t.slotId)
      .where(sql`${t.slotId} is not null`),
    index('alert_group_time_idx').on(t.groupId, t.atMs),
  ],
);

// ---- Custom voice ----------------------------------------------------------------------------

/** Raw bytes. node-postgres and PGlite hand back different byte types, so both are turned into a Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

/**
 * A family member's own recording of one of Kaabil's fixed sentences, played to the person instead
 * of the synthetic voice. The sentence is stored with the clip, and the person's phone finds a clip
 * only by the exact sentence it is about to say, so Kaabil still speaks nothing it was not written to say.
 * Stored only with the recorder's consent, and deletable.
 */
export const voiceClips = pgTable(
  'voice_clips',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => careGroups.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    /** A short hash of lang and sentence. The family's screen uses it as the clip's name. */
    textHash: text('text_hash').notNull(),
    messageKey: text('message_key').notNull(),
    text: text('text').notNull(),
    contentType: text('content_type').notNull(),
    audio: bytea('audio').notNull(),
    size: integer('size').notNull(),
    recordedBy: text('recorded_by').notNull(),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('voice_group_lang_hash_idx').on(t.groupId, t.lang, t.textHash)],
);
