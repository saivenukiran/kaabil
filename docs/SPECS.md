# Kaabil Hain Hum: Technical specification

What the prototype does and why is in [PRD.md](PRD.md). This document says how it is built, so you can check the claims against the code. Every number below is a constant or a test in this repository.

## 1. Repository layout

An npm-workspaces monorepo, run with [Turborepo](https://turborepo.dev).

| Path | What it is |
|---|---|
| `apps/web` | The React app: person screen, family screen, test panel, roadmap. Uses the browser's speech and `localStorage`. **Not connected to the backend yet.** |
| `apps/api` | The backend: family sign-in, care groups, pairing, plan sync, doses, alerts, live events, the server's missed-dose check, and the plain test console at `/dev`. Section 3b. |
| `packages/contract` | `@kaabil/contract`: the request and response schemas (Zod), their types, and a typed client with a live-event reader. The app and the API both import it, so a drift between them fails loudly. |
| `packages/db` | `@kaabil/db`: the database schema (Drizzle, Postgres) and the generated SQL migrations. |
| `packages/voice` | `@kaabil/voice`: the speech port (Web Speech API), the framework-free voice turn loop, the player that uses a family member's recording instead of the synthetic voice, and the audio processing for recordings. |
| `apps/testpage` | A plain static page at `/test/`: the family phone and the person's phone side by side on the real backend. For testing the whole prototype. Section 3c. |
| `tests/e2e` | End-to-end scripts for TestSutra that drive the test page in a real browser. |
| `packages/core` | `@kaabil/core`: pure TypeScript with no browser, clock, storage or speech in it. The dose dialogue, the Yes/No word rules, the message tables, the medicine parser, the test scenarios. It is compiled without the DOM type library, so touching the browser from there fails the typecheck. |
| `turbo.json` | Tasks: `build`, `typecheck`, `test`, `dev`, with caching. |
| `Dockerfile`, `docker-compose.yml`, `nginx.conf` | One Dockerfile builds the `api` and `web` images. Compose runs `init` (random secrets into a volume), `db` (Postgres, not published), `api` (port 3000, not published) and `web` (nginx on port 8080, which also proxies `/api`). |
| `scripts/hooks/pre-push` | Local checks before every push (GitHub Actions is not used). |

A phone app at the finale will import the same `@kaabil/core` and `@kaabil/contract`. Cloud speech and vision will be added to `apps/api`, so their keys stay on the server.

## 2. Run and test

```bash
docker compose up --build        # http://localhost:8080, no keys, no .env
                                 # the test console is at http://localhost:8080/dev
```

Without Docker (Node 24):

```bash
npm ci
npm run dev          # http://localhost:5173
npm run typecheck    # every package
npm test             # 133 tests in packages/core, plus the tests of packages/contract and apps/api
                     # (the API tests run on an in-process Postgres: no Docker needed)
npm run build        # typecheck + production build into apps/web/dist
npm run check        # everything the pre-push guard runs
npm run smoke        # start the Docker image and check what it serves (needs Docker)
npm run e2e          # TestSutra end-to-end scripts against a running copy (set KAABIL_TESTSUTRA to its path)
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

## 3b. Backend (`apps/api`)

The browser talks to one origin. `web` (nginx) serves the app and proxies `/api` to the `api`; the `api` talks to `db`. The dose dialogue still runs on the person's phone (`@kaabil/core`); the server stores the results and guards the missed dose.

| Part | What it does |
|---|---|
| Sign-in | Better Auth: email and password (10 characters or more), a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` when the address is https, 30 days). Better Auth's organization plugin is the care group: the group id is the organization id, roles are `owner` and `member`. We write no password, session or role code. |
| Care group | One person and their family: how to address the person, language, two consent switches (missed dose, emergency), medicines. A medicine is added as the typed line (`Metformin 500, 1-0-1`, parsed by `@kaabil/core`) or as fields. |
| Pairing | The family member asks for a code: 8 digits, valid 10 minutes, works once, one live code per group; only its hash is stored. The family member types it on the person's phone, which receives a long random device token (only its hash is stored). The person never has an account, an OTP or a PIN, and never says or types the code. |
| The phone | With its token it can read its group's plan, post doses and alerts, and listen for events. It cannot use any family route. A revoked phone is refused at once. |
| Doses | One row per slot (`medicineId`, day and `HH:MM` joined by a vertical bar). The key is unique per group and slot, so a retry returns the first record and records nothing twice. |
| Alerts | `missed_dose` needs the missed-dose consent, `emergency` needs the emergency consent, `double_dose` is always recorded. A missed or repeated-dose alert is unique per slot (the database enforces it); each emergency is recorded. The answer says why an alert was not created. |
| Live events | Server-sent events: `dose`, `alert`, `plan`, `device`, `remind`, `ping` every 15 seconds. A family stream per group and a stream per phone. A stream closes when the session or the phone is revoked. The events are kept in memory in one process. |
| Missed-dose check | Every 60 seconds the server looks at every slot of every group with consent and a paired phone. A slot with no dose 22 minutes after its time raises one `missed_dose` alert, unless the medicine was added after that slot time. The phone's own alert (20 minutes) and this one cannot both exist. Times are read in `Asia/Kolkata` (`KAABIL_TZ`). |
| Voice | `GET /api/voice/status` says `key not set` for cloud speech and voice. The proxies arrive with a provider key. |
| Test console | `GET /dev`, only when `KAABIL_DEV_CONSOLE=1`: a plain page to drive and watch the whole flow. `POST /api/dev/remind-now` sends a `remind` event to the group's phones. |

