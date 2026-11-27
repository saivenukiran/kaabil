# 1. Medicine dose by voice (DOSE)

The core flow. Release **P** (Round 2 prototype) is built and tested; release **F** adds what a server makes possible. Legend and ID scheme: [README](README.md).

## Actors and scope

| Actor | Role in this chapter |
|---|---|
| Person | Hears the reminder, answers by voice, button or typing |
| Family member | Sees the result (chapter 4) |
| System | Decides what the answer means with word rules, never with the speech model |

Out of scope: medical advice, dose calculation, drug interaction, identifying a pill (chapter 6).

## Rules that apply to every requirement here

| # | Rule |
|---|---|
| B1 | A dose is logged only after a claim ("I took it") and an explicit Yes. |
| B2 | Uncertainty never counts as Yes. "Unclear" and "mixed" never act. |
| B3 | Any No beats any Yes or claim. |
| B4 | The speech model supplies text only. Its confidence is not used. |
| B5 | Kaabil speaks only the 12 fixed messages. It generates no free text. |
| B6 | One conversation at a time. The earliest due dose goes first; another due dose waits until the current conversation has ended (logged or escalated). |

## Requirements

### FR-DOSE-01 Scheduled reminder (R1) — P, built

**Description.** When a medicine's time of day arrives, Kaabil starts a conversation and speaks the `remind` message in the person's language: how to address the person, the medicine, the strength, and one question (two short sentences).

**Business rules**
- A slot is one medicine at one time on one day. Each slot reminds once (`handled`).
- P uses a demo clock that moves only when "Advance demo time" or "Jump to time" is used, so a reminder can be shown in seconds. F uses the real clock.
- Browsers allow speech only after the person has tapped the page once, so the screen shows a Start hint first. Without a tap, the sentence is shown large and not spoken.
- If no voice for the language exists, the same sentence is shown large with a note (UI string `noVoice`).

**Edge cases**
| Case | Behaviour |
|---|---|
| Two medicines due at the same time | The earlier slot (ties: list order) goes first; the second starts after the first ends |
| App closed at the time | P: nothing happens (no background). F: a push notification brings the person to the page (FR-DOSE-12). L: a native app wakes by itself |
| Page opened late | A past slot that was never handled starts when the page next processes the clock |

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-01-1 | Metformin 500 at 08:00, language Telugu | the clock reaches 08:00 | the `remind` message is spoken in Telugu with "Metformin" and "500" |
| AC-DOSE-01-2 | A reminder already fired for today's 08:00 | the clock advances again | no second reminder for that slot |
| AC-DOSE-01-3 | Metformin 08:00 and Aspirin 08:00 | the clock reaches 08:00 | the first slot starts; the second starts only after the first is logged or escalated |
| AC-DOSE-01-4 | No installed voice for the language | a reminder is due | the sentence is shown large and a note explains why it is not spoken |

### FR-DOSE-02 Claim, then explicit confirmation (R2) — P, built

**Description.** After the reminder, the person says they took it. Kaabil reads back and asks to record ("నమోదు చేయనా?"). Only a Yes records the dose.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-02-1 | Phase `asked` | the person says "వేసుకున్నాను" | phase `confirming`; `confirm_log` is spoken; nothing is recorded yet |
| AC-DOSE-02-2 | Phase `confirming` | the person says "అవును" | the dose is recorded once; `logged` is spoken; phase `logged` |
| AC-DOSE-02-3 | Phase `asked` | the person says only "yes" (no claim) | nothing is recorded; `clarify` is spoken |
| AC-DOSE-02-4 | Phase `confirming` | 2 minutes pass with no answer | phase returns to `asked`; nothing is recorded (the ten-minute repeat clock restarts) |

### FR-DOSE-03 Uncertainty never counts as Yes (R3) — P, built

**Description.** If Kaabil cannot classify the answer, it asks again. After the second unclear answer or the second silence it shows large Yes and No buttons.

**Constants:** `MAX_UNCLEAR = 2`, `MAX_SILENCES = 2`, the microphone waits 6 seconds, opens 300 ms after Kaabil stops speaking.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-03-1 | Phase `confirming` | the person says "అవును కాదు" (Yes and No) | intent `mixed`; nothing recorded; `clarify` spoken |
| AC-DOSE-03-2 | Phase `asked` | two unclear answers in a row | `clarify` after each; after the second, the Yes/No buttons appear too |
| AC-DOSE-03-3 | Phase `asked` or `confirming` | the microphone hears nothing three times | the question is re-asked after the first and second silence; after the third the buttons appear |
| AC-DOSE-03-4 | Any phase | the recogniser returns text with high confidence but no Yes or claim word | nothing is recorded |

### FR-DOSE-04 Negation (R4) — P, built

**Description.** In Telugu negation is a verb ending. Words ending in లేదు, లేను, లేవు or లేరు are No, so "వేసుకోలేదు" ("did not take") is No, not a claim.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-04-1 | Phase `asked` | "వేసుకోలేదు" | treated as No: `snooze`; nothing recorded |
| AC-DOSE-04-2 | Phase `confirming` | "వద్దు" or "no" | phase `asked`; `not_logged`; nothing recorded |
| AC-DOSE-04-3 | Any phase | text with a Yes word and a No word | intent `mixed`; no action |

### FR-DOSE-05 Not yet / snooze (R5) — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-05-1 | Phase `asked` | "ఇంకా లేదు" (not yet) | phase `snoozed`; `snooze` spoken; a 10-minute timer starts |
| AC-DOSE-05-2 | Phase `snoozed` | 10 minutes pass | phase `asked`; `remind` spoken (this counts as the one repeat) |
| AC-DOSE-05-3 | After the snooze reminder | 10 more minutes of silence | escalation (FR-DOSE-06) |

