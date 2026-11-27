import { describe, expect, it } from 'vitest';
import { CONNECT_TIMEOUT_MS, RING_TIMEOUT_MS, type CallRole, type Signal } from '@kaabil/core';
import { CallController, type PeerLike, type StreamLike, type TrackLike } from './callController';

class FakeTrack implements TrackLike {
  enabled = true;
  stopped = false;
  constructor(public kind: string) {}
  stop() {
    this.stopped = true;
  }
}
class FakeStream implements StreamLike {
  tracks: FakeTrack[];
  constructor(kinds: string[]) {
    this.tracks = kinds.map((k) => new FakeTrack(k));
  }
  getTracks() {
    return this.tracks;
  }
}

class FakePeer implements PeerLike {
  connectionState = 'new';
  local: { type: string; sdp?: string } | null = null;
  remote: { type: string; sdp?: string } | null = null;
  added: string[] = [];
  transceivers: string[] = [];
  candidates: unknown[] = [];
  closed = false;
  onicecandidate: PeerLike['onicecandidate'] = null;
  ontrack: PeerLike['ontrack'] = null;
  onconnectionstatechange: PeerLike['onconnectionstatechange'] = null;
  constructor(public role: CallRole) {}
  async createOffer() {
    return { type: 'offer', sdp: `v=0 offer from ${this.role}` };
  }
  async createAnswer() {
    return { type: 'answer', sdp: `v=0 answer from ${this.role}` };
  }
  async setLocalDescription(d: { type: string; sdp?: string }) {
    this.local = d;
    // As a real connection does, start to find network paths once it knows its own side.
    setTimeout(() => this.onicecandidate?.({ candidate: { candidate: `candidate:1 1 udp 1 192.0.2.${this.role === 'family' ? 1 : 2} 5000 typ host`, sdpMid: '0', sdpMLineIndex: 0 } }), 0);
    setTimeout(() => this.onicecandidate?.({ candidate: null }), 1);
  }
  async setRemoteDescription(d: { type: string; sdp?: string }) {
    this.remote = d;
  }
  async addIceCandidate(c: unknown) {
    this.candidates.push(c);
  }
  addTrack(t: TrackLike) {
    this.added.push(t.kind);
  }
  addTransceiver(kind: string) {
    this.transceivers.push(kind);
  }
  close() {
    this.closed = true;
  }
  /** Pretend the network path was found. */
  setState(s: string) {
    this.connectionState = s;
    this.onconnectionstatechange?.();
  }
}

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => {
  for (let i = 0; i < 8; i++) await sleep(0);
};

interface Side {
  c: CallController;
  sent: Signal[];
  peers: FakePeer[];
  streams: FakeStream[];
  media: () => FakeStream | null;
}

function world(opts: { familyMic?: boolean; personMic?: boolean; failSend?: Record<string, string> } = {}) {
  let t = 1_000_000;
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const sides = {} as Record<CallRole, Side>;
  let idN = 0;
  const make = (role: CallRole, mic: boolean): Side => {
    const side: Side = { c: undefined as unknown as CallController, sent: [], peers: [], streams: [], media: () => (mic ? new FakeStream(['audio']) : null) };
    const other: CallRole = role === 'family' ? 'person' : 'family';
    side.c = new CallController({
      role,
      send: async (s) => {
        side.sent.push(s);
        const fail = opts.failSend?.[`${role}:${s.kind}`];
        if (fail) throw new Error(fail);
        await sleep(0);
        sides[other].c.handleSignal(JSON.parse(JSON.stringify(s)));
      },
      iceServers: async () => [{ urls: ['stun:stun.example:3478'] }],
      createPeer: () => {
        const p = new FakePeer(role);
        side.peers.push(p);
        return p;
      },
      getMedia: async () => {
        const m = side.media();
        if (m) side.streams.push(m);
        return m;
      },
      now: () => t,
      newCallId: () => `call-${String(++idN).padStart(8, '0')}`,
      every: (ms, fn) => {
        const h = { fn, ms, live: true };
        timers.push(h);
        return () => {
          h.live = false;
        };
      },
    });
    return side;
  };
  sides.family = make('family', opts.familyMic ?? true);
  sides.person = make('person', opts.personMic ?? true);
  const advance = (ms: number) => {
    // one second at a time, like a real timer
    for (let left = ms; left > 0; left -= 1000) {
      t += Math.min(1000, left);
      for (const h of timers) if (h.live) h.fn();
    }
  };
  /** Both sides have found each other. */
  const connect = () => {
    for (const s of Object.values(sides)) s.peers.at(-1)?.setState('connected');
  };
  return { sides, advance, connect, family: sides.family, person: sides.person, now: () => t };
}

