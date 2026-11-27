/**
 * A typed client for the Kaabil API. The family uses the cookie session that Better Auth sets;
 * the person's phone sends its device token. Every response is validated against the schemas, so
 * a server that drifts from the contract fails loudly here.
 */
import { z } from 'zod';
import {
  AlertListSchema,
  AlertResultSchema,
  AlertSchema,
  DoseListSchema,
  DeviceClipListSchema,
  DoseSchema,
  ErrorBodySchema,
  GroupSchema,
  HealthSchema,
  MeSchema,
  MedicineSchema,
  PairResponseSchema,
  PairingCodeSchema,
  PlanSchema,
  SttResultSchema,
  VoiceOverviewSchema,
  VoiceStatusSchema,
  type AlertInput,
  type CreateGroup,
  type DoseInput,
  type MedicineInput,
  type ServerEvent,
  type UpdateGroup,
} from './schemas';
import { live, type StreamStatus } from './sse';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  /** Empty for the same origin as the page. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The person's phone sets this after pairing. */
  deviceToken?: string;
  /** How long a live stream may stay silent before the client switches to polling. Default 5000. */
  streamWatchdogMs?: number;
}

export interface EventHandlers {
  onEvent: (e: ServerEvent) => void;
  onStatus?: (s: StreamStatus) => void;
}

