import { useEffect, useMemo, useRef, useState } from 'react';
import { formatReport, getLanguage, interpret, LANGUAGES, MESSAGE_KEYS, render, verdictFor, type LangCode, type VoiceFacts } from '@kaabil/core';
import { WebSpeechPort } from '../voice/speechPort';

/** Fictional sample values for the lines. */
const SAMPLE = { address: 'Amma', name: 'Metformin', strength: '500' };

interface RecognitionWindow {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

function readFacts(): VoiceFacts {
  const w = window as unknown as RecognitionWindow;
  const synthesis = 'speechSynthesis' in window;
  return {
    secureContext: window.isSecureContext,
    synthesis,
    recognition: Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition),
    voices: synthesis ? window.speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, localService: v.localService })) : [],
    userAgent: navigator.userAgent,
  };
}

/**
 * A two-minute check for a real phone: which voice Kaabil would use in each language,
 * whether it can listen, and a button to hear every spoken line. Nothing here is stored or sent.
 */
export function VoiceCheck() {
  const [facts, setFacts] = useState<VoiceFacts>(readFacts);
  const port = useMemo(() => new WebSpeechPort(), []);
  const [playing, setPlaying] = useState<{ code: LangCode; key: string; text: string } | null>(null);
  const [heard, setHeard] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  const stopped = useRef(false);

  useEffect(() => {
    // Browsers load their voices late; read them again when the list changes.
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const refresh = () => setFacts(readFacts());
    synth.addEventListener('voiceschanged', refresh);
    return () => {
      synth.removeEventListener('voiceschanged', refresh);
      stopped.current = true;
      port.cancel();
    };
  }, [port]);

  async function playAll(code: LangCode) {
    stopped.current = false;
    for (const key of MESSAGE_KEYS) {
      if (stopped.current) break;
      const text = render(code, key, SAMPLE);
      setPlaying({ code, key, text });
      await port.speak(text, code);
    }
    setPlaying(null);
  }

  function stop() {
    stopped.current = true;
    port.cancel();
    setPlaying(null);
  }

  async function tryMic(code: LangCode) {
    setHeard((h) => ({ ...h, [code]: 'Listening for 6 seconds. Say Yes or No in this language.' }));
    const r = await port.listen({ lang: code, timeoutMs: 6000 });
    const msg = r.ok ? `Heard "${r.text}". Kaabil reads this as: ${interpret(r.text)}.` : `Nothing heard (${r.reason}).`;
    setHeard((h) => ({ ...h, [code]: msg }));
  }

  const report = formatReport(facts, LANGUAGES);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('Copied.');
    } catch {
      setCopied('Copy was blocked. Select the text above and copy it by hand.');
    }
  }

  return (
    <section aria-label="Voice check">
      <div className="card">
        <h3>Voice check</h3>
        <p>Open this page on the phone you want to test. It shows the voice Kaabil would use in each language and lets you hear every spoken line. The microphone test uses your browser's speech recognition, which may send audio to its maker. Nothing is stored or sent by Kaabil.</p>
        <table>
          <tbody>
            <tr><td>Secure page (https or localhost)</td><td>{facts.secureContext ? 'Yes' : 'No'}</td></tr>
            <tr><td>Can speak</td><td>{facts.synthesis ? `Yes, ${facts.voices.length} voices installed` : 'No'}</td></tr>
            <tr><td>Can listen</td><td>{facts.recognition ? 'Yes' : 'No'}</td></tr>
          </tbody>
        </table>
      </div>

      {LANGUAGES.map((l) => {
        const v = verdictFor(facts, l);
        return (
          <div className="card" key={l.code}>
            <h3 lang={l.code}>{l.nativeName} <span className="muted">({l.nativeName === l.name ? l.locale : `${l.name}, ${l.locale}`})</span></h3>
            <table>
              <tbody>
                <tr><td>Voice Kaabil would use</td><td>{v.voice ? `${v.voice.name} (${v.voice.lang})` : 'None installed'}</td></tr>
                <tr><td>Speaks</td><td className={v.speaks ? 'ok' : 'muted'}>{v.speaks ? 'Yes' : 'No: the sentence is shown on screen instead'}</td></tr>
                <tr><td>Listens</td><td className={v.listens ? 'ok' : 'muted'}>{v.listens ? 'Yes' : 'No: buttons and typing work'}</td></tr>
              </tbody>
            </table>
            {v.notes.map((n) => <p className="notice" key={n}>{n}</p>)}
            <div className="row">
              <button onClick={() => void playAll(l.code)} disabled={playing !== null}>Play the {MESSAGE_KEYS.length} lines</button>
              <button onClick={stop} disabled={playing === null}>Stop</button>
              <button onClick={() => void tryMic(l.code)} disabled={!v.listens || playing !== null}>Test the microphone</button>
            </div>
            {playing?.code === l.code && <p lang={l.code} aria-live="polite"><strong>{playing.key}:</strong> {playing.text}</p>}
            {heard[l.code] && <p aria-live="polite" lang={getLanguage(l.code).code}>{heard[l.code]}</p>}
          </div>
        );
      })}

      <div className="card">
        <h3>Report</h3>
        <p>Copy this into your notes after the test. It contains the browser name and what worked, nothing personal.</p>
        <pre>{report}</pre>
        <div className="row">
          <button onClick={() => void copy()}>Copy the report</button>
        </div>
        {copied && <p aria-live="polite">{copied}</p>}
      </div>
    </section>
  );
}
