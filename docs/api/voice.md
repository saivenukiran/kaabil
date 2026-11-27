# Voice: hearing, deciding, speaking, and the family's own voice

How Kaabil listens to the person, decides what they meant, and speaks to them, and what is built, what is tested and what is not. The endpoints are in [endpoints.md](endpoints.md) (area "Voice").

## The four jobs, kept apart on purpose

| Job | Who does it | Why it is separate |
|---|---|---|
| **Hearing**: sound to text | The browser's speech recognition (Web Speech API), on the person's phone. A cloud model is possible later (below) | A model only supplies *text*. It never decides |
| **Deciding**: text to meaning | **Word rules** in `@kaabil/core` (`interpret`): fixed lists of words per language | A confident but wrong guess by a model must never log a dose. Uncertainty is never a Yes |
| **Speaking**: meaning to sound | The browser's text to speech, or a **recording by a family member** | Kaabil says only its 12 fixed messages, so it cannot say something we did not write |
| **Looking after the answer** | The dose dialogue (`dialogue.ts`), a pure state machine | Same rules in tests, in the browser and in a future phone app |

## Hearing

`@kaabil/voice` holds one `SpeechPort` interface with `speak`, `listen` and `cancel`. The browser implementation (`WebSpeechPort`) uses `speechSynthesis` and `SpeechRecognition`; tests use `ScriptedPort`, which plays back a script.

| Detail | Value |
|---|---|
| Recognition language | The language file's locale (`te-IN`, `en-IN`) |
| The microphone opens | 300 ms after Kaabil stops speaking, so it never hears itself (`speak` also stops listening) |
| It waits for an answer | 6 seconds. After two silences or two unclear answers the large Yes and No buttons appear |
| Needs | A secure page: `https` or `localhost`. On a plain `http://` address a phone blocks the microphone |
| Where it works | Chrome on Android and on a computer is what we have used. Other browsers differ: some have no speech recognition or only part of it (iPhone Safari was not tested), and then the buttons and typing do the whole job |

The turn loop that does speak, listen, decide is `createVoiceLoop` in `@kaabil/voice` (no framework; the React app has the same loop as a hook).

## Deciding: the word rules

`interpret(text)` returns one of: `emergency`, `stop`, `help`, `repeat`, `claim` ("I took it"), `yes`, `no`, `notyet`, `mixed` (a Yes and a No together), `unclear`. The lists live in one file per language (`packages/core/src/i18n/languages/te.ts`, `en.ts`); the rules merge all languages, so a sentence that mixes Telugu and English is understood.

- An **emergency** phrase is checked first and beats everything. Telugu emergency phrases match as parts of words, because Telugu words carry endings.
- Telugu **negation is a verb ending** (`వేసుకోలేదు`, "did not take"), so words ending in `లేదు`, `లేను`, `లేవు` or `లేరు` count as No. Any No beats any Yes or claim.
- A dose is logged only after a **claim and an explicit Yes**. A bare Yes is not enough.
- The speech model's confidence is not used: text in, intent out.

Full rules and the dialogue table are in `docs/SPECS.md` sections 4 and 5. The Telugu words are drafts, not yet reviewed by a native speaker.

## Speaking

| Detail | Value |
|---|---|
| Voice | The installed voice for the language's locale (`pickVoice`), spoken at 0.85 speed so an elder can follow |
| No voice for the language | Common for Telugu on a PC. The sentence is shown large on screen instead, and the dose flow still works. The Voice check tab in the app shows what a device has |
| The first sound | Browsers allow speech only after a tap, so the app asks for one tap to start |
| What can be said | One of 12 fixed messages (`remind`, `confirm_log`, `logged`, `snooze`, `already_logged`, `not_logged`, `clarify`, `escalated`, `emergency`, `buttons`, `help`, `stopped`), with the person's name, the medicine and the strength filled in |

## The family's own voice (custom voice)

A family member records their own voice reading one of Kaabil's sentences, and the person's phone plays that recording instead of the synthetic voice. It is the one place audio is stored, so it has its own rules.

**The flow**

