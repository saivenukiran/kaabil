/**
 * The call screen for the test page, the same for the family panel and the person's phone panel: a
 * Call button, an incoming call with Answer and Decline, the call itself with Mute and Hang up, and the
 * other side's sound and picture. It only shows what `CallController` says; the rules live there.
 */
import { formatDuration, type EndReason } from '@kaabil/core';
import type { Signal } from '@kaabil/core';
import { browserCallDeps, CallController, HEARING_ENERGY, type CallView, type IceServerInfo } from '@kaabil/voice';
import { button, el, errorText } from './dom';

export interface CallPanel {
  node: HTMLElement;
  /** Feed in a `call` event from the live channel. */
  handle(signal: unknown): void;
  /** True while a call is ringing, connecting or connected. */
  isLive(): boolean;
  /** Turn this panel's sound off, for when both phones are on one page and would howl. */
  setSoundOff(off: boolean): void;
  /** Watch for a call starting or ending. */
  onLiveChange(fn: () => void): void;
  /** Enable or disable the Call buttons (for example until a group is chosen). */
  setCanDial(can: boolean): void;
  /** End a call that is live (when the account or the phone is forgotten). */
  end(): void;
}

/** The volume for a panel that must not be heard (both phones on one page): faint, not silent, so the sound meter still works. */
const QUIET = 0.01;

const ENDED: Record<EndReason, string> = {
  hangup: 'You ended the call.',
  'remote-hangup': 'The other side ended the call.',
  declined: 'The call was declined.',
  busy: 'The other side is already in a call.',
  missed: 'Nobody answered.',
  failed: 'The call could not be connected.',
};

export function describeCall(v: CallView, who: string): string {
  const s = v.state;
  switch (s.phase) {
    case 'idle':
      return 'No call.';
    case 'calling':
      return `Calling ${who}… waiting for them to answer.`;
    case 'ringing':
      return `Incoming ${s.withVideo ? 'video' : 'voice'} call from ${who}.`;
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return `Connected ${formatDuration(v.seconds)}${v.muted ? ' (you are muted)' : ''}`;
    case 'ended':
      return `${s.endReason ? ENDED[s.endReason] : 'The call ended.'}${v.note ? ` ${v.note}` : ''}`;
  }
}

