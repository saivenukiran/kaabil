# Kaabil Hain Hum

A voice-first companion for people who depend on family to operate their phone: elders, people with low vision or low literacy, and patients recovering from a stroke or living with diabetes. The person talks to the app, mostly in Telugu; a relative sees what happened on a family dashboard.

This is the **Round 2 prototype**: one core flow that works end to end (medicine reminders and dose logging by voice), on a real backend: a family member signs in, pairs the person's phone with a one-time code, and sees doses and alerts arrive live. Everything else is a labelled placeholder. The full product is built at the finale.

## Run it

You need Docker. No API keys and no `.env` file are needed.

```bash
docker compose up --build
```

This starts four services: `init` writes random secrets (database password, session secret) into a volume on first start, `db` is Postgres (not reachable from outside), `api` is the backend, and `web` serves the app on one port and proxies `/api` to the backend. `docker compose down -v` removes the data and the secrets for a clean start.

Open <http://localhost:8080> in Chrome (it uses the browser's speech recognition; `localhost` counts as a secure page, so the microphone works). A phone on the same network sees a plain `http://` address, which is not a secure page, so its microphone is blocked there; use a tunnel with HTTPS for a two-phone demo, and set `KAABIL_BASE_URL` and `KAABIL_TRUSTED_ORIGINS` to that address.

### The test page

<http://localhost:8080/test/> is a plain page with the **family phone** and the **person's phone** side by side, both on the real backend. Sign up, create the care group, add `Metformin 500, 1-0-1` (or a medicine due in 2 minutes), make a pairing code (it is filled in on the person's phone), press **Remind now**, and answer with the buttons, the microphone or the text box. The family side shows the dose or alert as it happens. The family phone can also **record its own voice** reading Kaabil's sentences; the person's phone then plays that recording instead of the synthetic voice. `npm run seed` makes a fictional demo family (Amma, Telugu, two medicines) and prints a fresh pairing code, so a demo starts in seconds. Run the three end-to-end scripts with TestSutra: `npm run e2e` (set `KAABIL_TESTSUTRA` to the path of `testsutra-windows-x64.exe`).

### The test console

Until the app screens are connected to the backend, <http://localhost:8080/dev> is a plain developer page that drives the whole backend flow: sign up, create the care group, add `Metformin 500, 1-0-1`, make a pairing code, act as the person's phone (pair, log a dose, raise an alert), and watch the family side update live. It is switched on by `KAABIL_DEV_CONSOLE=1` (the default in this compose file) and must be off in any real deployment.

Check that it started and serves safely (needs Docker, or a running copy):

```bash
npm run smoke                          # builds and starts the image, checks it, stops it
npm run smoke -- http://localhost:8080 # checks a copy that is already running
```

