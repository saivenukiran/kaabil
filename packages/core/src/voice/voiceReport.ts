/**
 * What a phone can say and hear, in each language. Pure functions: the browser reads its
 * own voices and capabilities (apps/web) and passes them in as plain data, so this code
 * has no browser in it and is tested like the rest of core.
 */
import type { LanguageDef } from '../i18n/language';

export interface VoiceInfo {
  name: string;
  /** BCP-47 tag as the browser reports it. Some Android browsers write "te_IN". */
  lang: string;
  localService?: boolean;
}

export interface VoiceFacts {
  /** True on https and on localhost; browsers allow the microphone only there. */
  secureContext: boolean;
  /** The browser can speak at all (speechSynthesis exists). */
  synthesis: boolean;
  /** The browser can listen (SpeechRecognition exists). */
  recognition: boolean;
  voices: VoiceInfo[];
  userAgent: string;
}

export type LanguageForVoice = Pick<LanguageDef, 'code' | 'name' | 'locale'>;

const tag = (s: string) => s.replace(/_/g, '-').toLowerCase();
const primary = (s: string) => tag(s).split('-')[0] ?? '';

/** Voices for a locale: the exact locale first, then other voices of the same language. */
export function voicesFor(voices: readonly VoiceInfo[], locale: string): VoiceInfo[] {
  const want = tag(locale);
  const lang = primary(locale);
  const exact = voices.filter((v) => tag(v.lang) === want);
  const same = voices.filter((v) => primary(v.lang) === lang && tag(v.lang) !== want);
  return [...exact, ...same];
}

/** The voice Kaabil will use for a locale, or undefined when the phone has none. */
export function pickVoice(voices: readonly VoiceInfo[], locale: string): VoiceInfo | undefined {
  return voicesFor(voices, locale)[0];
}

export interface LanguageVerdict {
  code: string;
  name: string;
  locale: string;
  voice: VoiceInfo | undefined;
  speaks: boolean;
  listens: boolean;
  /** Plain sentences saying what will happen instead, when something is missing. */
  notes: string[];
}

export function verdictFor(facts: VoiceFacts, language: LanguageForVoice): LanguageVerdict {
  const voice = facts.synthesis ? pickVoice(facts.voices, language.locale) : undefined;
  const speaks = voice !== undefined;
  const listens = facts.recognition && facts.secureContext;
  const notes: string[] = [];
  if (!facts.synthesis) notes.push('This browser cannot speak. Every sentence is shown large on screen.');
  else if (!speaks) notes.push(`No voice for ${language.locale} is installed. Every sentence is shown large on screen instead of being spoken.`);
  if (!facts.recognition) notes.push('This browser cannot listen. The Yes and No buttons and the text box do the same job.');
  else if (!facts.secureContext) notes.push('Listening needs an https page or localhost. Use the buttons or the text box here.');
  return { code: language.code, name: language.name, locale: language.locale, voice, speaks, listens, notes };
}

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** A short plain-text report a person can copy into a note. It holds no personal data. */
export function formatReport(facts: VoiceFacts, languages: readonly LanguageForVoice[]): string {
  const lines = [
    'Kaabil voice check',
    `Browser: ${facts.userAgent.slice(0, 140)}`,
    `Secure page (https or localhost): ${yesNo(facts.secureContext)}`,
    `Can speak: ${yesNo(facts.synthesis)} (${facts.voices.length} voices installed)`,
    `Can listen: ${yesNo(facts.recognition)}`,
  ];
  for (const l of languages) {
    const v = verdictFor(facts, l);
    const voice = v.voice ? `voice "${v.voice.name}" (${v.voice.lang})` : 'no voice';
    lines.push(`${l.name} (${l.locale}): speaks ${yesNo(v.speaks)}, ${voice}; listens ${yesNo(v.listens)}`);
  }
  return lines.join('\n');
}
