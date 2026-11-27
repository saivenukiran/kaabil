# 11. Security between the UI and the backend (SEC)

How the browser and the server talk safely, and how the whole app is kept secure. Legend: [README](README.md).

The prototype has no backend, so most of this chapter is release **F**. What the prototype already does is in the first table.

## What the prototype already does (P, built)

| Control | State |
|---|---|
| No secrets in the repository or the browser bundle | Built; a pre-push guard blocks keys, emails, local paths and env files |
| Content-Security-Policy limited to our own origin, `nosniff`, no referrer, no framing, microphone and camera for our origin only, no geolocation | Built in `nginx.conf` |
| Container: non-root, all Linux capabilities dropped, `no-new-privileges` | Built in `docker-compose.yml` |
| Secret scanning and push protection on the repository | On |
| HTTPS | **Not in the Docker image**: it serves HTTP on port 8080 for local use. A public copy must sit behind HTTPS (FR-SEC-01) |
| Dependency checks | Lockfile and `npm ci`; no automated vulnerability audit yet (FR-SEC-12) |

## Threats we design against

| # | Asset | Threat | Main controls |
|---|---|---|---|
| T1 | Elder's health data | Another family reads it (broken access control) | FR-SEC-06 care-group scoping, tests |
| T2 | Sessions and device credentials | Theft by script injection (XSS) or by a lost phone | FR-SEC-03, FR-SEC-08, revocation (chapter 9) |
| T3 | Traffic | Reading or changing data on the network | FR-SEC-01 TLS everywhere |
| T4 | The person | A scammer gets an OTP or PIN, or a risky link opens | A1 in chapter 9, chapter 7 |
| T5 | Alerts | Forged, replayed or blocked alerts | FR-SEC-04, FR-SEC-10, delivery status stored per channel |
| T6 | Keys (cloud speech, vision, push) | Leak through the browser or the repository | FR-SEC-09 |
| T7 | Availability | A flood of requests, or one server failing | FR-SEC-07, backups, uptime check |
| T8 | Model and OCR input | Text in a photo or message instructs the system | FR-SEC-13, B5 (fixed messages) |
| T9 | Supply chain | A bad dependency | FR-SEC-12 |

## Requirements

### FR-SEC-01 TLS on every hop — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-01-1 | Any request to the public hostname over HTTP | it arrives | it is redirected to HTTPS, and no page or API is served over HTTP |
| AC-SEC-01-2 | A TLS scan of the public hostname | it runs before each release | only TLS 1.2 and 1.3 are offered, with modern cipher suites; the target is a top grade on the scanner of the day |
| AC-SEC-01-3 | Any response | headers are read | `Strict-Transport-Security` with at least one year, after we have confirmed that every subdomain is HTTPS (preload is a later, separate decision) |
| AC-SEC-01-4 | The path from the edge to the server | inspected | it is encrypted (a tunnel or TLS with certificate verification on); the server opens no inbound port to the internet |
| AC-SEC-01-5 | The server's calls to the database and to providers | inspected | the database is reachable only from the application network; calls to speech, vision and push providers use HTTPS with verification on |
| AC-SEC-01-6 | The page loads | any resource | no mixed content, no resource from another origin unless listed in the policy |
| AC-SEC-01-7 | Certificates | expiry | renewed automatically; an alert fires if one is within 14 days of expiry |

> Note: browsers allow the microphone, camera and speech recognition only on secure origins (HTTPS or `localhost`), so TLS is also a product requirement.

### FR-SEC-02 One origin for the page and the API — built (compose and nginx)

**Description.** The API is served at `/api` on the same origin as the page. No cross-origin requests are needed, so cross-origin resource sharing stays off.

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-02-1 | A request from another origin | it reaches the API | it is refused; there is no wildcard allow-list |
| AC-SEC-02-2 | The page's `connect-src` | read | it lists only our own origin (plus our own speech-provider route if one is added through our server) |

