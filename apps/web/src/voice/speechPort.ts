/**
 * All speech goes through one SpeechPort. The browser implementation uses the Web
 * Speech API; ScriptedPort replaces it in tests and in the demo without a microphone.
 * Models only turn sound into text. They never decide Yes or No (see words.ts).
 */
import type { LangCode } from '@kaabil/core';

export type ListenResult =
  | { ok: true; text: string; confidence?: number }
  | { ok: false; reason: 'timeout' | 'denied' | 'unsupported' | 'cancelled' | 'error' };

export interface SpeechPort {
  readonly kind: 'web-speech' | 'scripted';
  /** True if the browser can speak this language with a matching voice. */
  hasVoice(lang: LangCode): boolean;
  speak(text: string, lang: LangCode): Promise<void>;
  listen(opts: { lang: LangCode; timeoutMs: number }): Promise<ListenResult>;
  /** Stops listening (resolves a pending listen as "cancelled") and stops speaking. */
  cancel(): void;
}

const LOCALES: Record<LangCode, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' };

interface RecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export class WebSpeechPort implements SpeechPort {
  readonly kind = 'web-speech' as const;
  private stopListening: (() => void) | null = null;

  hasVoice(lang: LangCode): boolean {
    if (!('speechSynthesis' in window)) return false;
    return window.speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith(lang));
  }

  speak(text: string, lang: LangCode): Promise<void> {
    this.stopListening?.(); // the mic must never hear the app's own voice
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LOCALES[lang];
      u.rate = 0.85;
      const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
      if (voice) u.voice = voice;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        resolve();
      };
      const guard = setTimeout(finish, 8000); // a speech with no end event is cancelled
      u.onend = finish;
      u.onerror = finish;
      synth.cancel();
      synth.speak(u);
    });
  }

  listen(opts: { lang: LangCode; timeoutMs: number }): Promise<ListenResult> {
    const Ctor = recognitionCtor();
    if (!Ctor) return Promise.resolve({ ok: false, reason: 'unsupported' });
    return new Promise((resolve) => {
      const rec = new Ctor();
      rec.lang = LOCALES[opts.lang];
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let finished = false;
      const finish = (r: ListenResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.stopListening = null;
        resolve(r);
      };
      const timer = setTimeout(() => {
        rec.abort();
        finish({ ok: false, reason: 'timeout' });
      }, opts.timeoutMs);
      this.stopListening = () => {
        rec.abort();
        finish({ ok: false, reason: 'cancelled' });
      };
      rec.onresult = (e) => {
        const alt = e.results[0]?.[0];
        if (alt) finish({ ok: true, text: alt.transcript, confidence: alt.confidence });
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') finish({ ok: false, reason: 'denied' });
        else if (e.error === 'no-speech') finish({ ok: false, reason: 'timeout' });
        else if (e.error === 'aborted') finish({ ok: false, reason: 'cancelled' });
        else finish({ ok: false, reason: 'error' });
      };
      rec.onend = () => finish({ ok: false, reason: 'timeout' });
      try {
        rec.start();
      } catch {
        finish({ ok: false, reason: 'error' });
      }
    });
  }

  cancel(): void {
    this.stopListening?.();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}

/** A port that plays back a fixed script. Used by tests and by the no-microphone demo. */
export class ScriptedPort implements SpeechPort {
  readonly kind = 'scripted' as const;
  readonly spoken: { text: string; lang: LangCode }[] = [];
  private queue: (string | null)[];

  /** `null` in the script means "the person stayed silent". */
  constructor(script: (string | null)[]) {
    this.queue = [...script];
  }

  hasVoice(): boolean {
    return true;
  }

  speak(text: string, lang: LangCode): Promise<void> {
    this.spoken.push({ text, lang });
    return Promise.resolve();
  }

  listen(): Promise<ListenResult> {
    const next = this.queue.shift();
    if (next === undefined) return Promise.resolve({ ok: false, reason: 'unsupported' });
    if (next === null) return Promise.resolve({ ok: false, reason: 'timeout' });
    return Promise.resolve({ ok: true, text: next, confidence: 1 });
  }

  cancel(): void {
    this.queue = [];
  }
}

export function createPort(): SpeechPort {
  return new WebSpeechPort();
}
