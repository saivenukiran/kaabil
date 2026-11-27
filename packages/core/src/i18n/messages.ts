import type { LangCode, MessageKey } from '../types';

type Vars = { address: string; name: string; strength: string };
type Table = Record<MessageKey, (v: Vars) => string>;

// The first Telugu line comes from the team's prompt. The rest are first drafts and
// still need a native-speaker review before real users hear them.
const te: Table = {
  remind: (v) => `${v.address}, ${v.name} ${v.strength}, ఒక మాత్ర వేసుకునే సమయం.`,
  confirm_log: () => 'నమోదు చేయనా?',
  logged: () => 'నమోదు చేశాను.',
  snooze: () => 'పది నిమిషాల్లో మళ్ళీ గుర్తు చేస్తాను.',
  already_logged: () => 'ఇప్పటికే నమోదు చేశాను.',
  not_logged: () => 'సరే, నమోదు చేయలేదు.',
  clarify: () => 'సరిగ్గా వినలేదు. వేసుకున్నారా?',
  escalated: () => 'కుటుంబానికి చెప్పాను.',
  emergency: () => 'అత్యవసరం కావచ్చు. 112కి కాల్ చేయండి.',
  buttons: () => 'బటన్లు వాడండి.',
  help: () => 'వేసుకున్నాను, ఇంకా లేదు, అవును, వద్దు అని చెప్పండి.',
  stopped: () => 'సరే, ఆపాను.',
};

const hi: Table = {
  remind: (v) => `${v.address}, ${v.name} ${v.strength}, एक गोली लेने का समय है.`,
  confirm_log: () => 'दर्ज करूँ?',
  logged: () => 'दर्ज कर लिया.',
  snooze: () => 'दस मिनट में फिर याद दिलाऊँगा.',
  already_logged: () => 'यह पहले ही दर्ज है.',
  not_logged: () => 'ठीक है, दर्ज नहीं किया.',
  clarify: () => 'ठीक से सुना नहीं. दवाई ली?',
  escalated: () => 'परिवार को बता दिया.',
  emergency: () => 'आपातकाल हो सकता है. 112 पर कॉल करें.',
  buttons: () => 'बटन दबाइए.',
  help: () => 'कहिए: ले ली, अभी नहीं, हाँ, या नहीं.',
  stopped: () => 'ठीक है, रुक गया.',
};

const en: Table = {
  remind: (v) => `${v.address}, ${v.name} ${v.strength}, time for one tablet.`,
  confirm_log: () => 'Shall I record it?',
  logged: () => 'Recorded.',
  snooze: () => 'I will remind you again in ten minutes.',
  already_logged: () => 'Already recorded.',
  not_logged: () => 'Okay, not recorded.',
  clarify: () => 'I did not hear that well. Did you take it?',
  escalated: () => 'I have told your family.',
  emergency: () => 'This may be an emergency. Call 112.',
  buttons: () => 'Please use the buttons.',
  help: () => 'Say: taken, not yet, yes, or no.',
  stopped: () => 'Okay, stopped.',
};

const TABLES: Record<LangCode, Table> = { te, hi, en };

export function render(lang: LangCode, key: MessageKey, vars: Vars): string {
  return TABLES[lang][key](vars);
}

export interface StateWords {
  listening: string;
  thinking: string;
  done: string;
  ready: string;
}

export const STATE_WORDS: Record<LangCode, StateWords> = {
  te: { listening: 'వింటున్నాను', thinking: 'ఆలోచిస్తున్నాను', done: 'అయింది', ready: 'సిద్ధంగా ఉన్నాను' },
  hi: { listening: 'सुन रहा हूँ', thinking: 'सोच रहा हूँ', done: 'हो गया', ready: 'तैयार हूँ' },
  en: { listening: 'Listening', thinking: 'Thinking', done: 'Done', ready: 'Ready' },
};

export const BUTTON_WORDS: Record<LangCode, { yes: string; no: string; start: string }> = {
  te: { yes: 'అవును', no: 'వద్దు', start: 'ప్రారంభించు' },
  hi: { yes: 'हाँ', no: 'नहीं', start: 'शुरू करें' },
  en: { yes: 'Yes', no: 'No', start: 'Start' },
};