### FR-DOSE-06 No answer: repeat once, then tell the family (R6) — P, built; server guard built (backend)

**Description.** No answer for 10 minutes: repeat once. Still none 10 minutes after the repeat (20 in total): `escalated`, a `missed_dose` alert, and the `escalated` message.

**Consent rule.** The alert and the sentence "I told your family" exist only if the family consented to missed-dose alerts. Without consent Kaabil says nothing about telling the family, because that would be untrue.

**F addition.** The phone's session may be closed. A server timer raises the `missed_dose` alert for any slot with no log 20 minutes after its time, once per slot (unique on slot id).

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-06-1 | Consent on, no answer | 10 minutes | `remind` spoken a second time |
| AC-DOSE-06-2 | Consent on, still no answer | 20 minutes in total | phase `escalated`; one `missed_dose` alert; `escalated` spoken |
| AC-DOSE-06-3 | Consent off | 20 minutes in total | no alert is created; `escalated` is not spoken |
| AC-DOSE-06-4 | Alert already exists for the slot | the engine runs again | no second alert for that slot |
| AC-DOSE-06-5 (F) | Phone closed, no dose logged | 20 minutes after the slot time | the server raises one alert and the family is notified |

### FR-DOSE-07 Repeated-dose guard (R7) — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-07-1 | Dose logged 1 hour ago | the person claims again | `already_logged` spoken; nothing recorded; a `double_dose` alert is raised |
| AC-DOSE-07-2 | Dose logged 5 hours ago | the person claims again | treated as a normal claim for the next slot (window is 4 hours) |
| AC-DOSE-07-3 | Consent off | a repeated claim | `already_logged` spoken; the double-dose flag is still shown to the family in the app |

> Open question: whether the double-dose alert should also require consent. Today it does not. Decide with a doctor's input before the pilot.

### FR-DOSE-08 Commands that work anywhere — P, built

| Intent | Effect |
|---|---|
| `help` | `help` message: what Kaabil can do |
| `stop` | `stopped` message; conversation ends politely |
| `repeat` | while asking, the reminder is spoken again; while confirming, the confirmation question; in other phases nothing |
| `emergency` | see chapter 5 (FR-CHK-04); beats everything |

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-08-1 | No conversation active | "సహాయం" or "help" | `help` spoken |
| AC-DOSE-08-2 | Any phase | "ఆపు" or "stop" | `stopped` spoken |
| AC-DOSE-08-3 | Phase `confirming` | "repeat" or "మళ్ళీ చెప్పు" | `confirm_log` is spoken again, nothing is recorded |

### FR-DOSE-09 Buttons and typing do the same job (R10) — P, built

**Description.** Large Yes/No buttons and a text box reach the same logic as speech. While Kaabil waits for the claim, Yes means "I took it" and No means "not yet". While it asks to confirm, they answer the confirmation.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-09-1 | No microphone permission | the buttons are used | the dose can be completed |
| AC-DOSE-09-2 | Phase `asked` | the person presses Yes | treated as a claim; confirmation is asked |
| AC-DOSE-09-3 | Phase `confirming` | the person presses Yes | the dose is recorded, with `via = button` |
| AC-DOSE-09-4 | A typed answer | text is sent | the same word rules apply as for speech |

### FR-DOSE-10 A dose is recorded once — P, built (in the browser); server built (backend); the test page retries a failed send, the app screens do not yet

**Description.** Each slot has at most one dose record. A retry, a double tap or a duplicate request never records twice.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-10-1 | Dose recorded for slot S | a second record for S is attempted | still one record |
| AC-DOSE-10-2 (F) | The phone retries `POST /api/doses` after a lost response | the same slot id arrives twice | one row; the second call succeeds with the existing record |
| AC-DOSE-10-3 (F) | The network is down at the moment of logging | the person confirms | the dose is kept on the phone, shown as "waiting to send", and sent later; the screen never says "family told" before delivery |

### FR-DOSE-11 Many medicines and many people — F

**Description.** One family may look after more than one person; one person may take several medicines at the same time of day.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-11-1 | Two medicines at 08:00 | the clock reaches 08:00 | Kaabil asks about them one after the other, never in one confusing sentence |
| AC-DOSE-11-2 | A family with two persons | alerts arrive | each alert names the person and the medicine |

> Open question: ask once for "the morning tablets" or one by one. Test with real elders in the pilot.

### FR-DOSE-12 Reminder reaches a closed page — F (web push), L (native)

**Description.** A web push notification at the slot time brings the person to the app; one tap starts the spoken reminder. A web page cannot wake itself and speak, so this is the honest limit of a web app.

| AC | Given | When | Then |
|---|---|---|---|
| AC-DOSE-12-1 | Push allowed, page closed | slot time arrives | a notification appears with the medicine name in the person's language |
| AC-DOSE-12-2 | The person taps it | the page opens | Kaabil speaks the reminder at once (the tap counts as the required gesture) |
| AC-DOSE-12-3 | Push not allowed or unsupported | slot time arrives | the family is told at the missed-dose time (FR-DOSE-06) |
| AC-DOSE-12-4 | iOS Safari, app not installed to the home screen | push is requested | the app explains the install step; no false promise of a notification |

## Verification

| Kind | Where |
|---|---|
| Automated, P | 12 scenarios and unit tests in `packages/core` (`npm test`), also shown in the app's Test panel |
| Manual, P | README step list on a phone with Chrome: microphone, a Telugu voice, large buttons |
| F | API tests for idempotency and the server timer; a closed-phone test |
