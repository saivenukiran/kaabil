# API reference

> **Generated** from `packages/contract/src/routes.ts` and the schemas in `packages/contract/src/schemas.ts` by `scripts/gen-api-docs.mjs`. Do not edit by hand; run `npx tsx scripts/gen-api-docs.mjs`. Tests check that this list is exactly the server's endpoints. The same content as OpenAPI 3.1 is in [`openapi.json`](openapi.json).

Start with the [guide](README.md) for conventions (errors, sign-in, live events) and a worked example. The `curl` examples assume `BASE` is the address (for example `http://localhost:8080`), `cookies.txt` is a cookie jar from signing in, and `DEVICE_TOKEN` is the token from pairing.

## All endpoints

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/health` | none | Is the backend up? |
| GET | `/api/care/me` | session | Who is signed in, and which care groups do they belong to |
| POST | `/api/care/groups` | session | Create a care group for one person |
| GET | `/api/care/groups/:id` | session | One care group: person, language, consent, medicines, paired phones |
| PATCH | `/api/care/groups/:id` | session | Change the person, language or consent |
| POST | `/api/care/groups/:id/medicines` | session | Add (or update) a medicine |
| DELETE | `/api/care/groups/:id/medicines/:mid` | session | Remove a medicine |
| POST | `/api/care/groups/:id/pairing-codes` | session | Make a one-time code to pair the person's phone |
| DELETE | `/api/care/groups/:id/devices/:did` | session | Revoke a paired phone |
| GET | `/api/care/groups/:id/doses` | session | The dose log, newest first (at most 500) |
| GET | `/api/care/groups/:id/alerts` | session | The alerts, newest first (at most 200) |
| POST | `/api/care/groups/:id/alerts/:aid/ack` | session | Acknowledge an alert |
| POST | `/api/device/pair` | none | Pair the person's phone with the family's code |
| GET | `/api/device/plan` | device | What the phone needs to run the dose dialogue: person, language, consent, medicines |
| POST | `/api/device/doses` | device | Record that a dose was taken |
| POST | `/api/device/alerts` | device | Raise an alert for the family |
| GET | `/api/care/groups/:id/events` | session | Live events for the family: a server-sent-events stream |
| GET | `/api/care/groups/:id/poll` | session | The same events by long polling |
| GET | `/api/device/events` | device | Live events for the person's phone: a server-sent-events stream |
| GET | `/api/device/poll` | device | The phone's events by long polling |
| GET | `/api/voice/status` | none | Is cloud speech or voice available? |
| GET | `/api/care/groups/:id/voice` | session | The sentences Kaabil says to this person, and which have your recording |
| PUT | `/api/care/groups/:id/voice/:hash` | session | Save your recording of one sentence |
| GET | `/api/care/groups/:id/voice/:hash/audio` | session | Play back a saved recording (family) |
| DELETE | `/api/care/groups/:id/voice/:hash` | session | Delete one recording |
| DELETE | `/api/care/groups/:id/voice` | session | Delete all recordings of this group |
| GET | `/api/device/voice` | device | The recordings the phone may play, with the sentence each one says |
| GET | `/api/device/voice/:hash/audio` | device | Fetch a recording (phone) |
| POST | `/api/care/groups/:id/call` | session | Send a call message to the person's phone |
| POST | `/api/device/call` | device | Send a call message to the family |
| GET | `/api/care/groups/:id/ice` | session | Which servers to use to connect a call (family) |
| GET | `/api/device/ice` | device | Which servers to use to connect a call (phone) |
| POST | `/api/dev/remind-now` | dev | Send a 'remind now' event to the group's phones |
| GET | `/dev` | none | The plain test console (HTML) |

## Sign-in (Better Auth)

Family sign-in is [Better Auth](https://better-auth.com), mounted under `/api/auth/`. Its shapes are the library's; these are the ones the apps use. The library has more endpoints under the same prefix (organization management among them); treat the care-group routes above as the supported way to manage a group.

| Method | Path | Body | What it does |
|---|---|---|---|
| POST | `/api/auth/sign-up/email` | `{ "name": string, "email": string, "password": string (10 to 128 characters) }` | Creates the account and signs it in; sets the session cookie. |
| POST | `/api/auth/sign-in/email` | `{ "email": string, "password": string }` | Signs in; sets the session cookie. |
| POST | `/api/auth/sign-out` | `{}` | Ends the session on the server. |
| GET | `/api/auth/get-session` | `-` | The current session and user, or null. |

## System

### `GET /api/health`

**Is the backend up?**

Who may call it: anyone.

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |
| `version` | string | yes |  |

With curl

```bash
curl -s "$BASE/api/health"
```

With the typed client (`@kaabil/contract`)

```ts
client.health()
```

## Family: the account, the care group, medicines, pairing, doses and alerts

### `GET /api/care/me`

**Who is signed in, and which care groups do they belong to**

Who may call it: a signed-in family member (session cookie).

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `user` | object | yes | no other fields |
| `user.id` | string | yes |  |
| `user.name` | string | yes |  |
| `user.email` | string | yes |  |
| `groups` | array of object | yes |  |
| `groups[].id` | string | yes |  |
| `groups[].personName` | string | yes |  |
| `groups[].role` | one of "owner", "member" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/me"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.me()
```

