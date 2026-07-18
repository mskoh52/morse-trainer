# Developing Morse Trainer

Notes for future contributors (human or AI). The app is deliberately dependency-free
vanilla JS so it runs from `file://` with no build step. A build step exists only to
produce an optional single-file bundle.

## Architecture

Four classic scripts, loaded in order by `index.html`, each an IIFE that attaches its
public surface to `window`:

1. `js/morse.js` → `window.MORSE`, `window.CURRICULUM`, `window.charsThroughLesson`,
   `window.patternToText`, `window.AudioEngine`.
   - `MORSE`: character → dot/dash string (`.` dit, `-` dah).
   - `CURRICULUM`: 20 lessons, `{ id, chars: [a, b] }`, Koch order (letters, then
     numbers, then punctuation).
   - `AudioEngine`: Web Audio sidetone. `charWpm` sets element speed; `codeWpm` is the
     Farnsworth (spacing) speed. `playChar` / `playPattern` schedule beeps; `startTone` /
     `stopTone` drive the live key tone.
2. `js/storage.js` → `window.Store`. localStorage-backed profiles and per-profile
   progress. Keys are versioned (`morse.*.v1`). `Store.DEFAULT_SETTINGS` is the single
   source of settings defaults; `getProgress` backfills missing settings so old saves
   keep working when new settings are added.
3. `js/srs.js` → `window.SRS`. SM-2-lite per character: `grade(card, correct, fast)`,
   `isDue(card)`, `accuracy(card)`. A card is `{reps, ease, intervalDays, due, lapses,
   seen, correct}`.
4. `js/app.js` → the controller (no exports except `window.__morseTest`, see Testing).
   Owns all DOM wiring, the screen router (`showScreen`), the practice `session` object,
   the keyer, word practice, and the signal light.

There is no framework and no bundler for the source: `index.html` references the files
directly. Keep it that way — it is a feature.

## The `session` object (app.js)

One mutable object per practice run. Key fields:

- `queue` / `index` — the character-drill prompts and cursor.
- `mode` — `"see"`, `"listen"`, or `"word"`. Drives how `showCurrentPrompt` /
  `showWordPrompt` render and how the keyer interprets gaps.
- `acceptingInput` — the single gate for all keyer input. It is `true` only while a real
  prompt is on screen. Everything (key press, gap auto-submit, undo/clear/submit) checks
  it. This is what prevents keying during the presentation or between prompts (an early
  bug submitted `MORSE[null]`). If you add a new interactive state, set this correctly.
- `kind` — `"chars"` or `"words"`; which practice is running. Drives `finishSession`.
- `inPractice` — a practice run has started, so stepping back offers **Resume**.
- `teachChars` / `teachIndex` — the navigable presentation carousel.
- `wordPhase`, `words`, `wordIndex`, `wordMarks`, `wordGaps`, `wordReviewed` — word
  practice state (`wordMarks`/`wordGaps` are the raw keyed stream decoded on Submit).

Flow: tapping a lesson calls `startSession`, which always lands on the **presentation
hub** (`startTeach(false)`). The hub carousel shows the lesson's new characters and
offers two choices:

- **Character practice** (`beginCharacterPractice`) — builds a fresh `queue` and runs
  `nextPrompt` over it (see/listen prompts). `finishSession` grades character accuracy,
  handles the ≥90% pass, and advances the lesson.
- **Word practice** (`beginWordPractice`) — a bonus, unlocked only after the lesson's
  character practice is passed (`progress.completed[lessonId]`) and from lesson 3; the
  hub button is hidden entirely before lesson 3, and shown-but-disabled on lesson 3+
  until passed (see `startTeach`). 10 words from `pickWords`.
  Exploratory and ungraded: the learner keys a whole word (recorded as
  `wordMarks`/`wordGaps`), presses Submit, and `decodeWord` interprets the whole stream
  at once. `goToWord` moves between words; a fresh tap after a checked word starts a new
  attempt (`resetWordAttempt`, gated by `wordReviewed`). It never calls `finishSession`
  and does not affect lesson progression.

On a pass, the character summary offers **Next lesson** (only shown when passed) and
**Back to lesson** (re-enters the hub, where word practice is now unlocked).

The **?** header button calls `startTeach(true)` to step back to the presentation
mid-practice; its single **Back to practice** button (`resumePractice`) resumes the
current prompt without advancing. Each mode is independent — there is no automatic
hand-off from characters to words.

## Lesson pass / progression

`finishSession` computes accuracy over the character results only (words are extra
practice and do not affect passing). Pass = ≥ `PASS_ACCURACY` (0.9) AND every new
character was attempted. Passing sets `completed[lesson]`, advances `currentLesson`, and
raises `maxUnlocked`. Manual unlock (tapping a locked lesson) raises `maxUnlocked` after
a confirmation.

## Extending the curriculum