The routes, bodies and answers are the schemas in `packages/contract`. Every error has the same shape, `{ "error": { "code", "message" } }`, with 400 (invalid body), 401, 403, 404 (also for another family's id), 413, 429.

## 3c. The test page and custom voice

**The test page** (`apps/testpage`, served at `/test/`) has two phones on one screen, both talking to the real backend. The family phone signs up, creates the care group, adds a medicine (typed line, or "due in 2 minutes"), makes a pairing code, sees doses and alerts live and can acknowledge them, and records its own voice. The person's phone pairs with the code (filled in for you, since both phones are on one page), runs the real dose dialogue from `@kaabil/core` with the shared voice loop, and reports every dose and alert to the backend; a failed send is retried every few seconds and nothing is marked sent until the server answers. It has the demo controls the app screens have (remind now, advance 10 minutes). It is a developer tool, labelled so.

**Custom voice.** A family member records their own voice reading one of Kaabil's fixed sentences, with the person's name and the medicine filled in. The server lists those sentences (`GET /api/care/groups/:id/voice`) and stores a recording only for a listed sentence, only with the recorder's consent (the `x-voice-consent` header), only if it is an allowed audio type whose first bytes match that type, and between 200 bytes and 1.5 MB. The person's phone asks for the list (the sentence each recording says, not a way to say anything else) and plays a recording instead of the synthetic voice only when it is about to say that exact sentence; otherwise, or if a recording cannot play, the synthetic voice speaks. A recording is retired when its sentence changes (a renamed medicine). Before upload the browser trims the silence, evens out the loudness and writes a small mono 16 kHz WAV (at most 15 seconds, about 32 KB a second). Recordings can be deleted one by one or all at once, and go with the group. This is the one place audio is stored; it is the family member's own voice, with their consent. Making synthetic speech in someone's voice (voice cloning) is not built.

**End-to-end scripts** (`tests/e2e`, `npm run e2e`) drive the test page with TestSutra: a dose answered with the buttons reaches the family live; an emergency and a missed dose alert the family, who acknowledge; a family member records their voice, the person's phone plays it, and the family deletes it.

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

`npm test` runs 133 tests (Vitest) in `packages/core`:

| Group | What it covers |
|---|---|
| Word rules | Yes, No and claim words in Telugu and English; negation endings; mixed answers; emergency phrases; reply-language detection |
| Language registry | Every registered language is complete (12 messages, word lists, state and button words, a valid locale, 112 in the emergency message, no word both Yes and No); a made-up language added in the test works with no code change |
| Engine and dialogue | The transitions in section 5 and the time limits |
| Medicine parser | Valid and invalid lines, `BD`/`OD`/`TDS` |
| Safety properties | Run on thousands of generated sentences and 300 random conversations (seeded, so a failure repeats): a dose is recorded only after a claim and an explicit Yes, once per slot; a sentence with a No is never read as Yes or as a claim; alerts and the "family told" sentence need consent. Checked by changing the code on purpose: each break makes the matching test fail |
| Voice report | Picking a phone's voice for a language (exact locale first, underscore tags such as `te_IN`, no prefix mistakes) and the plain-text report |
| Call rules | The call state machine (ring, answer, decline, busy, missed after 45 seconds, failed after 20 seconds without audio, one call at a time, never answered by itself) and the signalling parser (accepts exactly the messages we send, rejects wrong shapes, bad ids and oversized text, never throws; checked on 5,000 seeded random objects). The WebRTC calls themselves are not built yet |
| 12 scenarios | `log-telugu`, `confirm-no`, `negated-verb`, `not-yet`, `snooze-returns`, `no-answer-alert`, `claimed-again`, `mixed-yes-no`, `bare-yes`, `emergency`, `english`, `silence-buttons` |

The same 12 scenarios run in the app's **Test panel** tab, which shows expected versus actual for each. They run against the real engine, with no mocks of the logic.

## 8. Security and privacy

| Area | What we do |
|---|---|
| Secrets | None in the repository, the images or the browser bundle. The compose `init` service writes a random database password and session secret into a volume on first start; the API reads them from files. `.env.example` lists the names of finale keys with empty values. Cloud speech and vision are "key not set" placeholders, and their keys will live on the server only. |
| Data | The app screens keep text transcripts only, in the browser's `localStorage`; "Delete all data" erases them. The backend stores the family's account, the plan, dose records and alerts, and receives no transcripts. The person's audio is never stored or sent by our code. The one exception is a family member's recording of a fixed sentence (custom voice, section 3c), stored on the server with their consent so the person's phone can play it, and deletable one by one or all at once. Server-side deletion of a whole group is not built yet. |
| Browser speech | In Chrome, the Web Speech API may send audio to the browser vendor's service. We do not control that. |
| Containers | Non-root nginx and a non-root API with a read-only file system, all Linux capabilities dropped, `no-new-privileges`. Only port 8080 is published; the API and the database are reachable only inside the compose network (the smoke test checks ports 3000 and 5432). |
| Who may do what | Every family route checks that the signed-in user belongs to the group in the path; another family's id answers 404. A phone's token works only on `/api/device/*` for its own group. Better Auth handles passwords and sessions. |
| Input | Every body is parsed against a strict Zod schema (unknown fields are refused); JSON bodies over 64 KB get 413; database access goes through Drizzle with parameters. |
| Cross-site requests | A data-changing family request must carry an allowed `Origin` (or, with none, not be marked cross-site by the browser). The API and the app share one origin, so there is no CORS. |
| Guessing | Pairing: 10 tries a minute per address, an 8-digit code that lives 10 minutes and works once, and the same answer for a wrong, used or expired code. Sign-in: Better Auth's rate limit. The code and the device token are stored only as hashes. |
| API headers | `default-src 'none'`, `nosniff`, no referrer, no framing, `no-store` on every answer; `Strict-Transport-Security` only when the public address is https. |
| HTTP headers | Content-Security-Policy limited to our own origin, `nosniff`, no referrer, no framing, microphone and camera limited to our own origin. |
| Recordings | A recording is accepted only for a sentence Kaabil says to this person, with the recorder's consent, as an allowed audio type whose first bytes match it, and within a size limit. It is served with its stored type and `nosniff`, only to the group's family and to its own paired phones, and removed on delete or with the group. |
| Prompt injection | No language model reads user text in this prototype, and Kaabil speaks only the 12 fixed messages. At the finale, text inside photos or messages is treated as data, never as instructions. |
| Logs | Method, path, status and time only: no names, medicine names or transcripts. |
| Commits | A pre-push guard blocks secrets, personal emails, local paths, env files and attribution lines, and runs typecheck, tests and build. |

## 9. Known limits

| Limit | Effect |
|---|---|
| The app screens are not connected to the backend yet | The screens keep their state in the browser. The backend works and is tested; today the test console at `/dev` drives it across devices. Connecting the screens is the next step |
| Plain HTTP in the compose file | A public copy must sit behind HTTPS; a phone on a plain `http://` address cannot use the microphone |
| Push notifications are not set up | The family sees alerts live only while the dashboard is open |
| The test page retries a failed send every few seconds; the app screens do not exist on the backend yet | The screen must not say "the family was told" until the server answers |
| Custom voice is not verified on a real phone | Recording from a real microphone and playing the clip there are untested; the end-to-end test uploads a generated file. Recordings are stored in the database (1.5 MB at most each) |
| Live events are in memory in one process | A restart closes the streams; clients reconnect. One server is a single point of failure |
| Web Speech API needs Chrome and a secure origin (`localhost` counts) | Other browsers fall back to buttons and typing |
| Telugu recognition and the Telugu voice on phones are unmeasured | See the "not verified" list in the PRD |
| Telugu wording is unreviewed by a native speaker | Treat it as a draft |
| A web app cannot guard links in other apps or wake in the background | Needs a native app |
