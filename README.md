# Kaabil Hain Hum

A voice-first companion for people who depend on family to operate their phone: elders, people with low vision or low literacy, and patients recovering from a stroke or living with diabetes. The person talks to the app, mostly in Telugu; a relative sees what happened on a family dashboard.

This is the **Round 2 prototype**: one core flow that works end to end (medicine reminders and dose logging by voice). Everything else is a labelled placeholder. The full product is built at the finale.

## Run it

You need Docker. No API keys and no `.env` file are needed.

```bash
docker compose up --build
```

Open <http://localhost:8080> in Chrome (it uses the browser's speech recognition; `localhost` counts as a secure page, so the microphone works).

Without Docker (Node 24):

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # typecheck + production build
```

## Try the core flow (about 90 seconds)

1. Open **Side by side**, so the person screen and the family dashboard are visible together.
2. Tap the big start button once. It unlocks speech and the microphone.
3. Press **Advance 1 min** until the demo clock reaches 08:00. Kaabil speaks the reminder in Telugu.
4. Say **"వేసుకున్నాను"**. Kaabil asks **"నమోదు చేయనా?"**. Say **"అవును"**. The dose appears as taken on the family side.
5. Try the edge cases: say **"ఇంకా లేదు"** (snoozed 10 minutes), say nothing and press **Advance 10 min** twice (the family gets a missed-dose alert), claim the dose again (refused and flagged), say **"ఛాతీ నొప్పి"** (a 112 button appears and the family is alerted).
6. No microphone or no Telugu voice on your device? The same flow works with the Yes/No buttons and the text box.

The **Test panel** tab runs 13 scripted scenarios and shows expected versus actual. The **Roadmap** tab lists what works and what is a placeholder.

## What works, and what does not (yet)

| Area | Status |
|---|---|
| Medicine reminder, spoken confirmation, dose log | Works (Telugu, Hindi, English) |
| Yes/No decided by word rules, never by the speech model | Works, unit tested |
| Missed-dose, repeated-dose and emergency alerts on the family view | Works in one browser; push is not set up |
| Family setup from text such as `Metformin 500, 1-0-1` | Works |
| Pill check, daily check-in, link guard, send to family | Placeholders |
| Cloud Indic speech, vision model | "Key not set" placeholders |
| Eight more language packs | Data only, not reviewed by native speakers |

## Read more

| Document | For |
|---|---|
| [PRD.md](PRD.md) | Problem, users, requirements, how we will know it works, what is not verified |
| [SPECS.md](SPECS.md) | Architecture, the dose state machine, word rules, timings, tests, security |

## How it is built

A [Turborepo](https://turborepo.dev) monorepo (npm workspaces): `apps/web` is the React app, `packages/core` is the pure logic that any future app can reuse.

- React 19, TypeScript (strict), Vite, Vitest. No backend: state lives in the browser (`localStorage`), and two tabs stay in sync.
- `packages/core/src/dose/dialogue.ts` is a pure state machine for the dose conversation, with no clock, storage or speech in it. `packages/core/src/voice/words.ts` holds the Yes/No rules. Telugu negation is a verb ending, so the rules match endings such as `లేదు`, and any No beats any Yes.
- All speech goes through one `SpeechPort` interface (Web Speech API in the browser, a scripted fake in tests).

## Before you push

`npm ci` installs a pre-push guard (`scripts/hooks/pre-push`). Before every push it checks the commits and runs typecheck, tests, the production build and, where Docker exists, the compose file and image build. It blocks pushes that contain secrets, email addresses, local paths, attribution trailers or env files, and direct pushes to `main`. GitHub Actions is not used. Run the same checks by hand with `npm run check`.

## Team

See [CONTRIBUTORS.md](CONTRIBUTORS.md).

## Privacy and security

- Transcripts are text only and stay in your browser. Audio is never stored.
- No secrets are in this repository or in the browser bundle. Keys for cloud speech and vision will be used only by a server-side proxy at the finale; `.env.example` lists the names with empty values.
- The container runs as a non-root user, drops all capabilities, and sends a strict Content-Security-Policy.
- Kaabil gives no medical advice, never identifies a pill by looks, and never asks for an OTP or PIN. It is not a medical device.
