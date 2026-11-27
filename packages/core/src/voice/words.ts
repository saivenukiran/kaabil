/**
 * Word rules decide Yes and No. A speech model only supplies text; the word lists decide
 * what it means. Uncertainty never counts as Yes: anything we cannot classify with
 * confidence returns "unclear" or "mixed", and the app asks again.
 *
 * The lists live in the language files (`i18n/languages/*.ts`), not here. The rules combine
 * the lists of every registered language, so a new language is understood as soon as it is
 * registered, and people who mix two languages in one sentence are understood too.
 */
import type { LanguageDef, WordLists } from '../i18n/language';
import { LANGUAGES } from '../i18n/languages';

export type Intent =
  | 'emergency'
  | 'stop'
  | 'help'
  | 'repeat'
  | 'claim' // "I took it"
  | 'yes'
  | 'no'
  | 'notyet' // "not yet" or "later"
  | 'mixed' // contains both Yes and No
  | 'unclear';

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‌‍]/g, '') // joiners inside Indic words must not split them
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const nfc = (xs: string[]) => xs.map((x) => x.normalize('NFC').toLowerCase());

/** The word lists of all languages merged, built once per language list. */
const compiled = new WeakMap<readonly LanguageDef[], WordLists>();

function wordsOf(languages: readonly LanguageDef[]): WordLists {
  const cached = compiled.get(languages);
  if (cached) return cached;
  const all: WordLists = { yes: [], no: [], noSuffix: [], claim: [], later: [], stop: [], help: [], repeat: [], emergency: [] };
  for (const l of languages) {
    for (const k of Object.keys(all) as (keyof WordLists)[]) all[k].push(...nfc(l.words[k]));
  }
  compiled.set(languages, all);
  return all;
}

const hasWord = (words: string[], list: string[]) => words.some((w) => list.includes(w));
const hasPhrase = (n: string, list: string[]) => list.some((p) => ` ${n} `.includes(` ${normalize(p)} `));

export function interpret(text: string, languages: readonly LanguageDef[] = LANGUAGES): Intent {
  const w = wordsOf(languages);
  const n = normalize(text);
  if (n === '') return 'unclear';
  const words = n.split(' ');

  if (w.emergency.some((p) => n.includes(normalize(p)))) return 'emergency';
  if (hasWord(words, w.stop)) return 'stop';
  if (hasWord(words, w.help)) return 'help';
  if (hasPhrase(n, w.repeat)) return 'repeat';

  const negated = hasWord(words, w.no) || words.some((x) => w.noSuffix.some((s) => x.endsWith(s)));
  const yes = hasWord(words, w.yes);
  const claim = hasWord(words, w.claim);
  const later = hasWord(words, w.later);

  if (negated && yes) return 'mixed';
  if (negated) return later ? 'notyet' : 'no';
  if (claim) return 'claim';
  if (yes) return 'yes';
  if (later) return 'notyet';
  return 'unclear';
}

/**
 * Letters of a language's script switch the reply language to it. Latin-only text keeps the
 * current language, because Latin script cannot tell English from a Latin-script language.
 * Mixed text goes to the language with the most letters; a tie keeps the current one.
 */
export function detectLang(text: string, current: string, languages: readonly LanguageDef[] = LANGUAGES): string {
  const counts = new Map<string, number>();
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    for (const l of languages) {
      if (l.scripts.some(([lo, hi]) => c >= lo && c <= hi)) counts.set(l.code, (counts.get(l.code) ?? 0) + 1);
    }
  }
  let best = current;
  let bestCount = counts.get(current) ?? 0;
  for (const [code, n] of counts) {
    if (n > bestCount) {
      best = code;
      bestCount = n;
    }
  }
  return best;
}

