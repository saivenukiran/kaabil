import { useState } from 'react';
import { dismiss112, getLanguage, hear, press, sos, ui } from '@kaabil/core';
import { update, useAppState } from '../store';
import { useVoiceLoop } from './useVoiceLoop';

export function PersonScreen() {
  const state = useAppState();
  const voice = useVoiceLoop();
  const [typed, setTyped] = useState('');
  const language = getLanguage(state.lang);
  const words = language.buttonWords;
  const stateWords = language.stateWords;

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
          <span className="hint">{ui(state.lang, 'startHint')}</span>
        </button>
      ) : (
        <>
          <p className="state-word" aria-live="polite">{stateWord}</p>
          <button
            className={`mic-circle ${voice.status}`}
            onClick={voice.tapMic}
            aria-label={ui(state.lang, 'speakAria')}
          >
            <span aria-hidden="true">🎤</span>
          </button>
        </>
      )}

      <div className="caption">
        {lastSaid && <p className="said">{lastSaid.text}</p>}
        {lastHeard && <p className="heard">“{lastHeard.text}”</p>}
        {!lastSaid && !lastHeard && <p className="muted">{ui(state.lang, 'tryHint')}</p>}
      </div>

      {voice.micMessage && <p className="notice" role="alert">{voice.micMessage}</p>}
      {voice.armed && voice.voiceKind === 'web-speech' && !voice.hasVoice(state.lang) && (
        <p className="notice">{ui(state.lang, 'noVoice')(language.name)}</p>
      )}

      {state.show112 && (
        <div className="call112" role="alert">
          <a className="big-button red" href="tel:112">112</a>
          <button className="link-button" onClick={() => update(dismiss112)}>{ui(state.lang, 'close')}</button>
        </div>
      )}

      {showButtons && (
        <div className="yn" role="group" aria-label="Answer">
          <button className="big-button yes" onClick={() => { voice.interrupt(); update((s) => press(s, 'yes')); }}>{words.yes}</button>
          <button className="big-button no" onClick={() => { voice.interrupt(); update((s) => press(s, 'no')); }}>{words.no}</button>
        </div>
      )}

      <div className="typed">
        <label htmlFor="typed">{ui(state.lang, 'typedLabel')}</label>
        <div className="row">
          <input
            id="typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={ui(state.lang, 'typedPlaceholder')}
            lang={state.lang}
          />
          <button onClick={send}>{ui(state.lang, 'send')}</button>
        </div>
      </div>

      <button className="big-button sos" onClick={() => { voice.interrupt(); update(sos); }}>{ui(state.lang, 'sos')}</button>
      <footer className="disclaimer">{ui(state.lang, 'disclaimer')}</footer>
    </section>
  );
}