### `POST /api/care/groups`

**Create a care group for one person**

Who may call it: a signed-in family member (session cookie).

The caller becomes its owner. A care group is one person and their family; every record belongs to exactly one. It is created through Better Auth's organization plugin, so roles and membership are the library's.

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `personName` | string | yes | 1 to 60 characters |
| `address` | string | yes | up to 40 characters |
| `lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `consent` | object | yes | no other fields |
| `consent.missedDose` | boolean | yes |  |
| `consent.emergency` | boolean | yes |  |

Example

```json
{
  "personName": "Amma",
  "address": "అమ్మ",
  "lang": "te",
  "consent": {
    "missedDose": true,
    "emergency": true
  }
}
```

Success: **201**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `personName` | string | yes |  |
| `address` | string | yes |  |
| `lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `consent` | object | yes | no other fields |
| `consent.missedDose` | boolean | yes |  |
| `consent.emergency` | boolean | yes |  |
| `medicines` | array of object | yes |  |
| `medicines[].id` | string | yes | at least 1 character |
| `medicines[].name` | string | yes | 1 to 80 characters |
| `medicines[].strength` | string | yes | up to 20 characters |
| `medicines[].times` | array of string | yes | 1 to 6 items. each item: matches `^([01]\d|2[0-3]):[0-5]\d$` |
| `devices` | array of object | yes |  |
| `devices[].id` | string | yes |  |
| `devices[].name` | string | yes |  |
| `devices[].createdAt` | number | yes |  |
| `devices[].lastSeenAt` | number,null | yes |  |
| `role` | one of "owner", "member" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 400 | The body is not valid JSON or does not match the schema (unknown fields are refused) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X POST -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" -d '{"personName":"Amma","address":"అమ్మ","lang":"te","consent":{"missedDose":true,"emergency":true}}' "$BASE/api/care/groups"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.createGroup({ personName, address, lang, consent })
```

### `GET /api/care/groups/:id`

**One care group: person, language, consent, medicines, paired phones**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `personName` | string | yes |  |
| `address` | string | yes |  |
| `lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `consent` | object | yes | no other fields |
| `consent.missedDose` | boolean | yes |  |
| `consent.emergency` | boolean | yes |  |
| `medicines` | array of object | yes |  |
| `medicines[].id` | string | yes | at least 1 character |
| `medicines[].name` | string | yes | 1 to 80 characters |
| `medicines[].strength` | string | yes | up to 20 characters |
| `medicines[].times` | array of string | yes | 1 to 6 items. each item: matches `^([01]\d|2[0-3]):[0-5]\d$` |
| `devices` | array of object | yes |  |
| `devices[].id` | string | yes |  |
| `devices[].name` | string | yes |  |
| `devices[].createdAt` | number | yes |  |
| `devices[].lastSeenAt` | number,null | yes |  |
| `role` | one of "owner", "member" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.group(groupId)
```

### `PATCH /api/care/groups/:id`

**Change the person, language or consent**

Who may call it: a signed-in family member (session cookie).

Any field may be left out. Phones are told with a `plan` event, so they pick up the change at once.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `personName` | string | no | 1 to 60 characters |
| `address` | string | no | up to 40 characters |
| `lang` | string | no | A registered language code, for example te (Telugu) or en (English) |
| `consent` | object | no | no other fields |
| `consent.missedDose` | boolean | yes |  |
| `consent.emergency` | boolean | yes |  |

Example

```json
{
  "consent": {
    "missedDose": true,
    "emergency": false
  }
}
```

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `personName` | string | yes |  |
| `address` | string | yes |  |
| `lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `consent` | object | yes | no other fields |
| `consent.missedDose` | boolean | yes |  |
| `consent.emergency` | boolean | yes |  |
| `medicines` | array of object | yes |  |
| `medicines[].id` | string | yes | at least 1 character |
| `medicines[].name` | string | yes | 1 to 80 characters |
| `medicines[].strength` | string | yes | up to 20 characters |
| `medicines[].times` | array of string | yes | 1 to 6 items. each item: matches `^([01]\d|2[0-3]):[0-5]\d$` |
| `devices` | array of object | yes |  |
| `devices[].id` | string | yes |  |
| `devices[].name` | string | yes |  |
| `devices[].createdAt` | number | yes |  |
| `devices[].lastSeenAt` | number,null | yes |  |
| `role` | one of "owner", "member" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 400 | The body is not valid JSON or does not match the schema (unknown fields are refused) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X PATCH -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" -d '{"consent":{"missedDose":true,"emergency":false}}' "$BASE/api/care/groups/$GROUP_ID"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.updateGroup(groupId, { consent })
```

### `POST /api/care/groups/:id/medicines`

**Add (or update) a medicine**

Who may call it: a signed-in family member (session cookie).

Send the typed line the family writes (`Metformin 500, 1-0-1`: morning, noon, night; or `OD`, `BD`, `TDS`) or the fields. A line is read by the same parser the app uses and is refused with a plain message if it cannot be read. A medicine with the same name (ignoring case) is updated, and answers 200 instead of 201. Phones get a `plan` event.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `option 1` | object | no | send exactly one of the options |
| `line` | string | yes | 1 to 120 characters |
| `option 2` | object | no | send exactly one of the options |
| `name` | string | yes | 1 to 80 characters |
| `strength` | string | yes | up to 20 characters |
| `times` | array of string | yes | 1 to 6 items. each item: matches `^([01]\d|2[0-3]):[0-5]\d$` |

Example

```json
{
  "line": "Metformin 500, 1-0-1"
}
```

Success: **201**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | at least 1 character |
| `name` | string | yes | 1 to 80 characters |
| `strength` | string | yes | up to 20 characters |
| `times` | array of string | yes | 1 to 6 items. each item: matches `^([01]\d|2[0-3]):[0-5]\d$` |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 400 | The line cannot be read (code `invalid_medicine`, with the reason in `message`), or the body is invalid |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X POST -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" -d '{"line":"Metformin 500, 1-0-1"}' "$BASE/api/care/groups/$GROUP_ID/medicines"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.addMedicine(groupId, { line: 'Metformin 500, 1-0-1' })
```

