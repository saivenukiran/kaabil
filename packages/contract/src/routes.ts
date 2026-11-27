/**
 * Every endpoint of the API, described once. The reference documentation (`docs/api/endpoints.md`) and the
 * OpenAPI file (`docs/api/openapi.json`) are generated from this list and the schemas, and tests check it
 * against the real server: an endpoint that is added without an entry here, or listed here but missing from
 * the server, fails the build. Better Auth's own sign-in endpoints are not listed here (see `AUTH_ENDPOINTS`).
 */
import { z } from 'zod';
import {
  AlertInputSchema,
  AlertListSchema,
  AlertResultSchema,
  AlertSchema,
  CallSignalSchema,
  CreateGroupSchema,
  IceServersSchema,
  DeviceClipListSchema,
  DoseInputSchema,
  DoseListSchema,
  DoseSchema,
  GroupSchema,
  HealthSchema,
  MeSchema,
  MedicineInputSchema,
  MedicineSchema,
  PairRequestSchema,
  PairResponseSchema,
  PairingCodeSchema,
  PlanSchema,
  PollResultSchema,
  RemindNowSchema,
  UpdateGroupSchema,
  VoiceOverviewSchema,
  VoiceStatusSchema,
} from './schemas';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Area = 'system' | 'family' | 'phone' | 'live' | 'voice' | 'calls' | 'dev';
/** none: anyone. session: a signed-in family member. device: the person's paired phone. dev: a family session, only when the console is on. */
export type Auth = 'none' | 'session' | 'device' | 'dev';

export interface RouteDoc {
  method: Method;
  /** Hono style: `:id` marks a path parameter. */
  path: string;
  area: Area;
  auth: Auth;
  summary: string;
  description?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** A JSON body: its schema and a valid example. Or `raw`: a body that is not JSON. */
  request?: { schema: z.ZodType; example: unknown } | { raw: string; contentType: string };
  /** A JSON answer, or `raw` for audio, a page or a stream. */
  response: { schema: z.ZodType } | { raw: string; contentType: string };
  status: number;
  errors?: { status: number; when: string }[];
  /** Extra headers the caller must send. */
  headers?: Record<string, string>;
}

const E = {
  noSession: { status: 401, when: 'There is no signed-in session' },
  badToken: { status: 401, when: 'The device token is missing, malformed, revoked or unknown' },
  notYours: { status: 404, when: "The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing)" },
  badBody: { status: 400, when: 'The body is not valid JSON or does not match the schema (unknown fields are refused)' },
  badOrigin: { status: 403, when: 'The request did not come from the app: the Origin header is not an allowed one' },
  tooBig: { status: 413, when: 'The body is larger than allowed' },
} as const;

const GROUP = { id: 'The care group id: from POST /api/care/groups or GET /api/care/me' };
const OK = z.object({ ok: z.literal(true) }).strict();

