/**
 * Word rules decide Yes and No. A speech model only supplies text; the lists below
 * decide what it means. Uncertainty never counts as Yes: anything we cannot classify
 * with confidence returns "unclear" or "mixed", and the app asks again.
 */
import type { LangCode } from '../types';

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

const nfc = (xs: string[]) => xs.map((x) => x.normalize('NFC').toLowerCase());

const YES = nfc(['అవును', 'ఔను', 'అవునండి', 'సరే', 'సరేనండి', 'అలాగే', 'haan', 'han', 'haanji', 'हाँ', 'हां', 'हाँजी', 'yes', 'yeah', 'yep', 'ok', 'okay']);
const NO = nfc(['కాదు', 'కాదండి', 'వద్దు', 'వద్దండి', 'నో', 'no', 'nope', 'not', 'never', 'nahi', 'nahin', 'नहीं', 'नही', 'मत', 'mat', 'dont']);
// Telugu attaches negation to the verb (వేసుకోలేదు = "did not take"), so match word endings.
const NO_SUFFIX = nfc(['లేదు', 'లేను', 'లేవు', 'లేరు', 'లేదండి']);
const CLAIM = nfc(['వేసుకున్నాను', 'వేసుకున్నా', 'వేసుకొన్నాను', 'వేసుకొన్నా', 'తీసుకున్నాను', 'తీసుకున్నా', 'తీసుకొన్నాను', 'li', 'ली', 'taken', 'took', 'swallowed']);
const LATER = nfc(['ఇంకా', 'తర్వాత', 'later', 'abhi', 'अभी', 'baad', 'बाद', 'yet']);
const STOP = nfc(['ఆపు', 'ఆపండి', 'रुको', 'रुकिए', 'stop']);
const HELP = nfc(['help', 'సహాయం', 'మదద్', 'मदद']);
const REPEAT = nfc(['మళ్ళీ చెప్పు', 'మళ్లీ చెప్పు', 'మళ్ళీ చెప్పండి', 'మళ్లీ చెప్పండి', 'repeat', 'say again', 'phir se', 'फिर से', 'दोबारा']);
// Substring match on purpose: Telugu words carry suffixes (పడిపోయాను, పడిపోయారు).
const EMERGENCY = nfc(['ఛాతీ నొప్పి', 'ఛాతీలో నొప్పి', 'ఛాతి నొప్పి', 'పడిపోయ', 'chest pain', 'i fell', 'fell down', 'breathe', 'सीने में दर्द', 'गिर गया', 'गिर गई', 'gir gaya', 'seene mein dard']);

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‌‍]/g, '') // joiners inside Telugu words must not split them
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const hasWord = (words: string[], list: string[]) => words.some((w) => list.includes(w));
const hasPhrase = (n: string, list: string[]) => list.some((p) => ` ${n} `.includes(` ${normalize(p)} `));

export function interpret(text: string): Intent {
  const n = normalize(text);
  if (n === '') return 'unclear';
  const words = n.split(' ');

  if (EMERGENCY.some((p) => n.includes(normalize(p)))) return 'emergency';
  if (hasWord(words, STOP)) return 'stop';
  if (hasWord(words, HELP)) return 'help';
  if (hasPhrase(n, REPEAT)) return 'repeat';

  const negated = hasWord(words, NO) || words.some((w) => NO_SUFFIX.some((s) => w.endsWith(s)));
  const yes = hasWord(words, YES);
  const claim = hasWord(words, CLAIM);
  const later = hasWord(words, LATER);

  if (negated && yes) return 'mixed';
  if (negated) return later ? 'notyet' : 'no';
  if (claim) return 'claim';
  if (yes) return 'yes';
  if (later) return 'notyet';
  return 'unclear';
}

/** Telugu and Devanagari letters switch the reply language; Latin-only text keeps it. */
export function detectLang(text: string, current: LangCode): LangCode {
  let te = 0;
  let hi = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0c00 && c <= 0x0c7f) te++;
    else if (c >= 0x0900 && c <= 0x097f) hi++;
  }
  if (te === 0 && hi === 0) return current;
  return te >= hi ? 'te' : 'hi';
}
