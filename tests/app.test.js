#!/usr/bin/env node
// Tests that run against the COMPILED single-file build (dist/morse-trainer.html).
//
// The build is (re)generated first, then the bundled <script> is extracted and
// executed inside a minimal DOM/localStorage/AudioContext stub. This exercises
// exactly the code a user loads in the browser, not the loose source files.
//
// No test framework or npm install required: `node tests/app.test.js`.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { build } = require("../build.js");

// ---- Minimal browser environment ------------------------------------------
function makeEl() {
  const classes = new Set();
  const e = {
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : force;
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
      contains: (c) => classes.has(c),
    },
    style: {},
    dataset: {},
    addEventListener() {},
    appendChild(c) { return c; },
    removeChild() {},
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
  };
  return e;
}

function makeDocument() {
  const byId = {};
  return {
    getElementById(id) {
      return byId[id] || (byId[id] = makeEl());
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener() {},
  };
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}

function loadCompiledApp() {
  const outPath = build(); // regenerate the bundle, return its path
  const html = fs.readFileSync(outPath, "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("No <script> block found in compiled output.");

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = makeDocument();
  sandbox.localStorage = makeLocalStorage();
  sandbox.setTimeout = () => 0; // tests are synchronous; drop scheduled work
  sandbox.clearTimeout = () => {};
  sandbox.requestAnimationFrame = () => 0; // hold-dot loop never actually paints
  sandbox.cancelAnimationFrame = () => {};
  sandbox.console = console;
  sandbox.Math = Math;
  sandbox.Date = Date;
  sandbox.Promise = Promise;
  // Enough of the Web Audio surface for AudioEngine to run without throwing.
  const audioNode = { connect: () => audioNode, start() {}, stop() {}, type: "", frequency: { value: 0 } };
  const gainNode = {
    connect: () => audioNode,
    gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, value: 0 },
  };
  sandbox.AudioContext = function () {
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
    this.resume = () => {};
    this.createOscillator = () => audioNode;
    this.createGain = () => gainNode;
  };
  sandbox.scrollTo = () => {};
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox, { filename: "morse-trainer.bundle.js" });
  return sandbox;
}

// ---- Tiny assert harness ---------------------------------------------------
let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(name + " — " + err.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || "not equal") + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// ---- Load once -------------------------------------------------------------
const w = loadCompiledApp();
const { MORSE, CURRICULUM, charsThroughLesson, patternToText, SRS, Store } = w;
const T = w.__morseTest;

check("bundle exposes its public API", () => {
  ["MORSE", "CURRICULUM", "charsThroughLesson", "patternToText", "SRS", "Store"].forEach(
    (k) => assert(w[k], "missing window." + k)
  );
  assert(T && T.pickWords, "missing window.__morseTest.pickWords");
});

check("MORSE covers A-Z, 0-9, and . , ? /", () => {
  const expected = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?/".split("");
  expected.forEach((c) => assert(MORSE[c], "missing pattern for " + c));
  eq(Object.keys(MORSE).length, expected.length, "unexpected MORSE size");
});

check("MORSE patterns are unique (reverse map is lossless)", () => {
  eq(Object.keys(T.MORSE_REVERSE).length, Object.keys(MORSE).length, "two characters share a pattern");
});

check("patternToText renders dits and dahs", () => {
  eq(patternToText(".-"), "·−");
  eq(patternToText(MORSE.K), "−·−");
});

check("curriculum: 20 lessons, 40 unique characters, full coverage", () => {
  eq(CURRICULUM.length, 20);
  const all = CURRICULUM.flatMap((l) => l.chars);
  eq(all.length, 40);
  eq(new Set(all).size, 40, "duplicate characters in curriculum");
  const expected = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?/".split("");
  expected.forEach((c) => assert(all.includes(c), "curriculum missing " + c));
});

check("charsThroughLesson is cumulative and inclusive", () => {
  eq(charsThroughLesson(3).join(""), "KMRSUA");
  eq(charsThroughLesson(0).length, 0);
});

check("SRS: correct answers grow the interval, lapses reset it", () => {
  let card = SRS.grade(undefined, true, true);
  eq(card.reps, 1);
  card = SRS.grade(card, true, true); // reps 2 -> 1 day
  eq(card.intervalDays, 1);
  card = SRS.grade(card, true, false); // reps 3 -> interval * ease
  assert(card.intervalDays >= 1 && card.due > Date.now(), "interval should grow");
  const lapsed = SRS.grade(card, false, false);
  eq(lapsed.reps, 0);
  eq(lapsed.intervalDays, 0);
  eq(lapsed.lapses, 1);
});

