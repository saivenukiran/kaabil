# Functional Specification (FSD)

The [PRD](../PRD.md) says what we build and why. [SPECS](../SPECS.md) says how the prototype is built. This specification says, feature by feature, **exactly what the product does**, in a form that can be tested: each requirement has acceptance criteria written as Given, When, Then.

It covers the whole product, in three releases, so we can see what the prototype is, and what the complete product still needs.

## Releases

| Tag | Release | Meaning |
|---|---|---|
| **P** | Round 2 prototype | One browser, no backend, no keys. `docker compose up` starts it. Built and tested where the status says "built" |
| **F** | Finale build and pilot product | A server, accounts, push, cloud speech and vision, link guard on a demo inbox. Planned, not built |
| **L** | Later | Needs a native app, a pilot, or a decision we have not made |

Status words used in each requirement's title:

| Word | Meaning |
|---|---|
| built | Works in this repository and is covered by a test or by a manual step in the README |
| built (backend) | Implemented in the backend and covered by its tests (and the smoke test and end-to-end scripts); the app screens do not use it yet |
| partly built | The title says what is built; the rest is still a plan |
| placeholder | A screen exists, is labelled as a placeholder, and does nothing real |
| designed, not built | Drawn on the design canvas; no code yet |
| to be verified | Written down, but not yet measured on the app |
| (no word) | Planned; no code |

A requirement marked **P, built** was checked against the code when this document was written. Everything else is a plan and may change.

## Chapters

| # | Chapter | Area ID | Requirements |
|---|---|---|---|
| 1 | [Medicine dose by voice](01-dose-by-voice.md) | DOSE | 12 |
| 2 | [Languages and speech](02-languages-and-speech.md) | LANG | 11 |
| 3 | [Screens and accessibility](03-screens-and-accessibility.md) | UI | 12 |
| 4 | [Medicines, alerts and the family view](04-medicines-alerts-family.md) | MED, ALERT | 12 |
| 5 | [Daily check-in and emergency](05-checkin-and-emergency.md) | CHK | 7 |
| 6 | [Pill check](06-pill-check.md) | PILL | 6 |
| 7 | [Link guard](07-link-guard.md) | LINK | 7 |
| 8 | [Send to family](08-send-to-family.md) | MSG | 6 |
| 9 | [Accounts, pairing and roles](09-accounts-pairing-roles.md) | AUTH | 9 |
| 10 | [Privacy, consent and data](10-privacy-consent-data.md) | PRIV | 9 |
| 11 | [Security between the UI and the backend](11-security-ui-to-backend.md) | SEC | 16 |
| 12 | [Non-functional requirements](12-non-functional.md) | NFR | tables |

107 functional requirements and about 350 acceptance criteria, plus the non-functional tables.

## How a requirement is written

| Part | Meaning |
|---|---|
| `FR-<AREA>-<nn>` | The requirement id. Stable: never reused, never renumbered |
| Title and release | What it is, and the release and status |
| Description | The behaviour in plain words |
| Business rules and edge cases | What must always be true, and the unhappy cases |
| `AC-<AREA>-<nn>-<k>` | One acceptance criterion: Given a state, When something happens, Then a result that can be observed |
| `(P)` or `(F)` inside an AC id column | The criterion belongs to that release only |

An acceptance criterion is met only if a test or a documented manual step shows it. "Works" without that does not count.

## Traceability: PRD requirements to this specification

| PRD | What | Requirements here |
|---|---|---|
| R1 | Reminder in the person's language | FR-DOSE-01 |
| R2 | Log only after a claim and a Yes | FR-DOSE-02 |
| R3 | Uncertainty never counts as Yes | FR-DOSE-03 |
| R4 | A negated claim is a No | FR-DOSE-04 |
| R5 | "Not yet" snoozes 10 minutes | FR-DOSE-05 |
| R6 | No answer: repeat, then alert the family | FR-DOSE-06, FR-ALERT-01 |
| R7 | Second claim within 4 hours is refused and flagged | FR-DOSE-07 |
| R8 | Emergency phrases show 112 and alert the family | FR-CHK-01, FR-CHK-02 |
| R9 | Telugu and English; a new language is one file | FR-LANG-01, FR-LANG-02, FR-LANG-03 |
| R10 | Buttons and a text box do the same job | FR-DOSE-09 |
| R11 | The family sets up medicines by typing a line | FR-MED-01 |
| R12 | Only text transcripts kept; the person's audio never stored; delete all data | FR-PRIV-03, FR-PRIV-04 |
| R13 | A family member records their own voice for Kaabil's fixed sentences | FR-LANG-11 |

PRD sections 3 and 8 name the capabilities the prototype only shows as placeholders; they are specified in chapters 5 to 8. PRD section 5 (safety rules) is in the rules tables at the top of chapters 1, 5, 6, 7 and 8. PRD section 6 (pilot targets) is in chapter 12.

## Counts by release

| Release | What it holds |
|---|---|
| P, built | Chapter 1 (dose flow), the language registry, the person and family screens, the medicine parser, emergency phrases, the test panel, the browser data and its deletion, the prototype's security headers and container hardening |
| P, placeholder | Pill check, daily check-in, link guard, send to family |
| F | Everything with a server: accounts, pairing, push, dose sync, family history, privacy on the server, security chapter, cloud speech and vision, the four features working, themes and installable app |
| L | A native app (link guard in other apps, wake in the background, location), the pilot's measurements, a clinician's review of emergency phrases |

## Open questions that block a requirement

| # | Question | Blocks |
|---|---|---|
| 1 | Retention periods for transcripts, dose logs and alerts | FR-PRIV-06, the privacy notice |
| 2 | Whose consent counts for an elder, and what the law requires | FR-PRIV-02, launch of F |
| 3 | Should a repeated-dose flag also need consent | FR-DOSE-07, FR-ALERT-01 |
| 4 | One question for all morning tablets, or one by one | FR-DOSE-11 |
| 5 | Which further emergency phrases belong in the list | FR-CHK-03 |
| 6 | Which reputation service the link guard uses | FR-LINK-02 |
| 7 | Which cloud speech and vision providers, and their data terms | FR-LANG-04, FR-LANG-05, FR-PILL-05 |
| 8 | Pairing code length (8 digits proposed) | FR-AUTH-05 |

## Glossary

| Term | Meaning |
|---|---|
| Person | The elder or person who depends on family to operate the phone |
| Family member | A relative who sets the app up and sees the result |
| Care group | One person and their family; every record belongs to exactly one |
| Slot | One medicine at one time on one day; the unit of a reminder and of a dose record |
| Claim | The person says they took the medicine |
| Intent | What the word rules decide an utterance means: claim, yes, no, not yet, mixed, unclear, stop, help, repeat, emergency |
| Fixed message | One of the 12 sentences Kaabil may speak; it never generates free text |
| Consent | The family's switch that lets Kaabil alert them (missed dose, emergency) |
| Pairing | Linking the person's phone to the care group with a one-time code entered by the family |