export const ROUTES: RouteDoc[] = [
  // ---- system
  { method: 'GET', path: '/api/health', area: 'system', auth: 'none', summary: 'Is the backend up?', response: { schema: HealthSchema }, status: 200 },

  // ---- family: the account's view
  {
    method: 'GET', path: '/api/care/me', area: 'family', auth: 'session', summary: 'Who is signed in, and which care groups do they belong to',
    response: { schema: MeSchema }, status: 200, errors: [E.noSession],
  },
  {
    method: 'POST', path: '/api/care/groups', area: 'family', auth: 'session', summary: 'Create a care group for one person',
    description: 'The caller becomes its owner. A care group is one person and their family; every record belongs to exactly one. It is created through Better Auth\'s organization plugin, so roles and membership are the library\'s.',
    request: { schema: CreateGroupSchema, example: { personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: true, emergency: true } } },
    response: { schema: GroupSchema }, status: 201, errors: [E.noSession, E.badBody, E.badOrigin],
  },
  {
    method: 'GET', path: '/api/care/groups/:id', area: 'family', auth: 'session', summary: 'One care group: person, language, consent, medicines, paired phones',
    params: GROUP, response: { schema: GroupSchema }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'PATCH', path: '/api/care/groups/:id', area: 'family', auth: 'session', summary: 'Change the person, language or consent',
    description: 'Any field may be left out. Phones are told with a `plan` event, so they pick up the change at once.',
    params: GROUP, request: { schema: UpdateGroupSchema, example: { consent: { missedDose: true, emergency: false } } },
    response: { schema: GroupSchema }, status: 200, errors: [E.noSession, E.notYours, E.badBody, E.badOrigin],
  },
  {
    method: 'POST', path: '/api/care/groups/:id/medicines', area: 'family', auth: 'session', summary: 'Add (or update) a medicine',
    description: 'Send the typed line the family writes (`Metformin 500, 1-0-1`: morning, noon, night; or `OD`, `BD`, `TDS`) or the fields. A line is read by the same parser the app uses and is refused with a plain message if it cannot be read. A medicine with the same name (ignoring case) is updated, and answers 200 instead of 201. Phones get a `plan` event.',
    params: GROUP, request: { schema: MedicineInputSchema, example: { line: 'Metformin 500, 1-0-1' } },
    response: { schema: MedicineSchema }, status: 201,
    errors: [E.noSession, E.notYours, { status: 400, when: 'The line cannot be read (code `invalid_medicine`, with the reason in `message`), or the body is invalid' }, E.badOrigin],
  },
  {
    method: 'DELETE', path: '/api/care/groups/:id/medicines/:mid', area: 'family', auth: 'session', summary: 'Remove a medicine',
    params: { ...GROUP, mid: 'The medicine id' }, response: { schema: OK }, status: 200,
    errors: [E.noSession, E.notYours, { status: 404, when: 'No such medicine in this group' }, E.badOrigin],
  },
  {
    method: 'POST', path: '/api/care/groups/:id/pairing-codes', area: 'family', auth: 'session', summary: "Make a one-time code to pair the person's phone",
    description: 'Eight digits, valid 10 minutes, works once, one live code per group (a new code replaces an unused one). Only its hash is stored. The family member types it on the person\'s phone; the person never says or types it.',
    params: GROUP, response: { schema: PairingCodeSchema }, status: 201, errors: [E.noSession, E.notYours, E.badOrigin],
  },
  {
    method: 'DELETE', path: '/api/care/groups/:id/devices/:did', area: 'family', auth: 'session', summary: "Revoke a paired phone",
    description: 'The phone is refused on its next request, and its live streams close at the next check.',
    params: { ...GROUP, did: 'The device id, from the group\'s `devices` list' }, response: { schema: OK }, status: 200,
    errors: [E.noSession, E.notYours, { status: 404, when: 'No such phone, or it was already revoked' }, E.badOrigin],
  },
  {
    method: 'GET', path: '/api/care/groups/:id/doses', area: 'family', auth: 'session', summary: 'The dose log, newest first (at most 500)',
    params: GROUP, query: { since: 'Optional. Epoch milliseconds: only doses at or after this time' },
    response: { schema: DoseListSchema }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'GET', path: '/api/care/groups/:id/alerts', area: 'family', auth: 'session', summary: 'The alerts, newest first (at most 200)',
    params: GROUP, response: { schema: AlertListSchema }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'POST', path: '/api/care/groups/:id/alerts/:aid/ack', area: 'family', auth: 'session', summary: 'Acknowledge an alert',
    params: { ...GROUP, aid: 'The alert id' }, response: { schema: AlertSchema }, status: 200,
    errors: [E.noSession, E.notYours, { status: 404, when: 'No such alert in this group' }, E.badOrigin],
  },

  // ---- phone
  {
    method: 'POST', path: '/api/device/pair', area: 'phone', auth: 'none', summary: "Pair the person's phone with the family's code",
    description: 'No other credential is needed: the code is the proof. The answer carries a long random device token, shown once; keep it on the phone and send it as `Authorization: Bearer <token>`. Only its hash is stored. A wrong, used or expired code all give the same 400, so a guess learns nothing. Limited to 10 tries a minute per address.',
    request: { schema: PairRequestSchema, example: { code: '12345678', deviceName: 'Amma phone' } },
    response: { schema: PairResponseSchema }, status: 201,
    errors: [{ status: 400, when: 'The code is wrong, used or expired (code `invalid_code`), or the body is invalid' }, { status: 429, when: 'More than 10 tries a minute from this address' }],
  },
  {
    method: 'GET', path: '/api/device/plan', area: 'phone', auth: 'device', summary: 'What the phone needs to run the dose dialogue: person, language, consent, medicines',
    description: 'Medicine ids are the server\'s; the phone uses them in slot ids (`medicineId|YYYY-MM-DD|HH:MM`).',
    response: { schema: PlanSchema }, status: 200, errors: [E.badToken],
  },
  {
    method: 'POST', path: '/api/device/doses', area: 'phone', auth: 'device', summary: 'Record that a dose was taken',
    description: 'Idempotent: one record per slot. The first call answers 201 and tells the family live; a retry answers 200 with the same record and changes nothing. The medicine must be on the phone\'s plan and the slot must belong to it.',
    request: { schema: DoseInputSchema, example: { slotId: 'MEDICINE_ID|2026-11-28|08:00', medicineId: 'MEDICINE_ID', atMs: 1795800000000, via: 'voice' } },
    response: { schema: DoseSchema }, status: 201,
    errors: [E.badToken, { status: 400, when: 'The medicine is not on this phone\'s plan (`unknown_medicine`), the slot does not belong to the medicine (`invalid_slot`), or the body is invalid' }, E.tooBig],
  },
  {
    method: 'POST', path: '/api/device/alerts', area: 'phone', auth: 'device', summary: 'Raise an alert for the family',
    description: 'Kinds: `missed_dose`, `double_dose`, `emergency`. `missed_dose` and `emergency` are created only if the family consented; the answer says why not (`created: false`, `reason: no_consent`). A missed or repeated-dose alert is unique per slot (`reason: duplicate` on a retry); every emergency is recorded. Answers 201 when created, 200 otherwise.',
    request: { schema: AlertInputSchema, example: { kind: 'emergency', atMs: 1795800000000 } },
    response: { schema: AlertResultSchema }, status: 201, errors: [E.badToken, E.badBody],
  },

  // ---- live
  {
    method: 'GET', path: '/api/care/groups/:id/events', area: 'live', auth: 'session', summary: 'Live events for the family: a server-sent-events stream',
    description: 'Each frame is `data: {json}` followed by a blank line. Types: `dose`, `alert`, `plan`, `device`, `voice`, `ping` (every 15 seconds). The server sends a `ping` the moment the stream opens. The stream closes at the next check if the session or the membership ends. Some proxies hold streams back (a Cloudflare quick tunnel does): then use the poll endpoint, or the client in `@kaabil/contract`, which switches by itself.',
    params: GROUP, response: { raw: 'A stream of events (see `ServerEvent`)', contentType: 'text/event-stream' }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'GET', path: '/api/care/groups/:id/poll', area: 'live', auth: 'session', summary: 'The same events by long polling',
    description: 'Ask what happened after event id `after`; the answer waits up to `wait` milliseconds for news. Without `after` the answer has no events and `last` is where to start. Keep the newest `last` and send it as `after` next time. The server keeps the last 100 events per group.',
    params: GROUP, query: { after: 'The id of the last event seen. Leave out to get the starting point', wait: 'Milliseconds to wait for news, 0 to 10000. Default 0' },
    response: { schema: PollResultSchema }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'GET', path: '/api/device/events', area: 'live', auth: 'device', summary: "Live events for the person's phone: a server-sent-events stream",
    description: 'Types: `plan` (the plan changed), `remind` (start a reminder now: from the developer console), `voice` (the family\'s recordings changed), `ping`. Send the device token in the `Authorization` header (so use `fetch`, not `EventSource`, which cannot set headers).',
    response: { raw: 'A stream of events', contentType: 'text/event-stream' }, status: 200, errors: [E.badToken],
  },
  {
    method: 'GET', path: '/api/device/poll', area: 'live', auth: 'device', summary: "The phone's events by long polling",
    description: 'Same as the family poll, for the person\'s phone.',
    query: { after: 'The id of the last event seen. Leave out to get the starting point', wait: 'Milliseconds to wait for news, 0 to 10000. Default 0' },
    response: { schema: PollResultSchema }, status: 200, errors: [E.badToken],
  },

  // ---- voice
  {
    method: 'GET', path: '/api/voice/status', area: 'voice', auth: 'none', summary: 'Is cloud speech or voice available?',
    description: 'Both say `key not set` until a provider key is configured on the server. No provider is wired yet: see `docs/api/voice.md`.',
    response: { schema: VoiceStatusSchema }, status: 200,
  },
  {
    method: 'GET', path: '/api/care/groups/:id/voice', area: 'voice', auth: 'session', summary: "The sentences Kaabil says to this person, and which have your recording",
    description: 'Custom voice. Every fixed message, with the person\'s name and the medicines filled in, each with a `textHash` (its name for upload and delete) and `clip` (null when there is no recording).',
    params: GROUP, response: { schema: VoiceOverviewSchema }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'PUT', path: '/api/care/groups/:id/voice/:hash', area: 'voice', auth: 'session', summary: 'Save your recording of one sentence',
    description: 'The body is the audio itself. Needs the header `x-voice-consent: yes`: the person recording agrees it is stored and played to the person. Accepted types: `audio/wav`, `audio/x-wav`, `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, and the first bytes must match the type. 200 bytes to 1.5 MB. Only a sentence in the list above can be recorded. Replaces an earlier recording. In the browser, process it first (`processRecording` in `@kaabil/voice`: trim, even out, mono 16 kHz WAV).',
    params: { ...GROUP, hash: 'The sentence\'s `textHash`' },
    headers: { 'x-voice-consent': 'yes', 'content-type': 'audio/wav' },
    request: { raw: 'The audio bytes', contentType: 'audio/wav (or another accepted type)' },
    response: { raw: 'No body', contentType: '-' }, status: 204,
    errors: [E.noSession, E.notYours, { status: 400, when: 'No consent (`consent_required`), empty or too short (`too_short`), or not the audio it claims (`not_audio`)' }, { status: 404, when: 'Kaabil does not say that sentence to this person' }, { status: 413, when: 'Over 1.5 MB' }, { status: 415, when: 'An audio type that is not accepted (`unsupported_audio`)' }, E.badOrigin],
  },
  {
    method: 'GET', path: '/api/care/groups/:id/voice/:hash/audio', area: 'voice', auth: 'session', summary: 'Play back a saved recording (family)',
    params: { ...GROUP, hash: 'The sentence\'s `textHash`' }, response: { raw: 'The audio, with its stored type and `nosniff`', contentType: 'audio/*' }, status: 200,
    errors: [E.noSession, E.notYours, { status: 404, when: 'No such recording' }],
  },
  {
    method: 'DELETE', path: '/api/care/groups/:id/voice/:hash', area: 'voice', auth: 'session', summary: 'Delete one recording',
    params: { ...GROUP, hash: 'The sentence\'s `textHash`' }, response: { schema: OK }, status: 200,
    errors: [E.noSession, E.notYours, { status: 404, when: 'No such recording' }, E.badOrigin],
  },
  {
    method: 'DELETE', path: '/api/care/groups/:id/voice', area: 'voice', auth: 'session', summary: 'Delete all recordings of this group',
    params: GROUP, response: { schema: OK }, status: 200, errors: [E.noSession, E.notYours, E.badOrigin],
  },
  {
    method: 'GET', path: '/api/device/voice', area: 'voice', auth: 'device', summary: 'The recordings the phone may play, with the sentence each one says',
    description: 'Only recordings whose sentence Kaabil still says (a renamed medicine retires its old recording). The phone plays a recording only when it is about to say exactly that sentence.',
    response: { schema: DeviceClipListSchema }, status: 200, errors: [E.badToken],
  },
  {
    method: 'GET', path: '/api/device/voice/:hash/audio', area: 'voice', auth: 'device', summary: 'Fetch a recording (phone)',
    params: { hash: 'The recording\'s `textHash`, from the list above' }, response: { raw: 'The audio, with its stored type and `nosniff`', contentType: 'audio/*' }, status: 200,
    errors: [E.badToken, { status: 404, when: 'No such recording, or its sentence is no longer said' }],
  },

  // ---- calls
  {
    method: 'POST', path: '/api/care/groups/:id/call', area: 'calls', auth: 'session', summary: "Send a call message to the person's phone",
    description: 'Voice and video calls go directly between the two phones (WebRTC); this server only carries the setup messages. The body is one signal: `ring`, `accept`, `decline`, `offer`, `answer`, `ice` or `hangup`, with a `callId` (8 to 64 letters, digits or dashes, the same for the whole call) and `from` (it must match who is sending). The other side receives it as a live `call` event. Limits: 300 messages a minute and 6 `ring`s in 5 minutes for each care group.',
    params: GROUP,
    request: { schema: CallSignalSchema, example: { kind: 'ring', callId: 'call-4f7a9c21', from: 'family', withVideo: false } },
    response: { schema: OK }, status: 200,
    errors: [E.noSession, E.notYours, E.badBody, { status: 400, when: '`from` is not `family` (`wrong_sender`)' }, { status: 409, when: 'A `ring` when no phone is paired (`no_phone`)' }, { status: 429, when: 'Too many messages (`rate_limited`) or too many calls (`too_many_calls`)' }, E.badOrigin],
  },
  {
    method: 'POST', path: '/api/device/call', area: 'calls', auth: 'device', summary: 'Send a call message to the family',
    description: 'Voice and video calls go directly between the two phones (WebRTC); this server only carries the setup messages. The body is one signal: `ring`, `accept`, `decline`, `offer`, `answer`, `ice` or `hangup`, with a `callId` (8 to 64 letters, digits or dashes, the same for the whole call) and `from` (it must match who is sending). The other side receives it as a live `call` event. Limits: 300 messages a minute and 6 `ring`s in 5 minutes for each care group.',
    request: { schema: CallSignalSchema, example: { kind: 'ring', callId: 'call-8b21d3e0', from: 'person', withVideo: false } },
    response: { schema: OK }, status: 200,
    errors: [E.badToken, E.badBody, { status: 400, when: '`from` is not `person` (`wrong_sender`)' }, { status: 429, when: 'Too many messages (`rate_limited`) or too many calls (`too_many_calls`)' }],
  },
  {
    method: 'GET', path: '/api/care/groups/:id/ice', area: 'calls', auth: 'session', summary: 'Which servers to use to connect a call (family)',
    description: 'Pass the answer as `iceServers` to `RTCPeerConnection`. Always a public STUN server. When a Cloudflare Realtime TURN key is configured (`CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`), short-lived relay credentials are added so a call still connects when a network blocks the direct path. If the relay cannot be reached the answer is STUN only. Never cached.',
    params: GROUP, response: { schema: IceServersSchema }, status: 200, errors: [E.noSession, E.notYours],
  },
  {
    method: 'GET', path: '/api/device/ice', area: 'calls', auth: 'device', summary: 'Which servers to use to connect a call (phone)',
    description: 'The same answer as the family\'s. Pass it as `iceServers` to `RTCPeerConnection`.',
    response: { schema: IceServersSchema }, status: 200, errors: [E.badToken],
  },

  // ---- developer console (only when KAABIL_DEV_CONSOLE=1)
  {
    method: 'POST', path: '/api/dev/remind-now', area: 'dev', auth: 'dev', summary: "Send a 'remind now' event to the group's phones",
    description: 'Only present when the developer console is on (`KAABIL_DEV_CONSOLE=1`). For demos and tests: makes the paired phone start a reminder at once.',
    request: { schema: RemindNowSchema, example: { groupId: 'GROUP_ID' } },
    response: { schema: OK }, status: 200, errors: [E.noSession, E.notYours, E.badBody, E.badOrigin],
  },
  {
    method: 'GET', path: '/dev', area: 'dev', auth: 'none', summary: 'The plain test console (HTML)',
    description: 'Only present when the developer console is on. A developer tool, not the product screens.',
    response: { raw: 'A single HTML page', contentType: 'text/html' }, status: 200,
  },
];

