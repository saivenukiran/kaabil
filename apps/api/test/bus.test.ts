import { describe, expect, it } from 'vitest';
import { Bus } from '../src/bus';

describe('the bus', () => {
  it('delivers to the right audience and stops after unsubscribe', () => {
    const bus = new Bus();
    const got: string[] = [];
    const off = bus.subscribe('g1', 'family', (e) => got.push(e.type));
    bus.publish('g1', 'device', { type: 'ping', at: 1 });
    bus.publish('g2', 'family', { type: 'ping', at: 1 });
    bus.publish('g1', 'family', { type: 'ping', at: 1 });
    off();
    bus.publish('g1', 'family', { type: 'ping', at: 2 });
    expect(got).toEqual(['ping']);
    expect(bus.count('g1', 'family')).toBe(0);
  });
  it('keeps going when one listener throws', () => {
    const bus = new Bus();
    const got: number[] = [];
    bus.subscribe('g', 'family', () => {
      throw new Error('boom');
    });
    bus.subscribe('g', 'family', () => got.push(1));
    bus.publish('g', 'family', { type: 'ping', at: 1 });
    expect(got).toEqual([1]);
  });
});
