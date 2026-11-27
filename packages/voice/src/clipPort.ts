/**
 * Plays a family member's own recording instead of the synthetic voice, when one exists for the
 * exact sentence Kaabil is about to say. Anything without a recording is spoken by the inner port,
 * so a missing or broken clip never means silence. Kaabil still speaks only its fixed messages:
 * a clip is looked up by the sentence, never the other way round.
 */
import type { LangCode } from '@kaabil/core';
import type { ListenResult, SpeechPort } from './speechPort';

export interface Clip {
  lang: LangCode;
  text: string;
  /** Where the audio can be played from (a blob or object URL). */
  url: string;
}

export const clipKey = (lang: string, text: string) => `${lang}|${text}`;

/** How a clip is played. The browser implementation uses an audio element; tests pass a fake. */
export type PlayClip = (url: string) => Promise<void>;

export const playWithAudioElement: PlayClip = (url) =>
  new Promise((resolve, reject) => {
    const audio = new Audio(url);
    const guard = setTimeout(() => reject(new Error('clip timed out')), 30_000);
    audio.onended = () => {
      clearTimeout(guard);
      resolve();
    };
    audio.onerror = () => {
      clearTimeout(guard);
      reject(new Error('clip failed'));
    };
    audio.play().catch((e: unknown) => {
      clearTimeout(guard);
      reject(e instanceof Error ? e : new Error('clip could not start'));
    });
  });

export class ClipSpeechPort implements SpeechPort {
  private clips = new Map<string, Clip>();
  /** Texts spoken from a recording, newest last. For the screen and for tests. */
  readonly playedFromClip: string[] = [];

  constructor(
    private readonly inner: SpeechPort,
    private readonly play: PlayClip = playWithAudioElement,
  ) {}

  get kind() {
    return this.inner.kind;
  }

  setClips(clips: Clip[]): void {
    this.clips = new Map(clips.map((c) => [clipKey(c.lang, c.text), c]));
  }

  has(lang: LangCode, text: string): boolean {
    return this.clips.has(clipKey(lang, text));
  }

  /** True when the sentence has a recording, so there is a voice even where the browser has none for the language. */
  hasVoice(lang: LangCode): boolean {
    return this.inner.hasVoice(lang);
  }

  async speak(text: string, lang: LangCode): Promise<void> {
    const clip = this.clips.get(clipKey(lang, text));
    if (clip) {
      this.inner.cancel(); // the microphone must never hear the recording
      try {
        await this.play(clip.url);
        this.playedFromClip.push(text);
        return;
      } catch {
        /* fall through: a clip that cannot play is spoken by the synthetic voice */
      }
    }
    return this.inner.speak(text, lang);
  }

  listen(opts: { lang: LangCode; timeoutMs: number }): Promise<ListenResult> {
    return this.inner.listen(opts);
  }

  cancel(): void {
    this.inner.cancel();
  }
}
