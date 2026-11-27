import { describe, expect, it } from 'vitest';
import { Bus } from '../src/bus';

const ping = (at: number) => ({ type: 'ping' as const, at });

describe('the bus keeps recent events for pollers', () => {
  it('numbers events and returns only those after a given id, for the right group and audience', () => {
    const b = new Bus();
    b.publish('g1', 'family', ping(1));
    b.publish('g2', 'family', ping(2));
    b.publish('g1', 'device', ping(3));
    b.publish('g1', 'family', ping(4));
    expect(b.since('g1', 'family', 0).map((l) => l.event)).toEqual([ping(1), ping(4)]);
    const first = b.since('g1', 'family', 0)[0]!;
    expect(b.since('g1', 'family', first.id).map((l) => l.event)).toEqual([ping(4)]);
    expect(b.since('g1', 'family', b.latest())).toEqual([]);
    expect(b.since('g2', 'device', 0)).toEqual([]);
  });

  it('keeps only the last 100 events of a group', () => {
    const b = new Bus();
    for (let i = 0; i < 130; i++) b.publish('g', 'family', ping(i));
    const all = b.since('g', 'family', 0);
    expect(all).toHaveLength(100);
    expect(all[0]?.event).toEqual(ping(30));
  });

  it('latest() moves forward with every event of any group', () => {
    const b = new Bus();
    const a = b.latest();
    b.publish('x', 'family', ping(1));
    b.publish('y', 'device', ping(2));
    expect(b.latest()).toBe(a + 2);
  });
});

describe('waiting for the next event (long poll)', () => {
  it('answers at once when an event is already there', async () => {
    const b = new Bus();
    b.publish('g', 'family', ping(1));
    expect((await b.wait('g', 'family', 0, 5000)).map((l) => l.event)).toEqual([ping(1)]);
  });

  it('wakes up when an event arrives, long before the timeout', async () => {
    const b = new Bus();
    const t0 = Date.now();
    const p = b.wait('g', 'family', b.latest(), 5000);
    setTimeout(() => b.publish('g', 'family', ping(9)), 30);
    expect((await p).map((l) => l.event)).toEqual([ping(9)]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('does not wake for another group', async () => {
    const b = new Bus();
    const p = b.wait('g', 'family', b.latest(), 80);
    setTimeout(() => b.publish('other', 'family', ping(1)), 10);
    expect(await p).toEqual([]);
  });

  it('returns an empty list when the time runs out', async () => {
    const b = new Bus();
    expect(await b.wait('g', 'device', b.latest(), 40)).toEqual([]);
    expect(b.count('g', 'device')).toBe(0); // it cleaned up after itself
  });

  it('stops waiting when the caller goes away', async () => {
    const b = new Bus();
    const ctl = new AbortController();
    const p = b.wait('g', 'family', b.latest(), 60_000, ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    expect(await p).toEqual([]);
    expect(b.count('g', 'family')).toBe(0);
  });
});
