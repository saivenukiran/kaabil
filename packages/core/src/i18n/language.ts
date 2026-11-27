/**
 * The contract for one language. Everything Kaabil says, hears or shows in a language
 * lives in one `LanguageDef` object in `languages/<code>.ts`. Nothing else in the code
 * may contain native-language text. To add a language, follow `languages/README.md`.
 */
import type { MessageKey } from '../types';

/** Values spliced into a spoken sentence. */
export interface Vars {
  address: string;
  name: string;
  strength: string;
}

/** Every spoken message, as a function so a language can order the words its own way. */
export type MessageTable = Record<MessageKey, (v: Vars) => string>;

export interface StateWords {
  listening: string;
  thinking: string;
  done: string;
  ready: string;
}

export interface ButtonWords {
  yes: string;
  no: string;
  start: string;
}

/**
 * Words the rules match. All lists are lower-case where the script has case. A phrase may
 * have several words. The rules combine the lists of every registered language, because
 * people mix languages in one sentence.
 */
export interface WordLists {
  yes: string[];
  no: string[];
  /** Word endings that negate a verb (Telugu: వేసుకోలేదు = did not take). Often empty. */
  noSuffix: string[];
  /** "I took it". */
  claim: string[];
  /** "not yet", "later". */
  later: string[];
  stop: string[];
  help: string[];
  repeat: string[];
  /** Matched as substrings, because many languages add endings to a verb. */
  emergency: string[];
}

/** Words on the person's screen outside the dialogue. Missing ones fall back to English. */
export interface UiStrings {
  startHint: string;
  tryHint: string;
  typedLabel: string;
  typedPlaceholder: string;
  send: string;
  sos: string;
  disclaimer: string;
  close: string;
  speakAria: string;
  micBlocked: string;
  micUnsupported: string;
  /** `languageName` is the English name of the language with no voice on this device. */
  noVoice: (languageName: string) => string;
}

export interface LanguageDef {
  /** Short code, unique. Also the key saved in the person's state. */
  code: string;
  /** English name, for lists and notices. */
  name: string;
  /** Name in the language's own script, for the language switch. */
  nativeName: string;
  /** BCP-47 tag handed to speech recognition and speech output, for example "te-IN". */
  locale: string;
  /**
   * Unicode ranges of the script, used to switch the reply language when the person speaks
   * it. Leave empty for a Latin-script language: Latin-only text keeps the current language.
   */
  scripts: ReadonlyArray<readonly [number, number]>;
  messages: MessageTable;
  stateWords: StateWords;
  buttonWords: ButtonWords;
  words: WordLists;
  ui: Partial<UiStrings>;
  /** Draft text must be reviewed by a native speaker before real users hear it. */
  review: 'draft' | 'native-reviewed';
}

/** Keeps the literal type of `code`, so `LangCode` is a union of the registered codes. */
export function defineLanguage<C extends string>(def: LanguageDef & { code: C }): LanguageDef & { code: C } {
  return def;
}
