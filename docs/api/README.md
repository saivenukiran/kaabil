# Kaabil API guide

How to talk to the Kaabil backend: who calls it, how they sign in, what the answers look like, how live updates work, and a complete example you can paste into a terminal.

| Read | For |
|---|---|
| This guide | Conventions and a worked example |
| [endpoints.md](endpoints.md) | Every endpoint: request, answer, errors, curl and client calls (generated from the code) |
| [openapi.json](openapi.json) | The same as OpenAPI 3.1, for tools |
| [backend.md](backend.md) | How the backend is built, configured, run and tested |
| [voice.md](voice.md) | Speech, the Yes/No word rules, custom voice, cloud voice |
| [calls.md](calls.md) | Voice and video calls between the person and the family, and how to test them on two devices |

## Who calls the API

| Caller | How it proves who it is | What it can do |
|---|---|---|
| A **family member** (the web app, a script) | Signs in with email and password and gets a **session cookie** | Everything about their own care groups: medicines, pairing, doses, alerts, recordings |
| The **person's phone** | Pairs once with a one-time code and gets a **device token**, sent as `Authorization: Bearer <token>` | Read its own plan, record doses, raise alerts, listen for events, fetch the family's recordings. It cannot use any family route |
| Anyone | Nothing | `GET /api/health`, `GET /api/voice/status`, and `POST /api/device/pair` (which needs the code) |

The person never has an account, a password, an OTP or a PIN. The family member types the pairing code on the person's phone.

## Conventions

- **One origin.** The API is under `/api/` on the same address as the web app (nginx or the Cloudflare Worker forwards it). There is no CORS.
- **JSON in and out**, except audio. A body that is not valid JSON, has a wrong type or has a field we do not know is refused with 400. Unknown fields are never ignored.
- **Times** are epoch milliseconds. Medicine times of day are `HH:MM` in the person's time zone (`Asia/Kolkata` on the server unless `KAABIL_TZ` says otherwise).
- **Slot ids** name one dose of one medicine on one day: `medicineId|YYYY-MM-DD|HH:MM`. They are what makes retries safe.
- **Errors** always have the same shape:

```json
{ "error": { "code": "not_found", "message": "No such group" } }
```

| Status | Meaning |
|---|---|
| 400 | The body or a parameter is invalid. `code` is `invalid_body`, `invalid_json`, `invalid_medicine`, `invalid_code`, `invalid_slot`, `unknown_medicine`, `consent_required`, `not_audio` or `too_short` |
| 401 | Not signed in, or the device token is missing, malformed, revoked or unknown |
| 403 | A data-changing request that did not come from the app (see the Origin rule below) |
| 404 | Not found, or it belongs to another family. The answer is identical, so an id reveals nothing |
| 413 | The body is larger than allowed (64 KB for JSON, 1.5 MB for a recording) |
| 415 | An audio type that is not accepted |
| 429 | Too many tries (pairing: 10 a minute per address; sign-in has its own limit) |
| 500 | Our fault. The message says nothing about the cause; the server logs it without any personal data |

## Signing in, and the Origin rule