### FR-SEC-03 Sessions and cookies — partly built (backend): `HttpOnly`, `SameSite=Lax`, `Secure` over https; no `__Host-` prefix or idle timeout yet

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-03-1 | A session cookie | inspected | `HttpOnly`, `Secure`, `SameSite=Lax` or stricter, with the `__Host-` prefix, no domain attribute |
| AC-SEC-03-2 | A session is idle for 30 days, or 12 hours for sensitive actions | the next request | re-authentication is required for the sensitive action |
| AC-SEC-03-3 | A role changes or the email changes | the next request | other sessions are ended |
| AC-SEC-03-4 | The person's device credential | sent | in an `Authorization` header, never in a URL or a query string, never in a cookie |
| AC-SEC-03-5 | Server logs | searched | no cookie, token or credential appears |

### FR-SEC-04 Cross-site request forgery and request origin — built (backend)

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-04-1 | A state-changing request that uses a cookie | the `Origin` header is not ours | 403 |
| AC-SEC-04-2 | A state-changing request | the method | never `GET` |
| AC-SEC-04-3 | A request with the device credential | arrives | it is accepted only for the endpoints that credential may use (FR-AUTH-06) |

### FR-SEC-05 Validate every input — built (backend): strict schemas, 64 KB JSON limit, 1.5 MB for a recording

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-05-1 | Any request body | it arrives | it is checked against a schema; unknown fields, wrong types and oversized values are rejected with 400 |
| AC-SEC-05-2 | A body or an upload above the limit (for example 64 KB for JSON, 5 MB for a photo) | it arrives | 413 before it is read fully |
| AC-SEC-05-3 | Text shown to another user (a message, a medicine name) | it is displayed | it is escaped; no HTML from users is ever rendered |
| AC-SEC-05-4 | Database access | any query | goes through the data library with parameters, never built from strings |
| AC-SEC-05-5 | A photo upload | arrives | the type is checked by content, not by name; it is never executed or served back |

### FR-SEC-06 Authorisation on every request — built (backend); the full role-by-endpoint matrix test is not written

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-06-1 | Any endpoint | it is called without a session or credential | 401 |
| AC-SEC-06-2 | An id that belongs to another care group | it is requested or changed | 404 |
| AC-SEC-06-3 | A role below the endpoint's need | it calls | 403 |
| AC-SEC-06-4 | The test suite | it runs | for every endpoint, a test covers: no auth, wrong group, wrong role, right role |

### FR-SEC-07 Rate limits and abuse control — partly built (backend): pairing and Better Auth's sign-in limit; not messages or photos

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-07-1 | Sign-in, code entry, pairing, invite, message send, photo upload | requests exceed the limit for the address or the account | 429 with a `Retry-After` header |
| AC-SEC-07-2 | A limit is hit on sign-in | it is hit for an account | the owner is told by email |
| AC-SEC-07-3 | The limits | reviewed | they are set so a real family never meets them in normal use |

