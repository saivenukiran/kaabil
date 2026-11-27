import { describe, expect, it } from 'vitest';
import {
  CONNECT_TIMEOUT_MS,
  IDLE_CALL,
  RING_TIMEOUT_MS,
  callStep,
  formatDuration,
  isLiveCall,
  talkSeconds,
  type CallEvent,
  type CallState,
} from './callMachine';
import { newCallId, otherRole, parseSignal, type Signal } from './signal';

const run = (events: CallEvent[], from: CallState = IDLE_CALL) => events.reduce(callStep, from);

describe('a call I start', () => {
  it('rings, then connects after the other side answers', () => {
    const s = run([{ type: 'dial', withVideo: false, nowMs: 1000 }, { type: 'remote-accept', nowMs: 5000 }]);
    expect(s.phase).toBe('connecting');
    expect(callStep(s, { type: 'media-connected', nowMs: 6000 })).toMatchObject({ phase: 'connected', sinceMs: 6000 });
  });

  it('keeps the video choice', () => {
    expect(run([{ type: 'dial', withVideo: true, nowMs: 0 }]).withVideo).toBe(true);
  });

  it('ends as declined, or as busy when the other side is already in a call', () => {
    const dialed: CallEvent = { type: 'dial', withVideo: false, nowMs: 0 };
    expect(run([dialed, { type: 'remote-decline' }])).toMatchObject({ phase: 'ended', endReason: 'declined' });
    expect(run([dialed, { type: 'remote-decline', busy: true }])).toMatchObject({ phase: 'ended', endReason: 'busy' });
  });

  it('can be cancelled by me while ringing', () => {
    expect(run([{ type: 'dial', withVideo: false, nowMs: 0 }, { type: 'hangup' }])).toMatchObject({ phase: 'ended', endReason: 'hangup' });
  });

  it('is missed after the ring timeout and not before', () => {
    const calling = run([{ type: 'dial', withVideo: false, nowMs: 1000 }]);
    expect(callStep(calling, { type: 'tick', nowMs: 1000 + RING_TIMEOUT_MS - 1 }).phase).toBe('calling');
    expect(callStep(calling, { type: 'tick', nowMs: 1000 + RING_TIMEOUT_MS })).toMatchObject({ phase: 'ended', endReason: 'missed' });
  });
});

describe('a call that rings me', () => {
  const ringing = run([{ type: 'incoming', withVideo: false, nowMs: 0 }]);

  it('is never answered by itself: it stays ringing until I tap Answer', () => {
    expect(ringing.phase).toBe('ringing');
    expect(callStep(ringing, { type: 'tick', nowMs: 10_000 }).phase).toBe('ringing');
  });

  it('connects when I answer', () => {
    expect(callStep(ringing, { type: 'accept', nowMs: 2000 })).toMatchObject({ phase: 'connecting', sinceMs: 2000 });
  });

  it('ends as declined when I decline', () => {
    expect(callStep(ringing, { type: 'decline' })).toMatchObject({ phase: 'ended', endReason: 'declined' });
  });

  it('counts as missed when the caller gives up or the ring times out', () => {
    expect(callStep(ringing, { type: 'remote-hangup' })).toMatchObject({ phase: 'ended', endReason: 'missed' });
    expect(callStep(ringing, { type: 'tick', nowMs: RING_TIMEOUT_MS })).toMatchObject({ phase: 'ended', endReason: 'missed' });
  });
});

describe('connecting and connected', () => {
  const connecting = run([{ type: 'dial', withVideo: false, nowMs: 0 }, { type: 'remote-accept', nowMs: 1000 }]);

  it('fails when the audio does not start in time', () => {
    expect(callStep(connecting, { type: 'tick', nowMs: 1000 + CONNECT_TIMEOUT_MS - 1 }).phase).toBe('connecting');
    expect(callStep(connecting, { type: 'tick', nowMs: 1000 + CONNECT_TIMEOUT_MS })).toMatchObject({ phase: 'ended', endReason: 'failed' });
  });

  it('ends from either side once connected, and ignores ticks', () => {
    const connected = callStep(connecting, { type: 'media-connected', nowMs: 2000 });
    expect(callStep(connected, { type: 'tick', nowMs: 99_999_999 })).toBe(connected);
    expect(callStep(connected, { type: 'hangup' })).toMatchObject({ endReason: 'hangup' });
    expect(callStep(connected, { type: 'remote-hangup' })).toMatchObject({ endReason: 'remote-hangup' });
    expect(callStep(connected, { type: 'failed' })).toMatchObject({ endReason: 'failed' });
  });

  it('measures talking time from the moment it connected', () => {
    const connected = callStep(connecting, { type: 'media-connected', nowMs: 2000 });
    expect(talkSeconds(connected, 2000 + 65_400)).toBe(65);
    expect(talkSeconds(connecting, 99_000)).toBe(0);
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(3599)).toBe('59:59');
  });
});

