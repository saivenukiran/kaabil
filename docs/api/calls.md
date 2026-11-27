# Calls: the person and the family talk, live

A family member can call the person's phone, and the person can call the family, as a voice call or a video call. The voice and the picture go **directly between the two phones** (WebRTC); this server only carries the setup messages and says which servers to use. Endpoints are in [endpoints.md](endpoints.md) (area "Calls").

## What is built, and what was checked

| Part | State | Checked by |
|---|---|---|
| Rules of a call (ring, answer, decline, busy, missed after 45 s, failed after 20 s, one at a time, never answered by itself) | Built | `packages/core` tests, run on random sequences |
| Setup messages: strict shape, size limits, sender check | Built | Contract tests, which also compare the server's schema with the phone's parser on 4,000 random objects |
| Server: pass setup messages to the other side, 4 endpoints, rate limits | Built | 16 API tests (who may ring whom, wrong sender, hostile bodies, limits, relay credentials, a down relay) |
| Call controller (`@kaabil/voice`): no framework, no direct browser use | Built | 26 tests with a fake network and fake connections; each safety rule was broken on purpose and a test failed |
| Browser parts: real connection, microphone with echo cancellation, a "hearing the other side" meter | Built | End-to-end in a real browser (below) |
| Test page: call panels for both sides | Built | 3 TestSutra scripts |
| **Voice really flowing both ways, mute and unmute** | Verified in one browser with fake microphones | `KAABIL_E2E_ATTACH` script: both sides report the microphone on and sound arriving; muting one side stops the sound at the other; unmuting restores it |
| **Two different real devices, over mobile data and Wi-Fi** | **Not yet tested** | The owner's real-phone test below |
| A relay (TURN) for networks that block a direct path | Built and unit tested against a fake; **not run against Cloudflare** | Needs a key from your Cloudflare account (below) |
| Ringing a phone whose page is closed or screen locked | **Not built** | Needs push notifications and an installed app. The page must be open |

## How a call goes

```
family phone                 server                   person's phone
     │  ring ───────────────▶ POST …/call ─────────────▶ rings (live event "call")
     │                                                    the person taps Answer (never by itself)
     │  ◀───────────────────── POST /api/device/call ◀── accept
     │  offer ──────────────▶ ─────────────────────────▶
     │  ◀────────────────────────────────────────────── answer
     │  ◀──── network candidates, both directions ────▶   (trickled while the two find a path)
     │ ═════════════ voice (and video) directly, or through a relay ═════════════
     │  hangup ─────────────▶ ─────────────────────────▶ either side can end it
```

1. The caller creates a call id and sends `ring` (`withVideo` says whether it is a video call). It asks for its microphone straight away, while it rings, so the permission prompt is not in the way later.
2. The other side's screen shows an incoming call. **Only a tap on Answer continues it.** It never answers by itself, so no call can listen to a home without someone knowing.
3. On Answer the callee sends `accept`; the caller makes the offer; the callee answers; both send network candidates as they find them.
4. When the connection is up, both screens show "Connected" and a timer. Either side can mute and hang up.
5. It rings for 45 seconds, then counts as missed (the caller sends `hangup` so the other phone stops ringing). After an answer, if no audio connects within 20 seconds the call fails and both sides are told.

### The setup messages

One JSON object each, sent with `POST /api/care/groups/:id/call` (family) or `POST /api/device/call` (phone), and received as the live event `{ "type": "call", "signal": { … } }`.

| `kind` | Fields besides `callId` and `from` | Sent by |
|---|---|---|
| `ring` | `withVideo` | The caller |
| `accept` | none | The callee, after the tap |
| `decline` | `reason`: `declined` or `busy` | The callee |
| `offer`, `answer` | `sdp` (up to 20,000 characters) | Caller, callee |
| `ice` | `candidate` (`candidate`, `sdpMid`, `sdpMLineIndex`) or `null` for "no more" | Both |
| `hangup` | none | Either |

`callId` is 8 to 64 letters, digits or dashes and is the same for the whole call. `from` is `family` or `person` and **must match who is sending**, or the server answers 400 `wrong_sender`.

### Rules the server enforces

| Rule | Answer |
|---|---|
| A family member can only reach their own group's phones; a phone only its own group's family | 404 for another family's group; the phone has no way to name another group |
| Every message is checked against the strict schema; unknown fields, bad ids, over-long text are refused | 400 |
| A `ring` when no phone is paired | 409 `no_phone`, at once |
| 300 messages a minute for each care group | 429 `rate_limited` |
| 6 `ring`s in 5 minutes for each care group | 429 `too_many_calls`. Other messages still pass, so a call in progress can always hang up |
| A revoked phone | 401 on its next message |

The receiving phone checks every message again with its own parser (`parseSignal`), ignores anything for another call or from its own side, and answers `busy` to a second ring during a call without disturbing the first.

## Which servers connect the phones: `GET …/ice`

`GET /api/care/groups/:id/ice` and `GET /api/device/ice` return `{ "iceServers": [ … ] }` to pass straight to `RTCPeerConnection`.

- **Always** Cloudflare's public STUN server (`stun.cloudflare.com:3478`, free, no account). It lets two phones learn their public addresses, which is enough when the networks allow a direct path.
- **Optional relay (TURN).** Some networks, mobile data above all, do not allow a direct path. A relay then carries the voice. We use Cloudflare Realtime TURN. The server asks Cloudflare for credentials that last an hour, keeps them for half that time, and hands them to the phones. **The API token never leaves the server** and is never logged. If Cloudflare cannot be reached the answer is STUN only, so a call is never refused because of the relay.

