# 2. Languages and speech (LANG)

How Kaabil speaks, listens and understands, and how a language is added. Legend: [README](README.md).

## Scope

| In scope | Out of scope |
|---|---|
| Telugu (first) and English in the prototype; the way every further language is added; speaking and listening; reply-language choice | Translating the family screens beyond what chapter 4 says; dialect-level tuning; a model that generates sentences |

## Principles

| # | Principle |
|---|---|
| L1 | All native-language text lives in one file per language (`packages/core/src/i18n/languages/<code>.ts`). No other file holds native text. |
| L2 | Kaabil speaks only the 12 fixed messages (B5 in chapter 1), so no sentence reaches a person that we did not write and review. |
| L3 | A language is shown to people as final only after a native speaker has reviewed every line (`review: 'native-reviewed'`). Until then it is a draft and says so. |
| L4 | What the person hears must also be readable on screen, large. |

## Requirements

### FR-LANG-01 Telugu and English (R9) — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-01-1 | Language Telugu | any of the 12 messages is due | it is spoken and shown in Telugu script |
| AC-LANG-01-2 | Language English | any of the 12 messages is due | it is spoken and shown in English |
| AC-LANG-01-3 | Language English | the person answers in Telugu script | the reply language switches to Telugu |
| AC-LANG-01-4 | Language Telugu | the person answers in Latin letters only | the language stays Telugu (Latin letters cannot tell English from other Latin-script languages) |

### FR-LANG-02 One file adds a language (the owner's rule) — P, built

**Description.** Adding a language means copying `te.ts`, filling a `LanguageDef`, and adding one line to the registry. The language switch, reply-language detection, speech locale, state and button words, word rules and Roadmap list read the registry.

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-02-1 | A new language file with an empty message | `npm test` runs | the completeness test fails and names the language and the message |
| AC-LANG-02-2 | A language where one word is both Yes and No | `npm test` runs | the test fails and names the word |
| AC-LANG-02-3 | A made-up language registered only in the test | it is used | it speaks, is understood, is detected by script, and untranslated screen strings show in English, with no change to application code |
| AC-LANG-02-4 | The emergency message of a language lacks the number 112 | `npm test` runs | the test fails |

### FR-LANG-03 Language switch — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-03-1 | Two languages registered | the person screen opens | two buttons are shown, each labelled in its own script ("తెలుగు", "English") |
| AC-LANG-03-2 | A third language is registered | the page reloads | a third button appears without changing the screen code |
| AC-LANG-03-3 | Saved data holds a language that is no longer registered | the app loads | it opens in Telugu without an error |

> Design rule for more than three languages: replace the buttons with a list. Decide before the third language ships.

### FR-LANG-04 Speaking — P browser voice, F cloud voice

**Description.** P uses the browser's text-to-speech, locale from the language file (`te-IN`, `en-IN`), at 0.85 speed so an elder can follow. F adds a server-side cloud voice for Telugu if phones have no good Telugu voice.

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-04-1 | A Telugu voice is installed | a message is due | it is spoken in that voice at the slower rate |
| AC-LANG-04-2 | No voice for the language | a message is due | the text is shown large with a note, and the dose flow still works |
| AC-LANG-04-3 | Speech is blocked until a tap | the page has just opened | a Start hint is shown; the first tap enables speech |
| AC-LANG-04-4 (F) | A cloud voice is configured on the server | a message is due | the audio is fetched from our server (never from the browser with a key) and played; if that fails, the browser voice is used |

### FR-LANG-05 Listening — P browser, F cloud fallback

**Description.** P uses the browser's speech recognition. F: after two failed attempts the audio goes to a cloud speech service through our server, and the result is only text for the word rules. Audio is never stored.

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-05-1 | Chrome with microphone permission | Kaabil finishes speaking | the microphone opens after 300 ms and waits 6 seconds |
| AC-LANG-05-2 | Microphone blocked or unsupported | the page loads | a clear notice is shown in the language and the buttons and text box work |
| AC-LANG-05-3 (F) | Two recognitions failed | the third attempt | cloud recognition is used and the result goes through the same word rules |
| AC-LANG-05-4 (F) | The cloud service is down | an attempt | browser recognition, then the buttons |

### FR-LANG-06 Mixed-language sentences — P, built

**Description.** The word rules merge every registered language's lists, so a sentence mixing Telugu and English is understood. Yes-and-No in one sentence is `mixed` and never acts.

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-06-1 | Both languages registered | "yes వేసుకున్నాను" | recognised as a claim or Yes as the word rules define |
| AC-LANG-06-2 | Both languages registered | "అవును no" | `mixed`; nothing is recorded |

### FR-LANG-07 Review status of the wording — P (draft), F (reviewed)

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-07-1 | `review: 'draft'` | the Roadmap and the docs describe the language | they say the wording is a draft |
| AC-LANG-07-2 (F) | A native speaker has reviewed every line | the file is set to `native-reviewed` | the draft note disappears and the reviewer and date are recorded outside the public repo |
| AC-LANG-07-3 | New Telugu text is added | the PR is opened | the line is added to the review list |

### FR-LANG-08 Further languages — F and L

**Description.** Nine more Indian languages exist as data-only phrase packs (Yes/No words, numbers). A pack becomes a language by writing its file (messages, words, screen strings), removing its row from the packs, and passing the same tests.

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-08-1 | A pack is promoted | `npm test` runs | the completeness tests for the new language pass |
| AC-LANG-08-2 | A promoted language has no reviewed wording | the app lists it | it is marked as a draft |
| AC-LANG-08-3 | A language's phone voice does not exist | it is selected | the text-only fallback of FR-LANG-04 applies and the Roadmap says so |

### FR-LANG-09 Family screens in the family's language — F

**Description.** The family screens, the test panel and the Roadmap are English only today. Their strings move into the language files (`ui`) the same way as the person screen's.

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-09-1 | Family language Telugu | the family dashboard opens | labels and alerts are in Telugu where translated, and in English where not |
| AC-LANG-09-2 | An alert is created | it is shown to the family | its text is built from a fixed template in the family's language, with the person and medicine names filled in |

### FR-LANG-10 Measuring recognition — L (pilot)

| AC | Given | When | Then |
|---|---|---|---|
| AC-LANG-10-1 | A fixed set of 40 Telugu phrases | read by real elders, including with 65 dB background noise | at least 85% are classified correctly by the word rules (target, not a result) |
| AC-LANG-10-2 | The same set | read by a person with slurred or slow speech | the failures are recorded, and the buttons are shown at the second failure |

## Verification

| Kind | Where |
|---|---|
| Automated | `languages.test.ts` (per-language completeness, the made-up language), `words.test.ts` |
| Manual | A real phone: which voice is used, whether recognition works in Telugu (not yet verified) |
| Pilot | FR-LANG-10 |
