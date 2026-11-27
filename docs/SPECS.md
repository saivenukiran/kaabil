# Kaabil Hain Hum: Technical specification

What the prototype does and why is in [PRD.md](PRD.md). This document says how it is built, so you can check the claims against the code. Every number below is a constant or a test in this repository.

## 1. Repository layout

An npm-workspaces monorepo, run with [Turborepo](https://turborepo.dev).

| Path | What it is |
|---|---|
| `apps/web` | The React app: person screen, family screen, test panel, roadmap. Uses the browser's speech and `localStorage`. |
| `packages/core` | `@kaabil/core`: pure TypeScript with no browser, clock, storage or speech in it. The dose dialogue, the Yes/No word rules, the message tables, the medicine parser, the test scenarios. It is compiled without the DOM type library, so touching the browser from there fails the typecheck. |
| `turbo.json` | Tasks: `build`, `typecheck`, `test`, `dev`, with caching. |
| `Dockerfile`, `docker-compose.yml`, `nginx.conf` | Build and serve the static app on port 8080. |
| `scripts/hooks/pre-push` | Local checks before every push (GitHub Actions is not used). |

The finale will add apps next to `apps/web` (a server-side key proxy, a phone app) that import the same `@kaabil/core`.

## 2. Run and test

```bash
docker compose up --build        # http://localhost:8080, no keys, no .env
```

Without Docker (Node 24):

```bash
npm ci
npm run dev          # http://localhost:5173
npm run typecheck    # both packages
npm test             # 104 tests in packages/core
npm run build        # typecheck + production build into apps/web/dist
npm run check        # everything the pre-push guard runs
npm run smoke        # start the Docker image and check what it serves (needs Docker)
```

The Docker image build calls the web workspace's own build script, so the container does not need Turborepo to run.

## 3. Architecture

```
 microphone ──► SpeechPort ──► text ──► interpret() ──► Intent ──► step() ──► Effects
 (browser)      (WebSpeech)             word rules       (pure)    (pure)     alert / say / log
                                                                                   │
 speaker ◄── SpeechPort ◄── say(MessageKey, language) ◄── engine over AppState ◄───┘
                                                                  │
                                                          localStorage (one JSON document)
                                                          storage event keeps tabs in sync
```

| Part | File | Role |
|---|---|---|
| Speech port | `apps/web/src/voice/speechPort.ts` | One interface for listening and speaking. `WebSpeechPort` in the browser; the tests drive the logic with scripted text instead. Cloud speech plugs in here. |
| Word rules | `packages/core/src/voice/words.ts` | `interpret(text)` returns one `Intent`; `detectLang(text)` picks the reply language. |
| Dialogue | `packages/core/src/dose/dialogue.ts` | `step(session, input, context)` is a pure function. It has no clock, storage or speech. |
| Engine | `packages/core/src/dose/engine.ts` | Applies `step()` to the whole `AppState`: time, doses, alerts, transcripts, consent. |
| Languages | `packages/core/src/i18n/languages/` | One file per language (`te.ts`, `en.ts`): the 12 spoken messages, the Yes/No and other word lists, state and button words, the speech locale, the script, and the person-screen strings. `index.ts` is the registry. See section 4b. |
| Messages | `packages/core/src/i18n/messages.ts` | `render()` and `ui()` read the registry; an untranslated string falls back to English, never to silence. |
| Phrase packs | `packages/core/src/i18n/packs.ts` | Nine more languages as data (Yes/No words, numbers), unreviewed. |
| Store | `apps/web/src/store.ts` | Holds `AppState`, saves it, and syncs open tabs. |

Spoken output is one of 12 fixed `MessageKey`s: `remind`, `confirm_log`, `logged`, `snooze`, `already_logged`, `not_logged`, `clarify`, `escalated`, `emergency`, `buttons`, `help`, `stopped`. Kaabil does not generate free text, so it cannot say something we did not write.

## 4. Word rules (`interpret`)

| Intent | Meaning |
|---|---|
| `emergency` | A phrase such as "ఛాతీ నొప్పి", "chest pain", "सीने में दर्द", "I fell". Checked first, and it beats everything. |
| `stop`, `help`, `repeat` | Work anywhere in the conversation. |
| `claim` | "I took it" ("వేసుకున్నాను", "दवाई ले ली"). |
| `yes`, `no` | The word lists of every registered language, merged (so a sentence that mixes Telugu and English is understood). |
| `notyet` | "Not yet", "later" ("ఇంకా లేదు"). |
| `mixed` | Contains both a Yes and a No. Never acts. |
| `unclear` | Anything else. Counts as nothing. |

Rules that matter:

1. Telugu negation is a verb ending. Words ending in లేదు, లేను, లేవు or లేరు are read as No, so "వేసుకోలేదు" (did not take) is No, not a claim.
2. Any No beats any Yes or claim.
3. Text is normalised first (Unicode NFC, zero-width joiners removed), so the same word typed two ways matches.
4. The speech model's confidence is not used. Text in, intent out.

## 4b. Languages and how to add one

The prototype speaks Telugu (primary) and English. A language is one `LanguageDef` object in `packages/core/src/i18n/languages/<code>.ts`, registered in `index.ts`; the code holds no native-language text anywhere else. The language switch, the reply-language detection (by script), the speech locale, the state and button words, the word rules and the Roadmap list all read the registry, so adding a language is one file and one line. `languages.test.ts` fails with the name of anything missing. Person-screen strings that are not translated yet show in English. Family screens are English only for now. Steps: `packages/core/src/i18n/languages/README.md`.

## 5. Dose dialogue

States (`Phase`): `asked`, `confirming`, `snoozed`, `logged`, `escalated`.

| From | Heard or time passes | To | Effect |
|---|---|---|---|
| (none) | Demo clock reaches a scheduled time | `asked` | say `remind` |
| `asked`, `snoozed`, `escalated` | claim (outside the 4-hour window) | `confirming` | say `confirm_log` ("నమోదు చేయనా?") |
| `asked`, `snoozed`, `escalated` | a bare yes, mixed or unclear | unchanged | say `clarify`; the second unclear answer also shows the buttons |
| `asked`, `snoozed`, `escalated` | no, or not yet | `snoozed` | say `snooze`; 10 minutes |
| `asked` | no answer for 10 minutes | `asked` (second reminder) | say `remind` once more |
| `asked` | still no answer 10 minutes after the repeat (20 in total) | `escalated` | alert `missed_dose`, say `escalated` |
| `confirming` | yes | `logged` | record the dose, say `logged` |
| `confirming` | no, or a negated verb | `asked` | say `not_logged`; nothing recorded |
| `confirming` | not yet, mixed or unclear | `confirming` | say `clarify`; never act |
| `confirming` | no answer for 2 minutes | `asked` | back to the reminder |
| `snoozed` | 10 minutes pass | `asked` | say `remind`; this counts as the one repeat, so 10 more minutes of silence alerts the family |
| `logged` | claim again | `logged` | say `already_logged`; alert `double_dose` if within 4 hours |
| any | emergency | unchanged | show the 112 button; alert `emergency` |

Constants (`dialogue.ts`):

| Constant | Value |
|---|---|
| `REPEAT_AFTER_MS` | 10 minutes |
| `SNOOZE_MS` | 10 minutes |
| `CONFIRM_TIMEOUT_MS` | 2 minutes |
| `DOUBLE_DOSE_WINDOW_MS` | 4 hours |
| `MAX_SILENCES` | 2 (re-prompt twice, then show the buttons) |
| `MAX_UNCLEAR` | 2 |

In the browser, the microphone opens 300 ms after Kaabil stops speaking, and waits 6 seconds for an answer.

Alerts are sent only with the family's consent (`consent.missedDose`, `consent.emergency`). Each reminder fires once per dose per day (`handled` holds the slot ids).

## 6. Data model

`AppState` is one JSON document, version 1, saved in the browser:

| Field | Content |
|---|---|
| `lang`, `person` | Language and how to address the person (for example "అమ్మ") |
| `medicines` | Name, strength, times of day as `HH:MM` |
| `consent` | Missed-dose alerts, emergency alerts |
| `clockMs` | The demo clock. It moves only when "Advance demo time" is pressed, so a reminder can be shown in seconds. |
| `session`, `handled` | The current dose conversation; slots already reminded |
| `doses`, `alerts` | The log and the alerts, each with its delivery status. Push shows "not set up in this prototype", so the screen never claims a delivery that did not happen. |
| `transcripts` | Text only |

The family adds medicines with a line such as `Metformin 500, 1-0-1` (morning, none, night; times can be edited). `BD`, `OD` and `TDS` map to 08:00 / 14:00 / 21:00.

## 7. Test coverage

`npm test` runs 104 tests (Vitest) in `packages/core`:

| Group | What it covers |
|---|---|
| Word rules | Yes, No and claim words in Telugu and English; negation endings; mixed answers; emergency phrases; reply-language detection |
| Language registry | Every registered language is complete (12 messages, word lists, state and button words, a valid locale, 112 in the emergency message, no word both Yes and No); a made-up language added in the test works with no code change |
| Engine and dialogue | The transitions in section 5 and the time limits |
| Medicine parser | Valid and invalid lines, `BD`/`OD`/`TDS` |
| Safety properties | Run on thousands of generated sentences and 300 random conversations (seeded, so a failure repeats): a dose is recorded only after a claim and an explicit Yes, once per slot; a sentence with a No is never read as Yes or as a claim; alerts and the "family told" sentence need consent. Checked by changing the code on purpose: each break makes the matching test fail |
| Voice report | Picking a phone's voice for a language (exact locale first, underscore tags such as `te_IN`, no prefix mistakes) and the plain-text report |
| 12 scenarios | `log-telugu`, `confirm-no`, `negated-verb`, `not-yet`, `snooze-returns`, `no-answer-alert`, `claimed-again`, `mixed-yes-no`, `bare-yes`, `emergency`, `english`, `silence-buttons` |

The same 12 scenarios run in the app's **Test panel** tab, which shows expected versus actual for each. They run against the real engine, with no mocks of the logic.

## 8. Security and privacy

| Area | What we do |
|---|---|
| Secrets | None in the repository or the browser bundle. `.env.example` lists the names of finale keys with empty values. Cloud speech and vision are "key not set" placeholders, and the finale will keep their keys in a server-side proxy only. |
| Data | Text transcripts only, in the browser's `localStorage`. Audio is never stored or sent by our code. "Delete all data" erases everything. |
| Browser speech | In Chrome, the Web Speech API may send audio to the browser vendor's service. We do not control that. |
| Container | Non-root nginx, all Linux capabilities dropped, `no-new-privileges`. |
| HTTP headers | Content-Security-Policy limited to our own origin, `nosniff`, no referrer, no framing, microphone and camera limited to our own origin. |
| Prompt injection | No language model reads user text in this prototype. At the finale, text inside photos or messages is treated as data, never as instructions. |
| Commits | A pre-push guard blocks secrets, personal emails, local paths, env files and attribution lines, and runs typecheck, tests and build. |

## 9. Known limits

| Limit | Effect |
|---|---|
| Family and person screens share one browser | Cross-device alerts need the finale's server and push notifications |
| Web Speech API needs Chrome and a secure origin (`localhost` counts) | Other browsers fall back to buttons and typing |
| Telugu recognition and the Telugu voice on phones are unmeasured | See the "not verified" list in the PRD |
| Telugu wording is unreviewed by a native speaker | Treat it as a draft |
| A web app cannot guard links in other apps or wake in the background | Needs a native app |
