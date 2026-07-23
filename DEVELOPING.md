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
   - `AudioEngine`: Web Audio sidetone. A single `wpm` sets the unit length
     (1 unit = 1200 / wpm ms) on the PARIS standard (dit 1, dah 3, intra-char gap 1,
     inter-char gap 3, word gap 7). `playChar` / `playPattern` / `playWord` schedule
     beeps; `startTone` / `stopTone` drive the live key tone.
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
hub** (`startTeach`). The hub carousel shows the lesson's new characters and always shows
all three mode buttons:

- **Review** (`beginCharacterPractice`, kind `"chars"`) — builds a fresh `queue` and runs
  `nextPrompt` over it (see/listen prompts). `finishSession` grades character accuracy,
  handles the ≥90% pass, and advances the lesson. The button is labelled **Review**, or
  **Resume review** while a review is in progress (`session.reviewInProgress`, set on start
  and cleared in `finishSession`); resuming calls `resumeReview`, which keeps the drill's
  `queue`/`index`/`results` and re-presents the current queue position via `nextPrompt`.
- **Word practice** (`beginWordPractice`, kind `"words"`) — sending. A bonus, unlocked
  only after the lesson's review is passed (`progress.completed[lessonId]`)
  and from lesson 3; the hub buttons are hidden entirely before lesson 3, and
  shown-but-disabled on lesson 3+ until passed (see `startTeach`). The learner keys a
  whole word (recorded as `wordMarks`/`wordGaps`), presses Submit, and `decodeWord`
  interprets the whole stream at once. A fresh tap after a checked word starts a new
  attempt (`resetWordAttempt`, gated by `wordReviewed`).
- **Word comprehension** (`beginComprehension`, kind `"comprehend"`) — copying. Same
  gating. Plays the word (`playWordAudio` → `AudioEngine.playWord` + `flashWord`) and the
  learner picks it from multiple-choice buttons (`renderChoices`; correct word plus up to
  three distractors from the set). `setInputMode("choice")` swaps the keyer for the
  `#choices` buttons; `acceptingInput` is false so the key/space is inert.

Both word modes share the lesson's word set via `getLessonWords` (cached on the session),
so production and comprehension drill the same words — comprehension just reshuffles. Both
are exploratory and ungraded: `goToWord`/`showCurrentWord` move between words, and neither
calls `finishSession` or affects lesson progression.

On a pass, the character summary offers **Next lesson** (only shown when passed) and
**Back to lesson** (re-enters the hub, where word practice is now unlocked).

The practice header's back button (**✕**, `btn-quit-practice`) is a hierarchical back: in
a drill it calls `startTeach` to step back to the presentation hub (pausing the run);
from the hub it calls `goHome` to leave to the lesson list. The hub never shows a "back to
practice" button — every return lands on the three mode buttons, and **Resume review**
picks the review back up. Each mode is independent — there is no automatic hand-off from
characters to words. (An intro-to-Morse popup lives on the lesson list instead —
`btn-intro` → `openIntro`.)

Stepping back mid-drill must not let a queued prompt render underneath the presentation.
The between-prompt delay (`advanceTimer`, set in `submitEntry`) keeps running, but when it
fires while the hub is visible (`teachPhaseVisible()`), `nextPrompt` just sets
`session.advancePending` and returns instead of presenting. `resumeReview` then presents
the held prompt on return (clearing `advancePending`/`advanceTimer` first).
`startSession`/`beginCharacterPractice`/`goHome` also clear `advanceTimer` so it can never
fire against a torn-down or restarted session.

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
  and never auto-submits. On Submit, `decodeMarks(marks, gaps, threshold, unit)` decodes
  the whole word: dit/dah by absolute press length, and letter boundaries by each gap vs
  the chosen speed's unit (`unit = 1200 / wpm`, `letterGap = 2 × unit`). Segmentation is
  **not** adaptive: the learner is expected to key at the speed set in Settings, so
  sloppy spacing shows up as a wrong decode rather than being silently corrected.
  `decodeMarks` is pure and exposed via `__morseTest` for the decode tests.

## Hold indicator

Seven dots fill at the chosen speed's unit (`1200 / wpm` ms per dot): **yellow** grows
with how long the key is held (dit ≈ 1, dah ≈ 3), **red** grows with how long silence has
lasted since the last release (letter gap = 3, word gap = 7). A single
`requestAnimationFrame` loop (`holdLoop` → `renderHoldDots` → `paintDots`) drives **both**
keyers — the graded prompt's `#hold-dots` and the free-practice `#tp-hold-dots` — since
only one is ever on screen at a time, so they look and behave identically. `renderHoldDots`
picks the target based on `teachPhaseVisible()` vs `holdDotsActive()` and reads that
keyer's own state (`keyDown`/`pressStart`/`holdReleaseAt` or `tpDown`/`tpPressStart`/
`tpReleaseAt`). `startHoldLoop` kicks the shared loop; it self-stops when neither keyer is
active.

## Presentation free-practice keyer

The presentation hub embeds a standalone keyer (`#teach-practice`, below the character
carousel and above the practice-mode buttons) for trying the new characters. It uses the
**same key and timing dots as the graded keyer** so both look identical, but is fully
independent of the graded `session` — its own state (`tpEntry`/`tpDown`/`tpPressStart`/
`tpReleaseAt` and the `tpGapTimer`/`tpClearTimer` timers) lives in the `tp*` functions and
it never touches lesson progress or SRS. `tpFinalize` fires after a character-separation
gap of silence (3 units = `3 × 1200/wpm` ms), decodes via `MORSE_REVERSE`, shows the
letter for 2 s, then blanks. `tpReset` (called on entering the hub via `startTeach`, and
whenever the hub is left for a practice mode) cancels timers and any live tone. On desktop
the spacebar routes to this keyer while the hub is visible (`teachPhaseVisible`) and to
the main keyer otherwise.

**Shared code between the two keyers.** Beyond the hold-dot loop above, both go through
`symbolFor(heldMs)` for the dit/dah split and `bindKey(el, onDown, onUp, isDown)` for
pointer wiring (and long-hold context-menu suppression). The behavior that differs — the
graded keyer feeds `session` and auto-submits via `gapTimeoutMs`; the free-practice keyer
is standalone and auto-decodes at the character-separation gap — stays in their separate
press/release handlers.

## Signal light

Two lamps share the `.signal-light` style: `#signal-light` (beside the prompt) and
`#teach-light` (beside the presentation character). It is a full second modality:

- `flashPattern(pattern, lightId)` schedules `setTimeout`s that blink the given light
  using the audio's unit timing (`1200 / wpm` ms) plus a small `startDelay`.
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
