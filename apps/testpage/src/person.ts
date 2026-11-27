/**
 * The person's phone. It pairs with a code the family member types, then runs the real dose
 * dialogue from @kaabil/core: speak the reminder, listen, decide Yes or No by word rules, and tell
 * the server what happened. A family member's recordings are played instead of the synthetic voice
 * for the exact sentences they recorded.
 */
import { advance, dismiss112, hear, press, sos, type AppState } from '@kaabil/core';
import { ApiError, applyPlan, newSent, planToState, remindNow, unsent, type Client, type Plan } from '@kaabil/contract';
import { ClipSpeechPort, createVoiceLoop, WebSpeechPort, type VoiceLoop, type VoiceStatus } from '@kaabil/voice';
import { mountCall } from './call';
import { button, el, errorText, field, section, status } from './dom';

const TOKEN_KEY = 'kaabil.testpage.device';

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the page works until it is closed */
  }
};

export function mountPerson(root: HTMLElement, client: Client, log: (m: string) => void) {
  let state: AppState | null = null;
  let loop: VoiceLoop | null = null;
  let stopEvents: (() => void) | null = null;
  let lastTick = Date.now();
  const sent = newSent();
  const tried = new Map<string, number>();
  const inflight = new Set<string>();
  let voiceStatus: VoiceStatus = 'idle';
  let notice: string | null = null;
  const clipUrls = new Map<string, string>();

  // ---- calls: ring the family, and answer when they ring
  const call = mountCall({
    id: 'dev-call',
    role: 'person',
    who: 'your family',
    send: async (s) => {
      await client.device.sendCallSignal(s);
    },
    iceServers: async () => (await client.device.iceServers()).iceServers,
    log,
  });
  call.setCanDial(false);

  const web = new WebSpeechPort();
  const port = new ClipSpeechPort(web);

  // ---- pairing
  const pairStatus = status('dev-status');
  const code = field('dev-code', 'Pairing code from the family member', '');
  const pname = field('dev-name', 'Name for this phone', 'Amma phone');
  const pair = button('dev-pair', 'Pair this phone', async () => {
    try {
      const r = await client.device.pair(code.input.value.trim(), pname.input.value.trim() || 'Phone');
      writeToken(r.deviceToken);
      pairStatus.set('Paired.', true);
      await connect();
    } catch (e) {
      pairStatus.set(errorText(e), false);
    }
  }, 'primary');
  const forget = button('dev-forget', 'Forget this phone', () => {
    writeToken(null);
    client.device.setToken(undefined);
    teardown();
    pairStatus.set('Forgotten. Pair again with a new code.');
    render();
  });

  // ---- the conversation
  const stateWord = el('span', { id: 'dev-state', class: 'state' }, 'idle');
  const phaseWord = el('span', { id: 'dev-phase', class: 'note' }, 'no conversation');
  const say = el('div', { id: 'dev-say', class: 'say', 'aria-live': 'polite' }, 'Pair this phone, then tap Start.');
  const noticeBox = el('p', { id: 'dev-notice', class: 'note bad' });
  const voiceNote = el('p', { id: 'dev-voice-note', class: 'note' });
  const syncNote = el('p', { id: 'dev-sync', class: 'note' });
  const clipNote = el('p', { id: 'dev-clips', class: 'note' }, 'No recordings from the family yet.');
  const playedNote = el('p', { id: 'dev-played', class: 'note' });
  const call112 = el('a', { id: 'dev-112', class: 'call', href: 'tel:112' }, 'Call 112');
  const dismiss = button('dev-112-dismiss', 'Hide 112', () => update(dismiss112), 'small');
  const text = field('dev-text', 'Or type what you would say', '');

  const start = button('dev-start', 'Tap to start Kaabil', async () => {
    if (!loop) return;
    await loop.arm();
    render();
  }, 'primary big');
  const yes = button('dev-yes', 'Yes', () => answer('yes'), 'big yes');
  const no = button('dev-no', 'No', () => answer('no'), 'big no');
  const mic = button('dev-mic', 'Speak', () => loop?.tapMic(), 'big');
  const send = button('dev-send', 'Send', () => {
    const v = text.input.value.trim();
    if (!v) return;
    text.input.value = '';
    loop?.interrupt();
    update((s) => hear(s, v, 'button'));
  });
  const sosBtn = button('dev-sos', 'SOS', () => update(sos), 'big sos');
  const adv = button('dev-advance', 'Advance 10 minutes (demo)', () => update((s) => advance(s, 10)));
  const remindLocal = button('dev-remind', 'Remind me now (this phone only)', () => {
    if (!state) return;
    const r = remindNow(state);
    if (r) update(() => advance(r.state, 0));
  });

  function answer(v: 'yes' | 'no') {
    loop?.interrupt();
    update((s) => press(s, v));
  }

  // ---- state, clock and the server
  function update(fn: (s: AppState) => AppState) {
    if (!state) return;
    state = fn(state);
    render();
    void flush();
    loop?.notify();
  }

  /** Tell the server what the dialogue recorded. Nothing is marked sent until the server answers; a failure is retried. */
  async function flush() {
    if (!state) return;
    const u = unsent(state, sent);
    const now = Date.now();
    const due = (k: string) => !inflight.has(k) && now - (tried.get(k) ?? 0) > 3000;
    for (const d of u.doses.filter((x) => due(`d:${x.key}`))) {
      const k = `d:${d.key}`;
      inflight.add(k);
      tried.set(k, now);
      client.device
        .postDose(d.body)
        .then(() => {
          sent.doses.add(d.key);
          log(`dose sent: ${d.key}`);
        })
        .catch((e: unknown) => log(`dose not sent yet: ${errorText(e)}`))
        .finally(() => {
          inflight.delete(k);
          renderSync();
        });
    }
    for (const a of u.alerts.filter((x) => due(`a:${x.key}`))) {
      const k = `a:${a.key}`;
      inflight.add(k);
      tried.set(k, now);
      client.device
        .postAlert(a.body)
        .then((r) => {
          sent.alerts.add(a.key);
          log(r.created ? `alert sent: ${a.body.kind}` : `alert not created: ${r.reason}`);
        })
        .catch((e: unknown) => log(`alert not sent yet: ${errorText(e)}`))
        .finally(() => {
          inflight.delete(k);
          renderSync();
        });
    }
    renderSync();
  }

  function renderSync() {
    if (!state) return;
    const waiting = unsent(state, sent);
    const n = waiting.doses.length + waiting.alerts.length;
    syncNote.textContent = `Told the family: ${sent.doses.size} dose(s), ${sent.alerts.size} alert(s).${n ? ` Waiting to send: ${n}.` : ''}`;
  }

  function tick() {
    const now = Date.now();
    const minutes = (now - lastTick) / 60_000;
    lastTick = now;
    if (state) update((s) => advance(s, minutes));
  }
  let timer: ReturnType<typeof setInterval> | null = null;

  function render() {
    const phase = state?.session?.phase;
    stateWord.textContent = voiceStatus;
    stateWord.className = `state ${voiceStatus}`;
    phaseWord.textContent = phase ? `conversation: ${phase}` : 'no conversation';
    const last = state?.outbox.at(-1);
    if (last) say.textContent = last.text;
    noticeBox.textContent = notice ?? '';
    const on = !!state;
    for (const b of [yes, no, mic, send, sosBtn, adv, remindLocal]) b.disabled = !on;
    start.disabled = !on || !!loop?.isArmed();
    start.textContent = loop?.isArmed() ? 'Kaabil is listening for reminders' : 'Tap to start Kaabil';
    call112.hidden = !state?.show112;
    dismiss.hidden = !state?.show112;
    if (state) {
      const has = web.hasVoice(state.lang);
      voiceNote.textContent = has ? `A ${state.lang === 'te' ? 'Telugu' : 'English'} voice is installed on this device.` : `No ${state.lang === 'te' ? 'Telugu' : 'English'} voice on this device: sentences are shown on the screen, and the family's recordings play where they exist.`;
    }
    playedNote.textContent = port.playedFromClip.length ? `Played from a family recording: ${port.playedFromClip.length} time(s). Last: ${port.playedFromClip.at(-1)}` : '';
  }

  // ---- connecting
  function teardown() {
    call.end();
    call.setCanDial(false);
    stopEvents?.();
    stopEvents = null;
    loop?.stop();
    loop = null;
    state = null;
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function connect() {
    const token = readToken();
    if (!token) return render();
    client.device.setToken(token);
    teardown();
    try {
      const plan: Plan = await client.device.plan();
      state = planToState(plan, Date.now());
      lastTick = Date.now();
      loop = createVoiceLoop(
        port,
        {
          getState: () => state!,
          update,
          onStatus: (s) => {
            voiceStatus = s;
            render();
          },
          onMessage: (m) => {
            notice = m;
            render();
          },
        },
        {},
      );
      pairStatus.set(`Paired with ${plan.person.name}'s family. ${plan.medicines.length} medicine(s).`, true);
      stopEvents = client.device.events({
        onEvent: (e) => {
          log(`phone event: ${e.type}`);
          if (e.type === 'plan') void client.device.plan().then((p) => update((s) => applyPlan(s, p)));
          if (e.type === 'remind' && state) {
            const r = remindNow(state, e.medicineId);
            if (r) update(() => advance(r.state, 0));
          }
          if (e.type === 'voice') void loadClips();
          if (e.type === 'call') call.handle(e.signal);
        },
        onStatus: (s) => {
          if (s === 'closed' && state) pairStatus.set('The server stopped this phone. Ask the family for a new code.', false);
        },
      });
      timer = setInterval(tick, 1000);
      call.setCanDial(true);
      await loadClips();
      render();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        writeToken(null);
        pairStatus.set('This phone was removed or the code is no longer valid. Pair again.', false);
      } else pairStatus.set(errorText(e), false);
      render();
    }
  }

  /** Fetch the family's recordings and hand them to the speech port, keyed by the exact sentence. */
  async function loadClips() {
    try {
      const { clips } = await client.device.voiceClips();
      const keep = new Set(clips.map((c) => c.textHash));
      for (const [h, url] of clipUrls) {
        if (!keep.has(h)) {
          URL.revokeObjectURL(url);
          clipUrls.delete(h);
        }
      }
      for (const c of clips) {
        if (!clipUrls.has(c.textHash)) clipUrls.set(c.textHash, URL.createObjectURL(await client.device.clipAudio(c.textHash)));
      }
      port.setClips(clips.map((c) => ({ lang: c.lang, text: c.text, url: clipUrls.get(c.textHash)! })));
      clipNote.textContent = clips.length ? `${clips.length} recording(s) from the family will be played instead of the synthetic voice.` : 'No recordings from the family yet.';
    } catch (e) {
      log(`recordings: ${errorText(e)}`);
    }
  }

  const api = { setCode: (c: string) => { code.input.value = c; }, call };

  root.append(
    el('h2', {}, "Person's phone"),
    section('1. Pair', code.wrap, pname.wrap, el('div', { class: 'row' }, pair, forget), pairStatus.node),
    section(
      '2. Kaabil',
      el('div', { class: 'row' }, stateWord, phaseWord),
      say,
      noticeBox,
      voiceNote,
      el('div', { class: 'row' }, start),
      el('div', { class: 'row' }, yes, no, mic),
      text.wrap,
      send,
      el('div', { class: 'row' }, sosBtn, call112, dismiss),
    ),
    section('3. Call the family', call.node),
    section('4. Demo controls', el('div', { class: 'row' }, remindLocal, adv), syncNote, clipNote, playedNote),
  );
  render();
  void connect();
  addEventListener('pagehide', () => loop?.stop());
  return api;
}
