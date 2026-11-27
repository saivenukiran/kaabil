/**
 * The turn loop: speak whatever the app has to say, then listen if an answer is needed.
 * Speaking and listening never overlap, so the microphone cannot hear the app's own voice.
 * It holds no framework: the screen gives it a way to read and change the dialogue state, and
 * calls `notify()` whenever that state changes. (The React app has the same loop as a hook.)
 */
import { forceButtons, hear, render, silence, ui, type AppState } from '@kaabil/core';
import type { SpeechPort } from './speechPort';

export type VoiceStatus = 'idle' | 'speaking' | 'listening';

export interface LoopHost {
  getState(): AppState;
  update(fn: (s: AppState) => AppState): void;
  onStatus?(s: VoiceStatus): void;
  /** A notice for the person, for example that the microphone is blocked. `null` clears it. */
  onMessage?(m: string | null): void;
}

export interface LoopOptions {
  /** How long to wait for an answer. */
  listenMs?: number;
  /** The microphone opens this long after the app stops speaking. */
  micDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createVoiceLoop(port: SpeechPort, host: LoopHost, opts: LoopOptions = {}) {
  const listenMs = opts.listenMs ?? 6000; // wait 6 seconds, re-prompt twice, then buttons (see dialogue.ts)
  const micDelayMs = opts.micDelayMs ?? 300;

  let spoken = host.getState().outbox.at(-1)?.id ?? 0;
  let running: Promise<void> | null = null;
  let armed = false;
  let autoListen = true;
  let forceOnce = false;
  let status: VoiceStatus = 'idle';

  const setStatus = (s: VoiceStatus) => {
    status = s;
    host.onStatus?.(s);
  };

  async function pump(): Promise<void> {
    try {
      while (armed) {
        const s = host.getState();
        const next = s.outbox.find((o) => o.id > spoken);
        if (next) {
          spoken = next.id;
          setStatus('speaking');
          await port.speak(next.text, next.lang);
          continue;
        }
        const sess = s.session;
        const waiting = !!sess && (sess.phase === 'asked' || sess.phase === 'confirming');
        const want = forceOnce || (autoListen && waiting && !sess.showButtons);
        if (!want) break;
        forceOnce = false;
        await sleep(micDelayMs);
        if (!armed) break;
        setStatus('listening');
        const r = await port.listen({ lang: s.lang, timeoutMs: listenMs });
        setStatus('idle');
        if (r.ok) host.update((st) => hear(st, r.text, 'voice'));
        else if (r.reason === 'timeout') host.update((st) => silence(st));
        else if (r.reason === 'cancelled') continue;
        else {
          autoListen = false;
          host.onMessage?.(r.reason === 'denied' ? ui(s.lang, 'micBlocked') : ui(s.lang, 'micUnsupported'));
          host.update(forceButtons);
          break;
        }
      }
    } finally {
      setStatus('idle');
    }
  }

  function run(): void {
    if (running) return;
    running = pump().finally(() => {
      running = null;
    });
  }

  return {
    /** New app speech or a new phase arrived: stop listening so it is spoken at once, then run the loop. */
    notify(): void {
      if (!armed) return;
      if (running && status === 'listening') port.cancel();
      run();
    },

    /** Must run inside a tap: unlocks speech and, on the first listen, asks for the microphone. Resolves when the loop is armed. */
    async arm(): Promise<void> {
      autoListen = true;
      host.onMessage?.(null);
      const s = host.getState();
      armed = true; // a tap is enough to start; the first spoken line doubles as the audio test
      await port.speak(render(s.lang, 'help', { address: s.person.address, name: '', strength: '' }), s.lang);
      run();
    },

    /** The big microphone button: listen now, even if the loop had stopped. */
    tapMic(): void {
      if (!armed) {
        void this.arm();
        return;
      }
      autoListen = true;
      forceOnce = true;
      if (running && status === 'listening') return;
      run();
    },

    /** Call before handling typed or button input so a pending listen ends at once. */
    interrupt(): void {
      if (status === 'listening') port.cancel();
    },

    /** Stop for good (for example when the page closes). */
    stop(): void {
      armed = false;
      port.cancel();
    },

    isArmed: () => armed,
    getStatus: () => status,
    /** Resolves when the loop has nothing left to do. Used by tests and by "wait until Kaabil has finished". */
    async idle(): Promise<void> {
      while (running) await running;
    },
    voiceKind: port.kind,
    hasVoice: port.hasVoice.bind(port),
  };
}

export type VoiceLoop = ReturnType<typeof createVoiceLoop>;
