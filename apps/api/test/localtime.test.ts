import { describe, expect, it } from 'vitest';
import { localParts, slotKey, slotTimeMs } from '../src/sweep';
import { T0 } from './helpers';

describe('local time in India', () => {
  it('reads the local day and minutes', () => {
    expect(localParts(T0, 'Asia/Kolkata')).toEqual({ day: '2026-11-28', minutes: 0 });
    expect(localParts(T0 - 1, 'Asia/Kolkata')).toEqual({ day: '2026-11-27', minutes: 23 * 60 + 59 });
  });
  it('finds the slot time on that day, and builds the same slot id as the phone', () => {
    const now = T0 + 10 * 60 * 60_000 + 17 * 60_000 + 33_000; // 10:17:33
    expect(slotTimeMs(now, '08:00', 'Asia/Kolkata')).toBe(T0 + 8 * 60 * 60_000);
    expect(slotTimeMs(now, '21:30', 'Asia/Kolkata')).toBe(T0 + 21.5 * 60 * 60_000);
    expect(slotKey('m1', now, '08:00', 'Asia/Kolkata')).toBe('m1|2026-11-28|08:00');
  });
});
