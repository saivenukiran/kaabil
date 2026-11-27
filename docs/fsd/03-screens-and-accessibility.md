# 3. Screens and accessibility (UI)

What the person and the family see, and the accessibility every screen must meet. Legend: [README](README.md).

## Scope

The person screen, the family screen, the test panel, the roadmap, family setup, themes and motion. Screen drawings are on the design canvas; this chapter is the rule they and the code must obey. Where the canvas shows something the app does not do yet, the status says **Designed, not built**.

## Principles

| # | Principle |
|---|---|
| U1 | **One screen, one job, one main action.** A person screen holds one state word or question, one card, at most two big answer buttons, and SOS. No menus, no scrolling. |
| U2 | **Honest screens.** A screen shows only what the product really does. No payments, no PIN or OTP entry, no "offline" claim for things that need a network, no delivery that did not happen. Placeholders are labelled. |
| U3 | **Everything spoken is also written, large**, and every voice action has a button and a typing fallback. |
| U4 | **Calm.** Motion is short and slow-in, never flashing; "reduce motion" turns it off. |
| U5 | Web first, then the same components on a phone-sized screen. |

## Requirements

### FR-UI-01 Person screen — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-01-1 | The person screen opens | before any reminder | it shows a Start hint, the language buttons, the Yes/No buttons and the SOS button |
| AC-UI-01-2 | A conversation is active | any phase | exactly one state word (listening, thinking, done, ready) and the current sentence are shown large |
| AC-UI-01-3 | The Yes/No buttons are shown | any answer is taken | the answer is spoken back or shown, never silently applied |
| AC-UI-01-4 | Any screen state | the screen is viewed | the SOS button is visible without scrolling |

### FR-UI-02 Large targets and large text — P, to be verified

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-02-1 | A person-screen answer button | measured on a 390 px wide screen | at least 64 px high and 44 px wide, with at least 12 px between buttons |
| AC-UI-02-2 | The main sentence, the state word, the answer buttons | measured | at least 24 px |
| AC-UI-02-3 | Any body text on the web | measured | at least 16 px |
| AC-UI-02-4 | A line of Telugu text | measured | `line-height` of at least 1.3, no clipped glyph |
| AC-UI-02-5 | Browser text size is raised to 200% | the person screen opens | nothing overlaps or is cut off; the page grows instead |

### FR-UI-03 Contrast and colour — P colours defined, themes F

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-03-1 | Any text on its background in any theme | measured with the WCAG formula | at least 4.5:1 (3:1 for text of 24 px or more) |
| AC-UI-03-2 | A state is shown by colour (taken, missed) | viewed in greyscale | the state is still readable from a word or an icon |
| AC-UI-03-3 | The accent is used | any screen | green means Yes or taken, red means No, SOS or missed; no other meaning |
| AC-UI-03-4 | Keyboard focus | any control | a visible focus ring of at least 3:1 contrast |

### FR-UI-04 Themes — F, designed, not built

**Description.** Four themes: light (default), dark, high contrast (pure black and white, plain font), and large (every size one step up, plain font). The family chooses at setup; the person is never asked.

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-04-1 | A theme is chosen | the person screen opens | colours, sizes and fonts come from tokens only; no literal colour in a component |
| AC-UI-04-2 | Each theme | all screens are checked | AC-UI-03-1 passes in every theme |
| AC-UI-04-3 | The device is set to dark mode and no theme was chosen | the app opens | the dark theme is used |
| AC-UI-04-4 | The theme changes | the person screen is open | it changes without a reload and without losing the current conversation |

### FR-UI-05 Calm motion — P partly, F complete

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-05-1 | Any transition | measured | between 120 and 360 ms, animating only transform and opacity |
| AC-UI-05-2 | Listening | the microphone is open | a slow breathing indicator (about 3 seconds per cycle) is shown; nothing flashes |
| AC-UI-05-3 | The device asks for reduced motion | any screen | animations are off and state changes are instant |
| AC-UI-05-4 | A button is pressed | the press | a visible pressed state responds within 100 ms |

