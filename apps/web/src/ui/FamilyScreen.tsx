import { useState } from 'react';
import { acknowledge, type AlertKind, type AppState, atTimeOfDay, deleteAllData, fmtTime, isValidTime, type ParsedMedicine, parseMedicineLine, removeMedicine, saveMedicine, setConsent, setPerson, slotId } from '@kaabil/core';
import { update, useAppState } from '../store';

const ALERT_TEXT: Record<AlertKind, string> = {
  missed_dose: 'Missed dose: no answer after two reminders',
  double_dose: 'Dose claimed again within 4 hours (not recorded)',
  emergency: 'Emergency phrase or SOS pressed',
};

function slotStatus(state: AppState, medId: string, hhmm: string): string {
  const id = slotId(medId, state.clockMs, hhmm);
  const dose = state.doses.find((d) => d.slotId === id);
  if (dose) return `Taken at ${fmtTime(dose.atMs)} (${dose.via})`;
  if (atTimeOfDay(state.clockMs, hhmm) > state.clockMs) return 'Upcoming';
  if (state.session?.slotId === id) {
    if (state.session.phase === 'escalated') return 'Missed, family alerted';
    return `Reminding (${state.session.phase})`;
  }
  return state.handled.includes(id) ? 'Reminded, no answer' : 'Due';
}

function Setup() {
  const state = useAppState();
  const [line, setLine] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<ParsedMedicine | null>(null);

  const read = () => {
    const r = parseMedicineLine(line);
    if (r.ok) {
      setDraft(r.value);
      setError('');
    } else {
      setDraft(null);
      setError(r.error);
    }
  };
  const timesValid = draft?.times.every(isValidTime) ?? false;

  return (
    <div className="card">
      <h3>Setup (family)</h3>
      <div className="row">
        <label>Name <input value={state.person.name} onChange={(e) => update((s) => setPerson(s, { name: e.target.value }))} /></label>
        <label>Address <input value={state.person.address} lang={state.lang} onChange={(e) => update((s) => setPerson(s, { address: e.target.value }))} /></label>
      </div>
      <label htmlFor="med">Medicine, typed or dictated (for example “Metformin 500, 1-0-1”)</label>
      <div className="row">
        <input id="med" value={line} onChange={(e) => setLine(e.target.value)} placeholder="Metformin 500, 1-0-1" />
        <button onClick={read}>Read it</button>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      {draft && (
        <div className="draft">
          <p>
            <strong>{draft.name} {draft.strength}</strong>: confirm the exact times.
          </p>
          <div className="row">
            {draft.times.map((t, i) => (
              <input
                key={i}
                type="time"
                value={t}
                onChange={(e) => setDraft({ ...draft, times: draft.times.map((x, j) => (j === i ? e.target.value : x)) })}
              />
            ))}
          </div>
          <button disabled={!timesValid} onClick={() => { update((s) => saveMedicine(s, draft)); setDraft(null); setLine(''); }}>
            Confirm and save
          </button>
          <p className="muted">Changes apply from the next dose.</p>
        </div>
      )}
      <ul className="plain">
        {state.medicines.map((m) => (
          <li key={m.id}>
            {m.name} {m.strength}: {m.times.join(', ')}{' '}
            <button className="link-button" onClick={() => update((s) => removeMedicine(s, m.id))}>Remove</button>
          </li>
        ))}
        {state.medicines.length === 0 && <li className="muted">No medicines yet.</li>}
      </ul>
    </div>
  );
}

export function FamilyScreen() {
  const state = useAppState();
  const openAlerts = state.alerts.filter((a) => !a.acknowledged).length;
  return (
    <section className="family" aria-label="Family dashboard">
      <div className="card">
        <h3>Today for {state.person.name || 'the person'}</h3>
        <table>
          <thead><tr><th>Medicine</th><th>Time</th><th>Status</th></tr></thead>
          <tbody>
            {state.medicines.flatMap((m) =>
              m.times.map((t) => (
                <tr key={`${m.id}${t}`}>
                  <td>{m.name} {m.strength}</td>
                  <td>{t}</td>
                  <td>{slotStatus(state, m.id, t)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Alerts {openAlerts > 0 && <span className="badge">{openAlerts} new</span>}</h3>
        {state.alerts.length === 0 && <p className="muted">No alerts.</p>}
        <ul className="plain">
          {[...state.alerts].reverse().map((a) => (
            <li key={a.id} className={a.acknowledged ? 'done' : 'new'}>
              <strong>{fmtTime(a.atMs)}</strong> {ALERT_TEXT[a.kind]}
              <div className="muted">In-app: {a.delivery.inApp}. Push: {a.delivery.push}.</div>
              {!a.acknowledged && <button onClick={() => update((s) => acknowledge(s, a.id))}>Acknowledge</button>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>Messages</h3>
        <ul className="plain transcripts">
          {state.transcripts.slice(-12).map((t, i) => (
            <li key={i}><span className="muted">{fmtTime(t.atMs)} {t.who === 'person' ? state.person.name || 'Person' : 'Kaabil'}:</span> {t.text}</li>
          ))}
          {state.transcripts.length === 0 && <li className="muted">Nothing yet. Transcripts are text only; audio is never stored.</li>}
        </ul>
      </div>

      <Setup />

      <div className="card">
        <h3>Consent and privacy</h3>
        <label className="check">
          <input type="checkbox" checked={state.consent.missedDose} onChange={(e) => update((s) => setConsent(s, { missedDose: e.target.checked }))} />
          Alert family automatically after a missed dose
        </label>
        <label className="check">
          <input type="checkbox" checked={state.consent.emergency} onChange={(e) => update((s) => setConsent(s, { emergency: e.target.checked }))} />
          Alert family automatically on an emergency phrase or SOS
        </label>
        <button className="danger" onClick={() => { if (window.confirm('Delete all data in this browser?')) update(deleteAllData); }}>
          Delete my data
        </button>
      </div>
    </section>
  );
}
