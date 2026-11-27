// End-to-end scripts for the test page at /test/, in TestSutra's script format. Each one drives a
// real browser through the real backend: a family member signs up, makes a care group, adds a
// medicine, pairs the person's phone with a code, and then something happens on the person's phone
// that the family must see. Fictional data only.
//
// `${...}` placeholders are filled by run.mjs: TONE is a generated test recording.

const SETUP = [
  { type: 'navigate', url: 'http://localhost:8080/test/', required: true },
  { type: 'assert_visible', selector: '#family', required: true },
  // sign up (the page fills in a fresh email and a dummy password)
  { type: 'click', selector: '#fam-signup', required: true },
  { type: 'wait_for_selector', selector: '#fam-status.ok', timeout_ms: 15000, required: true },
  { type: 'assert_text', selector: '#fam-status', expected: 'Signed in as', contains: true },
  // the care group
  { type: 'click', selector: '#fam-create-group', required: true },
  { type: 'wait_for_selector', selector: '#fam-group-status.ok', timeout_ms: 15000, required: true },
  { type: 'assert_text', selector: '#fam-group-status', expected: 'Amma', contains: true },
  // a medicine, typed as one line
  { type: 'click', selector: '#fam-add-line', required: true },
  { type: 'wait_for_selector', selector: '#fam-med-status.ok', timeout_ms: 15000, required: true },
  { type: 'assert_visible', selector: '#fam-meds li[data-medicine="Metformin"]' },
  // the pairing code is filled in on the person's phone, as the family member would type it
  { type: 'click', selector: '#fam-make-code', required: true },
  { type: 'wait_for_selector', selector: '#fam-code-status.ok', timeout_ms: 15000, required: true },
  { type: 'click', selector: '#dev-pair', required: true },
  { type: 'wait_for_selector', selector: '#dev-status.ok', timeout_ms: 15000, required: true },
  { type: 'assert_text', selector: '#dev-status', expected: 'Paired with', contains: true, timeout_ms: 15000 },
  // the family sees the phone
  { type: 'assert_visible', selector: '#fam-devices li[data-device="Amma phone"]', timeout_ms: 15000 },
];

