/**
 * The browser's parts for a call: the real peer connection, the real microphone and camera, the real clock.
 * Everything else about a call is in `CallController`, which is tested without a browser.
 *
 * The microphone is asked for with echo cancellation, noise suppression and automatic volume on, which is
 * what a phone call needs. If the camera is refused or missing on a video call we fall back to audio only,
 * and if there is no microphone at all we still listen (the controller adds a listen-only connection).
 */
import { newCallId, type CallRole, type Signal } from '@kaabil/core';
import type { CallDeps, IceServerInfo, PeerLike, StreamLike } from './callController';

export interface BrowserCallOptions {
  role: CallRole;
  /** Send one setup message to the other side (the server passes it on). */
  send(signal: Signal): Promise<void>;
  /** Ask the server which servers to use to connect. */
  iceServers(): Promise<IceServerInfo[]>;
}

async function getMedia(withVideo: boolean): Promise<StreamLike | null> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return null; // an http page, or an old browser
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const attempts: MediaStreamConstraints[] = withVideo ? [{ audio, video: { facingMode: 'user' } }, { audio }] : [{ audio }];
  for (const constraints of attempts) {
    try {
      return await devices.getUserMedia(constraints);
    } catch {
      /* refused, or no such device: try the next, then listen only */
    }
  }
  return null;
}

export function browserCallDeps(o: BrowserCallOptions): CallDeps {
  return {
    role: o.role,
    send: o.send,
    iceServers: o.iceServers,
    createPeer: (servers) => new RTCPeerConnection({ iceServers: servers }) as unknown as PeerLike,
    getMedia,
    now: () => Date.now(),
    newCallId: () => newCallId(),
    every: (ms, fn) => {
      const h = setInterval(fn, ms);
      return () => clearInterval(h);
    },
  };
}