export function mountCall(opts: {
  /** Prefix for element ids, so tests can find them: fam-call or dev-call. */
  id: string;
  role: 'family' | 'person';
  /** What this side calls the other: "the person" or "your family". */
  who: string;
  send(signal: Signal): Promise<void>;
  iceServers(): Promise<IceServerInfo[]>;
  log(m: string): void;
}): CallPanel {
  const { id } = opts;
  const controller = new CallController(browserCallDeps({ role: opts.role, send: opts.send, iceServers: opts.iceServers }));

  const stateLine = el('p', { id: `${id}-state`, class: 'call-state', role: 'status', 'aria-live': 'polite', 'data-phase': 'idle' }, 'No call.');
  const mediaLine = el('p', { id: `${id}-media`, class: 'note' });
  const hearLine = el('p', { id: `${id}-hear`, class: 'note', 'data-bytes': '0' });
  const audio = el('audio', { id: `${id}-audio`, autoplay: true });
  const video = el('video', { id: `${id}-video`, autoplay: true, playsinline: true, class: 'call-video' });
  video.hidden = true;

  const callAudio = button(`${id}-audio-call`, 'Voice call', () => controller.dial(false), 'primary');
  const callVideo = button(`${id}-video-call`, 'Video call', () => controller.dial(true));
  const answer = button(`${id}-answer`, 'Answer', () => controller.accept(), 'big yes');
  const decline = button(`${id}-decline`, 'Decline', () => controller.decline(), 'big no');
  const mute = button(`${id}-mute`, 'Mute', () => controller.setMuted(!controller.view().muted));
  const hang = button(`${id}-hangup`, 'Hang up', () => controller.hangup(), 'big no');
  const done = button(`${id}-dismiss`, 'OK', () => controller.dismiss(), 'small');

  let canDial = true;
  let soundOff = false;
  let wasLive = false;
  let changed: (() => void) | null = null;
  let shownStream: unknown = null;

  function render() {
    const v = controller.view();
    const p = v.state.phase;
    stateLine.textContent = describeCall(v, opts.who);
    stateLine.setAttribute('data-phase', p);
    stateLine.setAttribute('data-ended', v.state.endReason ?? '');
    mediaLine.textContent = p === 'idle' || p === 'ended' ? '' : v.localMedia === 'mic' ? 'Your microphone is on.' : v.localMedia === 'none' ? 'No microphone: you can listen but not speak.' : 'Asking for your microphone…';
    const idle = p === 'idle' || p === 'ended';
    callAudio.hidden = callVideo.hidden = !idle;
    callAudio.disabled = callVideo.disabled = !canDial;
    answer.hidden = decline.hidden = p !== 'ringing';
    mute.hidden = !(p === 'connecting' || p === 'connected');
    mute.textContent = v.muted ? 'Unmute' : 'Mute';
    hang.hidden = !(p === 'calling' || p === 'connecting' || p === 'connected');
    done.hidden = p !== 'ended';
    video.hidden = !(v.state.withVideo && p === 'connected');

    if (shownStream !== v.remoteStream) {
      shownStream = v.remoteStream;
      const s = (v.remoteStream as MediaStream | null) ?? null;
      audio.srcObject = s;
      video.srcObject = s;
      if (s) for (const m of [audio, video]) void m.play().catch(() => undefined); // a browser may need a tap first; the call button was one
    }
    audio.volume = soundOff ? QUIET : 1; // not 0 and not `muted`: the browser counts incoming sound only while it is played out, even faintly
    video.muted = true; // the sound plays from the audio element

    const live = p === 'calling' || p === 'ringing' || p === 'connecting' || p === 'connected';
    if (live !== wasLive) {
      wasLive = live;
      opts.log(`${opts.role} call: ${p}${v.state.endReason ? ` (${v.state.endReason})` : ''}`);
      changed?.();
    } else if (p === 'ended' && v.note) opts.log(`${opts.role} call: ${v.note}`);
  }
  controller.subscribe(render);
  render();

  // While connected, show whether the other side's voice is really arriving (from the connection's own counters).
  let last = { bytes: 0, energy: 0 };
  setInterval(() => {
    if (controller.view().state.phase !== 'connected') {
      last = { bytes: 0, energy: 0 };
      hearLine.textContent = '';
      hearLine.setAttribute('data-bytes', '0');
      hearLine.setAttribute('data-hearing', '');
      return;
    }
    void controller.receivedAudio().then((now) => {
      // The browser measures the sound as it is played out, so a faint panel needs a proportionally smaller threshold (energy goes with volume squared).
      const speaking = now.energy - last.energy >= HEARING_ENERGY * audio.volume * audio.volume;
      hearLine.setAttribute('data-bytes', String(now.bytes));
      hearLine.setAttribute('data-hearing', speaking ? 'yes' : 'no');
      hearLine.textContent = now.bytes === 0 ? 'No sound from the other side yet.' : speaking ? `Hearing the other side (${Math.round(now.bytes / 1024)} KB received).` : `The other side is silent or muted (${Math.round(now.bytes / 1024)} KB received).`;
      last = now;
    });
  }, 1000);

  const node = el(
    'div',
    { id, class: 'callbox' },
    stateLine,
    mediaLine,
    hearLine,
    el('div', { class: 'row' }, callAudio, callVideo, answer, decline, mute, hang, done),
    video,
    audio,
  );

  return {
    node,
    handle: (signal) => {
      try {
        controller.handleSignal(signal);
      } catch (e) {
        opts.log(`call message not used: ${errorText(e)}`);
      }
    },
    isLive: () => wasLive,
    setSoundOff: (off) => {
      soundOff = off;
      audio.volume = off ? QUIET : 1;
    },
    onLiveChange: (fn) => {
      changed = fn;
    },
    setCanDial: (can) => {
      canDial = can;
      render();
    },
    end: () => controller.hangup(),
  };
}