describe('one call at a time', () => {
  it('ignores a second dial or incoming call while a call is live, so the caller can answer "busy"', () => {
    const calling = run([{ type: 'dial', withVideo: false, nowMs: 0 }]);
    expect(callStep(calling, { type: 'incoming', withVideo: true, nowMs: 5 })).toBe(calling);
    expect(callStep(calling, { type: 'dial', withVideo: true, nowMs: 5 })).toBe(calling);
    expect(isLiveCall(calling)).toBe(true);
  });

  it('allows a new call after a finished one is left on screen, and reset goes back to rest', () => {
    const done = run([{ type: 'dial', withVideo: false, nowMs: 0 }, { type: 'hangup' }]);
    expect(isLiveCall(done)).toBe(false);
    expect(callStep(done, { type: 'dial', withVideo: false, nowMs: 9 }).phase).toBe('calling');
    expect(callStep(done, { type: 'reset' })).toBe(IDLE_CALL);
  });

  it('ignores events that make no sense, such as Answer when nothing rings', () => {
    expect(callStep(IDLE_CALL, { type: 'accept', nowMs: 1 })).toBe(IDLE_CALL);
    expect(callStep(IDLE_CALL, { type: 'hangup' })).toBe(IDLE_CALL);
  });
});

const ID = 'abcdef0123456789';

describe('parseSignal accepts exactly the messages we send', () => {
  const good: Signal[] = [
    { kind: 'ring', callId: ID, from: 'person', withVideo: false },
    { kind: 'accept', callId: ID, from: 'family' },
    { kind: 'decline', callId: ID, from: 'family', reason: 'busy' },
    { kind: 'offer', callId: ID, from: 'family', sdp: 'v=0\r\n' },
    { kind: 'answer', callId: ID, from: 'person', sdp: 'v=0\r\n' },
    { kind: 'ice', callId: ID, from: 'person', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } },
    { kind: 'ice', callId: ID, from: 'person', candidate: null },
    { kind: 'hangup', callId: ID, from: 'family' },
  ];
  it.each(good)('accepts $kind', (m) => {
    expect(parseSignal(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('rejects wrong shapes, unknown kinds, bad ids and oversized text', () => {
    const bad: unknown[] = [
      null, undefined, 42, 'ring', [], {},
      { kind: 'ring', callId: ID, from: 'stranger', withVideo: false },
      { kind: 'ring', callId: 'short', from: 'person', withVideo: false },
      { kind: 'ring', callId: ID + '!!', from: 'person', withVideo: false },
      { kind: 'ring', callId: ID, from: 'person', withVideo: 'yes' },
      { kind: 'explode', callId: ID, from: 'person' },
      { kind: 'decline', callId: ID, from: 'person', reason: 'because' },
      { kind: 'offer', callId: ID, from: 'person', sdp: '' },
      { kind: 'offer', callId: ID, from: 'person', sdp: 'x'.repeat(20_001) },
      { kind: 'offer', callId: ID, from: 'person', sdp: 7 },
      { kind: 'ice', callId: ID, from: 'person', candidate: 'text' },
      { kind: 'ice', callId: ID, from: 'person', candidate: { candidate: 'x'.repeat(2001), sdpMid: null, sdpMLineIndex: null } },
      { kind: 'ice', callId: ID, from: 'person', candidate: { candidate: 'c', sdpMid: 5, sdpMLineIndex: null } },
      { kind: 'ice', callId: ID, from: 'person', candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: -1 } },
    ];
    for (const b of bad) expect(parseSignal(b), JSON.stringify(b)).toBeNull();
  });

  it('never throws, whatever it is given', () => {
    const hostile = { get kind(): never { throw new Error('boom'); }, callId: ID, from: 'person' };
    expect(parseSignal(hostile)).toBeNull();
    expect(parseSignal(Object.create(null))).toBeNull();
  });

  it('on seeded random objects never throws and only returns well-formed messages', () => {
    let a = 12345;
    const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const values: unknown[] = ['ring', 'accept', 'offer', 'ice', 'hangup', 'decline', 'person', 'family', ID, 'x', '', true, false, 0, -1, 3.5, null, undefined, {}, [], { candidate: 'c' }];
    const keys = ['kind', 'callId', 'from', 'withVideo', 'sdp', 'reason', 'candidate'];
    for (let i = 0; i < 5000; i++) {
      const o: Record<string, unknown> = {};
      for (const k of keys) if (rnd() < 0.7) o[k] = pick(values);
      const s = parseSignal(o);
      if (s !== null) {
        expect(['ring', 'accept', 'decline', 'offer', 'answer', 'ice', 'hangup']).toContain(s.kind);
        expect(s.callId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
        expect(['person', 'family']).toContain(s.from);
      }
    }
  });
});

describe('small helpers', () => {
  it('names the other side', () => {
    expect(otherRole('person')).toBe('family');
    expect(otherRole('family')).toBe('person');
  });
  it('makes a valid call id from any random source', () => {
    const id = newCallId();
    expect(id).toMatch(/^[a-f0-9]{16}$/);
    expect(parseSignal({ kind: 'accept', callId: id, from: 'person' })).not.toBeNull();
    expect(newCallId(() => 0)).toBe('0000000000000000');
  });
});
