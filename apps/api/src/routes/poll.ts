/**
 * Long polling: the same events as the live stream, for clients that cannot stream. A Cloudflare quick
 * tunnel, for example, accepts the stream and then holds every event back, so a phone behind one must
 * ask instead. `after` is the id of the last event the client has seen; the answer waits up to `wait`
 * milliseconds for something newer. Without `after` the answer is the starting point, with no events.
 */
import type { PollResult } from '@kaabil/contract';
import type { Audience } from '../bus';
import type { Deps } from '../types';

export const MAX_WAIT_MS = 10_000;

export async function pollAnswer(d: Deps, groupId: string, audience: Audience, query: { after?: string; wait?: string }, signal?: AbortSignal): Promise<PollResult> {
  const after = Number(query.after);
  if (query.after === undefined || !Number.isInteger(after) || after < 0) return { events: [], last: d.bus.latest() };
  const wait = Math.min(MAX_WAIT_MS, Math.max(0, Number.isFinite(Number(query.wait)) ? Number(query.wait) : 0));
  const events = await d.bus.wait(groupId, audience, after, wait, signal);
  return { events: events.map((l) => ({ id: l.id, event: l.event })), last: events.length ? events[events.length - 1]!.id : after };
}
