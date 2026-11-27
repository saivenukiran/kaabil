import { useState } from 'react';
import { advance, fmtTime, jumpTo, LANGUAGES, setLang } from '@kaabil/core';
import { FamilyScreen } from './ui/FamilyScreen';
import { PersonScreen } from './ui/PersonScreen';
import { Roadmap } from './ui/Roadmap';
import { TestPanel } from './ui/TestPanel';
import { VoiceCheck } from './ui/VoiceCheck';
import { resetDemo, update, useAppState } from './store';

type Tab = 'person' | 'family' | 'split' | 'tests' | 'voice' | 'roadmap';

const TABS: { id: Tab; label: string }[] = [
  { id: 'person', label: 'Person' },
  { id: 'family', label: 'Family' },
  { id: 'split', label: 'Side by side' },
  { id: 'tests', label: 'Test panel' },
  { id: 'voice', label: 'Voice check' },
  { id: 'roadmap', label: 'Roadmap' },
];

export function App() {
  const state = useAppState();
  const [tab, setTab] = useState<Tab>('person');

  return (
    <div className="app">
      <header className="top">
        <h1>Kaabil Hain Hum <span className="tag">prototype</span></h1>
        <nav aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="demo" role="group" aria-label="Demo controls">
          <span className="clock" title="Demo clock">Demo clock {fmtTime(state.clockMs)}</span>
          <button onClick={() => update((s) => advance(s, 1))}>Advance 1 min</button>
          <button onClick={() => update((s) => advance(s, 10))}>Advance 10 min</button>
          <button onClick={() => update((s) => jumpTo(s, '08:00'))}>Jump to 08:00</button>
          <button onClick={() => update((s) => jumpTo(s, '21:00'))}>Jump to 21:00</button>
          <button onClick={resetDemo}>Reset demo</button>
          <span className="langs">
            {LANGUAGES.map((l) => (
              <button key={l.code} lang={l.code} className={state.lang === l.code ? 'active' : ''} onClick={() => update((s) => setLang(s, l.code))}>{l.nativeName}</button>
            ))}
          </span>
        </div>
      </header>

      <main className={tab === 'split' ? 'split' : ''}>
        {(tab === 'person' || tab === 'split') && <PersonScreen />}
        {(tab === 'family' || tab === 'split') && <FamilyScreen />}
        {tab === 'tests' && <TestPanel />}
        {tab === 'voice' && <VoiceCheck />}
        {tab === 'roadmap' && <Roadmap />}
      </main>
    </div>
  );
}
