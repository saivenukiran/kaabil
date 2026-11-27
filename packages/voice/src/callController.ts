/**
 * One voice or video call between the person's phone and a family member, with no framework and no
 * direct use of the browser: the network, the peer connection, the microphone and the clock are passed in,
 * so every rule can be tested with fakes.
 *
 * What it guarantees (the rules themselves are `callStep` and `parseSignal` in @kaabil/core):
 *  - A call is never answered by itself. The side that is rung stays "ringing" until a person taps Answer.
 *  - Every message from the other side is checked with `parseSignal`; a wrong one is ignored, never trusted.
 *  - Messages for another call, or from our own side, are ignored. A second call while one is live is
 *    answered "busy" and does not touch the first.
 *  - Setup messages are sent in order. Network candidates that arrive before the offer or answer are kept
 *    and used afterwards.
 *  - With no microphone the call still connects: we listen only. Nothing is sent that was not asked for.
 *  - Whatever ends a call, the microphone and the connection are released and the other side is told.
 */
import {
  callStep,
  IDLE_CALL,
  isLiveCall,
  parseSignal,
  talkSeconds,
  type CallEvent,
  type CallRole,
  type CallState,
  type IceCandidateInit,
  type Signal,
} from '@kaabil/core';

export interface IceServerInfo {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TrackLike {
  kind: string;
  enabled: boolean;
  stop(): void;
}
export interface StreamLike {
  getTracks(): TrackLike[];
}
export interface SessionDescriptionLike {
  type: string;
  sdp?: string;
}
/** The part of RTCPeerConnection that the call uses. */
export interface PeerLike {
  connectionState: string;
  createOffer(): Promise<SessionDescriptionLike>;
  createAnswer(): Promise<SessionDescriptionLike>;
  setLocalDescription(d: SessionDescriptionLike): Promise<void>;
  setRemoteDescription(d: SessionDescriptionLike): Promise<void>;
  addIceCandidate(c: IceCandidateInit): Promise<void>;
  addTrack(track: TrackLike, stream: StreamLike): unknown;
  addTransceiver(kind: 'audio' | 'video', init: { direction: 'recvonly' }): unknown;
  close(): void;
  /** Connection statistics, as RTCPeerConnection.getStats gives them. Optional: a missing one reads as no data. */
  getStats?(): Promise<{ forEach(cb: (stat: { type?: string; kind?: string; bytesReceived?: number; totalAudioEnergy?: number }) => void): void }>;
  onicecandidate: ((e: { candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null }) => void) | null;
  ontrack: ((e: { streams: readonly StreamLike[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
}

export interface CallDeps {
  role: CallRole;
  /** Send one setup message to the other side. Rejects when the server refuses (for example no phone is paired). */
  send(signal: Signal): Promise<void>;
  iceServers(): Promise<IceServerInfo[]>;
  createPeer(servers: IceServerInfo[]): PeerLike;
  /** The microphone (and camera), or null when there is none or it was refused. Never throws. */
  getMedia(withVideo: boolean): Promise<StreamLike | null>;
  now(): number;
  newCallId(): string;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
}

export interface CallView {
  state: CallState;
  callId: string | null;
  /** Whole seconds of talking, 0 until connected. */
  seconds: number;
  muted: boolean;
  /** 'pending' while asking for the microphone, 'none' when there is none (we only listen). */
  localMedia: 'pending' | 'mic' | 'none';
  remoteStream: StreamLike | null;
  /** A plain sentence about why a call failed, for the screen. */
  note: string;
}

/** Growth in `totalAudioEnergy` over one second that counts as someone speaking (a quiet room is about a hundred times less). */
export const HEARING_ENERGY = 0.0002;

const FALLBACK_ICE: IceServerInfo[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
const MAX_QUEUED_CANDIDATES = 100;

export class CallController {
  private state: CallState = IDLE_CALL;
  private callId: string | null = null;
  private pc: PeerLike | null = null;
  private local: StreamLike | null = null;
  private remote: StreamLike | null = null;
  private muted = false;
  private media: CallView['localMedia'] = 'pending';
  private note = '';
  private remoteSet = false;
  private queuedIce: IceCandidateInit[] = [];
  private prepared: Promise<void> | null = null;
  private stopTick: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private cached: CallView | null = null;

  constructor(private readonly d: CallDeps) {}

  // ---- what the screen reads

  view(): CallView {
    if (!this.cached) {
      this.cached = { state: this.state, callId: this.callId, seconds: talkSeconds(this.state, this.d.now()), muted: this.muted, localMedia: this.media, remoteStream: this.remote, note: this.note };
    }
    return this.cached;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.cached = null;
    for (const fn of [...this.listeners]) fn();
  }

  // ---- what a person does

  /** Ring the other side. Does nothing when a call is already live. */
  async dial(withVideo: boolean): Promise<void> {
    if (isLiveCall(this.state)) return;
    this.resetCall();
    const id = this.d.newCallId();
    this.callId = id;
    this.apply({ type: 'dial', withVideo, nowMs: this.d.now() });
    this.startTicking();
    // Ask for the microphone now, while it rings, so the prompt is not in the way after the answer.
    this.prepared = this.prepare(withVideo);
    try {
      await this.post({ kind: 'ring', callId: id, from: this.d.role, withVideo });
    } catch (e) {
      this.failIf(id, `Could not ring: ${messageOf(e)}`, false);
    }
  }

  /** Answer an incoming call. Only a person calls this, from a tap on Answer. */
  async accept(): Promise<void> {
    const id = this.callId;
    if (!id || this.state.phase !== 'ringing') return;
    this.apply({ type: 'accept', nowMs: this.d.now() });
    this.prepared = this.prepare(this.state.withVideo);
    try {
      await this.prepared;
      if (!this.current(id)) return;
      await this.post({ kind: 'accept', callId: id, from: this.d.role });
    } catch (e) {
      this.failIf(id, `Could not answer: ${messageOf(e)}`, true);
    }
  }

  async decline(): Promise<void> {
    const id = this.callId;
    if (!id || this.state.phase !== 'ringing') return;
    this.apply({ type: 'decline' });
    await this.post({ kind: 'decline', callId: id, from: this.d.role, reason: 'declined' }).catch(() => undefined);
  }

  hangup(): void {
    if (!isLiveCall(this.state)) return;
    this.apply({ type: 'hangup' });
  }

  /** Leave the finished-call screen. */
  dismiss(): void {
    if (isLiveCall(this.state)) return;
    this.resetCall();
    this.notify();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const t of this.local?.getTracks() ?? []) if (t.kind === 'audio') t.enabled = !muted;
    this.notify();
  }

  /**
   * What has arrived of the other side's sound so far: bytes (packets keep coming even when they are silent, for example when the
   * other side is muted) and energy (it rises only when there is sound). Both 0 when none, or when it cannot be read.
   * Compare two readings: if the energy grew by `HEARING_ENERGY` or more, someone was speaking.
   */
  async receivedAudio(): Promise<{ bytes: number; energy: number }> {
    const pc = this.pc;
    const none = { bytes: 0, energy: 0 };
    if (!pc?.getStats) return none;
    try {
      const got = { bytes: 0, energy: 0 };
      (await pc.getStats()).forEach((s) => {
        if (s.type !== 'inbound-rtp' || s.kind !== 'audio') return;
        if (typeof s.bytesReceived === 'number') got.bytes += s.bytesReceived;
        if (typeof s.totalAudioEnergy === 'number') got.energy += s.totalAudioEnergy;
      });
      return got;
    } catch {
      return none;
    }
  }

  // ---- what arrives from the other side

  /** Feed in anything that arrived on the live channel. Anything that is not a valid message for this call is ignored. */
  handleSignal(raw: unknown): void {
    const s = parseSignal(raw);
    if (!s || s.from === this.d.role) return;

    if (s.kind === 'ring') {
      if (isLiveCall(this.state)) {
        if (s.callId !== this.callId) void this.post({ kind: 'decline', callId: s.callId, from: this.d.role, reason: 'busy' }).catch(() => undefined);
        return;
      }
      if (s.callId === this.callId) return; // a repeat of a call we already finished
      this.resetCall();
      this.callId = s.callId;
      this.apply({ type: 'incoming', withVideo: s.withVideo, nowMs: this.d.now() });
      this.startTicking();
      return;
    }

    if (s.callId !== this.callId || !isLiveCall(this.state)) return;
    const id = s.callId;
    switch (s.kind) {
      case 'accept':
        if (this.state.phase !== 'calling') return;
        this.apply({ type: 'remote-accept', nowMs: this.d.now() });
        void this.makeOffer(id);
        return;
      case 'decline':
        this.apply({ type: 'remote-decline', busy: s.reason === 'busy' });
        return;
      case 'offer':
        if (this.state.phase !== 'connecting') return;
        void this.makeAnswer(id, s.sdp);
        return;
      case 'answer':
        if (this.state.phase !== 'connecting' || !this.pc || this.remoteSet) return;
        void this.useRemote(id, { type: 'answer', sdp: s.sdp });
        return;
      case 'ice':
        if (!s.candidate) return; // the end marker needs no action
        if (this.pc && this.remoteSet) void this.pc.addIceCandidate(s.candidate).catch(() => undefined);
        else if (this.queuedIce.length < MAX_QUEUED_CANDIDATES) this.queuedIce.push(s.candidate);
        return;
      case 'hangup':
        this.apply({ type: 'remote-hangup' });
        return;
    }
  }

  // ---- the connection

  private current(id: string): boolean {
    return this.callId === id && isLiveCall(this.state);
  }

  private async prepare(withVideo: boolean): Promise<void> {
    const id = this.callId;
    const [servers, stream] = await Promise.all([this.d.iceServers().catch(() => FALLBACK_ICE), this.d.getMedia(withVideo).catch(() => null)]);
    if (!id || !this.current(id)) {
      for (const t of stream?.getTracks() ?? []) t.stop(); // the call ended while we were asking
      return;
    }
    const pc = this.d.createPeer(servers.length ? servers : FALLBACK_ICE);
    this.pc = pc;
    this.local = stream;
    this.media = stream ? 'mic' : 'none';
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      void this.post({ kind: 'ice', callId: id, from: this.d.role, candidate: c ? { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } : null }).catch(() => undefined);
    };
    pc.ontrack = (e) => {
      if (this.pc !== pc || !e.streams[0]) return;
      this.remote = e.streams[0];
      this.notify();
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.apply({ type: 'media-connected', nowMs: this.d.now() });
      else if (pc.connectionState === 'failed') this.failIf(id, 'The connection could not be made. The two phones could not reach each other.', true);
    };
    // Send what we have. Where we have nothing (no microphone, no camera) we still listen.
    const have = new Set((stream?.getTracks() ?? []).map((t) => t.kind));
    for (const t of stream?.getTracks() ?? []) {
      if (this.muted && t.kind === 'audio') t.enabled = false;
      pc.addTrack(t, stream!);
    }
    if (!have.has('audio')) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (withVideo && !have.has('video')) pc.addTransceiver('video', { direction: 'recvonly' });
    this.notify();
  }

  private async makeOffer(id: string): Promise<void> {
    try {
      await this.prepared;
      const pc = this.pc;
      if (!pc || !this.current(id)) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) throw new Error('no offer was made');
      await this.post({ kind: 'offer', callId: id, from: this.d.role, sdp: offer.sdp });
    } catch (e) {
      this.failIf(id, `Could not start the call: ${messageOf(e)}`, true);
    }
  }

  private async makeAnswer(id: string, sdp: string): Promise<void> {
    try {
      await this.prepared;
      const pc = this.pc;
      if (!pc || !this.current(id) || this.remoteSet) return;
      await this.useRemote(id, { type: 'offer', sdp });
      if (!this.current(id)) return;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!answer.sdp) throw new Error('no answer was made');
      await this.post({ kind: 'answer', callId: id, from: this.d.role, sdp: answer.sdp });
    } catch (e) {
      this.failIf(id, `Could not answer the call: ${messageOf(e)}`, true);
    }
  }

  private async useRemote(id: string, desc: SessionDescriptionLike): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    await pc.setRemoteDescription(desc);
    if (!this.current(id)) return;
    this.remoteSet = true;
    const queued = this.queuedIce.splice(0);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => undefined);
  }

