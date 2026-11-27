import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceButtons, hear, render, silence } from '@kaabil/core';
import { getState, update, useAppState } from '../store';
import { createPort } from '../voice/speechPort';

export type VoiceStatus = 'idle' | 'speaking' | 'listening';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LISTEN_MS = 6000; // wait 6 seconds, re-prompt twice, then buttons (see dialogue.ts)
const MIC_DELAY_MS = 300; // the mic opens 300 ms after the app stops speaking

/**
 * The turn loop: speak whatever the app has to say, then listen if an answer is needed.
 * Speaking and listening never overlap, so the mic cannot hear the app's own voice.
 */
export function useVoiceLoop() {
  const state = useAppState();
  const port = useMemo(() => createPort(), []);
  const [armed, setArmed] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [micMessage, setMicMessage] = useState<string | null>(null);

  const spoken = useRef(getState().outbox.at(-1)?.id ?? 0);
  const busy = useRef(false);
  const armedRef = useRef(false);
  const autoListen = useRef(true);
  const forceOnce = useRef(false);
  const statusRef = useRef<VoiceStatus>('idle');

  const setStat = (s: VoiceStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (armedRef.current) {
        const s = getState();
        const next = s.outbox.find((o) => o.id > spoken.current);
        if (next) {
          spoken.current = next.id;
          setStat('speaking');
          await port.speak(next.text, next.lang);
          continue;
        }
        const sess = s.session;
        const waiting = !!sess && (sess.phase === 'asked' || sess.phase === 'confirming');
        const want = forceOnce.current || (autoListen.current && waiting && !sess.showButtons);
        if (!want) break;
        forceOnce.current = false;
        await sleep(MIC_DELAY_MS);
        if (!armedRef.current) break;
        setStat('listening');
        const r = await port.listen({ lang: s.lang, timeoutMs: LISTEN_MS });
        setStat('idle');
        if (r.ok) update((st) => hear(st, r.text, 'voice'));
        else if (r.reason === 'timeout') update((st) => silence(st));
        else if (r.reason === 'cancelled') continue;
        else {
          autoListen.current = false;
          setMicMessage(
            r.reason === 'denied'
              ? 'Microphone is blocked. Use the buttons or type.'
              : 'This browser cannot listen. Use the buttons or type.',
          );
          update(forceButtons);
          break;
        }
      }
    } finally {
      busy.current = false;
      setStat('idle');
    }
  }, [port]);

  // New app speech arrives: stop listening so it is spoken at once, then run the loop.
  useEffect(() => {
    if (!armed) return;
    if (busy.current && statusRef.current === 'listening') port.cancel();
    void pump();
  }, [armed, state.outbox.length, state.session?.phase, state.session?.showButtons, port, pump]);

  /** Must run inside a tap: unlocks speech and, on first listen, asks for the microphone. */
  const arm = useCallback(() => {
    armedRef.current = true;
    autoListen.current = true;
    setMicMessage(null);
    const s = getState();
    // The first spoken line doubles as the audio test; the loop starts after it ends.
    void port
      .speak(render(s.lang, 'help', { address: s.person.address, name: '', strength: '' }), s.lang)
      .then(() => setArmed(true));
  }, [port]);

  const tapMic = useCallback(() => {
    if (!armedRef.current) return arm();
    autoListen.current = true;
    forceOnce.current = true;
    if (busy.current && statusRef.current === 'listening') return;
    void pump();
  }, [arm, pump]);

  /** Call before handling typed or button input so a pending listen ends at once. */
  const interrupt = useCallback(() => {
    if (statusRef.current === 'listening') port.cancel();
  }, [port]);

  return { armed, status, micMessage, arm, tapMic, interrupt, voiceKind: port.kind, hasVoice: port.hasVoice.bind(port) };
}