### `DELETE /api/care/groups/:id/medicines/:mid`

**Remove a medicine**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |
| `mid` | The medicine id |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 404 | No such medicine in this group |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X DELETE -b cookies.txt -H "Origin: $BASE" "$BASE/api/care/groups/$GROUP_ID/medicines/$MEDICINE_ID"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.removeMedicine(groupId, medicineId)
```

### `POST /api/care/groups/:id/pairing-codes`

**Make a one-time code to pair the person's phone**

Who may call it: a signed-in family member (session cookie).

Eight digits, valid 10 minutes, works once, one live code per group (a new code replaces an unused one). Only its hash is stored. The family member types it on the person's phone; the person never says or types it.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **201**

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | matches `^\d{8}$` |
| `expiresAt` | number | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X POST -b cookies.txt -H "Origin: $BASE" "$BASE/api/care/groups/$GROUP_ID/pairing-codes"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.createPairingCode(groupId)
```

### `DELETE /api/care/groups/:id/devices/:did`

**Revoke a paired phone**

Who may call it: a signed-in family member (session cookie).

The phone is refused on its next request, and its live streams close at the next check.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |
| `did` | The device id, from the group's `devices` list |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 404 | No such phone, or it was already revoked |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X DELETE -b cookies.txt -H "Origin: $BASE" "$BASE/api/care/groups/$GROUP_ID/devices/$DEVICE_ID"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.revokeDevice(groupId, deviceId)
```

### `GET /api/care/groups/:id/doses`

**The dose log, newest first (at most 500)**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Query

| Name | Meaning |
|---|---|
| `since` | Optional. Epoch milliseconds: only doses at or after this time |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `doses` | array of object | yes |  |
| `doses[].slotId` | string | yes | 3 to 120 characters |
| `doses[].medicineId` | string | yes | at least 1 character |
| `doses[].atMs` | integer | yes | above 0 |
| `doses[].via` | one of "voice", "button" | yes |  |
| `doses[].id` | string | yes |  |
| `doses[].createdAt` | number | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/doses"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.doses(groupId, since)
```

### `GET /api/care/groups/:id/alerts`

