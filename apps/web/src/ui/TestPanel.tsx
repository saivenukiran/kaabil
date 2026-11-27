import { useMemo } from 'react';
import { runScenario, sameOutcome, SCENARIOS } from '@kaabil/core';

const fmt = (o: ReturnType<typeof runScenario>) =>
  `${o.phase}, doses ${o.doses}, alerts [${o.alerts.join(', ')}]${o.show112 ? ', 112' : ''}${o.showButtons ? ', buttons' : ''}, last: ${o.lastSay}`;

export function TestPanel() {
  const rows = useMemo(
    () => SCENARIOS.map((sc) => {
      const actual = runScenario(sc);
      return { sc, actual, pass: sameOutcome(actual, sc.expect) };
    }),
    [],
  );
  const passed = rows.filter((r) => r.pass).length;

  return (
    <section aria-label="Test panel">
      <div className="card">
        <h3>Dose flow: expected versus actual</h3>
        <p className={passed === rows.length ? 'ok' : 'bad'}>{passed} of {rows.length} scenarios pass</p>
        <table>
          <thead><tr><th>Scenario</th><th>Expected</th><th>Actual</th><th /></tr></thead>
          <tbody>
            {rows.map(({ sc, actual, pass }) => (
              <tr key={sc.id}>
                <td>{sc.title}</td>
                <td>{fmt(sc.expect)}</td>
                <td>{fmt(actual)}</td>
                <td className={pass ? 'ok' : 'bad'}>{pass ? 'PASS' : 'FAIL'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Not measured in this prototype</h3>
        <table>
          <tbody>
            <tr><td>Link guard: 6 of 6 risky flagged, 0 of 4 safe</td><td>Not built yet (placeholder)</td></tr>
            <tr><td>Recognition rate on 40 phrases, quiet and at 65 dB</td><td>Not measured: needs a recorded phrase set and a real microphone</td></tr>
            <tr><td>Alert reaches the family view within 3 seconds</td><td>In one browser the alert appears at once; real delivery over a network is not built</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
