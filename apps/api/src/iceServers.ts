/**
 * Which servers a phone uses to find a path to the other phone.
 *
 * Always Cloudflare's public STUN server (free, no account), which is enough when the two phones can reach
 * each other directly (same network, most home networks). When a Cloudflare Realtime TURN key is configured
 * (`CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`), short-lived relay credentials are added, so a call still
 * connects when a network blocks the direct path (a phone on mobile data calling one on Wi-Fi often needs it).
 * The relay credentials are made here, on the server, and kept for half their life; the token never leaves
 * the server. If the relay cannot be reached, the answer is STUN only: a call is never refused because of it.
 */
import { IceServersSchema, type IceServers } from '@kaabil/contract';
import type { Deps } from './types';

export const STUN: IceServers['iceServers'][number] = { urls: ['stun:stun.cloudflare.com:3478'] };

const TTL_SECONDS = 3600;
const KEEP_MS = (TTL_SECONDS / 2) * 1000;
const cache = new WeakMap<Deps, { at: number; value: IceServers }>();

export async function getIceServers(d: Deps): Promise<IceServers> {
  const turn = d.config.turn;
  if (!turn) return { iceServers: [STUN] };

  const hit = cache.get(d);
  if (hit && d.now() - hit.at < KEEP_MS) return hit.value;

  try {
    const res = await (d.fetch ?? fetch)(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turn.keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${turn.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`relay answered ${res.status}`);
    const parsed = IceServersSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('relay answered with an unexpected shape');
    // Browsers block port 53, so that address would only make a call wait for a timeout.
    const servers = parsed.data.iceServers
      .map((s) => ({ ...s, urls: s.urls.filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    const value = { iceServers: servers.some((s) => s.urls.some((u) => u.startsWith('stun:'))) ? servers : [STUN, ...servers] };
    cache.set(d, { at: d.now(), value });
    return value;
  } catch (e) {
    d.log.warn({ err: (e as Error).message }, 'relay credentials unavailable, using STUN only'); // never the token
    return { iceServers: [STUN] };
  }
}
