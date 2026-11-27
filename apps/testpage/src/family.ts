/** The family member's phone: account, care group, medicines, pairing, live doses and alerts, and recording their own voice. */
import { processRecording, type RecordingResult } from '@kaabil/voice';
import type { AlertDto, Client, DoseDto, GroupDto, VoiceOverview } from '@kaabil/contract';
import { button, clear, el, errorText, field, hhmm, section, select, status } from './dom';
import { startRecording, type Recording } from './record';

const REASONS: Record<Extract<RecordingResult, { ok: false }>['reason'], string> = {
  silent: 'Nothing was heard. Speak closer to the microphone and try again.',
  too_long: 'That recording is too long. Keep each sentence short.',
  empty: 'The recording is empty.',
  undecodable: 'This browser could not read that audio. Try recording again, or upload a different file.',
};

export function mountFamily(root: HTMLElement, client: Client, log: (m: string) => void, onCode: (code: string) => void = () => undefined) {
  let groupId: string | null = null;
  let group: GroupDto | null = null;
  let voice: VoiceOverview | null = null;
  let stopEvents: (() => void) | null = null;
  let recording: { hash: string; rec: Recording } | null = null;

  // ---- account
  const acct = status('fam-status');
  const name = field('fam-name', 'Name', 'Ravi');
  const email = field('fam-email', 'Email', `family-${Date.now().toString(36)}@example.test`, 'email');
  const pw = field('fam-password', 'Password (10 characters or more)', `dummy-${crypto.randomUUID()}`, 'password');

  /** Signing in as someone else must forget the previous account's group, its live stream and its lists. */
  function forgetAccount() {
    stopEvents?.();
    stopEvents = null;
    groupId = null;
    group = null;
    voice = null;
    recording = null;
  }

  async function refreshMe() {
    try {
      const me = await client.family.me();
      acct.set(`Signed in as ${me.user.name} (${me.user.email})`, true);
      const first = me.groups[0];
      if (first && !groupId) await selectGroup(first.id);
    } catch {
      acct.set('Not signed in.');
    }
  }
  const signUp = button('fam-signup', 'Sign up', async () => {
    try {
      forgetAccount();
      renderAll();
      acct.set('Signing up...');
      await client.auth.signUp({ name: name.input.value, email: email.input.value, password: pw.input.value });
      await refreshMe();
    } catch (e) {
      acct.set(errorText(e), false);
    }
  }, 'primary');
  const signIn = button('fam-signin', 'Sign in', async () => {
    try {
      forgetAccount();
      renderAll();
      acct.set('Signing in...');
      await client.auth.signIn({ email: email.input.value, password: pw.input.value });
      await refreshMe();
    } catch (e) {
      acct.set(errorText(e), false);
    }
  });
  const signOut = button('fam-signout', 'Sign out', async () => {
    forgetAccount();
    await client.auth.signOut().catch(() => undefined);
    renderAll();
    acct.set('Signed out.');
  });

  // ---- group
  const grpStatus = status('fam-group-status');
  const pname = field('fam-person-name', "Person's name", 'Amma');
  const paddr = field('fam-person-address', 'How to address them', 'అమ్మ');
  const plang = select('fam-lang', 'Language', [['te', 'Telugu'], ['en', 'English']]);
  const cMissed = el('input', { id: 'fam-consent-missed', type: 'checkbox', checked: true });
  const cEmerg = el('input', { id: 'fam-consent-emergency', type: 'checkbox', checked: true });

  async function selectGroup(id: string) {
    groupId = id;
    stopEvents?.();
    stopEvents = client.family.events(id, {
      onEvent: (e) => {
        log(`family event: ${e.type}`);
        if (e.type === 'dose' || e.type === 'alert') void refreshLists();
        if (e.type === 'plan' || e.type === 'device') void refreshGroup();
        if (e.type === 'voice') void refreshVoice();
      },
    });
    await refreshGroup();
    await refreshLists();
    await refreshVoice();
  }
  async function refreshGroup() {
    if (!groupId) return;
    const asked = groupId;
    try {
      const g = await client.family.group(asked);
      if (asked !== groupId) return; // the person switched account while this was loading
      group = g;
      grpStatus.set(`Group ${g.id.slice(0, 8)}: ${g.personName}, ${g.lang}, alerts: missed dose ${g.consent.missedDose ? 'on' : 'off'}, emergency ${g.consent.emergency ? 'on' : 'off'}`, true);
    } catch (e) {
      grpStatus.set(errorText(e), false);
    }
    renderGroup();
    void refreshVoice();
  }
  const createGroup = button('fam-create-group', 'Create group', async () => {
    grpStatus.set('Creating the group...');
    try {
      const g = await client.family.createGroup({ personName: pname.input.value, address: paddr.input.value, lang: plang.input.value as 'te' | 'en', consent: { missedDose: cMissed.checked, emergency: cEmerg.checked } });
      await selectGroup(g.id);
    } catch (e) {
      grpStatus.set(errorText(e), false);
    }
  }, 'primary');

  // ---- medicines and pairing
  const medStatus = status('fam-med-status');
  const line = field('fam-med-line', 'Medicine line', 'Metformin 500, 1-0-1');
  const meds = el('ul', { id: 'fam-meds' });
  const addLine = button('fam-add-line', 'Add medicine', async () => {
    if (!groupId) return medStatus.set('Create or select a group first.', false);
    medStatus.set('Saving...');
    try {
      await client.family.addMedicine(groupId, { line: line.input.value });
      medStatus.set('Medicine saved.', true);
      await refreshGroup();
    } catch (e) {
      medStatus.set(errorText(e), false);
    }
  }, 'primary');
  /** A medicine due in two minutes, so the whole flow can be shown without waiting for 08:00. */
  const addSoon = button('fam-add-soon', 'Add a medicine due in 2 minutes', async () => {
    if (!groupId) return medStatus.set('Create or select a group first.', false);
    try {
      await client.family.addMedicine(groupId, { name: 'Demo tablet', strength: '1', times: [hhmm(new Date(Date.now() + 2 * 60_000))] });
      medStatus.set('Demo tablet added, due in about 2 minutes.', true);
      await refreshGroup();
    } catch (e) {
      medStatus.set(errorText(e), false);
    }
  });
  const remind = button('fam-remind', 'Remind now (to the person\'s phone)', async () => {
    if (!groupId) return medStatus.set('Create or select a group first.', false);
    try {
      await client.dev.remindNow(groupId);
      medStatus.set('Reminder sent to the paired phone.', true);
    } catch (e) {
      medStatus.set(errorText(e), false);
    }
  });

  const codeBox = el('div', { class: 'code', id: 'fam-code' });
  const codeNote = status('fam-code-status');
  const devices = el('ul', { id: 'fam-devices' });
  const makeCode = button('fam-make-code', 'Make a pairing code', async () => {
    if (!groupId) return codeNote.set('Create or select a group first.', false);
    try {
      const c = await client.family.createPairingCode(groupId);
      codeBox.textContent = c.code;
      onCode(c.code); // this page has both phones, so the code is filled in on the person's phone for you
      codeNote.set(`Type this on the person's phone (filled in for you here). Valid until ${new Date(c.expiresAt).toLocaleTimeString()}, works once.`, true);
    } catch (e) {
      codeNote.set(errorText(e), false);
    }
  }, 'primary');

  // ---- live lists
  const doses = el('ul', { id: 'fam-doses' });
  const alertList = el('ul', { id: 'fam-alerts' });
  async function refreshLists() {
    if (!groupId) return;
    try {
      const [d, a] = await Promise.all([client.family.doses(groupId), client.family.alerts(groupId)]);
      renderDoses(d.doses);
      renderAlerts(a.alerts);
    } catch (e) {
      log(`lists: ${errorText(e)}`);
    }
  }
  function renderDoses(list: DoseDto[]) {
    clear(doses);
    if (!list.length) doses.append(el('li', {}, 'No doses yet.'));
    for (const d of list) doses.append(el('li', { 'data-slot': d.slotId }, `${new Date(d.atMs).toLocaleTimeString()}, taken by ${d.via}`));
  }
  function renderAlerts(list: AlertDto[]) {
    clear(alertList);
    if (!list.length) alertList.append(el('li', {}, 'No alerts.'));
    for (const a of list) {
      const li = el('li', { 'data-kind': a.kind, class: a.acknowledgedAt ? 'ok' : 'bad' }, `${a.kind.replace('_', ' ')} at ${new Date(a.atMs).toLocaleTimeString()} `);
      if (a.acknowledgedAt) li.append('(acknowledged)');
      else
        li.append(
          button(`ack-${a.id.slice(0, 8)}`, 'Acknowledge', async () => {
            if (!groupId) return;
            await client.family.acknowledge(groupId, a.id).catch((e) => log(errorText(e)));
            await refreshLists();
          }, 'small'),
        );
      alertList.append(li);
    }
  }

  // ---- custom voice
  const vStatus = status('fam-voice-status');
  const consent = el('input', { id: 'fam-voice-consent', type: 'checkbox' });
  const sentences = el('div', { id: 'fam-voice-list' });
  async function refreshVoice() {
    if (!groupId) return;
    try {
      voice = await client.family.voice(groupId);
      renderVoice();
    } catch (e) {
      vStatus.set(errorText(e), false);
    }
  }
  async function save(hash: string, result: RecordingResult) {
    if (!groupId) return;
    if (!result.ok) return vStatus.set(REASONS[result.reason], false);
    try {
      await client.family.uploadClip(groupId, hash, result.wav, consent.checked);
      vStatus.set(`Saved (${Math.round(result.wav.size / 1024)} KB, ${(result.report.outputMs / 1000).toFixed(1)} s, trimmed ${(result.report.trimmedMs / 1000).toFixed(1)} s, volume ${result.report.gainDb >= 0 ? '+' : ''}${result.report.gainDb} dB).`, true);
      await refreshVoice();
    } catch (e) {
      vStatus.set(errorText(e), false);
    }
  }
  async function toggleRecord(hash: string) {
    if (recording) {
      const cur = recording;
      recording = null;
      const blob = await cur.rec.stop();
      renderVoice();
      vStatus.set('Processing...');
      if (cur.hash === hash) return save(hash, await processRecording(blob));
      return;
    }
    if (!consent.checked) return vStatus.set('Tick the box first: you agree the recording is stored and played to the person.', false);
    try {
      recording = { hash, rec: await startRecording(voice?.maxSeconds ?? 15) };
      void recording.rec.done.then(async (blob) => {
        // the time limit ended the recording by itself
        if (recording?.hash === hash) {
          recording = null;
          renderVoice();
          vStatus.set('Processing...');
          await save(hash, await processRecording(blob));
        }
      });
      vStatus.set('Recording... read the sentence aloud, then press Stop.');
      renderVoice();
    } catch (e) {
      recording = null;
      vStatus.set(errorText(e), false);
      renderVoice();
    }
  }
  function renderVoice() {
    clear(sentences);
    if (!voice) return;
    const done = voice.sentences.filter((s) => s.clip).length;
    sentences.append(el('p', { class: 'note', id: 'fam-voice-count' }, `${done} of ${voice.sentences.length} sentences recorded. Sentences without a recording are spoken by the synthetic voice.`));
    for (const s of voice.sentences) {
      const h = s.textHash;
      const row = el('div', { class: 'sentence', 'data-key': s.key, 'data-recorded': s.clip ? 'yes' : 'no' }, el('div', { class: 'key' }, `${s.key}${s.medicineName ? ` (${s.medicineName})` : ''}${s.clip ? ', recorded' : ''}`), el('div', { class: 'text' }, s.text));
      const isRec = recording?.hash === h;
      row.append(button(`rec-${s.key}`, isRec ? 'Stop' : s.clip ? 'Record again' : 'Record', () => toggleRecord(h), isRec ? 'primary small' : 'small'));
      const file = el('input', { id: `file-${s.key}`, type: 'file', accept: 'audio/*' });
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        if (!f) return;
        if (!consent.checked) return vStatus.set('Tick the box first: you agree the recording is stored and played to the person.', false);
        vStatus.set('Processing...');
        void processRecording(f).then((r) => save(h, r));
      });
      row.append(el('label', { class: 'note' }, 'or upload a file', file));
      if (s.clip) {
        row.append(
          button(`play-${s.key}`, 'Play', async () => {
            if (!groupId) return;
            const url = URL.createObjectURL(await client.family.clipAudio(groupId, h));
            const a = new Audio(url);
            a.onended = () => URL.revokeObjectURL(url);
            await a.play().catch((e: unknown) => vStatus.set(errorText(e), false));
          }, 'small'),
          button(`del-${s.key}`, 'Delete', async () => {
            if (!groupId) return;
            await client.family.deleteClip(groupId, h);
            await refreshVoice();
          }, 'small'),
        );
      }
      sentences.append(row);
    }
  }
  const deleteAll = button('fam-voice-delete-all', 'Delete all my recordings', async () => {
    if (!groupId) return;
    await client.family.deleteAllClips(groupId);
    vStatus.set('All recordings deleted.', true);
    await refreshVoice();
  });

  // ---- layout
  const groupInfo = el('div', { id: 'fam-group-info' });
  function renderGroup() {
    clear(meds);
    clear(devices);
    if (!group) return;
    for (const m of group.medicines) {
      const li = el('li', { 'data-medicine': m.name }, `${m.name} ${m.strength} at ${m.times.join(', ')} `);
      li.append(
        button(`rm-${m.id.slice(0, 8)}`, 'Remove', async () => {
          if (!groupId) return;
          await client.family.removeMedicine(groupId, m.id);
          await refreshGroup();
        }, 'small'),
      );
      meds.append(li);
    }
    if (!group.medicines.length) meds.append(el('li', {}, 'No medicines yet.'));
    for (const d of group.devices) {
      const li = el('li', { 'data-device': d.name }, `phone: ${d.name} `);
      li.append(
        button(`revoke-${d.id.slice(0, 8)}`, 'Revoke', async () => {
          if (!groupId) return;
          await client.family.revokeDevice(groupId, d.id);
          await refreshGroup();
        }, 'small'),
      );
      devices.append(li);
    }
    if (!group.devices.length) devices.append(el('li', {}, 'No phone paired yet.'));
  }
  function renderAll() {
    renderGroup();
    renderDoses([]);
    renderAlerts([]);
    renderVoice();
    clear(groupInfo);
    grpStatus.set('');
  }

  root.append(
    el('h2', {}, "Family member's phone"),
    section('1. Account', name.wrap, email.wrap, pw.wrap, el('div', { class: 'row' }, signUp, signIn, signOut), acct.node),
    section(
      '2. Care group',
      pname.wrap,
      paddr.wrap,
      plang.wrap,
      el('label', {}, cMissed, 'Alert me when a dose is missed'),
      el('label', {}, cEmerg, 'Alert me in an emergency'),
      createGroup,
      grpStatus.node,
    ),
    section('3. Medicines', line.wrap, el('div', { class: 'row' }, addLine, addSoon, remind), medStatus.node, meds),
    section('4. Pair the person\'s phone', makeCode, codeBox, codeNote.node, devices),
    section('5. What happened (live)', el('h4', {}, 'Doses'), doses, el('h4', {}, 'Alerts'), alertList),
    section(
      '6. My own voice',
      el('p', { class: 'note' }, "Record yourself reading Kaabil's sentences. The person's phone will play your voice instead of the synthetic voice, only for these exact sentences. Recordings are trimmed and evened out in your browser first."),
      el('label', {}, consent, 'I agree my recording is stored and played to the person. I can delete it at any time.'),
      sentences,
      el('div', { class: 'row' }, deleteAll),
      vStatus.node,
    ),
  );
  renderAll();
  void refreshMe();
}
