# Kaabil Hain Hum: Product Requirements (PRD)

Status: Round 2 prototype. This document says what we are building, for whom, and how we will know it works. What is built today, and what is not, is in the [status table](#7-status-today). How it is built is in [SPECS.md](SPECS.md).

## 1. Problem

Many people depend on someone else to operate or check their phone. They cannot read the small print on a medicine strip, so doses are missed, doubled or mixed up. Their family lives elsewhere and learns that something is wrong too late. Scam messages ("your KYC has expired, click here") reach them, and one tap on a bad link or one OTP given to a caller can empty their savings.

## 2. Users

| User | Who | What they need |
|---|---|---|
| **Person** | Elders, people with low vision or low literacy, patients after a stroke or with diabetes or high blood pressure, first-time smartphone users | Speak in their own language, hear a short answer, never hunt for a small button |
| **Family member** | A relative who lives elsewhere and sets the app up | See what happened today, get told early when something is wrong, change the plan by typing |

How many people this reaches (pools, not users; they overlap, so they are not added):

| Group | Size | Source |
|---|---|---|
| Indians aged 60 or over | about 149 million (10.5%), 2022 | UNFPA |
| Indians living with a disability | about 2.2% | NSS 2018 |
| First target: Telugu-speaking people over 60 in Andhra Pradesh and Telangana | roughly 10 million | our estimate from state population shares of 11 to 12%; no published headcount found |

## 3. Product idea

One voice companion, so the person never learns four apps. The person talks to Kaabil, mostly in Telugu. A relative sees the result on a family dashboard.

| Capability | What it does | Prototype |
|---|---|---|
| Medicine care | Reminds at the right time, hears "వేసుకున్నాను", reads it back, logs the dose after a spoken Yes. A missed dose is repeated once, then the family is told. A second claim for the same dose is refused and flagged. | **Built (core flow)** |
| Pill check | The camera reads a strip aloud and compares it with the family-confirmed list. Never identifies a pill by looks. | Placeholder |
| Daily check-in | Once a day: "How are you? Did you eat?" Emergency phrases show a 112 button and alert the family. | Emergency phrases built; check-in is a placeholder |
| Link guard | A risky link opens nothing until the person confirms twice. | Placeholder |
| Send to family | "Tell my son the medicine is finished"; the reply is read aloud. | Placeholder |

Languages: the prototype works in Telugu (first) and English. Every word in a language lives in one file, so adding a language is one new file (see `packages/core/src/i18n/languages/README.md`). Nine more Indian languages (Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia) are data-only phrase packs, not yet reviewed by native speakers.

Platform: a mobile-first web app (PWA). Native apps come later, because only a native app can guard links inside other apps or wake in the background.

## 4. Requirements for the core flow (medicine dose by voice)

| # | Requirement | How we check it |
|---|---|---|
| R1 | At the scheduled time Kaabil speaks the reminder in the person's language, in two short sentences. | Scenario `log-telugu` |
| R2 | A dose is logged only after a claim ("I took it") **and** an explicit Yes. | `log-telugu`, `bare-yes` |
| R3 | Uncertainty never counts as Yes. If Kaabil is unsure it asks again, then shows large Yes/No buttons. | `silence-buttons`, `mixed-yes-no` |
| R4 | A negated claim is a No. In Telugu negation is a verb ending, so "వేసుకోలేదు" (did not take) is No. Any No beats any Yes. | `negated-verb`, `confirm-no` |
| R5 | "Not yet" snoozes for 10 minutes, then Kaabil reminds once more. | `not-yet`, `snooze-returns` |
| R6 | No answer: repeat once at 10 minutes, alert the family at 20 minutes (with consent). | `no-answer-alert` |
| R7 | A second claim for a dose within 4 hours is refused, and the family is flagged. | `claimed-again` |
| R8 | Emergency words ("ఛాతీ నొప్పి", chest pain) show a 112 call button and alert the family. Kaabil never diagnoses. | `emergency` |
| R9 | Works in Telugu and English, and replies in the language the person used. A new language needs one file and passes the completeness test. | `english`, `languages.test.ts` |
| R10 | Works without a microphone or a Telugu voice: Yes/No buttons and a text box do the same job. | Manual: README, step 6 |
| R11 | The family sets up medicines by typing a line such as `Metformin 500, 1-0-1` (morning and night). | Unit tests for the parser |
| R12 | Only text transcripts are kept, in the browser. Audio is never stored. "Delete all data" erases everything. | Code review: `deleteAllData` |

## 5. Safety rules (non-negotiable)

- Kaabil gives no medical advice, never says a dose is safe, and never identifies a pill by its look.
- Word rules decide Yes and No. The speech model only supplies text, so a confident-but-wrong guess cannot log a dose.
- Kaabil never asks for an OTP or a PIN.
- The family sees every logged dose, so a wrong log can be caught.
- It is not a medical device, and the screen says so.

## 6. How we will know it works

These are targets for a pilot, not results. We have not run the pilot.

| Measure | Target |
|---|---|
| Pilot | 8 weeks, 30 elders and their families through a senior-citizen association: 2 weeks baseline (pill counts, family diaries), then 6 weeks with Kaabil |
| Confirmed doses taken on time | 85% or more; missed doses fall by half |
| Tasks done by voice without help | 80% |
| Telugu recognition on a fixed set of 40 phrases, including 65 dB background noise | 85% or more |
| Family alert arrives | within 3 seconds when online |
| Still used weekly at the end | 70% |
| Link guard (finale) | 0 of 6 risky links opened, 0 of 4 safe links wrongly blocked |

Main risk: speech recognition is weakest for the people we serve (slurred or slow speech, strong accents, noisy homes, Telugu mixed with English). A misheard "yes" could log a dose that was not taken. Our limits are the fixed confirmation rules, the button fallback, and the family seeing every dose. We will measure recognition with real elders before claiming any result.

## 7. Status today

| Area | Status |
|---|---|
| Medicine reminder, spoken confirmation, dose log | Works in Telugu and English |
| Yes/No by word rules | Works; 104 automated tests pass |
| Missed-dose, repeated-dose and emergency alerts | Work on the family view in one browser; push notifications are not set up |
| Family setup from text | Works |
| Pill check, daily check-in, link guard, send to family | Placeholders |
| Cloud Indic speech and the vision model | "Key not set" placeholders; the prototype needs no keys |
| Nine more language packs (Hindi and eight others) | Data only |

**Not verified yet** (we say so rather than guess):

- `docker compose up --build` has not been run on the machine that built this repo (it has no Docker). The compose file and the image build are written to be standard.
- Real microphone and Telugu speech recognition on a phone.
- A Telugu text-to-speech voice on a phone. On the Windows PC that built this repo, the Voice check tab found 22 browser voices and none for Telugu, so there Kaabil shows each Telugu sentence large on screen instead of speaking it (English is spoken). A phone's Telugu voice depends on its installed speech engine and is not measured.
- The Telugu wording has not been reviewed by a native speaker.

## 8. Out of scope for this prototype

Payments, a backend and accounts, push notifications, native apps, background wake word, real camera pill reading, real link interception, clinical claims.

## 9. Dependencies and fallbacks

| Dependency | Used for | If it fails |
|---|---|---|
| Browser speech recognition (Chrome) | Hearing the person | Yes/No buttons and a text box |
| Browser text-to-speech with a Telugu voice | Speaking | The same sentence is shown large on screen |
| Cloud Indic speech (finale, server-side key) | Better recognition after two failures | Browser recognition, then buttons |
| Vision model (finale) | Pill check | Ask the family |
| Network | Family alerts across devices (finale) | In-app alert on the same device; dose logs sync later |

## 10. Launch plan

| Stage | What |
|---|---|
| 1. Round 2 prototype | This repo: one core flow, labelled placeholders, runs from `docker compose up` with no keys |
| 2. Finale build | Server-side proxy for cloud speech and vision keys, push alerts for the family, pill check and link guard on a demo inbox |
| 3. Pilot | 30 elders with a senior-citizen association, measured against the targets in section 6 |
| 4. Native apps | Link guard across apps and background wake word |
