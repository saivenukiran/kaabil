const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Epoch ms of "HH:MM" on the same local day as `ms`. */
export function atTimeOfDay(ms: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(ms);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

export function slotId(medicineId: string, ms: number, hhmm: string): string {
  return `${medicineId}|${dayKey(ms)}|${hhmm}`;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
