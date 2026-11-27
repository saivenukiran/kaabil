import { describe, expect, it } from 'vitest';
import { advance, initialState, press, type AppState } from '@kaabil/core';
import { createVoiceLoop, type VoiceStatus } from './voiceLoop';
import { ScriptedPort, type ListenResult, type SpeechPort } from './speechPort';

/** A little holder for the dialogue state, shaped like the host a screen would give the loop. */
function host(state: AppState) {
  const h = {
    state,
    messages: [] as (string | null)[],
    statuses: [] as VoiceStatus[],
    getState: () => h.state,
    update: (fn: (s: AppState) => AppState) => {
      h.state = fn(h.state);
    },
    onMessage: (m: string | null) => h.messages.push(m),
    onStatus: (s: VoiceStatus) => h.statuses.push(s),
  };
  return h;
}

const FAST = { listenMs: 50, micDelayMs: 0 };
/** 07:55, five minutes before Metformin at 08:00. */
const start = () => initialState(new Date(2026, 10, 28, 7, 55).getTime());

describe('the turn loop', () => {
  it('speaks the reminder, hears the claim and the yes, and records the dose', async () => {
    const port = new ScriptedPort(['వేసుకున్నాను', 'అవును']);
    const h = host(start());
    const loop = createVoiceLoop(port, h, FAST);
    await loop.arm();
    await loop.idle();
    h.update((s) => advance(s, 5));
    loop.notify();
    await loop.idle();
    expect(h.state.doses).toHaveLength(1);
    expect(h.state.doses[0]?.via).toBe('voice');
    expect(h.state.session?.phase).toBe('logged');
    const keys = h.state.outbox.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['remind', 'confirm_log', 'logged']));
    // the first spoken line is the audio test, then every outbox line is spoken in order
    expect(port.spoken.slice(1).map((x) => x.text)).toEqual(h.state.outbox.map((o) => o.text));
  });

  it('never records a dose from a bare yes', async () => {
    const port = new ScriptedPort(['అవును', 'అవును']);
    const h = host(start());
    const loop = createVoiceLoop(port, h, FAST);
    await loop.arm();
    h.update((s) => advance(s, 5));
    loop.notify();
    await loop.idle();
    expect(h.state.doses).toHaveLength(0);
    expect(h.state.outbox.filter((o) => o.key === 'clarify').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the buttons after repeated silence and then stops listening', async () => {
    const port = new ScriptedPort([null, null, null, null]);
    const h = host(start());
    const loop = createVoiceLoop(port, h, FAST);
    await loop.arm();
    h.update((s) => advance(s, 5));
    loop.notify();
    await loop.idle();
    expect(h.state.session?.showButtons).toBe(true);
    expect(h.state.outbox.at(-1)?.key).toBe('buttons');
    // with buttons showing, a press finishes the conversation without the microphone
    h.update((s) => press(press(s, 'yes'), 'yes'));
    expect(h.state.doses).toHaveLength(1);
    expect(h.state.doses[0]?.via).toBe('button');
  });

  it('falls back to buttons and says so when the microphone is blocked', async () => {
    const denied: SpeechPort = {
      kind: 'scripted',
      hasVoice: () => true,
      speak: () => Promise.resolve(),
      listen: (): Promise<ListenResult> => Promise.resolve({ ok: false, reason: 'denied' }),
      cancel: () => undefined,
    };
    const h = host(start());
    const loop = createVoiceLoop(denied, h, FAST);
    await loop.arm();
    h.update((s) => advance(s, 5));
    loop.notify();
    await loop.idle();
    expect(h.state.session?.showButtons).toBe(true);
    expect(h.messages.filter((m) => m !== null)).toHaveLength(1);
  });

  it('does not repeat lines it already spoke before it was created', async () => {
    const warm = advance(start(), 5); // a reminder is already in the outbox
    const port = new ScriptedPort([]);
    const h = host(warm);
    const loop = createVoiceLoop(port, h, FAST);
    await loop.arm();
    await loop.idle();
    expect(port.spoken).toHaveLength(1); // only the audio-test line
  });

  it('does nothing before it is armed, and stops when asked', async () => {
    const port = new ScriptedPort(['అవును']);
    const h = host(start());
    const loop = createVoiceLoop(port, h, FAST);
    h.update((s) => advance(s, 5));
    loop.notify();
    await loop.idle();
    expect(port.spoken).toHaveLength(0);
    await loop.arm();
    loop.stop();
    expect(loop.isArmed()).toBe(false);
  });
});