**The alerts, newest first (at most 200)**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `alerts` | array of object | yes |  |
| `alerts[].id` | string | yes |  |
| `alerts[].kind` | one of "missed_dose", "double_dose", "emergency" | yes |  |
| `alerts[].slotId` | string | no |  |
| `alerts[].medicineId` | string | no |  |
| `alerts[].atMs` | number | yes |  |
| `alerts[].acknowledgedAt` | number,null | yes |  |
| `alerts[].delivery` | object | yes | no other fields |
| `alerts[].delivery.inApp` | one of "delivered", "failed" | yes |  |
| `alerts[].delivery.push` | "not set up in this prototype" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/alerts"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.alerts(groupId)
```

### `POST /api/care/groups/:id/alerts/:aid/ack`

**Acknowledge an alert**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |
| `aid` | The alert id |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes |  |
| `kind` | one of "missed_dose", "double_dose", "emergency" | yes |  |
| `slotId` | string | no |  |
| `medicineId` | string | no |  |
| `atMs` | number | yes |  |
| `acknowledgedAt` | number,null | yes |  |
| `delivery` | object | yes | no other fields |
| `delivery.inApp` | one of "delivered", "failed" | yes |  |
| `delivery.push` | "not set up in this prototype" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 404 | No such alert in this group |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X POST -b cookies.txt -H "Origin: $BASE" "$BASE/api/care/groups/$GROUP_ID/alerts/$ALERT_ID/ack"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.acknowledge(groupId, alertId)
```

## The person's phone

### `POST /api/device/pair`

**Pair the person's phone with the family's code**

Who may call it: anyone.

No other credential is needed: the code is the proof. The answer carries a long random device token, shown once; keep it on the phone and send it as `Authorization: Bearer <token>`. Only its hash is stored. A wrong, used or expired code all give the same 400, so a guess learns nothing. Limited to 10 tries a minute per address.

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | matches `^\d{8}$` |
| `deviceName` | string | yes | 1 to 40 characters |

Example

```json
{
  "code": "12345678",
  "deviceName": "Amma phone"
}
```

Success: **201**

| Field | Type | Required | Notes |
|---|---|---|---|
| `deviceToken` | string | yes | at least 32 characters |
| `groupId` | string | yes |  |

Errors

| Status | When |
|---|---|
| 400 | The code is wrong, used or expired (code `invalid_code`), or the body is invalid |
| 429 | More than 10 tries a minute from this address |

With curl

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"code":"12345678","deviceName":"Amma phone"}' "$BASE/api/device/pair"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.pair(code, deviceName)   // keeps the token for later calls
```

### `GET /api/device/plan`

**What the phone needs to run the dose dialogue: person, language, consent, medicines**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Medicine ids are the server's; the phone uses them in slot ids (`medicineId|YYYY-MM-DD|HH:MM`).

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `groupId` | string | yes |  |
| `person` | object | yes | no other fields |
| `person.name` | string | yes | 1 to 60 characters |
| `person.address` | string | yes | up to 40 characters |
| `lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `consent` | object | yes | no other fields |
| `consent.missedDose` | boolean | yes |  |
| `consent.emergency` | boolean | yes |  |
| `medicines` | array of object | yes |  |
| `medicines[].id` | string | yes | at least 1 character |
| `medicines[].name` | string | yes | 1 to 80 characters |
| `medicines[].strength` | string | yes | up to 20 characters |
| `medicines[].times` | array of string | yes | 1 to 6 items. each item: matches `^([01]\d|2[0-3]):[0-5]\d$` |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |

With curl

```bash
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/plan"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.plan()
```

### `POST /api/device/doses`

**Record that a dose was taken**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Idempotent: one record per slot. The first call answers 201 and tells the family live; a retry answers 200 with the same record and changes nothing. The medicine must be on the phone's plan and the slot must belong to it.

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `slotId` | string | yes | 3 to 120 characters |
| `medicineId` | string | yes | at least 1 character |
| `atMs` | integer | yes | above 0 |
| `via` | one of "voice", "button" | yes |  |

Example

```json
{
  "slotId": "MEDICINE_ID|2026-11-28|08:00",
  "medicineId": "MEDICINE_ID",
  "atMs": 1795800000000,
  "via": "voice"
}
```

Success: **201**

| Field | Type | Required | Notes |
|---|---|---|---|
| `slotId` | string | yes | 3 to 120 characters |
| `medicineId` | string | yes | at least 1 character |
| `atMs` | integer | yes | above 0 |
| `via` | one of "voice", "button" | yes |  |
| `id` | string | yes |  |
| `createdAt` | number | yes |  |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |
| 400 | The medicine is not on this phone's plan (`unknown_medicine`), the slot does not belong to the medicine (`invalid_slot`), or the body is invalid |
| 413 | The body is larger than allowed |

