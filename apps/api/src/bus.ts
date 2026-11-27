/**
 * An in-memory publish and subscribe hub for live events. One server process, so no broker is needed.
 *
 * Live streams (server-sent events) do not get through every proxy: a Cloudflare quick tunnel, for
 * one, holds them back. So the hub also keeps the last few events of each group with a running id,
 * and a client that cannot stream can ask "what happened after id N?" and wait for the answer
 * (long polling). Both paths read the same events.
 */
import type { ServerEvent } from '@kaabil/contract';

export type Audience = 'family' | 'device';
type Listener = (e: ServerEvent) => void;

export interface Logged {
  id: number;
  event: ServerEvent;
}

/** How many recent events are kept per group and audience. A client that was away longer than this misses the oldest. */
const KEEP = 100;

export class Bus {
  private listeners = new Map<string, Set<Listener>>();
  private logs = new Map<string, Logged[]>();
  private seq = 0;
  private key = (groupId: string, a: Audience) => `${a}:${groupId}`;

  subscribe(groupId: string, audience: Audience, fn: Listener): () => void {
    const k = this.key(groupId, audience);
    let set = this.listeners.get(k);
    if (!set) this.listeners.set(k, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(k);
    };
  }

  publish(groupId: string, audience: Audience, e: ServerEvent): void {
    const k = this.key(groupId, audience);
    const log = this.logs.get(k) ?? [];
    log.push({ id: ++this.seq, event: e });
    if (log.length > KEEP) log.splice(0, log.length - KEEP);
    this.logs.set(k, log);
    for (const fn of this.listeners.get(k) ?? []) {
      try {
        fn(e);
      } catch {
        /* one broken listener must not stop the others */
      }
    }
  }

  /** The id of the newest event the hub has seen (of any group). A new poller starts from here. */
  latest(): number {
    return this.seq;
  }

  /** Events for this group and audience with an id after `after`. */
  since(groupId: string, audience: Audience, after: number): Logged[] {
    return (this.logs.get(this.key(groupId, audience)) ?? []).filter((l) => l.id > after);
  }

  /** Like `since`, but when there is nothing yet, waits up to `ms` for the next event. Resolves early if `signal` aborts. */
  wait(groupId: string, audience: Audience, after: number, ms: number, signal?: AbortSignal): Promise<Logged[]> {
    const now = this.since(groupId, audience, after);
    if (now.length || ms <= 0) return Promise.resolve(now);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        off();
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve(this.since(groupId, audience, after));
      };
      const off = this.subscribe(groupId, audience, () => queueMicrotask(done));
      timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done);
    });
  }

  count(groupId: string, audience: Audience): number {
    return this.listeners.get(this.key(groupId, audience))?.size ?? 0;
  }
}