Family sign-in is [Better Auth](https://better-auth.com). Sign up or in, and the response sets the session cookie.

```bash
BASE=http://localhost:8080
EMAIL="demo-$RANDOM@example.test"
PASSWORD=$(openssl rand -hex 12)         # at least 10 characters
curl -s -c cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d "{\"name\":\"Ravi\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-up/email"
```

**Every request that changes data with the cookie must carry an allowed `Origin` header** (the address people open: `BASE`). A browser sends it by itself. From curl or a script, add `-H "Origin: $BASE"`, as above. A request from another origin, or one a browser marks cross-site, is refused with 403. The address the server treats as its own is `KAABIL_BASE_URL` (plus `KAABIL_TRUSTED_ORIGINS`); if you open the app on another address, add it there.

Reads (`GET`) need only the cookie: `-b cookies.txt`.

## Pairing the person's phone

1. The family member asks for a code: `POST /api/care/groups/:id/pairing-codes` gives eight digits, valid for ten minutes, usable once. A new code replaces an unused one.
2. They type it on the person's phone, which calls `POST /api/device/pair` with the code and a name for the phone.
3. The answer holds the **device token**. It is shown once and only its hash is stored. The phone keeps it and sends it as `Authorization: Bearer <token>` on every call.
4. The family can revoke the phone at any time (`DELETE .../devices/:did`); its next request answers 401.

A wrong, used or expired code all give the same 400.

## Doses and alerts: what the phone sends and why it is safe to retry

The dose dialogue runs on the person's phone (`@kaabil/core`); the server stores the result.

- `POST /api/device/doses` records a dose for a slot. **One record per slot**: the first call answers 201 and tells the family live; a retry answers 200 with the same record and changes nothing. If the network drops, keep the dose on the phone and send it again later.
- `POST /api/device/alerts` raises `missed_dose`, `double_dose` or `emergency`. `missed_dose` and `emergency` are created only if the family consented, and the answer says why not (`reason: no_consent`). A missed or repeated-dose alert is unique per slot (`reason: duplicate` on a retry); every emergency is recorded.
- The server also checks for missed doses by itself: a slot with no dose 22 minutes after its time raises one alert if the family consented and a phone is paired, so a closed or dead phone still alerts the family. The phone's own alert (at 20 minutes) and the server's cannot both exist.
- A screen must not say "the family was told" before the server has answered.

## Live updates: stream or poll

Both give the same events. Each event is a JSON object with a `type`:

| `type` | Sent to | When | Fields |
|---|---|---|---|
| `dose` | family | The phone recorded a dose | `dose` (the dose record) |
| `alert` | family | An alert was created | `alert` |
| `plan` | family, phone | The plan or consent changed | `at` |
| `device` | family | A phone paired or was revoked | `device` (or null), `removedId` |
| `remind` | phone | The developer console asked for a reminder now | `at`, `medicineId?` |
| `voice` | family, phone | A recording was saved or deleted | `at` |
| `call` | family or phone (the other side) | A call setup message from the other side | `signal` (see [calls.md](calls.md)) |
| `ping` | family, phone | Every 15 seconds on a stream, and the moment a stream opens | `at` |

**Stream (server-sent events):** `GET /api/care/groups/:id/events` and `GET /api/device/events`. Frames are `data: {json}` and a blank line. The phone must send a header, so use `fetch` (a browser `EventSource` cannot).

**Long polling:** `GET .../poll?after=N&wait=8000`. Call it first without `after` to get a starting `last`; then keep calling with `after=<last>`. The answer waits up to `wait` milliseconds for news and returns `{ events: [{ id, event }], last }`. The server keeps the last 100 events of each group. Use polling when a proxy holds streams back: **a Cloudflare quick tunnel does exactly that**, which is how the test deployment runs.

**The typed client does this for you:** `client.family.events(groupId, { onEvent })` and `client.device.events({ onEvent })` open the stream, and if nothing arrives in three seconds they switch to polling, remembering where they were so no event is lost.

## A complete example, step by step

Everything below is real: it is the flow the smoke test runs. `jq` is used to pick values out of answers.

```bash
BASE=http://localhost:8080          # or https://your-address
EMAIL="demo-$RANDOM@example.test"; PASSWORD=$(openssl rand -hex 12)

# 1. A family member signs up (the cookie jar keeps the session)
curl -s -c cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d "{\"name\":\"Ravi\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/sign-up/email" > /dev/null

# 2. Make the care group for the person
GROUP_ID=$(curl -s -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d '{"personName":"Amma","address":"అమ్మ","lang":"te","consent":{"missedDose":true,"emergency":true}}' \
  "$BASE/api/care/groups" | jq -r .id)

# 3. Add a medicine as one typed line: morning and night
MEDICINE_ID=$(curl -s -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d '{"line":"Metformin 500, 1-0-1"}' "$BASE/api/care/groups/$GROUP_ID/medicines" | jq -r .id)

# 4. Make a pairing code, and pair the person's phone with it
CODE=$(curl -s -b cookies.txt -H "Origin: $BASE" -X POST "$BASE/api/care/groups/$GROUP_ID/pairing-codes" | jq -r .code)
DEVICE_TOKEN=$(curl -s -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"deviceName\":\"Amma phone\"}" "$BASE/api/device/pair" | jq -r .deviceToken)

# 5. The phone fetches its plan
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/plan" | jq .

# 6. The family notes where the news stands, then the phone records a dose
START=$(curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/poll" | jq .last)
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"slotId\":\"$MEDICINE_ID|2026-11-28|08:00\",\"medicineId\":\"$MEDICINE_ID\",\"atMs\":$(date +%s)000,\"via\":\"voice\"}" \
  "$BASE/api/device/doses" | jq .

# 7. The family hears about it (long poll: answers as soon as there is news)
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/poll?after=$START&wait=5000" | jq .

# 8. The phone raises an emergency; the family lists and acknowledges it
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"kind\":\"emergency\",\"atMs\":$(date +%s)000}" "$BASE/api/device/alerts" | jq .
ALERT_ID=$(curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/alerts" | jq -r '.alerts[0].id')
curl -s -b cookies.txt -H "Origin: $BASE" -X POST "$BASE/api/care/groups/$GROUP_ID/alerts/$ALERT_ID/ack" | jq .
```

Repeat step 6 and the second answer has the **same** record with status 200: a retry changes nothing.

## The same in JavaScript

`@kaabil/contract` is a typed client that validates every answer against the schemas, so a server that drifts from the contract fails loudly.

```ts
import { createClient } from '@kaabil/contract';

const family = createClient();                       // the family's browser: uses the session cookie
await family.auth.signUp({ name: 'Ravi', email, password });
const group = await family.family.createGroup({ personName: 'Amma', address: 'అమ్మ', lang: 'te', consent: { missedDose: true, emergency: true } });
await family.family.addMedicine(group.id, { line: 'Metformin 500, 1-0-1' });
const { code } = await family.family.createPairingCode(group.id);
const stop = family.family.events(group.id, { onEvent: (e) => console.log(e.type) });

const phone = createClient();                        // the person's phone
await phone.device.pair(code, 'Amma phone');         // keeps the device token for later calls
const plan = await phone.device.plan();
await phone.device.postDose({ slotId: `${plan.medicines[0].id}|2026-11-28|08:00`, medicineId: plan.medicines[0].id, atMs: Date.now(), via: 'voice' });
```

The pure helpers `planToState`, `applyPlan`, `remindNow` and `unsent` in the same package turn the plan into the dose dialogue's state and say which doses and alerts the server has not been told yet.

## Security in one table

| What | How |
|---|---|
| Passwords, sessions, roles | Better Auth. We write none of it |
| Who may see a group | Every family route checks membership of the group in the path; another family's id answers 404 |
| Phones | A random token, only its hash stored; scoped to its own group; revocable at once |
| Forged requests | The Origin rule; no CORS |
| Input | Strict schemas; size limits; database access with parameters |
| Guessing | Pairing: 10 tries a minute per address, 8 digits, 10 minutes, once; sign-in: Better Auth's limit |
| Headers | Every answer is `Cache-Control: no-store`; the API sends a policy that allows nothing, no framing, `nosniff`; HSTS only over HTTPS |
| Logs | Method, path, status and time only: never a name, a medicine, a transcript or audio |

More: [backend.md](backend.md) and `docs/SPECS.md` section 8. TLS is not in the Docker compose file (plain HTTP for local use); a public copy sits behind HTTPS (see `packages/edge`).

## Try it

```bash
docker compose up --build          # http://localhost:8080, no keys
npm run smoke                      # the real flow through the proxy, with checks
npm run e2e                        # browser scripts (TestSutra) against a running copy
npx tsx scripts/gen-api-docs.mjs   # regenerate endpoints.md and openapi.json after changing the route list
```

`http://localhost:8080/test/` is a page with the family phone and the person's phone side by side on the real backend, and `/dev` is a plain console. Both are developer tools.
