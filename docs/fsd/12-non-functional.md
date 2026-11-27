# 12. Non-functional requirements (NFR)

Every number here is a **target**, not a result, unless the row says it is built. Legend: [README](README.md).

## Performance and latency

| ID | Requirement | Target | Release | How measured |
|---|---|---|---|---|
| NFR-PERF-01 | First useful screen on a mid-range phone on a 4G connection | within 3 seconds | P, F | A lab test with a throttled connection, run before each release |
| NFR-PERF-02 | Page weight of the first load (compressed) | at most 300 KB of script and style, fonts excluded | P, F | Build output report |
| NFR-PERF-03 | Answer to a button press | a visible response within 100 ms | P, F | Manual and an automated interaction test |
| NFR-PERF-04 | From the person's confirmed Yes to the family seeing the dose | within 3 seconds, 95th percentile, when online | F | A script that logs 100 doses from a phone in the region and times the family screen |
| NFR-PERF-05 | From an alert being created to a push reaching a phone | within 3 seconds, 95th percentile | F | The same script |
| NFR-PERF-06 | API response time for ordinary calls | 95th percentile under 300 ms at the server | F | Server timings |
| NFR-PERF-07 | Pill photo to spoken answer | within 10 seconds, or the "cannot read" fallback | F | Timed test |

## Reliability and recovery

| ID | Requirement | Target | Release |
|---|---|---|---|
| NFR-REL-01 | A dose is never lost: it is stored on the phone until the server confirms it | zero lost confirmed doses in a network-cut test | F |
| NFR-REL-02 | A missed-dose alert is raised even if the phone is closed | by the server timer, once per slot | F |
| NFR-REL-03 | Availability of the family alert path | 99.5% per month as a target for the pilot; one server is a known single point of failure, accepted for the pilot and written down | F |
| NFR-REL-04 | Backups | nightly database dump to separate storage; a restore drill before the pilot and after each schema change | F |
| NFR-REL-05 | Data we can lose after a failure | at most 24 hours of non-alert history (the last nightly backup), and no confirmed dose that the phone still holds | F |
| NFR-REL-06 | Deploy and rollback | the previous image stays available; rollback in under 15 minutes | F |
| NFR-REL-07 | Dependency failure | speech, vision, push or database trouble degrades to the fallbacks in the PRD's dependency table, never to a wrong action | P (speech), F (others) |
| NFR-REL-08 | Clock | a phone with a wrong clock does not create doses at wrong times: slot times are decided on the phone's local day; the server stores its own receive time beside the phone's | F |

## Observability

| ID | Requirement | Release |
|---|---|---|
| NFR-OBS-01 | A health endpoint and an external uptime check; the founders are told when it fails | F |
| NFR-OBS-02 | Structured logs without personal data (FR-PRIV-07); each request has an id | F |
| NFR-OBS-03 | Counters for: alerts created and delivered, delivery failures, pairing attempts, sign-in failures, recognition fallbacks to buttons | F |
| NFR-OBS-04 | A written "what to check when an alert did not arrive" runbook | F |

## Compatibility

| ID | Requirement | Release |
|---|---|---|
| NFR-COMP-01 | Primary: Chrome on a phone. Speech recognition depends on it | P |
| NFR-COMP-02 | Other browsers: the buttons and the text box work and the screen says speech is not available | P |
| NFR-COMP-03 | iOS: web push needs the app installed to the home screen; the app explains this and never promises a notification it cannot send | F |
| NFR-COMP-04 | Screens from 360 px wide up; text scales to 200% | P |
| NFR-COMP-05 | The prototype runs from `docker compose up --build` on a clean clone with no keys and no `.env` | P |

## Maintainability and quality

| ID | Requirement | Release |
|---|---|---|
| NFR-MAINT-01 | `packages/core` has no browser, clock, storage or speech dependency; it compiles without the DOM type library | P, built |
| NFR-MAINT-02 | Any change to the word rules or the dialogue comes with a test | P, built (review rule) |
| NFR-MAINT-03 | Typecheck, tests and build pass before every push (local guard, since GitHub Actions is off) | P, built |
| NFR-MAINT-04 | Every language file passes the completeness test | P, built |
| NFR-MAINT-05 | Server code is covered by API tests for authorisation, idempotency and limits (chapter 11) | F |
| NFR-MAINT-06 | A new infrastructure concern uses a maintained SDK, with the choice written down | P, F |

## Operations

| ID | Requirement | Release |
|---|---|---|
| NFR-OPS-01 | Deploy is one scripted command from a clean checkout after the local checks pass | F |
| NFR-OPS-02 | One staging environment that matches production, with fictional data only | F |
| NFR-OPS-03 | Cost is estimated from the provider's calculator and approved before anything is created | F |
| NFR-OPS-04 | A monthly patch window and a dependency update pass | F |

## Testing strategy

| Level | What | Release |
|---|---|---|
| Unit | Word rules, dialogue, parser, language completeness | P, built (141 tests) |
| Scenario | 12 dose scenarios against the real engine, also shown in the Test panel | P, built |
| API | Endpoints, roles, idempotency, limits, deletion | F |
| End to end | A scripted browser test of the dose flow with text input; two-device alert test | F |
| Accessibility | Contrast script, screen reader pass, 200% text | P, F |
| Security | Chapter 11's release gate | F |
| Performance | The timing scripts above | F |
| Field | A real phone, a Telugu voice, real elders (pilot) | L |

## Pilot success measures (from the PRD)

Targets for an eight-week pilot with 30 elders and their families; we have not run it.

| Measure | Target |
|---|---|
| Confirmed doses taken on time | 85% or more; missed doses fall by half |
| Tasks done by voice without help | 80% |
| Telugu recognition on 40 fixed phrases, including 65 dB noise | 85% or more |
| Family alert arrives | within 3 seconds when online |
| Still used weekly at the end | 70% |
| Link guard | 0 of 6 risky links opened, 0 of 4 safe links wrongly blocked |