/**
 * Better Auth owns these. They are real endpoints of ours, but their shapes are the library's, so they are
 * described here briefly and not generated. The library has many more under `/api/auth/` (organization
 * management among them); the ones the apps use are listed.
 */
export const AUTH_ENDPOINTS = [
  { method: 'POST', path: '/api/auth/sign-up/email', body: '{ "name": string, "email": string, "password": string (10 to 128 characters) }', does: 'Creates the account and signs it in; sets the session cookie.' },
  { method: 'POST', path: '/api/auth/sign-in/email', body: '{ "email": string, "password": string }', does: 'Signs in; sets the session cookie.' },
  { method: 'POST', path: '/api/auth/sign-out', body: '{}', does: 'Ends the session on the server.' },
  { method: 'GET', path: '/api/auth/get-session', body: '-', does: 'The current session and user, or null.' },
] as const;

/** The call in `@kaabil/contract`'s typed client that uses each endpoint (`METHOD path`). Tested: each must exist on the client. */
export const CLIENT_CALLS: Record<string, string> = {
  'GET /api/health': 'client.health()',
  'GET /api/care/me': 'client.family.me()',
  'POST /api/care/groups': 'client.family.createGroup({ personName, address, lang, consent })',
  'GET /api/care/groups/:id': 'client.family.group(groupId)',
  'PATCH /api/care/groups/:id': 'client.family.updateGroup(groupId, { consent })',
  'POST /api/care/groups/:id/medicines': "client.family.addMedicine(groupId, { line: 'Metformin 500, 1-0-1' })",
  'DELETE /api/care/groups/:id/medicines/:mid': 'client.family.removeMedicine(groupId, medicineId)',
  'POST /api/care/groups/:id/pairing-codes': 'client.family.createPairingCode(groupId)',
  'DELETE /api/care/groups/:id/devices/:did': 'client.family.revokeDevice(groupId, deviceId)',
  'GET /api/care/groups/:id/doses': 'client.family.doses(groupId, since)',
  'GET /api/care/groups/:id/alerts': 'client.family.alerts(groupId)',
  'POST /api/care/groups/:id/alerts/:aid/ack': 'client.family.acknowledge(groupId, alertId)',
  'GET /api/care/groups/:id/events': 'client.family.events(groupId, { onEvent })   // opens the stream, and polls by itself if it is held back',
  'GET /api/care/groups/:id/poll': 'client.family.events(groupId, { onEvent })   // the same call: it falls back to this endpoint by itself',
  'POST /api/device/pair': 'client.device.pair(code, deviceName)   // keeps the token for later calls',
  'GET /api/device/plan': 'client.device.plan()',
  'POST /api/device/doses': 'client.device.postDose({ slotId, medicineId, atMs, via })',
  'POST /api/device/alerts': 'client.device.postAlert({ kind, atMs })',
  'GET /api/device/events': 'client.device.events({ onEvent })',
  'POST /api/care/groups/:id/call': "client.family.sendCallSignal(groupId, { kind: 'ring', callId, from: 'family', withVideo: false })",
  'POST /api/device/call': "client.device.sendCallSignal({ kind: 'accept', callId, from: 'person' })",
  'GET /api/care/groups/:id/ice': 'client.family.iceServers(groupId)',
  'GET /api/device/ice': 'client.device.iceServers()',
  'GET /api/device/poll': 'client.device.events({ onEvent })   // falls back to this endpoint by itself',
  'GET /api/voice/status': 'client.voice.status()',
  'GET /api/care/groups/:id/voice': 'client.family.voice(groupId)',
  'PUT /api/care/groups/:id/voice/:hash': 'client.family.uploadClip(groupId, textHash, audioBlob, true)',
  'GET /api/care/groups/:id/voice/:hash/audio': 'client.family.clipAudio(groupId, textHash)',
  'DELETE /api/care/groups/:id/voice/:hash': 'client.family.deleteClip(groupId, textHash)',
  'DELETE /api/care/groups/:id/voice': 'client.family.deleteAllClips(groupId)',
  'GET /api/device/voice': 'client.device.voiceClips()',
  'GET /api/device/voice/:hash/audio': 'client.device.clipAudio(textHash)',
  'POST /api/dev/remind-now': 'client.dev.remindNow(groupId)',
};
