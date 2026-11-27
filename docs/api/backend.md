# The backend: how it is built, configured, run and tested

For callers of the API, see the [guide](README.md) and the [endpoint reference](endpoints.md). This document is for people who change or run the backend.

## What it is

A small Node 24 server (`apps/api`) that stores what the person's phone and the family do, and tells each side about the other in real time. It does **not** decide whether a dose was taken: the dose dialogue and the Yes/No word rules run on the person's phone (`@kaabil/core`); the server stores the result and guards the missed dose.

| Part | Choice | Why |
|---|---|---|
| HTTP | [Hono](https://hono.dev) | Small, standard `Request` and `Response`, easy to test without a network |
| Sign-in, sessions, roles | [Better Auth](https://better-auth.com), email and password, with its organization plugin | We write no password, session or role code. The care group *is* an organization |
| Database | Postgres 16 through [Drizzle](https://orm.drizzle.team); migrations are generated SQL that runs at start | Same as the finale design |
| Validation | [Zod](https://zod.dev) schemas shared with the app in `@kaabil/contract` | One definition, used by the server to refuse and by the client to check |
| Logging | [pino](https://getpino.io), method, path, status and time only | No names, medicines, transcripts or audio in a log line |
| Live updates | Server-sent events, plus long polling | The stream is best; some proxies hold streams back |

## How a request travels

```
phone or browser
   │  HTTPS
   ▼
Cloudflare Worker (packages/edge)   serves the screens, forwards /api and /dev        ← testing setup
   │  Cloudflare quick tunnel
   ▼
web (nginx, port 8080)              serves the screens, proxies /api to the api       ← what `docker compose` runs
   ▼
api (Hono, port 3000, not published)
   ▼
db (Postgres 16, not published)
```

`docker compose up` starts four services: `init` writes random secrets into a volume on first start, `db`, `api`, `web`. Only port 8080 is published. nginx sets the client's address itself (replacing anything the caller sent), because the API limits pairing guesses by address. The Cloudflare Worker is a separate, optional layer for HTTPS during testing; see `packages/edge/README.md`. For the demo the backend is meant to move to a small VM (the finale design: Cloudflare for the screens, one VM in Mumbai for the compose stack).

## Code map (`apps/api/src`)

| File | What it does |
|---|---|
| `server.ts` | Connects to Postgres (waits for it), runs the migrations, starts the missed-dose check and the HTTP server |
| `app.ts` | Builds the Hono app: request logging, headers, body limits, `/api/health`, mounts Better Auth and the routes |
| `config.ts` | Reads the environment; a secret may be given directly or as a file (`NAME_FILE`) |
| `auth.ts` | Better Auth set-up: email and password (10 to 128 characters), 30-day sessions, cookie flags, rate limits, the organization plugin |
| `routes/care.ts` | The family's routes (behind a session): groups, medicines, pairing codes, devices, doses, alerts, stream, poll, custom voice |
| `routes/device.ts` | The phone's routes: pairing, plan, doses, alerts, stream, poll, recordings |
| `routes/poll.ts` | Long polling shared by both |
| `routes/voice.ts` | `GET /api/voice/status` (cloud voice: not wired) |
| `routes/dev.ts`, `routes/consoleHtml.ts` | The developer console and "remind now" (only when `KAABIL_DEV_CONSOLE=1`) |
| `repo.ts` | Database reads and the conversion of rows to contract objects. Every query is scoped by group |
| `alertsService.ts` | The one place an alert is created: consent rules and uniqueness per slot |
| `sweep.ts` | The server's own missed-dose check |
| `voiceClips.ts` | Custom voice: which sentences can be recorded, validation, storage, retirement |
| `bus.ts` | In-memory publish and subscribe, with the last 100 events of each group for polling |
| `security.ts` | Hashing, pairing codes, device tokens, a rate limiter, the origin check |
| `http.ts` | Error classes and the single error shape |

The schemas and the typed client are in `packages/contract`; the database schema and migrations in `packages/db`.

## Configuration

Set by environment variables. In `docker compose` the secrets are generated and read from files, and only the first four below are meant to be set by hand.

| Variable | Default | Meaning |
|---|---|---|
| `KAABIL_BASE_URL` (compose) → `BASE_URL` | `http://localhost:8080` | The address people open. Cookies are `Secure` if it starts with `https`, HSTS is sent only then, and the origin check accepts this address |
| `KAABIL_TRUSTED_ORIGINS` (compose) → `TRUSTED_ORIGINS` | none | More addresses allowed to send cookie-authenticated, data-changing requests, comma separated (a LAN address, a tunnel) |
| `KAABIL_DEV_CONSOLE` | `1` in compose | The console at `/dev` and `POST /api/dev/remind-now`. Set `0` in any real deployment |
| `KAABIL_TZ` | `Asia/Kolkata` | The time zone medicine times such as 08:00 are read in, for the server's missed-dose check |
| `PORT` | 3000 | The API's port inside the compose network |
| `DATABASE_URL`, or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME` and `DB_PASSWORD` or `DB_PASSWORD_FILE` | host `db`, user and database `kaabil` | The database. There is no default password |
| `AUTH_SECRET` or `AUTH_SECRET_FILE` | none: required | Signs sessions. Generated by the compose `init` service |
| `MISSED_AFTER_MS` | 1,320,000 (22 minutes) | How long after a slot with no dose the server raises a missed-dose alert |
| `SWEEP_EVERY_MS` | 60,000 | How often the server checks |
| `LOG_LEVEL` | `info` | pino level |

`.env.example` lists the optional settings. No secret is in the repository or the images. `docker compose down -v` deletes the data and the secrets for a clean start.

## Data model (`packages/db/src/schema.ts`)

| Table | Holds | Notes |
|---|---|---|
| `user`, `session`, `account`, `verification` | Better Auth's | We do not edit them |
| `organization`, `member`, `invitation` | Better Auth's organization plugin | The care group is an organization; roles `owner` and `member` |
| `care_groups` | The person (name, how to address them), language, the two consents | Its id is the organization id |
| `medicines` | Name, strength, times of day (`HH:MM`) | Created at a time the server clock gives, so the missed-dose check ignores slots from before it existed |
| `devices` | A paired phone: name, **hash** of its token, last seen, revoked | |
| `pairing_codes` | **Hash** of a one-time code, expiry, used | |
| `dose_events` | One row per slot | Unique on (group, slot id): a retry cannot record twice |
| `alerts` | Kind, slot, time, acknowledged by whom | A missed or repeated-dose alert is unique per (group, kind, slot); emergencies are not |
| `voice_clips` | A family member's recording of one fixed sentence, with the sentence | Unique on (group, language, sentence hash); stored as audio bytes with the recorder's consent time |

Everything a family can reach carries the care group's id, and every query filters on it. Deleting a care group removes its rows (they cascade).

## The rules that live in the server

- **Consent.** A `missed_dose` alert needs the missed-dose consent; an `emergency` alert needs the emergency consent; a `double_dose` flag is always recorded. The answer to the phone says why an alert was not created.
- **One dose per slot, one alert per slot and kind.** Enforced by unique keys in the database, so a retry, a double tap or a race cannot duplicate.
- **The missed-dose check** (`sweep.ts`): every minute, for every care group with missed-dose consent and a paired phone, every slot whose time is at least 22 minutes past and less than a day old with no dose and no alert raises one `missed_dose` alert, unless the medicine was created after that slot's time. The phone raises the same alert at 20 minutes; the unique key means only one exists.
- **A recording** is saved only for a sentence Kaabil will say to this person, with the recorder's consent, an allowed audio type whose first bytes match, 200 bytes to 1.5 MB. It is retired (no longer offered or played) when its sentence changes.
- **A pairing code** is eight digits, valid ten minutes, works once; a wrong, used and expired code give one identical answer.

## Running, testing, changing

```bash
docker compose up --build                  # the whole backend with no keys: http://localhost:8080
npm test                                   # every package's tests (the API tests run on an in-process Postgres: no Docker)
npm run smoke                              # builds and starts the images, then walks the real flow through the proxy
npm run e2e                                # TestSutra browser scripts against a running copy
npm run docs:check                         # the numbers in the docs and the generated API reference match the code
npm run seed                               # a fictional demo family and a pairing code
```

| Test | What it covers |
|---|---|
| `apps/api/test/*.test.ts` | Auth and care groups, pairing, doses, alerts, live streams over real HTTP, long polling, the server's missed-dose check with a fake clock, custom voice, the developer console, the bus, configuration, security helpers |
| `apps/api/test/routes.sync.test.ts` | **Every endpoint the server registers is documented, and every documented endpoint exists**; every protected endpoint answers 401 without credentials |
| `packages/contract` | The schemas, the typed client, the event reader and its polling fallback, the route list |
| `scripts/smoke.mjs` | The real flow through the real proxy, security headers, closed ports |

**To add an endpoint:** write the route, add its entry to `packages/contract/src/routes.ts` (summary, who may call it, schemas, an example, the errors), add its client call to `CLIENT_CALLS`, run `npx tsx scripts/gen-api-docs.mjs`, and commit the regenerated files. The tests fail until all of these agree.

## Known limits

| Limit | Effect |
|---|---|
| One server process | The event hub and the pairing rate limit are in memory; a restart closes streams (clients reconnect) |
| No TLS inside compose | A public copy sits behind HTTPS (the Cloudflare Worker for testing, a VM for the demo) |
| No push notifications | The family sees alerts live only while the app is open |
| No backups, no server-side deletion of a whole care group | Before any real person's data |
| Voice cloud proxies are not built | See [voice.md](voice.md) |
| Better Auth exposes more endpoints under `/api/auth/` than the apps use (organization management, such as inviting or removing members) | They are protected by the library's own permission checks, which we have not tested separately. Treat the care-group routes as the supported way to manage a group |
