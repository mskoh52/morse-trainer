# Morse Trainer

A no-server, browser-only app for learning Morse code by ear, with spaced repetition.

## Run

Open `index.html` in any modern browser. No build, no install, no network.
(For a local server instead: `python3 -m http.server` in this folder, then visit the printed URL.)

Prefer a single file? Run `node build.js` and open `dist/morse-trainer.html` — the
whole app (HTML, CSS, JS) inlined into one file you can email or drop anywhere.

All state — profiles, progress, spaced-repetition history, settings — lives in the
browser's `localStorage`. Clearing site data resets everything.

## How it works

- **Koch method.** Characters are introduced two per lesson in Koch order, sent at
  full element speed from the first lesson. Clear a lesson at ≥90% accuracy to advance.
- **PARIS-standard speed.** A single WPM slider in Settings sets everything on the
  PARIS standard (dit 1 unit, dah 3, intra-character gap 1, inter-character gap 3, word
  gap 7). A button plays the word "PARIS" at the chosen speed to preview it.
- **Learn by sound.** Prompts play the character; the dot/dash chart is hidden by
  default (toggle in Settings). Tapping a lesson opens its presentation, where the new
  characters can be heard and reviewed.
- **Practice modes.** From the presentation, choose **Character practice** (the Koch
  drill), **Word practice** (sending — key whole words), or **Word comprehension**
  (copying — hear a word and pick it from choices). The two word modes are a bonus: they
  stay locked until this lesson's character practice is passed, and are hidden entirely
  before lesson 3, when the first vowels arrive.
- **Spaced repetition.** Each character is an SM-2 card. Due earlier characters are
  mixed into later lessons to keep them fresh.
- **Word practice (sending).** 10 words built from learned characters, each featuring the
  lesson's new characters. Key the whole word and press **Submit** — the app decodes the
  entire stream at once, inferring letter boundaries from the gaps against the speed set
  in Settings. Key at that speed: run letters together and the decode reflects it. Not
  graded: retry freely, move between words with the arrows.
- **Word comprehension (copying).** The same words, reordered: the app plays a word in
  Morse (with the signal light) and you pick it from multiple-choice buttons. Tap the
  **?** to replay. Not graded.
- **Signal light.** A lamp beside the character is a second modality: it blinks the dits
  and dahs in time with the sound, and lights up live while you hold the key.

## Input

Tap/click (or hold Space on desktop) the key:

- short press = **dit** (`·`)
- long press = **dah** (`−`), threshold adjustable in Settings

After a pause the entered character is checked automatically (or press **Submit**). The
Submit button fills up during that pause to show how long until auto-submit; keying again
resets it.

Above the key, seven dots track your timing at the chosen speed: they fill **yellow** as
you hold (one dot per unit — a dit is one, a dah is three) and **red** during silence
(letter gap = three, word gap = seven), so you can see whether your dits, dahs, and gaps
are the right length.

In word practice there is no auto-submit: key the whole word with natural spacing between
letters, then press **Submit** to decode and check it.

## Lessons

- Tapping a lesson opens its **presentation** (the new characters), then offers
  **Character practice** and (once passed) **Word practice**.
- Passing character practice (≥90%) returns you to the lesson, unlocks its word practice
  bonus, and reveals a **Next lesson** button.
- Cleared lessons stay open for review.
- Future lessons are locked; tapping a locked lesson offers to unlock it after a
  confirmation dialog.
- The **?** button in the practice header steps back to the presentation at any time;
  "Back to practice" returns and resumes the current prompt.

## Profiles

Multiple profiles, each with a cute avatar and its own progress. No passwords.
Delete a profile from **Manage profiles** (beneath the profile grid), or by
long-pressing / right-clicking its card — both confirm first.

## Character reference

The **Character reference** button on the home screen lists every character (letters,
numbers, punctuation). Learned ones show their pattern and play their sound when tapped;
the rest are grayed out.

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | Screens and layout; loads the CSS and JS below |
| `css/styles.css` | Styling (mobile + desktop) |
| `js/morse.js` | Morse table, curriculum, Web Audio sidetone |
| `js/storage.js` | Profiles + progress in localStorage |
| `js/srs.js` | SM-2 spaced repetition |
| `js/app.js` | UI controller, keyer, word practice, signal light |
| `build.js` | Inlines everything into `dist/morse-trainer.html` |
| `tests/app.test.js` | Tests that run against the compiled single file |

## Develop

```bash
node build.js          # or: npm run build   -> dist/morse-trainer.html
node tests/app.test.js # or: npm test        -> builds, then tests the bundle
```

See `DEVELOPING.md` for architecture notes and how to extend the curriculum.