- **Add / reorder characters:** edit `CURRICULUM` in `js/morse.js`. Every character must
  have an entry in `MORSE`. The reference screen and word bank pick these up
  automatically. Update the tests' expected character set if you change the total.
- **Add words:** append to `WORD_BANK` in `js/app.js` (space-separated, letters only).
  `pickWords(lessonId, n)` filters to words spellable from learned characters and
  prefers those containing the lesson's new characters. It only needs the word to be
  spellable; it does not need to be "new-character-only."
- **Change session length / thresholds:** constants at the top of `js/app.js`
  (`SESSION_LENGTH`, `FOCUS_REPS`, `PASS_ACCURACY`, `WORD_START_LESSON`,
  `WORDS_PER_SESSION`). Note lesson 1 is intentionally shorter (no earlier characters to
  pad with) — that is expected, not a bug.

## Keyer timing

`onKeyRelease` classifies a press as dah when held ≥ `settings.keyThresholdMs`
(default 180 ms), else dit.

- **Character mode** auto-submits the single character after `gapTimeoutMs` (when
  auto-submit is on), via `scheduleGapSubmit`. That call also drives the Submit button's
  fill (`startSubmitFill`/`resetSubmitFill`) as a visual countdown to auto-submit.
- **Word mode** records raw elements and the gap before each (`wordMarks`/`wordGaps`)
  and never auto-submits. On Submit, `decodeMarks(marks, gaps, threshold)` decodes the
  whole word: dit/dah by absolute press length, but letter boundaries by each gap
  relative to the estimated dit unit (`letterGap = 2 × ditUnit`). This is why keying
  adapts to the learner's speed and there is no delicate per-letter timeout to hit.
  `decodeMarks` is pure and exposed via `__morseTest` for the decode tests. Note a
  single word can't disambiguate all-equal elements by ratio alone, which is why dit/dah
  stays on the absolute threshold rather than being inferred.

## Signal light

Two lamps share the `.signal-light` style: `#signal-light` (beside the prompt) and
`#teach-light` (beside the presentation character). It is a full second modality:

- `flashPattern(pattern, lightId)` schedules `setTimeout`s that blink the given light
  using the audio's unit timing (`1200 / charWpm` ms) plus a small `startDelay`.
  `playAndFlash(char, lightId)` plays and blinks together; `clearFlash()` cancels
  pending blinks and turns both lamps off.
- Live input: `onKeyPress`/`onKeyRelease` light `#signal-light` while the key is held,
  so it mirrors the learner's own keying.
- It is visual only, so it still conveys the code when audio is muted. In "see" prompts
  the answer is not auto-flashed (that would give it away) — the light only reflects the
  learner's input there.

## Build (single file)

`node build.js` reads `index.html`, inlines `css/styles.css` and the four JS files in
order, and writes `dist/morse-trainer.html`. It fails loudly if a tag it expects to
replace is missing or if any external `href=/src=` reference survives — so if you rename
or reorder the source files, update the anchors in `build.js` (`JS_FILES` and the
`<link>`/`<script>` strings).

## Testing

`node tests/app.test.js` (or `npm test`):

1. Calls `build()` to regenerate the bundle, so tests always run against the compiled
   artifact a user would open — not the loose sources.
2. Extracts the bundled `<script>`, runs it in a Node `vm` with a hand-rolled stub for
   `document`, `localStorage`, `AudioContext`, `scrollTo`, and a no-op `setTimeout`
   (tests are synchronous — scheduled work is intentionally dropped).
3. Asserts against the `window` globals and `window.__morseTest`, which `app.js` exposes
   solely for the harness: the pure helpers (`pickWords`, `decodeMarks`, `WORD_BANK`,
   `MORSE_REVERSE`, tuning constants) plus flow entry points (`selectProfile`,
   `startSession`,
   `beginCharacterPractice`, `beginWordPractice`, `getSession`) used by the end-to-end
   flow test. This export is harmless in the browser; keep it in sync if you rename the
   internals it points at.

The AudioContext stub implements just enough (`createOscillator`, `createGain`,
`currentTime`, `resume`, `destination`) for `AudioEngine` to run during the flow test.

The DOM stub only implements what `boot()` and the pure helpers touch. If you exercise
more DOM in a test, extend the stub in `tests/app.test.js`.

## Gotchas

- **Non-breaking space:** the empty entry display uses a literal U+00A0 in
  `updateEntryDisplay`. Editors/patches that "helpfully" match a normal space will miss
  it. Preserve the nbsp so the entry box keeps its height when empty.
- **Audio needs a user gesture.** The first `AudioContext` use must be inside a click/
  tap handler or the browser blocks it. All current call sites are gesture-initiated.
- **`function` declarations are hoisted; `let`/`const` are not.** Helpers are safe to
  call before their definition line (all invoked at runtime after the IIFE finishes),
  but module-scoped `let` state (e.g. `flashTimers`) must not be read at load time.
