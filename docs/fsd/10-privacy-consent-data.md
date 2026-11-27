# 10. Privacy, consent and data (PRIV)

Elders' medicine and health information is sensitive. We collect the least we can, say what we keep, and let the family delete it. Legend: [README](README.md).

> **Legal note.** India's Digital Personal Data Protection Act applies to this kind of data. We have not had a lawyer review this product, so nothing here claims compliance. A legal review is a launch condition for F and for the pilot.

## Rules

| # | Rule |
|---|---|
| D1 | Text transcripts only. **The person's audio is never stored** by our code. The one exception is a family member's own recording of a fixed sentence (FR-LANG-11): made on purpose, with their consent, stored so the person's phone can play it, and deletable. |
| D2 | Alerts reach the family only with consent, and the screen says who will be told. |
| D3 | Every kept item has a stated reason and a stated retention period. |
| D4 | The family can delete everything about the person, and the screen says how long backups keep it. |
| D5 | No real person's data is used in the repository, the demo or tests. Demo data is fictional ("Amma"). |
| D6 | Logs hold no transcripts, no medicine names and no names. |

## Data inventory

| Data | Why we keep it | P: where | F: where | Retention |
|---|---|---|---|---|
| Person's name or how to address them | To speak to them | Browser | Server | Until deleted |
| Language | To speak in it | Browser | Server | Until deleted |
| Medicines (name, strength, times) | To remind | Browser | Server | Until deleted |
| Dose log (slot, time, voice or button) | To show the family | Browser | Server | To be decided (open question) |
| Alerts and their delivery | To show the family | Browser | Server | To be decided |
| Consents (what, who, when, wording version) | Proof the family agreed | Browser (the two switches) | Server | As long as the account exists, plus a period set by legal review |
| Text transcripts | To show what was heard, and to debug | Browser (last 200 lines) | Server, short period | To be decided; target is days, not months |
| Family email | To sign in and notify | None | Server | Until deleted |
| Push subscription | To notify | None | Server | Until the device is revoked |
| Pill photo | To read a strip | None | Not kept | Deleted after the answer (chapter 6) |
| The person's audio | Not kept | None | Not kept | Never stored by our code |
| A family member's recording of a fixed sentence | To play it to the person | None (the app screens do not use it yet) | Server, as audio bytes with the sentence it says | Until the family deletes it, or the group is deleted |

## Requirements

### FR-PRIV-01 What the screen tells the family — P partly, F full

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-01-1 | Setup | the family reaches consent | plain wording (in the family's language) says what is kept, where, for how long, who sees alerts, and that the person's audio is not stored (only a family member's own recordings, made with their consent) |
| AC-PRIV-01-2 | The wording changes | the family next opens the app | they are asked to read and accept it again; the version is recorded |
| AC-PRIV-01-3 | Browser speech recognition is used (P) | the screen explains | it says the browser's vendor may process the audio, which we do not control |
| AC-PRIV-01-4 | A cloud speech or vision provider is used (F) | the screen explains | it names the provider and what is sent |

### FR-PRIV-02 Consent for alerts — P toggles, F recorded

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-02-1 | Both consents are off by default | a new setup | no alert is created until the family turns one on |
| AC-PRIV-02-2 (F) | A consent changes | it is saved | a row records who changed it, when, and the wording version |
| AC-PRIV-02-3 (F) | The family withdraws consent | the next event | no alert is created, and the person's spoken messages do not claim one |

> Open question for the legal review: whose consent counts for an elder who cannot read the notice. The design assumes the family sets it up with the person present; a lawyer decides what is required.

### FR-PRIV-03 Data held in the browser — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-03-1 | The prototype runs | storage is inspected | one JSON document, no audio, no keys, transcripts limited to the last 200 lines and 50 spoken messages |
| AC-PRIV-03-2 | Saved data comes from a newer or broken version | the app loads | it starts clean instead of failing |

### FR-PRIV-04 Delete all data — P browser, F server

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-04-1 (P) | The family presses "Delete all data" | they confirm | the person, medicines, consents, doses, alerts and transcripts in the browser are erased |
| AC-PRIV-04-2 (F) | An owner requests deletion | they confirm twice | every row of the care group is removed within 24 hours, devices are revoked, and a confirmation is sent |
| AC-PRIV-04-3 (F) | Backups exist | the screen explains | it states that backups age out within the stated number of days |
| AC-PRIV-04-4 (F) | Deletion has run | any request for the group's data | returns nothing |

### FR-PRIV-05 Export — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-05-1 | An owner asks for their data | the export runs | they receive a file with the plan, doses, alerts and consents in a readable form |
| AC-PRIV-05-2 | The export is created | it is stored | the download link works once and expires within an hour |

### FR-PRIV-06 Retention jobs — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-06-1 | A transcript is older than its retention period | the nightly job runs | it is removed |
| AC-PRIV-06-2 | The job fails | the next morning | an alert is raised to the team |

### FR-PRIV-07 No sensitive data in logs or analytics — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-07-1 | A request is logged | the line is written | it holds ids and status only, never transcripts, names or medicine names |
| AC-PRIV-07-2 | A test sends a known marker text as a transcript | the logs are searched | the marker is not found |
| AC-PRIV-07-3 | Analytics | decided | none that sends personal data to a third party is added without a written decision |

### FR-PRIV-08 Access record — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-08-1 | A family member or an operator reads a person's data | the read happens | an audit row records who, what kind of data, and when |
| AC-PRIV-08-2 | An operator needs production data to fix a fault | they ask | it needs a written reason, is logged, and is limited to the fault's record |

### FR-PRIV-09 Incident handling — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-PRIV-09-1 | A breach is suspected | the team finds out | the response steps (contain, revoke keys, assess, notify the families and the authority as the law requires) are written in a runbook before launch |
| AC-PRIV-09-2 | A secret reaches the public repository | it is found | it is treated as compromised and rotated first, deleted second |

## Verification

| Kind | How |
|---|---|
| Automated | A test that the person's audio never reaches storage (family recordings are the only audio kept, and only with consent); a log-scan test with marker text; deletion tests against a test database |
| Review | Legal review of the notice and the retention table before F |
| Manual | Delete all data, then reload: the app starts empty |