With curl

```bash
curl -s -X POST -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" -d '{"slotId":"MEDICINE_ID|2026-11-28|08:00","medicineId":"MEDICINE_ID","atMs":1795800000000,"via":"voice"}' "$BASE/api/device/doses"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.postDose({ slotId, medicineId, atMs, via })
```

### `POST /api/device/alerts`

**Raise an alert for the family**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Kinds: `missed_dose`, `double_dose`, `emergency`. `missed_dose` and `emergency` are created only if the family consented; the answer says why not (`created: false`, `reason: no_consent`). A missed or repeated-dose alert is unique per slot (`reason: duplicate` on a retry); every emergency is recorded. Answers 201 when created, 200 otherwise.

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | one of "missed_dose", "double_dose", "emergency" | yes |  |
| `slotId` | string | no | up to 120 characters |
| `medicineId` | string | no |  |
| `atMs` | integer | yes | above 0 |

Example

```json
{
  "kind": "emergency",
  "atMs": 1795800000000
}
```

Success: **201**

| Field | Type | Required | Notes |
|---|---|---|---|
| `option 1` | object | no | send exactly one of the options |
| `created` | true | yes |  |
| `alert` | object | yes | no other fields |
| `alert.id` | string | yes |  |
| `alert.kind` | one of "missed_dose", "double_dose", "emergency" | yes |  |
| `alert.slotId` | string | no |  |
| `alert.medicineId` | string | no |  |
| `alert.atMs` | number | yes |  |
| `alert.acknowledgedAt` | number,null | yes |  |
| `alert.delivery` | object | yes | no other fields |
| `alert.delivery.inApp` | one of "delivered", "failed" | yes |  |
| `alert.delivery.push` | "not set up in this prototype" | yes |  |
| `option 2` | object | no | send exactly one of the options |
| `created` | false | yes |  |
| `reason` | one of "no_consent", "duplicate" | yes |  |
| `alert` | object | no | no other fields |
| `alert.id` | string | yes |  |
| `alert.kind` | one of "missed_dose", "double_dose", "emergency" | yes |  |
| `alert.slotId` | string | no |  |
| `alert.medicineId` | string | no |  |
| `alert.atMs` | number | yes |  |
| `alert.acknowledgedAt` | number,null | yes |  |
| `alert.delivery` | object | yes | no other fields |
| `alert.delivery.inApp` | one of "delivered", "failed" | yes |  |
| `alert.delivery.push` | "not set up in this prototype" | yes |  |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |
| 400 | The body is not valid JSON or does not match the schema (unknown fields are refused) |

With curl

```bash
curl -s -X POST -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" -d '{"kind":"emergency","atMs":1795800000000}' "$BASE/api/device/alerts"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.postAlert({ kind, atMs })
```

## Live events: streams and long polling

### `GET /api/care/groups/:id/events`

**Live events for the family: a server-sent-events stream**

Who may call it: a signed-in family member (session cookie).

Each frame is `data: {json}` followed by a blank line. Types: `dose`, `alert`, `plan`, `device`, `voice`, `ping` (every 15 seconds). The server sends a `ping` the moment the stream opens. The stream closes at the next check if the session or the membership ends. Some proxies hold streams back (a Cloudflare quick tunnel does): then use the poll endpoint, or the client in `@kaabil/contract`, which switches by itself.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **200**

A stream of events (see `ServerEvent`) (`text/event-stream`).

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/events"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.events(groupId, { onEvent })   // opens the stream, and polls by itself if it is held back
```

### `GET /api/care/groups/:id/poll`

**The same events by long polling**

Who may call it: a signed-in family member (session cookie).

Ask what happened after event id `after`; the answer waits up to `wait` milliseconds for news. Without `after` the answer has no events and `last` is where to start. Keep the newest `last` and send it as `after` next time. The server keeps the last 100 events per group.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Query

| Name | Meaning |
|---|---|
| `after` | The id of the last event seen. Leave out to get the starting point |
| `wait` | Milliseconds to wait for news, 0 to 10000. Default 0 |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `events` | array of object | yes |  |
| `events[].id` | integer | yes | at least 0 |
| `events[].event` | one of the events `dose`, `alert`, `plan`, `device`, `remind`, `voice`, `call`, `ping` | yes |  |
| `last` | integer | yes | at least 0 |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/poll"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.events(groupId, { onEvent })   // the same call: it falls back to this endpoint by itself
```

