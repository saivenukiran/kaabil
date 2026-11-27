import { describe, expect, it } from 'vitest';
import { ClipSpeechPort } from './clipPort';
import { ScriptedPort } from './speechPort';

describe('the recorded-voice port', () => {
  it('plays the recording for a sentence that has one, and does not use the synthetic voice', async () => {
    const inner = new ScriptedPort([]);
    const played: string[] = [];
    const port = new ClipSpeechPort(inner, (url) => {
      played.push(url);
      return Promise.resolve();
    });
    port.setClips([{ lang: 'te', text: 'అమ్మ, మందు వేసుకోండి', url: 'blob:one' }]);
    await port.speak('అమ్మ, మందు వేసుకోండి', 'te');
    expect(played).toEqual(['blob:one']);
    expect(inner.spoken).toEqual([]);
    expect(port.playedFromClip).toEqual(['అమ్మ, మందు వేసుకోండి']);
  });

  it('speaks everything else with the synthetic voice', async () => {
    const inner = new ScriptedPort([]);
    const port = new ClipSpeechPort(inner, () => Promise.reject(new Error('should not play')));
    port.setClips([{ lang: 'te', text: 'one sentence', url: 'blob:one' }]);
    await port.speak('another sentence', 'te');
    expect(inner.spoken).toEqual([{ text: 'another sentence', lang: 'te' }]);
  });

  it('matches the language as well as the text', async () => {
    const inner = new ScriptedPort([]);
    const port = new ClipSpeechPort(inner, () => Promise.reject(new Error('should not play')));
    port.setClips([{ lang: 'te', text: 'Recorded.', url: 'blob:one' }]);
    await port.speak('Recorded.', 'en');
    expect(inner.spoken).toHaveLength(1);
  });

  it('falls back to the synthetic voice when a recording cannot play, so there is never silence', async () => {
    const inner = new ScriptedPort([]);
    const port = new ClipSpeechPort(inner, () => Promise.reject(new Error('decode error')));
    port.setClips([{ lang: 'en', text: 'Time for your medicine', url: 'blob:bad' }]);
    await port.speak('Time for your medicine', 'en');
    expect(inner.spoken).toEqual([{ text: 'Time for your medicine', lang: 'en' }]);
    expect(port.playedFromClip).toEqual([]);
  });

  it('can be refreshed with a new set of recordings', async () => {
    const inner = new ScriptedPort([]);
    const port = new ClipSpeechPort(inner, () => Promise.resolve());
    port.setClips([{ lang: 'en', text: 'a', url: 'u1' }]);
    expect(port.has('en', 'a')).toBe(true);
    port.setClips([]);
    expect(port.has('en', 'a')).toBe(false);
  });
});
