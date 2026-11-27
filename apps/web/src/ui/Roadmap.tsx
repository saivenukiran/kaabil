import { LANGUAGES, PHRASE_PACKS } from '@kaabil/core';
import { cloudSpeechStatus } from '../voice/cloudSpeech';

type Status = 'works' | 'placeholder';

const FLOWS: { name: string; status: Status; note: string }[] = [
  { name: 'Medicine reminder and dose logging', status: 'works', note: `${LANGUAGES.map((l) => l.name).join(' and ')}. Voice, buttons or typing. Missed and double doses alert the family view.` },
  { name: 'Family setup: "Metformin 500, 1-0-1"', status: 'works', note: 'Parsed into times, saved only after the family confirms.' },
  { name: 'Emergency phrases and SOS', status: 'works', note: '112 call button and a family alert (with consent). Never diagnoses.' },
  { name: 'Pill check by camera', status: 'placeholder', note: 'Needs a vision model and a key. Planned output: {drug, strength, confidence, unreadable}. Strength must match exactly.' },
  { name: 'Daily check-in at 6 pm', status: 'placeholder', note: 'Planned: logs the answer; "dizzy" offers to tell family.' },
  { name: 'Link guard', status: 'placeholder', note: 'Planned: demo inbox of 10 messages, rule-scored, two Yes needed to open a simulated preview.' },
  { name: 'Send a message to family', status: 'placeholder', note: 'Planned: speak, read back, send; the family reply is read aloud.' },
  { name: 'Wake word, shake, companion mode', status: 'placeholder', note: 'Planned for the finale build.' },
  { name: 'Smartwatch feed', status: 'placeholder', note: 'Planned as a clearly labelled simulated feed.' },
  { name: 'Push notifications', status: 'placeholder', note: 'Alerts show real delivery status; push is "not set up" for now.' },
];

export function Roadmap() {
  const cloud = cloudSpeechStatus();
  return (
    <section aria-label="Roadmap">
      <div className="card">
        <h3>What works and what is a placeholder</h3>
        <table>
          <thead><tr><th>Flow</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            {FLOWS.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td className={f.status === 'works' ? 'ok' : 'muted'}>{f.status === 'works' ? 'Works' : 'Placeholder'}</td>
                <td>{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Languages</h3>
        <p>{LANGUAGES.map((l) => l.name).join(' and ')} work in the dose flow; a new language is one file (see the README in the languages folder). Phrase packs for {PHRASE_PACKS.length} more exist as data only, unreviewed by native speakers:</p>
        <table>
          <thead><tr><th>Language</th><th>Yes</th><th>No</th><th>1 to 5</th></tr></thead>
          <tbody>
            {PHRASE_PACKS.map((p) => (
              <tr key={p.code}><td>{p.name}</td><td>{p.yes}</td><td>{p.no}</td><td>{p.numbers.join(' ')}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="notice">{cloud.message}</p>
      </div>
    </section>
  );
}