/** A whole call up to "both phones connected". */
async function connectedCall(w: ReturnType<typeof world>, withVideo = false) {
  await w.family.c.dial(withVideo);
  await settle();
  await w.person.c.accept();
  await settle();
  w.connect();
  await settle();
}

describe('a call from the family to the person', () => {
  it('rings, waits for a tap, then connects through offer, answer and network candidates', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    expect(w.family.c.view().state.phase).toBe('calling');
    expect(w.person.c.view().state.phase).toBe('ringing');
    // It never answers by itself: no accept, no offer, no microphone asked for.
    expect(w.person.sent).toEqual([]);
    expect(w.person.peers).toEqual([]);

    await w.person.c.accept();
    await settle();
    expect(w.person.sent.map((s) => s.kind)[0]).toBe('accept');
    expect(w.family.sent.map((s) => s.kind)).toEqual(expect.arrayContaining(['ring', 'offer']));
    expect(w.person.sent.map((s) => s.kind)).toEqual(expect.arrayContaining(['accept', 'answer']));
    expect(w.family.peers[0]!.local?.type).toBe('offer');
    expect(w.family.peers[0]!.remote?.type).toBe('answer');
    expect(w.person.peers[0]!.remote?.type).toBe('offer');
    expect(w.person.peers[0]!.local?.type).toBe('answer');
    // Each side got the other's network candidate.
    expect(w.family.peers[0]!.candidates).toHaveLength(1);
    expect(w.person.peers[0]!.candidates).toHaveLength(1);

    w.connect();
    await settle();
    expect(w.family.c.view().state.phase).toBe('connected');
    expect(w.person.c.view().state.phase).toBe('connected');
  });

  it('the person can also ring the family', async () => {
    const w = world();
    await w.person.c.dial(false);
    await settle();
    expect(w.family.c.view().state.phase).toBe('ringing');
    await w.family.c.accept();
    await settle();
    w.connect();
    await settle();
    expect(w.person.c.view().state.phase).toBe('connected');
    expect(w.family.c.view().state.phase).toBe('connected');
  });

  it('sends the microphone, and listens only when there is none', async () => {
    const w = world({ familyMic: true, personMic: false });
    await connectedCall(w);
    expect(w.family.peers[0]!.added).toEqual(['audio']);
    expect(w.family.peers[0]!.transceivers).toEqual([]);
    expect(w.person.peers[0]!.added).toEqual([]);
    expect(w.person.peers[0]!.transceivers).toEqual(['audio']); // listen only
    expect(w.person.c.view().localMedia).toBe('none');
    expect(w.family.c.view().localMedia).toBe('mic');
    expect(w.person.c.view().state.phase).toBe('connected');
  });

  it('asks for video only when the call is a video call, and still listens for it without a camera', async () => {
    const w = world();
    await connectedCall(w, true);
    expect(w.family.peers[0]!.transceivers).toEqual(['video']);
    expect(w.person.peers[0]!.transceivers).toEqual(['video']);
    expect(w.person.c.view().state.withVideo).toBe(true);
  });

  it('hang up ends both sides and releases the microphone and the connection', async () => {
    const w = world();
    await connectedCall(w);
    w.family.c.hangup();
    await settle();
    expect(w.family.c.view().state).toMatchObject({ phase: 'ended', endReason: 'hangup' });
    expect(w.person.c.view().state).toMatchObject({ phase: 'ended', endReason: 'remote-hangup' });
    for (const s of [w.family, w.person]) {
      expect(s.peers[0]!.closed).toBe(true);
      expect(s.streams[0]!.tracks.every((t) => t.stopped)).toBe(true);
    }
  });

  it('mute turns the microphone track off and on, and a new call starts unmuted', async () => {
    const w = world();
    await connectedCall(w);
    const track = w.family.streams[0]!.tracks[0]!;
    w.family.c.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(w.family.c.view().muted).toBe(true);
    w.family.c.setMuted(false);
    expect(track.enabled).toBe(true);
    w.family.c.setMuted(true);
    w.family.c.hangup();
    w.family.c.dismiss();
    await w.family.c.dial(false);
    expect(w.family.c.view().muted).toBe(false);
  });

  it('counts talking time from the moment the audio connects', async () => {
    const w = world();
    await connectedCall(w);
    expect(w.family.c.view().seconds).toBe(0);
    w.advance(5000);
    expect(w.family.c.view().seconds).toBe(5);
  });
});