export const SCRIPTS = [
  {
    name: 'A dose answered with the buttons reaches the family, live',
    requirements: ['R1', 'R2', 'R10'],
    steps: [
      ...SETUP,
      // the family presses "Remind now": the server sends an event to the phone, which starts the reminder
      { type: 'click', selector: '#fam-remind', required: true },
      { type: 'assert_text', selector: '#dev-phase', expected: 'asked', contains: true, timeout_ms: 15000 },
      { type: 'assert_text', selector: '#dev-say', expected: 'Metformin', contains: true },
      // a bare Yes is a claim; only the second Yes confirms
      { type: 'click', selector: '#dev-yes' },
      { type: 'assert_text', selector: '#dev-phase', expected: 'confirming', contains: true },
      { type: 'click', selector: '#dev-yes' },
      { type: 'assert_text', selector: '#dev-phase', expected: 'logged', contains: true },
      // the family sees the dose without asking, and the phone knows the server heard it
      { type: 'wait_for_selector', selector: '#fam-doses li[data-slot]', timeout_ms: 15000 },
      { type: 'assert_text', selector: '#fam-doses', expected: 'button', contains: true },
      { type: 'assert_text', selector: '#dev-sync', expected: '1 dose', contains: true, timeout_ms: 10000 },
      { type: 'assert_console_clean' },
    ],
  },
  {
    name: 'An emergency and a missed dose alert the family, who can acknowledge',
    requirements: ['R6', 'R8'],
    steps: [
      ...SETUP,
      { type: 'click', selector: '#dev-sos', required: true },
      { type: 'wait_for_selector', selector: '#fam-alerts li[data-kind="emergency"]', timeout_ms: 15000 },
      { type: 'assert_visible', selector: '#dev-112' },
      // a reminder nobody answers: it repeats at 10 minutes and alerts the family at 20
      { type: 'click', selector: '#dev-remind', required: true },
      { type: 'assert_text', selector: '#dev-phase', expected: 'asked', contains: true, timeout_ms: 10000 },
      { type: 'click', selector: '#dev-advance' },
      { type: 'click', selector: '#dev-advance' },
      { type: 'assert_text', selector: '#dev-phase', expected: 'escalated', contains: true, timeout_ms: 10000 },
      { type: 'wait_for_selector', selector: '#fam-alerts li[data-kind="missed_dose"]', timeout_ms: 15000 },
      { type: 'click', selector: '#fam-alerts li[data-kind="missed_dose"] button' },
      { type: 'assert_text', selector: '#fam-alerts li[data-kind="missed_dose"]', expected: 'acknowledged', contains: true, timeout_ms: 10000 },
      { type: 'assert_console_clean' },
    ],
  },
  {
    name: 'A family member records their own voice and the person\'s phone plays it',
    requirements: ['custom-voice'],
    steps: [
      ...SETUP,
      // nothing is saved until the recorder agrees
      { type: 'assert_visible', selector: '#fam-voice-list .sentence[data-key="remind"]', timeout_ms: 15000 },
      { type: 'click', selector: '#fam-voice-consent' },
      { type: 'upload_file', selector: '#file-remind', file_paths: ['${TONE}'] },
      { type: 'wait_for_selector', selector: '#fam-voice-status.ok', timeout_ms: 20000 },
      { type: 'assert_text', selector: '#fam-voice-status', expected: 'Saved', contains: true },
      { type: 'assert_visible', selector: '#fam-voice-list .sentence[data-key="remind"][data-recorded="yes"]' },
      // the phone is told, fetches it, and will use it for exactly that sentence
      { type: 'assert_text', selector: '#dev-clips', expected: '1 recording', contains: true, timeout_ms: 15000 },
      { type: 'click', selector: '#dev-start' },
      { type: 'click', selector: '#fam-remind' },
      { type: 'assert_text', selector: '#dev-played', expected: 'Played from a family recording', contains: true, timeout_ms: 60000 },
      // the family can take it back
      { type: 'click', selector: '#fam-voice-delete-all' },
      { type: 'assert_text', selector: '#fam-voice-count', expected: '0 of', contains: true, timeout_ms: 15000 },
      { type: 'assert_text', selector: '#dev-clips', expected: 'No recordings', contains: true, timeout_ms: 15000 },
    ],
  },
  {
    name: 'A call from the family rings the person, who must tap Answer; then the two phones connect and either can hang up',
    requirements: ['calls', 'webrtc'],
    steps: [
      ...SETUP,
      { type: 'click', selector: '#fam-call-audio-call', required: true },
      { type: 'wait_for_selector', selector: '#dev-call-state[data-phase="ringing"]', timeout_ms: 15000, required: true },
      { type: 'assert_text', selector: '#dev-call-state', expected: 'Incoming voice call', contains: true },
      { type: 'wait_for_selector', selector: '#fam-call-state[data-phase="calling"]' },
      // it never answers by itself: still ringing after a few seconds, and no connection
      { type: 'wait', ms: 4000 },
      { type: 'assert_attribute', selector: '#dev-call-state', name: 'data-phase', expected: 'ringing' },
      { type: 'assert_attribute', selector: '#fam-call-state', name: 'data-phase', expected: 'calling' },
      // the person taps Answer
      { type: 'click', selector: '#dev-call-answer', required: true },
      { type: 'wait_for_selector', selector: '#fam-call-state[data-phase="connected"]', timeout_ms: 25000, required: true },
      { type: 'wait_for_selector', selector: '#dev-call-state[data-phase="connected"]', timeout_ms: 25000, required: true },
      { type: 'assert_text', selector: '#fam-call-state', expected: 'Connected', contains: true },
      // the family hangs up; the person's phone sees it
      { type: 'click', selector: '#fam-call-hangup', required: true },
      { type: 'wait_for_selector', selector: '#dev-call-state[data-phase="ended"]', timeout_ms: 15000 },
      { type: 'assert_text', selector: '#dev-call-state', expected: 'The other side ended the call', contains: true },
      { type: 'assert_text', selector: '#fam-call-state', expected: 'You ended the call', contains: true },
    ],
  },
  {
    name: 'The person rings the family, who can decline',
    requirements: ['calls'],
    steps: [
      ...SETUP,
      { type: 'click', selector: '#dev-call-audio-call', required: true },
      { type: 'wait_for_selector', selector: '#fam-call-state[data-phase="ringing"]', timeout_ms: 15000, required: true },
      { type: 'click', selector: '#fam-call-decline', required: true },
      { type: 'wait_for_selector', selector: '#dev-call-state[data-phase="ended"]', timeout_ms: 15000 },
      { type: 'assert_text', selector: '#dev-call-state', expected: 'The call was declined', contains: true },
      { type: 'assert_text', selector: '#fam-call-state', expected: 'The call was declined', contains: true },
    ],
  },
  {
    name: 'With microphones, voice really flows in both directions during a call',
    requirements: ['calls', 'webrtc', 'voice-in-call'],
    // TestSutra's own browser has no microphone. This one needs a browser started with a fake one and attached to:
    //   chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<a new folder> --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
    //   KAABIL_E2E_ATTACH=http://127.0.0.1:9333 npm run e2e
    needsMicrophone: true,
    steps: [
      ...SETUP,
      { type: 'click', selector: '#fam-call-audio-call', required: true },
      { type: 'wait_for_selector', selector: '#dev-call-state[data-phase="ringing"]', timeout_ms: 15000, required: true },
      { type: 'click', selector: '#dev-call-answer', required: true },
      { type: 'wait_for_selector', selector: '#fam-call-state[data-phase="connected"]', timeout_ms: 25000, required: true },
      { type: 'wait_for_selector', selector: '#dev-call-state[data-phase="connected"]', timeout_ms: 25000, required: true },
      { type: 'assert_text', selector: '#fam-call-media', expected: 'microphone is on', contains: true },
      { type: 'assert_text', selector: '#dev-call-media', expected: 'microphone is on', contains: true },
      // the connection's own counters show sound arriving, on both sides
      { type: 'wait_for_selector', selector: '#fam-call-hear[data-hearing="yes"]', timeout_ms: 15000 },
      { type: 'wait_for_selector', selector: '#dev-call-hear[data-hearing="yes"]', timeout_ms: 15000 },
      { type: 'assert_text', selector: '#fam-call-hear', expected: 'Hearing the other side', contains: true },
      // muting one side stops its sound arriving at the other
      { type: 'click', selector: '#fam-call-mute', required: true },
      { type: 'assert_text', selector: '#fam-call-state', expected: 'you are muted', contains: true },
      { type: 'wait_for_selector', selector: '#dev-call-hear[data-hearing="no"]', timeout_ms: 15000 },
      { type: 'click', selector: '#fam-call-mute' },
      { type: 'wait_for_selector', selector: '#dev-call-hear[data-hearing="yes"]', timeout_ms: 15000 },
      { type: 'click', selector: '#dev-call-hangup', required: true },
      { type: 'wait_for_selector', selector: '#fam-call-state[data-phase="ended"]', timeout_ms: 15000 },
      { type: 'assert_text', selector: '#fam-call-state', expected: 'The other side ended the call', contains: true },
    ],
  },
];
