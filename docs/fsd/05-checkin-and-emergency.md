# 5. Daily check-in and emergency (CHK)

Release P: emergency phrases and the SOS button are built; the daily check-in is a labelled placeholder. Legend: [README](README.md).

## Rules

| # | Rule |
|---|---|
| C1 | Kaabil never diagnoses, never says a symptom is safe, and never tells the person to wait. In an emergency it shows the way to call 112 and tells the family. |
| C2 | Emergency is checked first and beats every other intent and every other conversation. |
| C3 | A web page cannot place a call by itself. The person taps the call button. Kaabil does not claim it called anyone. |
| C4 | Check-in answers are classified by word rules, like doses. Uncertain means ask again, then show buttons. |
| C5 | Kaabil never tells the person that the family was alerted unless the alert was really created (consent on). |

## Requirements: emergency

### FR-CHK-01 Emergency phrases — P, built

**Description.** Phrases such as "ఛాతీ నొప్పి" (chest pain), "పడిపోయాను" (I fell) and "chest pain", "I fell". Telugu phrases match as substrings because words carry suffixes (పడిపోయారు, పడిపోయాను).

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-01-1 | Any phase, or no conversation | the person says "ఛాతీ నొప్పి" | the 112 button is shown and the `emergency` message is spoken, naming 112 |
| AC-CHK-01-2 | Emergency consent on | the same phrase | one `emergency` alert is created for the family |
| AC-CHK-01-3 | A dose conversation is in `confirming` | an emergency phrase | the emergency flow runs; no dose is recorded by that sentence |
| AC-CHK-01-4 | A sentence with an emergency phrase and a Yes | it is heard | emergency wins |
| AC-CHK-01-5 | Telugu with a suffix, "పడిపోయారు" | it is heard | recognised as emergency |

### FR-CHK-02 SOS button — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-02-1 | Any screen state | the person presses SOS | same result as an emergency phrase |
| AC-CHK-02-2 | The 112 button is shown | the person presses it | the phone's dialler opens with 112 (where the device supports it) |
| AC-CHK-02-3 | The 112 button is shown | the person dismisses it | it hides; the alert for the family stays |
| AC-CHK-02-4 | Emergency consent off | SOS is pressed | the 112 button is shown; no family alert exists and Kaabil says nothing about alerting them |

### FR-CHK-03 Emergency wording is reviewed — P draft, F reviewed

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-03-1 | The emergency message in each language | `npm test` runs | it contains 112 |
| AC-CHK-03-2 (F) | A native speaker and a doctor review the emergency list | the list is changed | it is changed in the language file only, with a test for each new phrase |

> Open question: which phrases beyond chest pain and a fall belong in the list (breathlessness, bleeding, stroke signs). Needs a clinician's input before the pilot.

### FR-CHK-04 Emergency with a location — L (native app)

**Description.** A native app could read the phone's location and include it in the family alert, after consent. A web page can ask for location only with a permission prompt that elders will not manage well, so it is not in scope for P or F.

## Requirements: daily check-in (placeholder in P)

### FR-CHK-05 Daily check-in conversation — F

**Description.** Once a day at a time the family sets, Kaabil asks two things in the person's language: how are you, and did you eat. The answers are classified with word rules and fixed messages. Kaabil says nothing about health.

| Answer | Meaning | Kaabil does |
|---|---|---|
| "బాగున్నాను" (I am fine) | fine | says a short thanks (`checkin_ok`), records "fine" |
| "బాగాలేదు" (not well) | not fine | says it will tell the family (`checkin_notwell`) if consent is on; creates a `not_well` alert |
| An emergency phrase | emergency | the emergency flow (chapter 5, FR-CHK-01) |
| No answer after two prompts | none | records "no answer"; after one more attempt 30 minutes later, a `no_checkin` alert if consent is on |
| Unclear | unclear | asks again, then shows buttons (I am fine / not well) |

New fixed messages (`checkin_ask`, `checkin_eat`, `checkin_ok`, `checkin_notwell`) are added to every language file and reviewed by a native speaker before use (FR-LANG-07).

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-05-1 | Check-in time 09:00 | the clock reaches it | `checkin_ask` is spoken |
| AC-CHK-05-2 | The person says "బాగున్నాను" | it is heard | `checkin_ok`; "fine" is recorded for today |
| AC-CHK-05-3 | The person says "బాగాలేదు", consent on | it is heard | a `not_well` alert is created and `checkin_notwell` is spoken |
| AC-CHK-05-4 | The person says "బాగాలేదు", consent off | it is heard | no alert exists; Kaabil does not say the family was told |
| AC-CHK-05-5 | No answer to two prompts | the time passes | "no answer" is recorded; a second attempt follows in 30 minutes |
| AC-CHK-05-6 | A dose conversation is active | check-in time arrives | the dose conversation finishes first; the check-in follows |

### FR-CHK-06 Check-in history for the family — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-06-1 | Seven days of check-ins | the family opens the dashboard | each day shows fine, not well, or no answer |
| AC-CHK-06-2 | Three days in a row of "no answer" | the third day ends | an optional family notice suggests a phone call (a suggestion, not a diagnosis) |

### FR-CHK-07 Check-in setting — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-07-1 | Setup | the family sets the check-in time and turns it on or off | the change applies from the next day |
| AC-CHK-07-2 | The check-in is off | the day passes | nothing is asked and no alert is raised |

## Placeholder behaviour in P

| AC | Given | When | Then |
|---|---|---|---|
| AC-CHK-P-1 | The daily check-in screen | it opens | it is labelled "placeholder" and nothing is spoken or recorded |
| AC-CHK-P-2 | The Roadmap | it opens | it lists the check-in as not built |

## Verification

| Kind | Where |
|---|---|
| Automated | Scenario `emergency`; word-rule tests for each emergency phrase; completeness test (112 in the message). F: scenario tests for each check-in answer |
| Manual | Real phone: the 112 button opens the dialler |
| Pilot | A clinician reviews the emergency list and the not-well wording |