### FR-UI-06 Start and the speech permission — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-06-1 | The page has just opened | a reminder is due | a large Start button explains that one tap lets Kaabil speak |
| AC-UI-06-2 | The microphone is denied | the person taps Start | a notice in the person's language explains how to allow it; the buttons still work |
| AC-UI-06-3 | The microphone is unsupported | the page opens | the notice says so; typing and buttons work |

### FR-UI-07 Family screen "Today" — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-07-1 | Doses were logged today | the family screen opens | each dose shows medicine, time, and whether it came by voice or button |
| AC-UI-07-2 | An alert exists | the screen opens | it shows kind (missed, repeated dose, emergency), medicine, time, delivery status, and an Acknowledge control |
| AC-UI-07-3 | Push is not set up (P) | an alert is shown | delivery reads "not set up in this prototype", never "sent" |
| AC-UI-07-4 | An alert is acknowledged | it is shown again | it is marked acknowledged and no longer counted as new |
| AC-UI-07-5 | A day has no doses | the screen opens | an empty state says so in plain words |

### FR-UI-08 Family setup — P form built, wizard designed

**Description.** The family sets the person's name (how to address them), language, consent for alerts, and the medicines (one line each, see chapter 4). The designed onboarding is four steps: who the person is and language, medicines, consent, a test run. P has the same fields as one settings screen; the step-by-step wizard is **designed, not built**.

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-08-1 | First visit | the family opens setup | the fields have sensible defaults and the medicine example `Metformin 500, 1-0-1` is shown |
| AC-UI-08-2 | A required field is empty | the family saves | a message in plain words says which field |
| AC-UI-08-3 | Consent toggles | the family changes them | the change applies from the next alert and is shown on screen |
| AC-UI-08-4 (F) | The wizard | the last step is done | a test reminder can be played so the family hears what the person will hear |

### FR-UI-09 Test panel — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-09-1 | The test panel opens | it runs | all 12 scenarios run against the real engine with expected and actual results shown |
| AC-UI-09-2 | A scenario fails | the panel is viewed | it is shown as failed with the difference, not hidden |

### FR-UI-10 Roadmap and honest labels — P, built

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-10-1 | A placeholder feature (pill check, daily check-in, link guard, send to family) | its screen opens | a banner says "placeholder" and what is missing |
| AC-UI-10-2 | The Roadmap | opened | lists the languages from the registry and what is verified and what is not |
| AC-UI-10-3 | Any screen | searched for the words "offline", "secure", "private" | each use is true for the build (checked at review) |

### FR-UI-11 Phone layout and install — F

**Description.** The same components, laid out for a 390 × 844 screen first, and installable to the home screen so a push notification can open it. The app needs a network for family alerts; only the shell is cached.

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-11-1 | A 390 px wide screen | every screen is opened | no horizontal scroll; targets meet FR-UI-02 |
| AC-UI-11-2 | The app is installed | the network is lost | the person screen opens and the Yes/No flow works; the screen says family alerts will wait for the network |
| AC-UI-11-3 | Landscape orientation | the person screen opens | the main sentence and the answer buttons are both visible |

### FR-UI-12 Errors, empty and loading states — F

| AC | Given | When | Then |
|---|---|---|---|
| AC-UI-12-1 | A server call fails | any screen | a message in plain language says what failed and what will happen next; no technical text or code is shown to a person |
| AC-UI-12-2 | Loading takes longer than one second | any screen | a calm loading state appears; nothing jumps when the content arrives |

## Verification

| Kind | How |
|---|---|
| Automated | Contrast check over all token pairs in each theme; a script that fails the build on a literal colour |
| Manual | Screen reader pass (TalkBack and VoiceOver) on the person and family screens; 200% text; reduced motion |
| Pilot | Reading and tapping test with five elders before any claim about readability |
