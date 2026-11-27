# 4. Medicines, alerts and the family view (MED, ALERT)

How the family sets up the plan, and how they find out what happened. Legend: [README](README.md).

## Scope

| In scope | Out of scope |
|---|---|
| Typing a medicine line, editing times, removing a medicine; dose history; alerts and their delivery; consent for alerts | Checking what the doctor prescribed; dose calculation; stock or refill ordering; payments |

## Rules

| # | Rule |
|---|---|
| M1 | The family confirms every medicine before it is saved. A parse is only a proposal. |
| M2 | Kaabil never suggests, changes or removes a medicine by itself. |
| M3 | The family sees every logged dose and every alert, so a wrong log can be caught. |
| M4 | An alert is created only with the family's consent (missed dose, emergency). A repeated-dose flag is always shown in the app. |
| M5 | The screen never says an alert was delivered unless it was. Delivery is stored per channel. |

## Requirements: medicines

### FR-MED-01 Add a medicine from one typed line (R11) — P, built

**Description.** The family types `name strength, pattern`. The pattern is three numbers for morning, noon and night (`1-0-1`), or `OD`, `BD`/`BID`, `TDS`/`TID`. Default times are 08:00, 14:00 and 21:00 and can be edited.

| AC | Given | When | Then |
|---|---|---|---|
| AC-MED-01-1 | The text `Metformin 500, 1-0-1` | it is parsed | name Metformin, strength 500, times 08:00 and 21:00 |
| AC-MED-01-2 | The text `Aspirin 75 mg, BD` | it is parsed | strength `75mg`, times 08:00 and 21:00 |
| AC-MED-01-3 | `TDS` or `1-1-1` | it is parsed | times 08:00, 14:00, 21:00 |
| AC-MED-01-4 | An empty line, no comma, an unreadable strength or pattern, or `0-0-0` | it is parsed | no medicine is created and the message names what to fix, in plain words |
| AC-MED-01-5 | A valid line | the family sees the proposal | the times are shown and nothing is saved until the family confirms |

**Known limit (P):** three daily slots only, one digit per slot, units `mg`, `mcg`, `g` or `ml`. A pattern with four doses a day or a weekly medicine is rejected with a message. See FR-MED-04.

### FR-MED-02 Edit times and remove — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-MED-02-1 | A proposal with times | the family edits a time to a valid `HH:MM` and saves | the medicine is saved with the new time; saving a line with the name of an existing medicine replaces its strength and times, from the next dose |
| AC-MED-02-2 | A time such as `25:00` or `9:5` | it is entered | the Save button stays disabled until every time is valid |
| AC-MED-02-3 | A saved medicine | the family removes it | no further reminders for it; past doses stay in the history |
| AC-MED-02-4 | A conversation about the medicine is active | it is removed | the conversation ends without logging |

### FR-MED-03 Dictation of the line — P if the browser supports it

| AC | Given | When | Then |
|---|---|---|---|
| AC-MED-03-1 | The family dictates "Metformin 500 1-0-1" | the text arrives | it goes through the same parser and the same confirmation (M1) |
| AC-MED-03-2 | Dictation is unavailable | the field is shown | typing works and nothing is shown that implies dictation |

### FR-MED-04 Richer schedules — F

**Description.** Any number of doses a day, "with food" notes, weekly or alternate-day schedules, a start and end date, and a pause. Free text from the family is shown as written and is never interpreted by a language model.

| AC | Given | When | Then |
|---|---|---|---|
| AC-MED-04-1 | A medicine every second day | the schedule is saved | reminders fire only on those days |
| AC-MED-04-2 | An end date | it passes | the medicine stops reminding and moves to "finished" |
| AC-MED-04-3 | A pause | it is active | no reminders and no missed-dose alerts; the family view shows "paused" |

### FR-MED-05 Several people in one family — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-MED-05-1 | A family looks after two persons | the dashboard opens | the family picks a person; every list is for one person |
| AC-MED-05-2 | A medicine is saved | its owner is checked | it belongs to exactly one person |

## Requirements: alerts

### FR-ALERT-01 Alert kinds and when they are raised — P, built