  // ---- the rules, then what follows from them

  private apply(e: CallEvent): void {
    const before = this.state;
    const next = callStep(before, e);
    if (next === before) return;
    this.state = next;
    if (next.phase === 'ended') {
      // Tell the other side unless they are the one who ended it or already know.
      const id = this.callId;
      const weEnded = next.endReason === 'hangup' || next.endReason === 'failed' || (next.endReason === 'missed' && before.phase === 'calling');
      if (id && weEnded) void this.post({ kind: 'hangup', callId: id, from: this.d.role }).catch(() => undefined);
      this.release();
    }
    this.notify();
  }

  private failIf(id: string, note: string, tellOther: boolean): void {
    if (!this.current(id)) return;
    this.note = note;
    if (tellOther) this.apply({ type: 'failed' });
    else {
      // The other side was never told about this call, so there is nothing to hang up.
      this.state = callStep(this.state, { type: 'failed' });
      this.release();
      this.notify();
    }
  }

  private startTicking(): void {
    this.stopTick?.();
    this.stopTick = this.d.every(1000, () => {
      if (isLiveCall(this.state)) {
        this.apply({ type: 'tick', nowMs: this.d.now() });
        if (isLiveCall(this.state)) this.notify(); // the talk timer
      }
    });
  }

  /** Let go of the microphone, the connection and the timer. */
  private release(): void {
    this.stopTick?.();
    this.stopTick = null;
    for (const t of this.local?.getTracks() ?? []) t.stop();
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    this.local = null;
    this.remote = null;
    this.queuedIce = [];
    this.remoteSet = false;
    this.prepared = null;
  }

  private resetCall(): void {
    this.release();
    this.state = IDLE_CALL;
    this.callId = null;
    this.note = '';
    this.media = 'pending';
    this.muted = false;
  }

  /** Send in order: a later message never overtakes an earlier one. A failure rejects only for the caller that sent it. */
  private post(signal: Signal): Promise<void> {
    const run = this.chain.then(() => this.d.send(signal));
    this.chain = run.catch(() => undefined);
    return run;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'something went wrong';
}
