/**
 * The messages two phones send each other to set up a call (signalling). They arrive from a
 * channel we do not control, so `parseSignal` accepts only a message of exactly the right shape
 * and size and returns null for anything else. It never throws.
 */

export type CallRole = 'person' | 'family';

export const otherRole = (r: CallRole): CallRole => (r === 'person' ? 'family' : 'person');

export interface IceCandidateInit {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type Signal =
  | { kind: 'ring'; callId: string; from: CallRole; withVideo: boolean }
  | { kind: 'accept'; callId: string; from: CallRole }
  | { kind: 'decline'; callId: string; from: CallRole; reason: 'declined' | 'busy' }
  | { kind: 'offer'; callId: string; from: CallRole; sdp: string }
  | { kind: 'answer'; callId: string; from: CallRole; sdp: string }
  | { kind: 'ice'; callId: string; from: CallRole; candidate: IceCandidateInit | null }
  | { kind: 'hangup'; callId: string; from: CallRole };

const MAX_SDP = 20_000;
const MAX_CANDIDATE = 2_000;
const MAX_MID = 64;
const CALL_ID = /^[A-Za-z0-9-]{8,64}$/;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isRole = (x: unknown): x is CallRole => x === 'person' || x === 'family';
const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

function parseCandidate(x: unknown): IceCandidateInit | null | undefined {
  if (x === null) return null; // the end-of-candidates marker
  if (!isRecord(x)) return undefined;
  const { candidate, sdpMid, sdpMLineIndex } = x;
  if (typeof candidate !== 'string' || candidate.length > MAX_CANDIDATE) return undefined;
  if (sdpMid !== null && sdpMid !== undefined && !(typeof sdpMid === 'string' && sdpMid.length <= MAX_MID)) return undefined;
  if (sdpMLineIndex !== null && sdpMLineIndex !== undefined && !(Number.isInteger(sdpMLineIndex) && (sdpMLineIndex as number) >= 0 && (sdpMLineIndex as number) < 64)) return undefined;
  return { candidate, sdpMid: (sdpMid as string | null | undefined) ?? null, sdpMLineIndex: (sdpMLineIndex as number | null | undefined) ?? null };
}

export function parseSignal(x: unknown): Signal | null {
  try {
    if (!isRecord(x)) return null;
    const { kind, callId, from } = x;
    if (typeof callId !== 'string' || !CALL_ID.test(callId) || !isRole(from)) return null;
    switch (kind) {
      case 'ring':
        return typeof x.withVideo === 'boolean' ? { kind, callId, from, withVideo: x.withVideo } : null;
      case 'accept':
      case 'hangup':
        return { kind, callId, from };
      case 'decline':
        return x.reason === 'declined' || x.reason === 'busy' ? { kind, callId, from, reason: x.reason } : null;
      case 'offer':
      case 'answer':
        return str(x.sdp, MAX_SDP) ? { kind, callId, from, sdp: x.sdp } : null;
      case 'ice': {
        const c = parseCandidate(x.candidate);
        return c === undefined ? null : { kind, callId, from, candidate: c };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** A hard-to-guess id for one call: 16 hex characters from the given random source. */
export function newCallId(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 16; i++) id += Math.floor(random() * 16).toString(16);
  return id;
}
