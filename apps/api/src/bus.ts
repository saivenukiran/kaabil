/** An in-memory publish and subscribe hub for live events. One server process, so no broker is needed. */
import type { ServerEvent } from '@kaabil/contract';

export type Audience = 'family' | 'device';
type Listener = (e: ServerEvent) => void;

export class Bus {
  private listeners = new Map<string, Set<Listener>>();
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
    for (const fn of this.listeners.get(this.key(groupId, audience)) ?? []) {
      try {
        fn(e);
      } catch {
        /* one broken listener must not stop the others */
      }
    }
  }

  count(groupId: string, audience: Audience): number {
    return this.listeners.get(this.key(groupId, audience))?.size ?? 0;
  }
}