check("SRS.isDue: unseen cards are due", () => {
  assert(SRS.isDue(undefined), "new card should be due");
  assert(SRS.isDue({ seen: 0 }), "unseen card should be due");
  assert(!SRS.isDue({ seen: 1, due: Date.now() + 1e6 }), "future card should not be due");
});

check("Store: profile lifecycle persists to localStorage", () => {
  const p = Store.createProfile("Tester", "🦊");
  assert(p.id, "profile should get an id");
  eq(Store.getProfile(p.id).name, "Tester");
  eq(Store.getProgress(p.id).currentLesson, 1);
  eq(Store.listProfiles().length, 1);
  Store.deleteProfile(p.id);
  eq(Store.listProfiles().length, 0);
});

check("no words before lesson 3 (no vowels yet)", () => {
  eq(T.pickWords(1, T.WORDS_PER_SESSION).length, 0);
  eq(T.pickWords(2, T.WORDS_PER_SESSION).length, 0);
});

check("word practice starts at lesson 3", () => {
  eq(T.WORD_START_LESSON, 3);
  const words = T.pickWords(3, T.WORDS_PER_SESSION);
  eq(words.length, T.WORDS_PER_SESSION, "should return a full set of words");
});

// The core requirement: words are spellable from learned characters AND
// include at least one of the lesson's spotlighted (new) characters.
[3, 4, 5, 6, 7, 8].forEach((lessonId) => {
  check("lesson " + lessonId + " words are spellable and feature its new characters", () => {
    const learned = new Set(charsThroughLesson(lessonId));
    const focus = CURRICULUM[lessonId - 1].chars;
    const words = T.pickWords(lessonId, T.WORDS_PER_SESSION);
    assert(words.length > 0, "expected words for lesson " + lessonId);
    words.forEach((word) => {
      word.split("").forEach((ch) =>
        assert(learned.has(ch), word + " uses unlearned character " + ch)
      );
      assert(
        focus.some((f) => word.includes(f)),
        word + " lacks any spotlighted character (" + focus.join(", ") + ")"
      );
    });
  });
});

check("keyed word decodes back to its characters via MORSE_REVERSE", () => {
  const word = "MARS";
  const decoded = word.split("").map((c) => T.MORSE_REVERSE[MORSE[c]]).join("");
  eq(decoded, word);
});

// Synthesize the marks/gaps a learner would produce keying `word` at unit `u`
// (dit=u, dah=3u, intra-letter gap=u, inter-letter gap=3u).
function keyWord(word, u) {
  const marks = [];
  const gaps = [];
  word.split("").forEach((ch, ci) => {
    MORSE[ch].split("").forEach((sym, si) => {
      // Gap before this element: 0 for the very first, u within a letter,
      // 3u between letters.
      if (marks.length === 0) gaps.push(0);
      else if (si === 0) gaps.push(3 * u);
      else gaps.push(u);
      marks.push(sym === "-" ? 3 * u : u);
    });
  });
  return { marks, gaps, threshold: 2 * u, unit: u };
}

check("decodeMarks: segmentation at the chosen speed decodes a word keyed to match", () => {
  ["MARS", "SKUA", "ARM"].forEach((word) => {
    [50, 120, 300].forEach((u) => {
      const { marks, gaps, threshold, unit } = keyWord(word, u);
      eq(T.decodeMarks(marks, gaps, threshold, unit).text, word, word + " at u=" + u);
    });
  });
});

check("decodeMarks: all-same-length elements still classify by press length", () => {
  // "MM" is all dahs; "EE" is all dits. dit/dah is absolute (press length),
  // so uniform-rhythm words still decode correctly.
  const mm = keyWord("MM", 100);
  eq(T.decodeMarks(mm.marks, mm.gaps, mm.threshold, mm.unit).text, "MM");
  const ee = keyWord("EE", 100);
  eq(T.decodeMarks(ee.marks, ee.gaps, ee.threshold, ee.unit).text, "EE");
});