describe('when the call does not go through', () => {
  it('the person declines: the family sees it, and no connection is ever made', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    await w.person.c.decline();
    await settle();
    expect(w.person.c.view().state).toMatchObject({ phase: 'ended', endReason: 'declined' });
    expect(w.family.c.view().state).toMatchObject({ phase: 'ended', endReason: 'declined' });
    expect(w.person.peers).toEqual([]);
    expect(w.family.sent.map((s) => s.kind)).toEqual(['ring']);
  });

  it('nobody answers: it rings out, the caller hangs up so the other phone stops ringing', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    w.advance(RING_TIMEOUT_MS + 1000);
    await settle();
    expect(w.family.c.view().state).toMatchObject({ phase: 'ended', endReason: 'missed' });
    expect(w.person.c.view().state).toMatchObject({ phase: 'ended', endReason: 'missed' });
    expect(w.family.sent.at(-1)!.kind).toBe('hangup');
    expect(w.family.streams[0]!.tracks.every((t) => t.stopped)).toBe(true); // the microphone asked for while ringing is released
  });

  it('a second call while one is live is answered busy and does not disturb the first', async () => {
    const w = world();
    await connectedCall(w);
    w.person.c.handleSignal({ kind: 'ring', callId: 'call-99999999', from: 'family', withVideo: false });
    await settle();
    expect(w.person.sent.at(-1)).toEqual({ kind: 'decline', callId: 'call-99999999', from: 'person', reason: 'busy' });
    expect(w.person.c.view().state.phase).toBe('connected');
    expect(w.person.c.view().callId).not.toBe('call-99999999');
  });

  it('dialling while a call is live does nothing', async () => {
    const w = world();
    await connectedCall(w);
    const before = w.family.sent.length;
    await w.family.c.dial(false);
    expect(w.family.sent.length).toBe(before);
    expect(w.family.c.view().state.phase).toBe('connected');
  });

  it('the server refuses the ring (no phone paired): ends with a plain message and sends no hangup', async () => {
    const w = world({ failSend: { 'family:ring': 'No phone is paired yet, so there is no one to call' } });
    await w.family.c.dial(false);
    await settle();
    const v = w.family.c.view();
    expect(v.state).toMatchObject({ phase: 'ended', endReason: 'failed' });
    expect(v.note).toContain('No phone is paired');
    expect(w.family.sent.map((s) => s.kind)).toEqual(['ring']);
    expect(w.family.streams[0]?.tracks.every((t) => t.stopped) ?? true).toBe(true);
  });

  it('answered but the audio never connects: fails after the connect time and tells the other side', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    await w.person.c.accept();
    await settle();
    w.advance(CONNECT_TIMEOUT_MS + 1000);
    await settle();
    expect(w.family.c.view().state).toMatchObject({ phase: 'ended', endReason: 'failed' });
    expect(w.person.c.view().state.phase).toBe('ended');
    expect(w.family.peers[0]!.closed && w.person.peers[0]!.closed).toBe(true);
  });

  it('the connection reports failure: ends the call with a message', async () => {
    const w = world();
    await connectedCall(w);
    w.family.peers[0]!.setState('failed');
    await settle();
    expect(w.family.c.view().state).toMatchObject({ phase: 'ended', endReason: 'failed' });
    expect(w.family.c.view().note).toContain('could not reach each other');
    expect(w.person.c.view().state.phase).toBe('ended');
  });

  it('the other side hangs up while ringing: the missed call is shown', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    w.family.c.hangup();
    await settle();
    expect(w.person.c.view().state).toMatchObject({ phase: 'ended', endReason: 'missed' });
  });
});