### `GET /api/device/events`

**Live events for the person's phone: a server-sent-events stream**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Types: `plan` (the plan changed), `remind` (start a reminder now: from the developer console), `voice` (the family's recordings changed), `ping`. Send the device token in the `Authorization` header (so use `fetch`, not `EventSource`, which cannot set headers).

Success: **200**

A stream of events (`text/event-stream`).

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |

With curl

```bash
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/events"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.events({ onEvent })
```

### `GET /api/device/poll`

**The phone's events by long polling**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Same as the family poll, for the person's phone.

Query

| Name | Meaning |
|---|---|
| `after` | The id of the last event seen. Leave out to get the starting point |
| `wait` | Milliseconds to wait for news, 0 to 10000. Default 0 |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `events` | array of object | yes |  |
| `events[].id` | integer | yes | at least 0 |
| `events[].event` | one of the events `dose`, `alert`, `plan`, `device`, `remind`, `voice`, `call`, `ping` | yes |  |
| `last` | integer | yes | at least 0 |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |

With curl

```bash
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/poll"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.events({ onEvent })   // falls back to this endpoint by itself
```

## Voice: custom voice recordings, and cloud voice status

### `GET /api/voice/status`

**Is cloud speech or voice available?**

Who may call it: anyone.

Both say `key not set` until a provider key is configured on the server. No provider is wired yet: see `docs/api/voice.md`.

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `stt` | one of "ready", "key not set" | yes |  |
| `tts` | one of "ready", "key not set" | yes |  |

With curl

```bash
curl -s "$BASE/api/voice/status"
```

With the typed client (`@kaabil/contract`)

```ts
client.voice.status()
```

### `GET /api/care/groups/:id/voice`

**The sentences Kaabil says to this person, and which have your recording**

Who may call it: a signed-in family member (session cookie).

Custom voice. Every fixed message, with the person's name and the medicines filled in, each with a `textHash` (its name for upload and delete) and `clip` (null when there is no recording).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `sentences` | array of object | yes |  |
| `sentences[].key` | one of "remind", "confirm_log", "logged", "snooze", "already_logged", "not_logged", "clarify", "escalated", "emergency", "buttons", "help", "stopped" | yes |  |
| `sentences[].lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `sentences[].text` | string | yes |  |
| `sentences[].textHash` | string | yes | matches `^[0-9a-f]{16}$` |
| `sentences[].medicineName` | string | no |  |
| `sentences[].clip` | object or null | yes |  |
| `maxBytes` | number | yes |  |
| `maxSeconds` | number | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/voice"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.voice(groupId)
```

### `PUT /api/care/groups/:id/voice/:hash`

**Save your recording of one sentence**

Who may call it: a signed-in family member (session cookie).

The body is the audio itself. Needs the header `x-voice-consent: yes`: the person recording agrees it is stored and played to the person. Accepted types: `audio/wav`, `audio/x-wav`, `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, and the first bytes must match the type. 200 bytes to 1.5 MB. Only a sentence in the list above can be recorded. Replaces an earlier recording. In the browser, process it first (`processRecording` in `@kaabil/voice`: trim, even out, mono 16 kHz WAV).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |
| `hash` | The sentence's `textHash` |

Headers to send

| Header | Value |
|---|---|
| `x-voice-consent` | `yes` |
| `content-type` | `audio/wav` |

Request body

The audio bytes (`audio/wav (or another accepted type)`).

Success: **204**

No body.

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 400 | No consent (`consent_required`), empty or too short (`too_short`), or not the audio it claims (`not_audio`) |
| 404 | Kaabil does not say that sentence to this person |
| 413 | Over 1.5 MB |
| 415 | An audio type that is not accepted (`unsupported_audio`) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X PUT -b cookies.txt -H "Origin: $BASE" -H "x-voice-consent: yes" -H "content-type: audio/wav" --data-binary @clip.wav "$BASE/api/care/groups/$GROUP_ID/voice/$TEXT_HASH"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.uploadClip(groupId, textHash, audioBlob, true)
```

### `GET /api/care/groups/:id/voice/:hash/audio`

**Play back a saved recording (family)**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |
| `hash` | The sentence's `textHash` |

Success: **200**

The audio, with its stored type and `nosniff` (`audio/*`).

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 404 | No such recording |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/voice/$TEXT_HASH/audio"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.clipAudio(groupId, textHash)
```

### `DELETE /api/care/groups/:id/voice/:hash`

**Delete one recording**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |
| `hash` | The sentence's `textHash` |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 404 | No such recording |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X DELETE -b cookies.txt -H "Origin: $BASE" "$BASE/api/care/groups/$GROUP_ID/voice/$TEXT_HASH"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.deleteClip(groupId, textHash)
```

