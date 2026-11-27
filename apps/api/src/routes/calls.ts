/**
 * Calls between the person and the family: this server only passes the setup messages (signalling) from one
 * side to the other, over the same live channel as every other event. The voice and video themselves go
 * directly between the two phones (or through a relay), never through this server.
 *
 * Who may ring whom is fixed by the group: a signed-in family member rings that group's phones, and a paired
 * phone rings that group's family. Every message is checked against the schema, must claim to come from
 * the side that sent it, and is rate limited so one group cannot be flooded with calls.
 */
import type { CallSignal } from '@kaabil/contract';
import { HttpError } from '../http';
import { listDevices } from '../repo';
import { RateLimiter } from '../security';
import type { Deps } from '../types';

/** A call takes a few dozen messages (most are network candidates). */
export const SIGNALS_PER_MINUTE = 300;
export const RINGS_PER_WINDOW = 6;
export const RING_WINDOW_MS = 5 * 60_000;

const limits = new WeakMap<Deps, { signals: RateLimiter; rings: RateLimiter }>();
function limitsOf(d: Deps) {
  let l = limits.get(d);
  if (!l) limits.set(d, (l = { signals: new RateLimiter(SIGNALS_PER_MINUTE, 60_000, d.now), rings: new RateLimiter(RINGS_PER_WINDOW, RING_WINDOW_MS, d.now) }));
  return l;
}

/** Pass one signalling message (already checked against the schema) to the other side. `sender` is who really sent it, known from how they signed in. */
export async function relaySignal(d: Deps, groupId: string, sender: 'family' | 'person', signal: CallSignal): Promise<void> {
  if (signal.from !== sender) throw new HttpError(400, 'wrong_sender', 'The message says it is from the other side');

  const { signals, rings } = limitsOf(d);
  if (!signals.take(groupId)) throw new HttpError(429, 'rate_limited', 'Too many call messages. Wait a minute.');
  if (signal.kind === 'ring') {
    if (!rings.take(groupId)) throw new HttpError(429, 'too_many_calls', 'Too many calls just now. Wait a few minutes and try again.');
    // Ringing a phone nobody has paired would ring for nothing: say so at once.
    if (sender === 'family' && (await listDevices(d.db, groupId)).length === 0) throw new HttpError(409, 'no_phone', "No phone is paired yet, so there is no one to call");
  }
  d.bus.publish(groupId, sender === 'family' ? 'device' : 'family', { type: 'call', signal });
}
