/**
 * The rules of a voice or video call between the person and the family, as pure functions.
 * No WebRTC, clock or screen is in here: the web app feeds events in and reads the state out,
 * so the same rules can be tested without a browser and reused by a phone app.
 *
 * A call is never answered by itself. The other side must tap Answer, so a call cannot listen
 * to someone's home without them knowing.
 */

export type CallPhase = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

export type EndReason = 'hangup' | 'remote-hangup' | 'declined' | 'busy' | 'missed' | 'failed';

export interface CallState {
  phase: CallPhase;
  withVideo: boolean;
  /** When the current phase began (ms). */
  sinceMs: number;
  endReason?: EndReason;
}

export const IDLE_CALL: CallState = { phase: 'idle', withVideo: false, sinceMs: 0 };

/** How long a call rings before it counts as missed. */
export const RING_TIMEOUT_MS = 45_000;
/** How long Kaabil waits for the audio to start after an answer. */
export const CONNECT_TIMEOUT_MS = 20_000;

export type CallEvent =
  | { type: 'dial'; withVideo: boolean; nowMs: number }
  | { type: 'incoming'; withVideo: boolean; nowMs: number }
  | { type: 'accept'; nowMs: number }
  | { type: 'decline' }
  | { type: 'remote-accept'; nowMs: number }
  | { type: 'remote-decline'; busy?: boolean }
  | { type: 'media-connected'; nowMs: number }
  | { type: 'hangup' }
  | { type: 'remote-hangup' }
  | { type: 'failed' }
  | { type: 'tick'; nowMs: number }
  | { type: 'reset' };

const ended = (s: CallState, reason: EndReason, nowMs?: number): CallState => ({
  phase: 'ended',
  withVideo: s.withVideo,
  sinceMs: nowMs ?? s.sinceMs,
  endReason: reason,
});

const live = (p: CallPhase) => p === 'calling' || p === 'ringing' || p === 'connecting' || p === 'connected';

/** The next state. An event that makes no sense in the current phase changes nothing. */
export function callStep(s: CallState, e: CallEvent): CallState {
  if (e.type === 'reset') return IDLE_CALL;

  // A new call can start only from rest, or after a finished call is left on screen.
  if (e.type === 'dial' && (s.phase === 'idle' || s.phase === 'ended')) {
    return { phase: 'calling', withVideo: e.withVideo, sinceMs: e.nowMs };
  }
  if (e.type === 'incoming' && (s.phase === 'idle' || s.phase === 'ended')) {
    return { phase: 'ringing', withVideo: e.withVideo, sinceMs: e.nowMs };
  }
  // A second call while one is live is refused by the caller of this function with a "busy" reply.
  if (e.type === 'dial' || e.type === 'incoming') return s;

  switch (s.phase) {
    case 'calling':
      if (e.type === 'remote-accept') return { ...s, phase: 'connecting', sinceMs: e.nowMs };
      if (e.type === 'remote-decline') return ended(s, e.busy ? 'busy' : 'declined');
      if (e.type === 'hangup') return ended(s, 'hangup');
      if (e.type === 'failed') return ended(s, 'failed');
      if (e.type === 'tick' && e.nowMs - s.sinceMs >= RING_TIMEOUT_MS) return ended(s, 'missed', e.nowMs);
      return s;
    case 'ringing':
      if (e.type === 'accept') return { ...s, phase: 'connecting', sinceMs: e.nowMs };
      if (e.type === 'decline') return ended(s, 'declined');
      if (e.type === 'remote-hangup') return ended(s, 'missed');
      if (e.type === 'failed') return ended(s, 'failed');
      if (e.type === 'tick' && e.nowMs - s.sinceMs >= RING_TIMEOUT_MS) return ended(s, 'missed', e.nowMs);
      return s;
    case 'connecting':
      if (e.type === 'media-connected') return { ...s, phase: 'connected', sinceMs: e.nowMs };
      if (e.type === 'hangup') return ended(s, 'hangup');
      if (e.type === 'remote-hangup') return ended(s, 'remote-hangup');
      if (e.type === 'failed') return ended(s, 'failed');
      if (e.type === 'tick' && e.nowMs - s.sinceMs >= CONNECT_TIMEOUT_MS) return ended(s, 'failed', e.nowMs);
      return s;
    case 'connected':
      if (e.type === 'hangup') return ended(s, 'hangup');
      if (e.type === 'remote-hangup') return ended(s, 'remote-hangup');
      if (e.type === 'failed') return ended(s, 'failed');
      return s;
    default:
      return s;
  }
}

export const isLiveCall = (s: CallState): boolean => live(s.phase);

/** Whole seconds of talking so far, or 0 when the call is not connected. */
export function talkSeconds(s: CallState, nowMs: number): number {
  return s.phase === 'connected' ? Math.max(0, Math.floor((nowMs - s.sinceMs) / 1000)) : 0;
}

/** "3:07" style time for the call screen. */
export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