Without Docker (Node 24):

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit and API tests (the API tests run on an in-process Postgres, no Docker needed)
npm run build      # typecheck + production build
```

## Try the core flow (about 90 seconds)

1. Open **Side by side**, so the person screen and the family dashboard are visible together.
2. Tap the big start button once. It unlocks speech and the microphone.
3. Press **Advance 1 min** until the demo clock reaches 08:00. Kaabil speaks the reminder in Telugu.
4. Say **"వేసుకున్నాను"**. Kaabil asks **"నమోదు చేయనా?"**. Say **"అవును"**. The dose appears as taken on the family side.
5. Try the edge cases: say **"ఇంకా లేదు"** (snoozed 10 minutes), say nothing and press **Advance 10 min** twice (the family gets a missed-dose alert), claim the dose again (refused and flagged), say **"ఛాతీ నొప్పి"** (a 112 button appears and the family is alerted).
6. No microphone or no Telugu voice on your device? The same flow works with the Yes/No buttons and the text box.

The **Test panel** tab runs 12 scripted scenarios and shows expected versus actual. The **Voice check** tab, opened on a phone, shows which voice Kaabil would use in each language, plays every spoken line, tests the microphone, and gives a short report to copy. The **Roadmap** tab lists what works and what is a placeholder.

## What works, and what does not (yet)

| Area | Status |
|---|---|
| Medicine reminder, spoken confirmation, dose log | Works (Telugu, English) |
| Yes/No decided by word rules, never by the speech model | Works, unit tested |
| Sign-in, care group, pairing code, plan sync, doses, alerts and live events (backend) | Works and is tested; driven today by the test console at `/dev` |
| The app screens on the backend | **Not connected yet**: the screens still keep their state in the browser; connecting them is the next step |
| Missed-dose, repeated-dose and emergency alerts | Created by the dose dialogue and stored and streamed live by the backend; push notifications are not set up |
| Family setup from text such as `Metformin 500, 1-0-1` | Works |
| Pill check, daily check-in, link guard, send to family | Placeholders |
| Cloud Indic speech, vision model | "Key not set" placeholders |
| Nine more language packs | Data only, not reviewed by native speakers |
| Adding a language | One file: see `packages/core/src/i18n/languages/README.md` |

## Read more

| Document | For |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Problem, users, requirements, how we will know it works, what is not verified |
| [docs/SPECS.md](docs/SPECS.md) | Architecture, the dose state machine, word rules, timings, tests, security |
| [docs/fsd/](docs/fsd/README.md) | Functional specification: every feature with acceptance criteria, prototype vs finale vs later, security between the UI and the backend |

## How it is built

A [Turborepo](https://turborepo.dev) monorepo (npm workspaces): `apps/web` is the React app, `apps/api` is the backend, `packages/core` is the pure logic that any future app can reuse, `packages/contract` holds the request and response schemas and a typed client shared by the app and the API, and `packages/db` is the database schema and migrations.

- React 19, TypeScript (strict), Vite, Vitest for the app. The backend uses Hono, Better Auth (sign-in, sessions and the care-group roles; we do not write our own), Drizzle with Postgres, Zod and pino. The app screens still keep their state in the browser (`localStorage`) until they are connected to the backend.
- `packages/core/src/dose/dialogue.ts` is a pure state machine for the dose conversation, with no clock, storage or speech in it. `packages/core/src/voice/words.ts` holds the Yes/No rules. Telugu negation is a verb ending, so the rules match endings such as `లేదు`, and any No beats any Yes.
- All speech goes through one `SpeechPort` interface (Web Speech API in the browser, a scripted fake in tests).

## Before you push

`npm ci` installs a pre-push guard (`scripts/hooks/pre-push`). Before every push it checks the commits and runs typecheck, tests, the production build and, where Docker exists, the compose file and image build. It blocks pushes that contain secrets, email addresses, local paths, attribution trailers or env files, and direct pushes to `main`. GitHub Actions is not used. Run the same checks by hand with `npm run check`.

## Team

See [CONTRIBUTORS.md](CONTRIBUTORS.md).

## Privacy and security

- The person's voice is never recorded or stored. A family member can record their own voice reading Kaabil's fixed sentences, with their consent; those recordings are stored on the server so the person's phone can play them, and can be deleted at any time. The backend keeps the family's account, the plan, dose records and alerts; it does not receive transcripts. Demo data is fictional.
- No secrets are in this repository, in the images or in the browser bundle: the compose file generates random secrets on first start. Keys for cloud speech and vision will be used only by the backend; `.env.example` lists the names with empty values.
- The person's phone has no account, password, OTP or PIN: the family member types a one-time 8-digit code that works once and expires in 10 minutes. Only hashes of codes and device tokens are stored.
- The API checks that the signed-in user belongs to the group in the path (another family's id answers 404), validates every body, refuses requests from other origins, limits pairing attempts, and sends strict headers. The compose file serves plain HTTP for local use: a public copy must sit behind HTTPS.
- Containers drop all capabilities, and the API runs as a non-root user with a read-only file system.
- Kaabil gives no medical advice, never identifies a pill by looks, and never asks for an OTP or PIN. It is not a medical device.