### `DELETE /api/care/groups/:id/voice`

**Delete all recordings of this group**

Who may call it: a signed-in family member (session cookie).

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X DELETE -b cookies.txt -H "Origin: $BASE" "$BASE/api/care/groups/$GROUP_ID/voice"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.deleteAllClips(groupId)
```

### `GET /api/device/voice`

**The recordings the phone may play, with the sentence each one says**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Only recordings whose sentence Kaabil still says (a renamed medicine retires its old recording). The phone plays a recording only when it is about to say exactly that sentence.

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `clips` | array of object | yes |  |
| `clips[].lang` | string | yes | A registered language code, for example te (Telugu) or en (English) |
| `clips[].text` | string | yes |  |
| `clips[].textHash` | string | yes | matches `^[0-9a-f]{16}$` |
| `clips[].contentType` | string | yes |  |
| `clips[].size` | number | yes |  |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |

With curl

```bash
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/voice"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.voiceClips()
```

### `GET /api/device/voice/:hash/audio`

**Fetch a recording (phone)**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Path parameters

| Name | Meaning |
|---|---|
| `hash` | The recording's `textHash`, from the list above |

Success: **200**

The audio, with its stored type and `nosniff` (`audio/*`).

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |
| 404 | No such recording, or its sentence is no longer said |

With curl

```bash
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/voice/$TEXT_HASH/audio"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.clipAudio(textHash)
```

## Calls

### `POST /api/care/groups/:id/call`

**Send a call message to the person's phone**

Who may call it: a signed-in family member (session cookie).

Voice and video calls go directly between the two phones (WebRTC); this server only carries the setup messages. The body is one signal: `ring`, `accept`, `decline`, `offer`, `answer`, `ice` or `hangup`, with a `callId` (8 to 64 letters, digits or dashes, the same for the whole call) and `from` (it must match who is sending). The other side receives it as a live `call` event. Limits: 300 messages a minute and 6 `ring`s in 5 minutes for each care group.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `option 1` | object | no | send exactly one of the options |
| `kind` | "ring" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `withVideo` | boolean | yes |  |
| `option 2` | object | no | send exactly one of the options |
| `kind` | "accept" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `option 3` | object | no | send exactly one of the options |
| `kind` | "decline" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `reason` | one of "declined", "busy" | yes |  |
| `option 4` | object | no | send exactly one of the options |
| `kind` | "offer" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `sdp` | string | yes | 1 to 20000 characters |
| `option 5` | object | no | send exactly one of the options |
| `kind` | "answer" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `sdp` | string | yes | 1 to 20000 characters |
| `option 6` | object | no | send exactly one of the options |
| `kind` | "ice" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `candidate` | object or null | yes |  |
| `option 7` | object | no | send exactly one of the options |
| `kind` | "hangup" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |

Example

```json
{
  "kind": "ring",
  "callId": "call-4f7a9c21",
  "from": "family",
  "withVideo": false
}
```

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 400 | The body is not valid JSON or does not match the schema (unknown fields are refused) |
| 400 | `from` is not `family` (`wrong_sender`) |
| 409 | A `ring` when no phone is paired (`no_phone`) |
| 429 | Too many messages (`rate_limited`) or too many calls (`too_many_calls`) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X POST -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" -d '{"kind":"ring","callId":"call-4f7a9c21","from":"family","withVideo":false}' "$BASE/api/care/groups/$GROUP_ID/call"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.sendCallSignal(groupId, { kind: 'ring', callId, from: 'family', withVideo: false })
```

### `POST /api/device/call`

**Send a call message to the family**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

Voice and video calls go directly between the two phones (WebRTC); this server only carries the setup messages. The body is one signal: `ring`, `accept`, `decline`, `offer`, `answer`, `ice` or `hangup`, with a `callId` (8 to 64 letters, digits or dashes, the same for the whole call) and `from` (it must match who is sending). The other side receives it as a live `call` event. Limits: 300 messages a minute and 6 `ring`s in 5 minutes for each care group.

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `option 1` | object | no | send exactly one of the options |
| `kind` | "ring" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `withVideo` | boolean | yes |  |
| `option 2` | object | no | send exactly one of the options |
| `kind` | "accept" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `option 3` | object | no | send exactly one of the options |
| `kind` | "decline" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `reason` | one of "declined", "busy" | yes |  |
| `option 4` | object | no | send exactly one of the options |
| `kind` | "offer" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `sdp` | string | yes | 1 to 20000 characters |
| `option 5` | object | no | send exactly one of the options |
| `kind` | "answer" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `sdp` | string | yes | 1 to 20000 characters |
| `option 6` | object | no | send exactly one of the options |
| `kind` | "ice" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |
| `candidate` | object or null | yes |  |
| `option 7` | object | no | send exactly one of the options |
| `kind` | "hangup" | yes |  |
| `callId` | string | yes | matches `^[A-Za-z0-9-]{8,64}$` |
| `from` | one of "person", "family" | yes |  |

Example

```json
{
  "kind": "ring",
  "callId": "call-8b21d3e0",
  "from": "person",
  "withVideo": false
}
```

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |
| 400 | The body is not valid JSON or does not match the schema (unknown fields are refused) |
| 400 | `from` is not `person` (`wrong_sender`) |
| 429 | Too many messages (`rate_limited`) or too many calls (`too_many_calls`) |

With curl

```bash
curl -s -X POST -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" -d '{"kind":"ring","callId":"call-8b21d3e0","from":"person","withVideo":false}' "$BASE/api/device/call"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.sendCallSignal({ kind: 'accept', callId, from: 'person' })
```

### `GET /api/care/groups/:id/ice`

**Which servers to use to connect a call (family)**

Who may call it: a signed-in family member (session cookie).

Pass the answer as `iceServers` to `RTCPeerConnection`. Always a public STUN server. When a Cloudflare Realtime TURN key is configured (`CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`), short-lived relay credentials are added so a call still connects when a network blocks the direct path. If the relay cannot be reached the answer is STUN only. Never cached.

Path parameters

| Name | Meaning |
|---|---|
| `id` | The care group id: from POST /api/care/groups or GET /api/care/me |

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `iceServers` | array of object | yes |  |
| `iceServers[].urls` | array of string | yes | 1 to 12 items. each item: up to 200 characters |
| `iceServers[].username` | string | no | up to 500 characters |
| `iceServers[].credential` | string | no | up to 500 characters |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |

With curl

```bash
curl -s -b cookies.txt "$BASE/api/care/groups/$GROUP_ID/ice"
```

With the typed client (`@kaabil/contract`)

```ts
client.family.iceServers(groupId)
```

### `GET /api/device/ice`

**Which servers to use to connect a call (phone)**

Who may call it: the person's paired phone (`Authorization: Bearer <device token>`).

The same answer as the family's. Pass it as `iceServers` to `RTCPeerConnection`.

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `iceServers` | array of object | yes |  |
| `iceServers[].urls` | array of string | yes | 1 to 12 items. each item: up to 200 characters |
| `iceServers[].username` | string | no | up to 500 characters |
| `iceServers[].credential` | string | no | up to 500 characters |

Errors

| Status | When |
|---|---|
| 401 | The device token is missing, malformed, revoked or unknown |

With curl

```bash
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" "$BASE/api/device/ice"
```

With the typed client (`@kaabil/contract`)

```ts
client.device.iceServers()
```

## Developer console (only when KAABIL_DEV_CONSOLE=1)

### `POST /api/dev/remind-now`

**Send a 'remind now' event to the group's phones**

Who may call it: a signed-in family member, and only when the developer console is on.

Only present when the developer console is on (`KAABIL_DEV_CONSOLE=1`). For demos and tests: makes the paired phone start a reminder at once.

Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `groupId` | string | yes |  |
| `medicineId` | string | no |  |

Example

```json
{
  "groupId": "GROUP_ID"
}
```

Success: **200**

| Field | Type | Required | Notes |
|---|---|---|---|
| `ok` | true | yes |  |

Errors

| Status | When |
|---|---|
| 401 | There is no signed-in session |
| 404 | The group is not found, or it belongs to another family (the answer is the same, so ids reveal nothing) |
| 400 | The body is not valid JSON or does not match the schema (unknown fields are refused) |
| 403 | The request did not come from the app: the Origin header is not an allowed one |

With curl

```bash
curl -s -X POST -b cookies.txt -H "Origin: $BASE" -H "Content-Type: application/json" -d '{"groupId":"GROUP_ID"}' "$BASE/api/dev/remind-now"
```

With the typed client (`@kaabil/contract`)

```ts
client.dev.remindNow(groupId)
```

### `GET /dev`

**The plain test console (HTML)**

Who may call it: anyone.

Only present when the developer console is on. A developer tool, not the product screens.

Success: **200**

A single HTML page (`text/html`).

With curl

```bash
curl -s "$BASE/dev"
```

