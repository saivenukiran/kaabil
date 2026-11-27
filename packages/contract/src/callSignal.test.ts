import { describe, expect, it } from 'vitest';
import { parseSignal } from '@kaabil/core';
import { CallSignalSchema, EventSchema, IceServersSchema } from './schemas';

const id = 'abcdef0123456789';
const valid = [
  { kind: 'ring', callId: id, from: 'family', withVideo: false },
  { kind: 'ring', callId: id, from: 'person', withVideo: true },
  { kind: 'accept', callId: id, from: 'person' },
  { kind: 'decline', callId: id, from: 'person', reason: 'busy' },
  { kind: 'decline', callId: id, from: 'person', reason: 'declined' },
  { kind: 'offer', callId: id, from: 'family', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' },
  { kind: 'answer', callId: id, from: 'person', sdp: 'v=0\r\n' },
  { kind: 'ice', callId: id, from: 'family', candidate: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54400 typ host', sdpMid: '0', sdpMLineIndex: 0 } },
  { kind: 'ice', callId: id, from: 'person', candidate: null },
  { kind: 'hangup', callId: id, from: 'family' },
];
const invalid: unknown[] = [
  null,
  'ring',
  [],
  {},
  { kind: 'ring', callId: id, from: 'family' }, // no withVideo
  { kind: 'ring', callId: 'x', from: 'family', withVideo: false }, // short id
  { kind: 'ring', callId: 'has spaces here!', from: 'family', withVideo: false },
  { kind: 'ring', callId: id, from: 'robot', withVideo: false },
  { kind: 'ring', callId: id, from: 'family', withVideo: 'yes' },
  { kind: 'ring', callId: id, from: 'family', withVideo: false, extra: 1 }, // unknown field
  { kind: 'offer', callId: id, from: 'family', sdp: '' },
  { kind: 'offer', callId: id, from: 'family', sdp: 'x'.repeat(20_001) },
  { kind: 'decline', callId: id, from: 'person', reason: 'because' },
  { kind: 'ice', callId: id, from: 'family', candidate: { candidate: 'x'.repeat(2001), sdpMid: null, sdpMLineIndex: null } },
  { kind: 'ice', callId: id, from: 'family', candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: 64 } },
  { kind: 'ice', callId: id, from: 'family', candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: -1 } },
  { kind: 'explode', callId: id, from: 'family' },
];

describe('the call signal schema', () => {
  it('accepts every message we send', () => {
    for (const s of valid) expect(CallSignalSchema.safeParse(s).success, JSON.stringify(s).slice(0, 80)).toBe(true);
  });
  it('refuses wrong shapes, bad ids, oversized text and unknown fields', () => {
    for (const s of invalid) expect(CallSignalSchema.safeParse(s).success, JSON.stringify(s)?.slice(0, 80)).toBe(false);
  });
  it('agrees with the core parser: what the server accepts, the receiving phone accepts unchanged', () => {
    for (const s of valid) expect(parseSignal(s)).toEqual(s);
  });
  it('is never looser than the core parser on random objects', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    for (let i = 0; i < 4000; i++) {
      const o: Record<string, unknown> = {};
      for (const k of ['kind', 'callId', 'from', 'withVideo', 'reason', 'sdp', 'candidate']) {
        if (rnd() < 0.7) o[k] = k === 'kind' ? pick(['ring', 'accept', 'decline', 'offer', 'answer', 'ice', 'hangup', 'x']) : k === 'callId' ? pick([id, 'short', 'a'.repeat(70)]) : k === 'from' ? pick(['person', 'family', 1]) : k === 'withVideo' ? pick([true, false, 'y']) : k === 'reason' ? pick(['busy', 'declined', 'no']) : k === 'sdp' ? pick(['v=0', '', 'x'.repeat(21_000)]) : pick([null, { candidate: 'c', sdpMid: null, sdpMLineIndex: 0 }, { candidate: 1 }, 'c']);
      }
      if (CallSignalSchema.safeParse(o).success) expect(parseSignal(o), JSON.stringify(o).slice(0, 100)).not.toBeNull();
    }
  });
});

describe('the call event and the ICE answer', () => {
  it('carries a signal as a live event, and refuses a bad one', () => {
    expect(EventSchema.safeParse({ type: 'call', signal: valid[0] }).success).toBe(true);
    expect(EventSchema.safeParse({ type: 'call', signal: { kind: 'ring' } }).success).toBe(false);
    expect(EventSchema.safeParse({ type: 'call', signal: valid[0], extra: true }).success).toBe(false);
  });
  it('describes servers with a public STUN address and optional relay credentials', () => {
    expect(IceServersSchema.safeParse({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }).success).toBe(true);
    expect(IceServersSchema.safeParse({ iceServers: [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }] }).success).toBe(true);
    expect(IceServersSchema.safeParse({ iceServers: [{ urls: [] }] }).success).toBe(false);
    expect(IceServersSchema.safeParse({ iceServers: [{ urls: ['stun:x'], extra: 1 }] }).success).toBe(false);
  });
});
