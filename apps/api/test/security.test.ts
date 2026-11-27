import { describe, expect, it } from 'vitest';
import { bearer, newDeviceToken, newPairingCode, originAllowed, RateLimiter, sha256 } from '../src/security';

describe('security helpers', () => {
  it('makes 8-digit pairing codes and long device tokens', () => {
    for (let i = 0; i < 50; i++) expect(newPairingCode()).toMatch(/^\d{8}$/);
    expect(newDeviceToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newDeviceToken()).not.toBe(newDeviceToken());
  });
  it('hashes the same way every time', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(sha256('a')).not.toBe(sha256('b'));
  });
  it('rate limits per key and resets after the window', () => {
    let now = 0;
    const r = new RateLimiter(2, 1000, () => now);
    expect([r.take('a'), r.take('a'), r.take('a'), r.take('b')]).toEqual([true, true, false, true]);
    now = 1001;
    expect(r.take('a')).toBe(true);
  });
  it('accepts only our origins, and a missing origin only when the browser does not say cross-site', () => {
    const allowed = ['http://localhost:8080'];
    expect(originAllowed('http://localhost:8080', undefined, allowed)).toBe(true);
    expect(originAllowed('https://evil.example', 'same-origin', allowed)).toBe(false);
    expect(originAllowed(undefined, undefined, allowed)).toBe(true);
    expect(originAllowed(undefined, 'same-origin', allowed)).toBe(true);
    expect(originAllowed(undefined, 'cross-site', allowed)).toBe(false);
    expect(originAllowed(undefined, 'same-site', allowed)).toBe(false);
  });
  it('reads only well-formed bearer tokens', () => {
    expect(bearer(`Bearer ${'a'.repeat(43)}`)).toBe('a'.repeat(43));
    expect(bearer('Bearer short')).toBeUndefined();
    expect(bearer(`Basic ${'a'.repeat(43)}`)).toBeUndefined();
    expect(bearer(undefined)).toBeUndefined();
  });
});