check("decodeMarks: a too-short gap merges letters (wrong split -> wrong text)", () => {
  // If the learner runs two letters together (gap < letter threshold), they
  // decode as one run — the trainer surfaces sloppy spacing rather than hiding it.
  const u = 100;
  // Key "A" then "N" but with only an intra-letter gap between them.
  const marks = [u, 3 * u, 3 * u, u]; // .-  -.  => A N elements
  const gaps = [0, u, u, u]; // all one-unit gaps: no letter break
  const out = T.decodeMarks(marks, gaps, 2 * u, u);
  eq(out.letters.length, 1, "should be read as a single run");
  assert(out.text !== "AN", "merged letters should not decode as AN");
});

// End-to-end flow against the compiled bundle: select a profile, enter a
// lesson, and start each practice mode. Catches DOM-id typos and flow errors.
check("lesson flow: presentation hub -> character practice", () => {
  const p = Store.createProfile("Flow", "🐧");
  T.selectProfile(p.id);
  T.startSession(3);
  let s = T.getSession();
  eq(s.lessonId, 3, "should be on lesson 3");
  eq(s.kind, null, "hub has no mode chosen yet");

  T.beginCharacterPractice();
  s = T.getSession();
  eq(s.kind, "chars");
  eq(s.queue.length, T.SESSION_LENGTH, "lesson 3 drill should be a full session");
  assert(s.target != null, "a prompt target should be selected");
  assert(s.acceptingInput, "keyer should accept input during a prompt");
  assert(s.mode === "see" || s.mode === "listen", "unexpected char prompt mode");
  Store.deleteProfile(p.id);
});

check("lesson flow: word practice yields a full set of word prompts", () => {
  const p = Store.createProfile("Flow2", "🐨");
  T.selectProfile(p.id);
  T.startSession(5);
  T.beginWordPractice();
  const s = T.getSession();
  eq(s.kind, "words");
  eq(s.mode, "word");
  eq(s.words.length, T.WORDS_PER_SESSION);
  assert(typeof s.target === "string" && s.target.length >= 2, "word target should be set");
  assert(s.acceptingInput, "keyer should accept input during a word");
  Store.deleteProfile(p.id);
});

check("word comprehension uses the same words as production, offers choices", () => {
  const p = Store.createProfile("Copy", "🐬");
  T.selectProfile(p.id);
  T.startSession(4);

  T.beginWordPractice();
  const production = T.getSession().words.slice();
  T.beginComprehension();
  const s = T.getSession();
  eq(s.kind, "comprehend");
  eq(s.mode, "comprehend");
  eq(s.words.length, T.WORDS_PER_SESSION);
  // Same word set as production (order may differ).
  eq(
    s.words.slice().sort().join(","),
    production.slice().sort().join(","),
    "comprehension should reuse the production word set"
  );
  const choices = w.document.getElementById("choices").innerHTML;
  assert(
    choices.indexOf('data-word="' + s.target + '"') >= 0,
    "choices should include the target word"
  );
  Store.deleteProfile(p.id);
});

check("word practice button is hidden on lessons 1 and 2", () => {
  const wordBtn = () => w.document.getElementById("teach-start-words");
  const p = Store.createProfile("Early", "🐝");
  T.selectProfile(p.id);
  T.startSession(1);
  assert(wordBtn().classList.contains("hidden"), "hidden on lesson 1");
  T.startSession(2);
  assert(wordBtn().classList.contains("hidden"), "hidden on lesson 2");
  T.startSession(3);
  assert(!wordBtn().classList.contains("hidden"), "shown from lesson 3");
  Store.deleteProfile(p.id);
});

check("word practice is locked until character practice is passed", () => {
  const wordBtn = () => w.document.getElementById("teach-start-words");

  const p = Store.createProfile("Lock", "🦉");
  T.selectProfile(p.id);
  T.startSession(3); // lands on the hub; lesson not passed yet
  assert(wordBtn().disabled, "word practice should be locked before passing");

  // Mark the lesson passed and re-enter: the button should now be enabled.
  const prog = Store.getProgress(p.id);
  prog.completed[3] = { bestAccuracy: 1, completedAt: 0 };
  Store.saveProgress(p.id, prog);
  T.selectProfile(p.id);
  T.startSession(3);
  assert(!wordBtn().disabled, "word practice should unlock after passing");
  Store.deleteProfile(p.id);
});

// ---- Report ----------------------------------------------------------------
console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  failures.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log("All tests passed against dist/morse-trainer.html");
