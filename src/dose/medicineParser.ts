/**
 * Parses what a family member types or dictates, such as "Metformin 500, 1-0-1".
 * 1-0-1 means morning, noon and night doses of 1, 0 and 1. The result is only a
 * proposal: the family screen shows the times and saves after the family confirms.
 */
export interface ParsedMedicine {
  name: string;
  strength: string;
  /** One entry per daily dose, "HH:MM". These are defaults the family can edit. */
  times: string[];
}

export type ParseResult = { ok: true; value: ParsedMedicine } | { ok: false; error: string };

const SLOT_TIMES = ['08:00', '14:00', '21:00'];
const ABBREVIATIONS: Record<string, string> = { od: '1-0-0', bd: '1-0-1', bid: '1-0-1', tds: '1-1-1', tid: '1-1-1' };

export function parseMedicineLine(line: string): ParseResult {
  const text = line.trim();
  if (text === '') return { ok: false, error: 'Type a medicine, for example: Metformin 500, 1-0-1' };

  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return { ok: false, error: 'Use: name and strength, then the pattern, for example Metformin 500, 1-0-1' };

  const nameAndStrength = /^(.+?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)?$/i.exec(parts[0] ?? '');
  if (!nameAndStrength) return { ok: false, error: 'Could not read the strength. Write it like: Metformin 500' };

  const rawPattern = (parts[1] ?? '').toLowerCase();
  const pattern = ABBREVIATIONS[rawPattern] ?? rawPattern;
  const digits = /^(\d)-(\d)-(\d)$/.exec(pattern);
  if (!digits) return { ok: false, error: 'Could not read the pattern. Use 1-0-1, or BD, OD, TDS' };

  const counts = [Number(digits[1]), Number(digits[2]), Number(digits[3])];
  const times = SLOT_TIMES.filter((_, i) => (counts[i] ?? 0) > 0);
  if (times.length === 0) return { ok: false, error: 'The pattern has no doses in it' };

  return {
    ok: true,
    value: {
      name: nameAndStrength[1] ?? '',
      strength: `${nameAndStrength[2] ?? ''}${(nameAndStrength[3] ?? '').toLowerCase()}`,
      times,
    },
  };
}

export function isValidTime(hhmm: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}
