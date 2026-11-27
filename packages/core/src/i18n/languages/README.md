# Adding a language

The prototype supports **Telugu** (primary) and **English**. Every word Kaabil speaks, understands or shows in a language lives in one file here, so a new language is one new file and one line. Nothing else in the code holds native-language text.

## Steps

1. Copy `te.ts` to `<code>.ts` (for example `ta.ts` for Tamil) and change the export name.
2. Fill in the `LanguageDef`:
   | Field | What to write |
   |---|---|
   | `code`, `name`, `nativeName` | Short code, English name, name in its own script (shown on the language switch) |
   | `locale` | BCP-47 tag for speech recognition and voice, for example `ta-IN` |
   | `scripts` | Unicode ranges of the script (Tamil is `[[0x0b80, 0x0bff]]`). Empty for a Latin-script language |
   | `messages` | All 12 spoken sentences. They are functions, so word order is yours to choose |
   | `stateWords`, `buttonWords` | Listening, thinking, done, ready; Yes, No, Start |
   | `words` | The Yes, No, "I took it", "not yet", stop, help, repeat and emergency words the rules match. `noSuffix` is for languages that negate by a verb ending, as Telugu does |
   | `ui` | Person-screen strings. Leave out any you do not have: they show in English until you add them |
   | `review` | `'draft'` until a native speaker has checked every line |
3. Add it to `LANGUAGES` in `index.ts`. The `LangCode` type grows by itself.
4. Run `npm test`. `languages.test.ts` fails with the name of anything missing or wrong: an empty message, a word that is both Yes and No, an emergency phrase the rules do not recognise, a missing 112 in the emergency message.
5. If the language was a phrase pack in `../packs.ts`, delete its row there.
6. Try it on a real phone. Whether the phone can recognise and speak the language depends on its speech engine, not on our code.

## What changes by itself
The language switch, the reply language when the person speaks a new script, the speech locale, the state and button words, the notices, the Roadmap list, the word rules (they merge every language, so mixed sentences work) and the tests.

## What it does not cover
- Family screens, the test panel and the Roadmap text are in English only. Their strings can move into `ui` the same way when we need them.
- A Latin-script language cannot be told from English by its letters, so the reply language changes only with the language switch.
- Text to speech and recognition quality for a language are not part of this file.
