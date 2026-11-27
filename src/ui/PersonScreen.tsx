import { useState } from 'react';
import { dismiss112, hear, press, sos } from '../dose/engine';
import { BUTTON_WORDS, STATE_WORDS } from '../i18n/messages';
import { update, useAppState } from '../store';
import { useVoiceLoop } from './useVoiceLoop';

export function PersonScreen() {
  const state = useAppState();
  const voice = useVoiceLoop();
  const [typed, setTyped] = useState('');
  const words = BUTTON_WORDS[state.lang];
  const stateWords = STATE_WORDS[state.lang];

  const session = state.session;
  const lastHeard = [...state.transcripts].reverse().find((t) => t.who === 'person');
  const lastSaid = state.outbox.at(-1);
  const showButtons = !!session?.showButtons || voice.micMessage !== null;

  let stateWord = stateWords.ready;
  if (voice.status === 'listening') stateWord = stateWords.listening;
  else if (voice.status === 'speaking') stateWord = stateWords.thinking;
  else if (session?.phase === 'logged') stateWord = stateWords.done;

  const send = () => {
    if (typed.trim() === '') return;
    voice.interrupt();
    update((s) => hear(s, typed, 'voice'));
    setTyped('');
  };

  return (
    <section className="person" aria-label="Person screen">
      {!voice.armed ? (
        <button className="start-button" onClick={voice.arm}>
          {words.start}
          <span className="hint">Tap once so the phone can speak and listen</span>
        </button>
      ) : (
        <>
          <p className="state-word" aria-live="polite">{stateWord}</p>
          <button
            className={`mic-circle ${voice.status}`}
            onClick={voice.tapMic}
            aria-label="Speak"
          >
            <span aria-hidden="true">🎤</span>
          </button>
        </>
      )}

      <div className="caption">
        {lastSaid && <p className="said">{lastSaid.text}</p>}
        {lastHeard && <p className="heard">“{lastHeard.text}”</p>}
        {!lastSaid && !lastHeard && <p className="muted">Press “Advance demo time” to reach 08:00.</p>}
      </div>

      {voice.micMessage && <p className="notice" role="alert">{voice.micMessage}</p>}
      {voice.armed && voice.voiceKind === 'web-speech' && !voice.hasVoice(state.lang) && (
        <p className="notice">No {state.lang === 'te' ? 'Telugu' : state.lang === 'hi' ? 'Hindi' : 'English'} voice on this device. The words are shown on screen instead.</p>
      )}

      {state.show112 && (
        <div className="call112" role="alert">
          <a className="big-button red" href="tel:112">112</a>
          <button className="link-button" onClick={() => update(dismiss112)}>Close</button>
        </div>
      )}

      {showButtons && (
        <div className="yn" role="group" aria-label="Answer">
          <button className="big-button yes" onClick={() => { voice.interrupt(); update((s) => press(s, 'yes')); }}>{words.yes}</button>
          <button className="big-button no" onClick={() => { voice.interrupt(); update((s) => press(s, 'no')); }}>{words.no}</button>
        </div>
      )}

      <div className="typed">
        <label htmlFor="typed">If voice fails, type or dictate (Wispr Flow works here)</label>
        <div className="row">
          <input
            id="typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="వేసుకున్నాను"
            lang={state.lang}
          />
          <button onClick={send}>Send</button>
        </div>
      </div>

      <button className="big-button sos" onClick={() => { voice.interrupt(); update(sos); }}>SOS</button>
      <footer className="disclaimer">Not a medical device</footer>
    </section>
  );
}
