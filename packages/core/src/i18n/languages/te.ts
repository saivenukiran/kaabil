import { defineLanguage } from '../language';

// The first spoken line comes from the team's prompt. The rest are first drafts and still
// need a native-speaker review before real users hear them (see review/telugu-lines.md).
export const te = defineLanguage({
  code: 'te',
  name: 'Telugu',
  nativeName: 'తెలుగు',
  locale: 'te-IN',
  scripts: [[0x0c00, 0x0c7f]],
  review: 'draft',
  messages: {
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
  },
  stateWords: { listening: 'వింటున్నాను', thinking: 'ఆలోచిస్తున్నాను', done: 'అయింది', ready: 'సిద్ధంగా ఉన్నాను' },
  buttonWords: { yes: 'అవును', no: 'వద్దు', start: 'ప్రారంభించు' },
  words: {
    yes: ['అవును', 'ఔను', 'అవునండి', 'సరే', 'సరేనండి', 'అలాగే'],
    no: ['కాదు', 'కాదండి', 'వద్దు', 'వద్దండి', 'నో'],
    // Telugu attaches negation to the verb (వేసుకోలేదు = "did not take"), so match word endings.
    noSuffix: ['లేదు', 'లేను', 'లేవు', 'లేరు', 'లేదండి'],
    claim: ['వేసుకున్నాను', 'వేసుకున్నా', 'వేసుకొన్నాను', 'వేసుకొన్నా', 'తీసుకున్నాను', 'తీసుకున్నా', 'తీసుకొన్నాను', 'తీసుకొన్నా'],
    later: ['ఇంకా', 'తర్వాత'],
    stop: ['ఆపు', 'ఆపండి'],
    help: ['సహాయం'],
    repeat: ['మళ్ళీ చెప్పు', 'మళ్లీ చెప్పు', 'మళ్ళీ చెప్పండి', 'మళ్లీ చెప్పండి'],
    // Substring match on purpose: Telugu words carry suffixes (పడిపోయాను, పడిపోయారు).
    emergency: ['ఛాతీ నొప్పి', 'ఛాతీలో నొప్పి', 'ఛాతి నొప్పి', 'పడిపోయ'],
  },
  // Only the Telugu already in the team's prompt. The rest of the person screen shows the
  // English text until a native speaker supplies and reviews the Telugu.
  ui: {
    typedPlaceholder: 'వేసుకున్నాను',
  },
});