### FR-SEC-08 Security headers and policy — P built; API headers built (backend); HSTS is sent only over https

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-08-1 | Any page response | headers are read | `Content-Security-Policy` without `unsafe-inline` or `unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` |
| AC-SEC-08-2 | Fonts and images | the page loads them | from our own origin (fonts are self-hosted, so no third party sees who opens the app) |
| AC-SEC-08-3 | Any response | headers are read | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` limited to what the page needs |
| AC-SEC-08-4 | API responses | read | `Cache-Control: no-store` for any response with personal data |

### FR-SEC-09 Secrets — P none; server secrets generated by compose and read from files, built (backend)

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-09-1 | The repository and the browser bundle | scanned | no key, token or password; `.env.example` has names with empty values |
| AC-SEC-09-2 | Production secrets (database password, push keys, provider keys) | stored | in the server's environment outside the repository, readable only by the service account |
| AC-SEC-09-3 | A secret is exposed | it is found | rotate first, delete second, and write what happened |
| AC-SEC-09-4 | Each environment (local, test, production) | configured | has its own keys; production keys are never on a developer's laptop |

### FR-SEC-10 Replay and duplicates — built (backend): doses, alerts and codes

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-10-1 | A dose log or alert sent twice | received | one record (unique on slot id); the second call succeeds without a second effect |
| AC-SEC-10-2 | A pairing or sign-in code | used twice | refused the second time |
| AC-SEC-10-3 | A push payload | built | carries only an id and a kind; the app fetches the details over TLS |

### FR-SEC-11 Server and container hardening — partly built: containers non-root with dropped capabilities, the database is not published; no TLS, no backups, no encrypted-disk check yet

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-11-1 | Containers | inspected | non-root, capabilities dropped, no privileged mode, read-only root file system where the service allows |
| AC-SEC-11-2 | The database | its network | reachable only from the API container; the database user has only the rights it needs |
| AC-SEC-11-3 | Disks and backups | inspected | encrypted at rest (the cloud provider's default is confirmed, not assumed); backups are encrypted and a restore drill has been run |
| AC-SEC-11-4 | The host and images | patching | a monthly window; image versions pinned; a base image is replaced when a fix for a known vulnerability exists |
| AC-SEC-11-5 | Remote access to the host | inspected | key-only, no password login, no database port, no admin panel on the internet |

### FR-SEC-12 Dependencies and supply chain — P partly, F full

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-12-1 | Installs | in CI-less workflow | `npm ci` from the lockfile; Docker builds use `--ignore-scripts` |
| AC-SEC-12-2 | A new dependency | proposed | the PR states why an SDK is needed, its maintenance state and licence |
| AC-SEC-12-3 | Vulnerability audit | before every release | `npm audit` (or equivalent) runs; no known high or critical issue in production dependencies without a written reason |
| AC-SEC-12-4 | GitHub dependency alerts | enabled | they reach both founders |

### FR-SEC-13 Untrusted text and prompt injection — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-13-1 | Text read from a photo, a message or a family reply | it is processed | it is data; it never changes Kaabil's behaviour or what it says |
| AC-SEC-13-2 | Any spoken output | it is produced | it is one of the fixed messages, with names filled in |
| AC-SEC-13-3 | A vision or speech provider's answer | it is received | it is validated against a strict schema before use |

### FR-SEC-14 Realtime channel — built (backend): authenticated, scoped to the group, closes at the next check when a session or phone is revoked; long polling with the same checks when a proxy holds streams back

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-14-1 | A live connection for alerts | it opens | it needs a valid session, delivers only that care group's events, and carries no token in the URL |
| AC-SEC-14-2 | The session is revoked | the connection is open | it is closed within one minute |

### FR-SEC-15 Push notifications and the lock screen — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-15-1 | A push is sent | its text is built | the family can choose "private" wording that omits the medicine and the person's name on the lock screen |
| AC-SEC-15-2 | Push keys | stored | on the server only; a subscription belongs to one user and is removed when they leave |

### FR-SEC-16 Security events and response — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-SEC-16-1 | Sign-ins, failures, role changes, pairings, deletions | they happen | an event is stored without secrets or personal text |
| AC-SEC-16-2 | Failed sign-ins spike, or the uptime check fails | it happens | both founders are told |
| AC-SEC-16-3 | The repository | has a security policy | researchers report a vulnerability privately (GitHub private reporting) and not by a public issue |

## Release gate for F

A release that touches the server does not ship until all of these are done:

| # | Check |
|---|---|
| 1 | The authorisation tests of FR-SEC-06 pass |
| 2 | A TLS scan and a header scan are run on the staging hostname and saved |
| 3 | An automated web scan against staging finds no high-severity issue |
| 4 | Secret scan and dependency audit are clean (or written exceptions) |
| 5 | The chapter's checklist is walked through by the founder who did not write the change |
| 6 | Before a pilot with real elders: a second person or an outside reviewer tries to break authorisation and pairing |

The checklist is based on the OWASP Application Security Verification Standard, level 1 for the whole app and level 2 for sign-in, sessions, pairing and data deletion. This is our working target, not a certification.

## Verification

| Kind | How |
|---|---|
| Automated | API tests per endpoint and role; header tests; log-scan test; rate-limit tests |
| Scans | TLS and header scan on staging; automated web scan; dependency audit |
| Manual | Review by the other founder; the pre-pilot attempt to break it |