| Kind | Raised when | Needs consent |
|---|---|---|
| `missed_dose` | No answer 20 minutes after the slot (chapter 1, FR-DOSE-06) | Yes (`missedDose`) |
| `double_dose` | A second claim within 4 hours (FR-DOSE-07) | No (always shown in the app) |
| `emergency` | An emergency phrase or the SOS button (chapter 5) | Yes (`emergency`) |

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-01-1 | Consent for missed doses is off | a dose is missed | no alert exists; Kaabil does not say the family was told |
| AC-ALERT-01-2 | An alert for slot S exists | the engine sees the same miss again | no second alert for S |
| AC-ALERT-01-3 | Consent for emergencies is off | the person says "ఛాతీ నొప్పి" | the 112 button is shown, no family alert is created, and the person is not told the family was alerted |

### FR-ALERT-02 Delivery per channel — P in-app; live delivery to the family built (backend); push not built

**Description.** Each alert stores a delivery status per channel (in-app, push, later SMS or a call). P delivers in the app only and says so.

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-02-1 (P) | An alert is created | the family screen is open in the same browser | it shows with in-app "delivered" and push "not set up in this prototype" |
| AC-ALERT-02-2 (F) | An alert is created on the server | a family member has push allowed | a push is sent and the delivery status becomes `sent` or `failed` with a reason |
| AC-ALERT-02-3 (F) | A push fails | the status is saved | the alert stays unacknowledged and is retried, then shown as "not delivered" in the app |
| AC-ALERT-02-4 (F) | A family member has the dashboard open | an alert is created | it appears within 3 seconds (95th percentile, measured) without a reload |

### FR-ALERT-03 Acknowledge and escalate to a second family member — P acknowledge; acknowledge built (backend); escalation not built

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-03-1 (P) | An unacknowledged alert | the family presses Acknowledge | it is marked acknowledged with the time |
| AC-ALERT-03-2 (F) | An alert stays unacknowledged for 15 minutes (value to be tuned) | the time passes | the next family member in the order set at setup is notified |
| AC-ALERT-03-3 (F) | A family member acknowledges | other members open the dashboard | they see who acknowledged and when |

### FR-ALERT-04 Quiet hours and noise control — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-04-1 | Quiet hours are set for non-urgent alerts | a missed dose happens in them | the alert is held and shown at the end, but an emergency is never held |
| AC-ALERT-04-2 | Many alerts in a short time | the family looks | alerts of the same kind and medicine are grouped, none is dropped |

## Requirements: family history

### FR-ALERT-05 Dose history — P today's list, F history

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-05-1 (P) | Doses were logged today | the family screen opens | each shows medicine, time and `voice` or `button` |
| AC-ALERT-05-2 (F) | The family picks a date range | the history opens | taken, missed and flagged doses are listed per day, with a weekly summary |
| AC-ALERT-05-3 (F) | A dose was logged by button | it is shown | it says so, because a button press is weaker evidence than a heard answer |

### FR-ALERT-06 Family correction of a wrong log — F

**Description.** If a dose was logged wrongly (the person pressed Yes by mistake), a family member can mark it "not actually taken". The original record is kept with the correction and its author.

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-06-1 | A logged dose | a family member corrects it | the dose shows as corrected, with who and when; the original stays in the audit history |
| AC-ALERT-06-2 | A corrected dose | the family exports or reads the history | the correction is visible, not hidden |

### FR-ALERT-07 Consent changes — P toggles, F recorded

| AC | Given | When | Then |
|---|---|---|---|
| AC-ALERT-07-1 (P) | A consent toggle | it is changed | it applies from the next alert |
| AC-ALERT-07-2 (F) | A consent is changed | it is saved | who changed it and when is recorded (chapter 10) |

## Verification

| Kind | Where |
|---|---|
| Automated | `medicineParser` unit tests; engine tests for consent and for no second alert per slot; scenarios `no-answer-alert`, `claimed-again`, `emergency` |
| F | API tests for alert idempotency and delivery status; a timed test from alert creation to family screen (target 3 s, 95th percentile) |
| Manual | The family screen on a phone, with push on and off |
