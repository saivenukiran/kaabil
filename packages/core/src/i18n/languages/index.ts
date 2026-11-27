/**
 * The language registry. The prototype supports Telugu (primary) and English.
 * To add a language: create `<code>.ts` next to this file and add it to LANGUAGES.
 * Read README.md in this folder first; `languages.test.ts` checks the new file is complete.
 */
import type { LanguageDef } from '../language';
import { en } from './en';
import { te } from './te';

export const LANGUAGES = [te, en] as const;

/** Union of the registered codes. It grows by itself when a language is added above. */
export type LangCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANG: LangCode = 'te';

export function isLangCode(code: unknown): code is LangCode {
  return LANGUAGES.some((l) => l.code === code);
}

/** Unknown codes (for example a language removed since the state was saved) fall back to English. */
export function getLanguage(code: string, languages: readonly LanguageDef[] = LANGUAGES): LanguageDef {
  return languages.find((l) => l.code === code) ?? languages.find((l) => l.code === 'en') ?? (languages[0] as LanguageDef);
}