export function createClient(options: ClientOptions = {}) {
  const base = options.baseUrl ?? '';
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let deviceToken = options.deviceToken;

  const deviceHeaders = (): Record<string, string> => {
    if (!deviceToken) throw new ApiError(0, 'no_device_token', 'This phone is not paired yet.');
    return { authorization: `Bearer ${deviceToken}` };
  };

  async function send<S extends z.ZodType>(method: string, path: string, schema: S, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<z.infer<S>> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await doFetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    const json: unknown = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const e = ErrorBodySchema.safeParse(json);
      throw new ApiError(res.status, e.success ? e.data.error.code : 'http_error', e.success ? e.data.error.message : `Request failed (${res.status})`);
    }
    return schema.parse(json);
  }

  /** A request whose body or answer is raw bytes (audio). Errors still come back as ApiError. */
  async function binary(method: string, path: string, headers: Record<string, string>, body?: Blob): Promise<Response> {
    const res = await doFetch(`${base}${path}`, { method, headers, body });
    if (!res.ok) {
      const e = ErrorBodySchema.safeParse(safeJson(await res.text()));
      throw new ApiError(res.status, e.success ? e.data.error.code : 'http_error', e.success ? e.data.error.message : `Request failed (${res.status})`);
    }
    return res;
  }

  const family = (method: string, path: string, schema: z.ZodType, body?: unknown) => send(method, path, schema, { body });
  const device = async (method: string, path: string, schema: z.ZodType, body?: unknown) => send(method, path, schema, { body, headers: deviceHeaders() });
  const Ok = z.object({ ok: z.literal(true) }).strict();
  const g = (id: string) => `/api/care/groups/${encodeURIComponent(id)}`;

  /** Live events: a stream when one gets through, long polling when something holds the stream back. */
  function stream(url: string, headers: Record<string, string>, h: EventHandlers, pollPath: string): () => void {
    const ctl = new AbortController();
    void live({
      url: `${base}${url}`,
      fetch: doFetch,
      headers,
      signal: ctl.signal,
      onEvent: h.onEvent,
      onStatus: h.onStatus,
      firstEventMs: options.streamWatchdogMs,
      pollUrl: (after, waitMs) => `${base}${pollPath}${after === undefined ? '' : `?after=${after}&wait=${waitMs}`}`,
    });
    return () => ctl.abort();
  }

  return {
    health: () => send('GET', '/api/health', HealthSchema),

    /** Sign-in is Better Auth's own endpoint. The response body is not part of our contract. */
    auth: {
      signUp: (v: { name: string; email: string; password: string }) => send('POST', '/api/auth/sign-up/email', z.unknown(), { body: v }).then(() => undefined),
      signIn: (v: { email: string; password: string }) => send('POST', '/api/auth/sign-in/email', z.unknown(), { body: v }).then(() => undefined),
      signOut: () => send('POST', '/api/auth/sign-out', z.unknown(), { body: {} }).then(() => undefined),
      session: () => send('GET', '/api/auth/get-session', z.unknown()),
    },

    family: {
      me: () => family('GET', '/api/care/me', MeSchema) as Promise<z.infer<typeof MeSchema>>,
      createGroup: (v: CreateGroup) => family('POST', '/api/care/groups', GroupSchema, v) as Promise<z.infer<typeof GroupSchema>>,
      group: (id: string) => family('GET', g(id), GroupSchema) as Promise<z.infer<typeof GroupSchema>>,
      updateGroup: (id: string, v: UpdateGroup) => family('PATCH', g(id), GroupSchema, v) as Promise<z.infer<typeof GroupSchema>>,
      addMedicine: (id: string, v: MedicineInput) => family('POST', `${g(id)}/medicines`, MedicineSchema, v) as Promise<z.infer<typeof MedicineSchema>>,
      removeMedicine: (id: string, medicineId: string) => family('DELETE', `${g(id)}/medicines/${encodeURIComponent(medicineId)}`, Ok),
      createPairingCode: (id: string) => family('POST', `${g(id)}/pairing-codes`, PairingCodeSchema) as Promise<z.infer<typeof PairingCodeSchema>>,
      revokeDevice: (id: string, deviceId: string) => family('DELETE', `${g(id)}/devices/${encodeURIComponent(deviceId)}`, Ok),
      doses: (id: string, since?: number) => family('GET', `${g(id)}/doses${since ? `?since=${since}` : ''}`, DoseListSchema) as Promise<z.infer<typeof DoseListSchema>>,
      alerts: (id: string) => family('GET', `${g(id)}/alerts`, AlertListSchema) as Promise<z.infer<typeof AlertListSchema>>,
      acknowledge: (id: string, alertId: string) => family('POST', `${g(id)}/alerts/${encodeURIComponent(alertId)}/ack`, AlertSchema) as Promise<z.infer<typeof AlertSchema>>,
      /** Returns a function that closes the stream. Reconnects by itself. */
      events: (id: string, h: EventHandlers) => stream(`${g(id)}/events`, {}, h, `${g(id)}/poll`),

      /** Custom voice. The sentences Kaabil will say for this person, and which already have a recording. */
      voice: (id: string) => family('GET', `${g(id)}/voice`, VoiceOverviewSchema) as Promise<z.infer<typeof VoiceOverviewSchema>>,
      /** Upload a recording of one sentence. `consent` must be true: the recorder agrees it is stored and played to the person. */
      uploadClip: (id: string, textHash: string, audio: Blob, consent: boolean) =>
        binary('PUT', `${g(id)}/voice/${encodeURIComponent(textHash)}`, { 'content-type': audio.type, ...(consent ? { 'x-voice-consent': 'yes' } : {}) }, audio).then(() => undefined),
      deleteClip: (id: string, textHash: string) => family('DELETE', `${g(id)}/voice/${encodeURIComponent(textHash)}`, Ok),
      deleteAllClips: (id: string) => family('DELETE', `${g(id)}/voice`, Ok),
      clipAudio: (id: string, textHash: string) => binary('GET', `${g(id)}/voice/${encodeURIComponent(textHash)}/audio`, {}).then((r) => r.blob()),
    },

    device: {
      /** After pairing, the token is kept in the client and returned so the app can store it. */
      pair: async (code: string, deviceName: string) => {
        const r = await send('POST', '/api/device/pair', PairResponseSchema, { body: { code, deviceName } });
        deviceToken = r.deviceToken;
        return r;
      },
      setToken: (t: string | undefined) => {
        deviceToken = t;
      },
      plan: () => device('GET', '/api/device/plan', PlanSchema) as Promise<z.infer<typeof PlanSchema>>,
      postDose: (v: DoseInput) => device('POST', '/api/device/doses', DoseSchema, v) as Promise<z.infer<typeof DoseSchema>>,
      postAlert: (v: AlertInput) => device('POST', '/api/device/alerts', AlertResultSchema, v) as Promise<z.infer<typeof AlertResultSchema>>,
      events: (h: EventHandlers) => stream('/api/device/events', deviceHeaders(), h, '/api/device/poll'),
      /** The recordings the family made, to match against what this phone is about to say. */
      voiceClips: () => device('GET', '/api/device/voice', DeviceClipListSchema) as Promise<z.infer<typeof DeviceClipListSchema>>,
      clipAudio: async (textHash: string) => (await binary('GET', `/api/device/voice/${encodeURIComponent(textHash)}/audio`, deviceHeaders())).blob(),
    },

    voice: {
      status: () => send('GET', '/api/voice/status', VoiceStatusSchema, { headers: deviceToken ? deviceHeaders() : {} }),
      stt: async (audio: Blob, lang: string) => {
        const res = await doFetch(`${base}/api/voice/stt?lang=${encodeURIComponent(lang)}`, { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm', ...(deviceToken ? deviceHeaders() : {}) }, body: audio });
        if (!res.ok) throw new ApiError(res.status, 'stt_failed', `Speech recognition failed (${res.status})`);
        return SttResultSchema.parse(await res.json());
      },
    },

    dev: {
      remindNow: (groupId: string, medicineId?: string) => send('POST', '/api/dev/remind-now', Ok, { body: { groupId, medicineId } }),
    },
  };
}

export type Client = ReturnType<typeof createClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