describe('messages that should be ignored', () => {
  it('ignores things that are not valid messages', () => {
    const w = world();
    for (const junk of [null, undefined, 1, 'ring', [], {}, { kind: 'ring' }, { kind: 'ring', callId: 'x', from: 'family', withVideo: false }, { kind: 'offer', callId: 'call-00000001', from: 'family', sdp: 'x'.repeat(20_001) }]) w.person.c.handleSignal(junk);
    expect(w.person.c.view().state.phase).toBe('idle');
  });

  it('ignores messages that say they come from our own side', () => {
    const w = world();
    w.person.c.handleSignal({ kind: 'ring', callId: 'call-00000001', from: 'person', withVideo: false });
    expect(w.person.c.view().state.phase).toBe('idle');
  });

  it('ignores messages about a call it is not in, and a repeat of a finished call', async () => {
    const w = world();
    await connectedCall(w);
    const id = w.person.c.view().callId!;
    for (const kind of ['hangup', 'accept', 'decline']) w.person.c.handleSignal({ kind, callId: 'call-77777777', from: 'family', ...(kind === 'decline' ? { reason: 'declined' } : {}) });
    w.person.c.handleSignal({ kind: 'offer', callId: 'call-77777777', from: 'family', sdp: 'v=0' });
    expect(w.person.c.view()).toMatchObject({ callId: id });
    expect(w.person.c.view().state.phase).toBe('connected');

    w.family.c.hangup();
    await settle();
    expect(w.person.c.view().state.phase).toBe('ended');
    w.person.c.handleSignal({ kind: 'ring', callId: id, from: 'family', withVideo: false }); // a late repeat
    expect(w.person.c.view().state.phase).toBe('ended');
  });

  it('does not answer by itself even if an offer arrives while only ringing', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    const id = w.person.c.view().callId!;
    w.person.c.handleSignal({ kind: 'offer', callId: id, from: 'family', sdp: 'v=0 sneaky' });
    await settle();
    expect(w.person.c.view().state.phase).toBe('ringing');
    expect(w.person.peers).toEqual([]);
    expect(w.person.sent).toEqual([]);
  });

  it('keeps network candidates that arrive early and uses them after the description', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    const id = w.person.c.view().callId!;
    // The person has not answered yet, so there is no connection: the early candidate is only remembered.
    w.person.c.handleSignal({ kind: 'ice', callId: id, from: 'family', candidate: { candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 } });
    expect(w.person.peers).toEqual([]);
    await w.person.c.accept();
    await settle();
    expect(w.person.peers[0]!.candidates).toContainEqual({ candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 });
  });

  it('keeps at most 100 early candidates', async () => {
    const w = world();
    await w.family.c.dial(false);
    await settle();
    const id = w.person.c.view().callId!;
    for (let i = 0; i < 150; i++) w.person.c.handleSignal({ kind: 'ice', callId: id, from: 'family', candidate: { candidate: `c${i}`, sdpMid: '0', sdpMLineIndex: 0 } });
    await w.person.c.accept();
    await settle();
    // 100 early ones plus the family's real ones from the offer exchange.
    const early = w.person.peers[0]!.candidates.filter((c) => (c as { candidate: string }).candidate.startsWith('c') && !(c as { candidate: string }).candidate.startsWith('candidate:'));
    expect(early.length).toBe(100);
  });
});

describe('sending in order, and telling the screen', () => {
  it('sends ring before offer and accept before answer, even when sends take different times', async () => {
    const w = world();
    await connectedCall(w);
    const order = (s: Side) => s.sent.filter((x) => x.kind !== 'ice').map((x) => x.kind);
    expect(order(w.family)).toEqual(['ring', 'offer']);
    expect(order(w.person)).toEqual(['accept', 'answer']);
  });

  it('tells subscribers on every change, and stops when they unsubscribe', async () => {
    const w = world();
    let n = 0;
    const off = w.family.c.subscribe(() => n++);
    await w.family.c.dial(false);
    await settle();
    expect(n).toBeGreaterThan(0);
    off();
    const seen = n;
    w.family.c.hangup();
    expect(n).toBe(seen);
  });

  it('reuses the same view object until something changes, so a screen does not redraw for nothing', async () => {
    const w = world();
    expect(w.family.c.view()).toBe(w.family.c.view());
    const before = w.family.c.view();
    await w.family.c.dial(false);
    expect(w.family.c.view()).not.toBe(before);
  });

  it('after a finished call the next one starts clean', async () => {
    const w = world();
    await connectedCall(w);
    w.family.c.hangup();
    await settle();
    w.family.c.dismiss();
    w.person.c.dismiss();
    expect(w.family.c.view().state.phase).toBe('idle');
    await connectedCall(w);
    expect(w.family.c.view().state.phase).toBe('connected');
    expect(w.family.peers).toHaveLength(2);
    expect(w.family.c.view().callId).not.toBe(w.family.sent[0] && (w.family.sent[0] as { callId: string }).callId);
  });
});
