import type { MessageKey } from '../types';
import type { LanguageDef, UiStrings, Vars } from './language';
import { getLanguage, LANGUAGES } from './languages';

/** A spoken sentence. A language that lacks a message falls back to English, never to silence. */
export function render(lang: string, key: MessageKey, vars: Vars, languages: readonly LanguageDef[] = LANGUAGES): string {
  const fn = getLanguage(lang, languages).messages[key] ?? getLanguage('en', languages).messages[key];
  return fn(vars);
}

/** A string on the person's screen, in the language, or in English when it is not translated yet. */
export function ui<K extends keyof UiStrings>(lang: string, key: K, languages: readonly LanguageDef[] = LANGUAGES): UiStrings[K] {
  const own = getLanguage(lang, languages).ui[key];
  return (own ?? getLanguage('en', languages).ui[key]) as UiStrings[K];
}
