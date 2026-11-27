# @kaabil/edge: the app on HTTPS, on Cloudflare

A phone only lets a web page use the microphone on a secure (HTTPS) page. This Worker gives the app an HTTPS address on the free Cloudflare plan, with no domain and no server of ours in front.

```
phone ──HTTPS──► Cloudflare Worker (kaabil.<account>.workers.dev)
                   ├─ "/" and "/test/"  served from the built screens (static assets)
                   └─ "/api/*", "/dev"  forwarded to the backend ──► the machine running `docker compose`
```

To the browser it is one origin, so there is no CORS and the sign-in cookie belongs to that host.

## What is where

| Piece | Where it lives |
|---|---|
| The screens (`apps/web`, `apps/testpage`) | Built into `packages/edge/public/` and uploaded with the Worker |
| The Worker (`src/worker.ts`) | Forwards `/api/*` and `/dev`, refuses anything that is not an allowed https backend |
| The backend address | The KV namespace `kaabil-config`, key `origin` (not a secret). Change it without deploying again |
| The backend, database | `docker compose` on the machine running the demo |

The Worker forwards only to an `https` address whose host ends in `.trycloudflare.com` (a Cloudflare quick tunnel). A wrong or hostile value in KV answers 503 and is never called. Set `ALLOWED_ORIGIN_SUFFIXES` (comma separated) in `wrangler.jsonc` to allow another host.

## Deploy

One time, as the owner of the Cloudflare account: `npx wrangler login` (it opens a browser to allow Wrangler).

```bash
npm ci
npm run build:assets --workspace @kaabil/edge        # builds the app and the test page into packages/edge/public
cd packages/edge
npx wrangler deploy                                   # prints https://kaabil.<account>.workers.dev
```

## Point it at the backend (every time the tunnel starts)

A quick tunnel gets a new address each time it starts. Start it, tell the Worker, and tell the backend the public address:

```bash
cloudflared tunnel --url http://localhost:8080        # prints https://<random>.trycloudflare.com
npx wrangler kv key put origin https://<random>.trycloudflare.com --binding CONFIG --remote

# the backend must trust the address people open (the Worker's), not the tunnel's
KAABIL_BASE_URL=https://kaabil.<account>.workers.dev docker compose up -d
```

`KAABIL_BASE_URL` makes the sign-in cookie `Secure` and lets the origin check accept the Worker's address.

## Limits (honest)

- The backend runs on one machine. If that machine sleeps or the tunnel stops, the app shows "The backend is not reachable" and nothing else works. This is for testing and the demo, not a hosting plan.
- Quick tunnels are for testing: no uptime promise, a new address on every start.
- Everything the family and the person do goes through Cloudflare's network. Use fictional data only.
- The Worker cannot reach `localhost`; it only reaches a public https address.