1. `GET /api/care/groups/:id/voice` lists the sentences for this person, in their language, with their name and medicines filled in. Each has a `textHash` (the first 16 hex characters of SHA-256 of `language|sentence`) and `clip` (null until recorded).
2. The family member ticks the consent box and records one sentence. In the browser the recording is processed (below), then `PUT /api/care/groups/:id/voice/:textHash` uploads it with the header `x-voice-consent: yes`.
3. The server checks the consent header, the audio type, that the first bytes match the type, the size (200 bytes to 1.5 MB), and that the hash is a sentence Kaabil says to this person. Anything else is refused. It then stores the audio with the sentence, replacing an earlier recording, and tells the person's phone with a `voice` event.
4. The phone calls `GET /api/device/voice`, which lists the recordings it may play **with the sentence each one says**, and fetches the audio from `GET /api/device/voice/:hash/audio`.
5. When the phone is about to say a sentence, `ClipSpeechPort` looks for a recording of exactly that sentence (language and text must match). If there is one it plays it; if not, or if the recording cannot play, the synthetic voice speaks. **There is never silence.**
6. If the sentence changes (a medicine is renamed or its strength changes) the old recording is retired: it is no longer listed or served, and the family sees the new sentence needs recording.
7. The family can delete one recording or all of them (`DELETE .../voice/:hash`, `DELETE .../voice`). Recordings also go when the care group is deleted.

**Processing in the browser** (`processRecording` in `@kaabil/voice`, before upload): decode, mix to mono, trim the silence at both ends (anything quieter than 45 dB below the loudest sound counts as silence; 80 ms are kept around the speech), bring the loudest sound to -1 dB (never boosting by more than 12 times, so room noise is not turned into loud noise), resample to 16 kHz, write 16-bit WAV. At most 15 seconds; a recording with nothing said is refused with a plain message. A five-second sentence comes to about 160 KB. This also means every phone can play it, whatever its microphone recorded.

**Rules**

- Kaabil still says only its fixed messages. A recording is looked up *by the sentence*, never the other way round, so a recording cannot make Kaabil say something new.
- Nothing is stored without the recorder's consent, and it can be deleted at any time.
- It is the family member's own voice. The person's voice is never recorded or stored.
- Making synthetic speech *in* a family member's voice (voice cloning) is **not built**. It would need the voice owner's explicit consent, a provider whose terms allow it and a clear label on screen (issue 198).

## Cloud voice (Vertex AI): tested, not wired in

`GET /api/voice/status` answers `{ "stt": "key not set", "tts": "key not set" }`. **No cloud speech or voice provider is connected to the app**, and the typed client's `voice.stt` method has no server route yet.

We did test whether a fast Vertex AI Gemini model could recognise Telugu answers, on 40 fictional phrases spoken by a synthetic voice (clean and with added noise):

| Model | Same Yes/No decision, clean / noisy | Median time | Note |
|---|---|---|---|
| `gemini-3-flash-preview` (global region) | 82.5% / 80% | 1.5 s | Best and fastest; a preview model |
| `gemini-2.5-flash` | 80% / 65% | 3.1 s | |
| `gemini-2.5-flash-lite` | 57.5% / 60% | 3 s | Not usable: made up long text on one-second clips, and two false Yes in noise |

How far to trust it: the audio was synthetic and from one voice, the 40 phrases were drafted by us and not checked by a native speaker, and cost was not computed. It is a rough upper bound, never a claim about real elders. The test also found Telugu spelling variants the word rules did not know (chest pain with a short vowel was not an emergency); they are fixed.

If it is added, the design is: browser recognition first, the cloud only after two failures; the server holds the key and only sends text back; **the word rules still decide**; a transcript far longer than a short clip can hold is rejected; the buttons stay as the way out. **It would send the elder's voice to a third party**, which needs the owner's decision and a plain notice first. The harness, results and write-up are in the internal repository under `research/vertex-telugu-stt`.

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| The microphone does nothing on a phone | The page is on a plain `http://` address. Use `https` (the Cloudflare address) or `localhost` |
| The sentence appears but nothing is spoken | No voice for that language on the device (Telugu is often missing). Read it on screen, or have a family member record it |
| "Tap to start" | Browsers allow sound only after a tap. Tap once |
| Recognition does not work | This browser may not support it (use Chrome on Android), or the microphone was refused. Use the Yes and No buttons or type |
| A recording was refused | Check the consent box was ticked, the file is audio, it is under 1.5 MB and under 15 seconds, and the sentence still exists (a renamed medicine changes it) |
| A recording stopped being played | Its sentence changed, so it was retired. Record the new sentence |
| Live updates arrive late | A proxy is holding the stream back. The client switches to polling after three seconds by itself |
