import type { LangCode } from './i18n/languages';

// The registered language codes. Add a language in i18n/languages, not here.
export type { LangCode };

/** Every sentence Kaabil may speak. Kaabil generates no other text. */
export const MESSAGE_KEYS = [
  'remind',
  'confirm_log',
  'logged',
  'snooze',
  'already_logged',
  'not_logged',
  'clarify',
  'escalated',
  'emergency',
  'buttons',
  'help',
  'stopped',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

export interface Medicine {
  id: string;
  name: string;
  strength: string;
  /** Local times of day, "HH:MM". */
  times: string[];
}

export type Phase = 'asked' | 'confirming' | 'snoozed' | 'logged' | 'escalated';

export interface DoseSession {
  slotId: string;
  medicineId: string;
  phase: Phase;
  /** When the current phase or the last reminder started (demo-clock ms). */
  sinceMs: number;
  snoozeUntilMs: number;
  repeats: number;
  silences: number;
  unclear: number;
  showButtons: boolean;
}

export interface DoseRecord {
  slotId: string;
  medicineId: string;
  atMs: number;
  via: 'voice' | 'button';
}

export type AlertKind = 'missed_dose' | 'double_dose' | 'emergency';

export interface AlertRecord {
  id: string;
  kind: AlertKind;
  medicineId?: string;
  slotId?: string;
  atMs: number;
  acknowledged: boolean;
  delivery: { inApp: 'delivered'; push: 'not set up in this prototype' };
}

export interface Transcript {
  atMs: number;
  who: 'person' | 'app';
  text: string;
}

export interface SayItem {
  id: number;
  key: MessageKey;
  text: string;
  lang: LangCode;
}

export interface AppState {
  v: 1;
  lang: LangCode;
  person: { name: string; address: string };
  medicines: Medicine[];
  consent: { missedDose: boolean; emergency: boolean };
  /** Demo clock, epoch ms. It only moves when "Advance demo time" is pressed. */
  clockMs: number;
  session: DoseSession | null;
  /** Slot ids that already started a reminder (one reminder per dose and day). */
  handled: string[];
  doses: DoseRecord[];
  alerts: AlertRecord[];
  /** Text only. Audio is never stored. */
  transcripts: Transcript[];
  outbox: SayItem[];
  nextId: number;
  show112: boolean;
}
