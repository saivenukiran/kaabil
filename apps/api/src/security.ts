/** Small security helpers: hashing, one-time codes, device tokens, a rate limiter and an origin check. */
import { createHash, randomBytes, randomInt } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** An 8-digit pairing code. The family member types it; the person never says or types it. */
export const newPairingCode = () => String(randomInt(0, 100_000_000)).padStart(8, '0');

/** A long random device token. Only its hash is stored. */
export const newDeviceToken = () => randomBytes(32).toString('base64url');

export const newId = () => crypto.randomUUID();

/** A fixed-window counter per key. In memory, which is enough for one server and a prototype. */
export class RateLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the call is allowed. */
  take(key: string): boolean {
    const t = this.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { n: 1, resetAt: t + this.windowMs });
      this.sweep(t);
      return true;
    }
    cur.n += 1;
    return cur.n <= this.max;
  }

  private sweep(t: number): void {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

/**
 * Cookie-authenticated requests that change data must come from our own origin. Browsers always
 * send `Origin` on such requests. A request with no `Origin` is allowed only when the browser does
 * not mark it cross-site, which keeps curl and tests working but blocks a forged form post.
 */
export function originAllowed(origin: string | undefined, fetchSite: string | undefined, allowed: string[]): boolean {
  if (origin) return allowed.includes(origin.replace(/\/$/, ''));
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}

export const bearer = (header: string | undefined): string | undefined => {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header ?? '');
  return m?.[1];
};