### Turning the relay on (a step only the account owner can do)

1. In the Cloudflare dashboard, open **Realtime → TURN** and create a **TURN key**. Note its **key id** and **API token**.
2. Put them in a `.env` file next to `docker-compose.yml` (it is ignored by git and never committed):
   ```
   CF_TURN_KEY_ID=<the key id>
   CF_TURN_API_TOKEN=<the API token>
   ```
3. `docker compose up -d` again. `GET /api/device/ice` now also lists `turn:` and `turns:` addresses.

Cost (Cloudflare's published pricing, read from their documentation on 28 Nov 2026): the relay is billed for data sent from Cloudflare to the phones, **$0.05 per GB, with the first 1,000 GB each month free**; STUN is free. A voice call is a few megabytes an hour, so a test costs nothing. Check the current price before relying on it.

## Using it from code

The pieces are framework-free, so the real app (React, or a phone app later) uses the same ones as the test page.

```ts
import { browserCallDeps, CallController } from '@kaabil/voice';
import { createClient } from '@kaabil/contract';

const client = createClient();                    // the family's client, signed in
const call = new CallController(browserCallDeps({
  role: 'family',
  send: async (s) => { await client.family.sendCallSignal(groupId, s); },
  iceServers: async () => (await client.family.iceServers(groupId)).iceServers,
}));

// Feed in everything that arrives on the live channel:
client.family.events(groupId, { onEvent: (e) => { if (e.type === 'call') call.handleSignal(e.signal); } });

// Draw the screen from the controller:
call.subscribe(() => render(call.view()));       // { state, callId, seconds, muted, localMedia, remoteStream, note }
await call.dial(false);                           // ring (true = video)
await call.accept();                              // only from a tap on Answer
await call.decline();
call.hangup();
call.setMuted(true);
const { bytes, energy } = await call.receivedAudio();   // is voice really arriving?
```

`view().state.phase` is one of `idle`, `calling`, `ringing`, `connecting`, `connected`, `ended`. Attach `view().remoteStream` to an `<audio autoplay>` (and a `<video autoplay playsinline>` for video). The controller releases the microphone and the connection whenever a call ends, whatever the reason.

**Without a microphone** (or if it is refused) the call still connects and the screen says "No microphone: you can listen but not speak". On a video call without a camera it falls back to voice.

## Try it on two real devices

This is the test that matters, and it has **not been done yet**. It needs two devices that can reach the page over HTTPS (a phone needs HTTPS for its microphone).

**Setup (once).** On the computer, with the stack running (`docker compose up`, then `npm run up --workspace @kaabil/edge` for the public HTTPS address), open `https://kaabil.saivenukiran.workers.dev/test/` (or your own address).

| Step | On the computer (the family) | On the phone (the person) |
|---|---|---|
| 1 | In **Family member's phone**: Sign up, Create care group, add a medicine, **Make pairing code** | Open the same address in Chrome |
| 2 | | In **Person's phone**: type the code, **Pair this phone** |
| 3 | In **5. Call the person** tap **Voice call**. Allow the microphone | The phone shows "Incoming voice call". Tap **Answer** and allow the microphone |
| 4 | Both screens say **Connected** with a timer, and a line "Hearing the other side (n KB received)". Speak: the line on the other device should say it hears you | Speak back |
| 5 | Try **Mute**: the other device's line changes to "silent or muted". **Hang up** | The phone shows the call ended |
| 6 | Then the other way: on the phone, **3. Call the family**, tap **Voice call** | The computer rings: Answer |

What to look at, and what each result means:

| You see | Meaning |
|---|---|
| Rings but never connects ("Connecting…" then failed) | The two networks could not find a direct path. Turn the relay on (above) and retry |
| Connected, "Hearing the other side" on both, but you cannot hear it | The device's volume, or the page's sound was blocked: tap once on the page and retry |
| Howling or echo | You are using two devices next to each other. Move apart, or use headphones on one |
| "No microphone" on a phone | The page is not HTTPS, or the microphone was refused in the browser's site settings |
| The phone does not ring | The page must be open on the phone and the phone paired. A closed page cannot be rung |
| The first ring after opening the page takes a few seconds | The public test address holds live streams back; the page notices after 3 seconds of silence and switches to long polling, which is immediate afterwards. A real server address streams from the start |

Please send what you see (with the device and network for each) so the result can be recorded.

## Running the tests

```bash
npm test                                   # includes the call rules, controller, server and schema tests
npm run e2e                                # TestSutra: ring/answer/connect/hang up, and ring/decline
# Voice really flowing needs a browser that has a (fake) microphone, started fresh each time:
chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<a NEW folder> --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
KAABIL_E2E_ATTACH=http://127.0.0.1:9333 npm run e2e
```

(Sign-up allows 10 a minute per address, so many repeated test runs in a minute can fail at sign-up.)

## Known limits

| Limit | Effect |
|---|---|
| The page must be open | No ringing a closed app or locked phone; needs push notifications and an installed app |
| One server process holds the live channel in memory | A server restart drops a call's setup; a call already connected carries on, since the media is direct |
| Both sides ringing at once | Each answers the other "busy"; both see "busy" and try again |
| Group calls, recording and screen sharing | Not built, and not planned for the prototype |
| Calls are not recorded or stored anywhere | By design: the server never receives the voice or the picture |
