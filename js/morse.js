// Morse code data, curriculum, and audio engine.
// Loaded as a classic script so the app works from file:// with no build step.

(function () {
  "use strict";

  // International Morse. "." = dit, "-" = dah.
  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
    G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
    S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
    "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
    ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.",
  };

  // Curriculum ordered by the Koch method: characters are introduced in the
  // order that maximizes the difficulty of distinguishing them by sound, two
  // per lesson. Letters first (Koch order), then numbers, then punctuation.
  const CURRICULUM = [
    { chars: ["K", "M"] },
    { chars: ["R", "S"] },
    { chars: ["U", "A"] },
    { chars: ["P", "T"] },
    { chars: ["L", "O"] },
    { chars: ["W", "I"] },
    { chars: ["N", "J"] },
    { chars: ["E", "F"] },
    { chars: ["Y", "V"] },
    { chars: ["G", "Q"] },
    { chars: ["Z", "H"] },
    { chars: ["B", "C"] },
    { chars: ["D", "X"] },
    { chars: ["1", "2"] },
    { chars: ["3", "4"] },
    { chars: ["5", "6"] },
    { chars: ["7", "8"] },
    { chars: ["9", "0"] },
    { chars: [".", ","] },
    { chars: ["?", "/"] },
  ].map((lesson, index) => ({ id: index + 1, chars: lesson.chars }));

  // All characters unlocked by the time a given lesson (1-indexed) is reached.
  function charsThroughLesson(lessonId) {
    const out = [];
    for (let i = 0; i < lessonId && i < CURRICULUM.length; i++) {
      out.push(...CURRICULUM[i].chars);
    }
    return out;
  }

  function patternToText(pattern) {
    return pattern.replace(/\./g, "·").replace(/-/g, "−");
  }

  // Web Audio sidetone generator. Plays dits/dahs and whole characters using
  // Farnsworth timing: character elements are sent at `charWpm`, while the gaps
  // between characters/words are stretched to an effective `codeWpm`.
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.frequency = 600;
      this.charWpm = 20; // element speed (Koch: full speed from day one)
      this.codeWpm = 20; // overall/Farnsworth speed (<= charWpm stretches gaps)
      this.muted = false;
      this._activeStop = null; // cancel token for in-flight playback
    }

    setSpeeds(charWpm, codeWpm) {
      this.charWpm = charWpm;
      this.codeWpm = Math.min(codeWpm, charWpm);
    }

    _ensureCtx() {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }

    // Element durations (ms). dit = 1 unit at charWpm.
    unit() {
      return 1200 / this.charWpm;
    }

    // Farnsworth gap unit for spacing between characters (ms).
    _gapUnit() {
      const dit = 1200 / this.charWpm;
      const fdit = 1200 / this.codeWpm;
      // Standard Farnsworth: total delay is distributed so that overall speed
      // matches codeWpm. Simplified: gap unit scales with the slower speed.
      return Math.max(dit, fdit);
    }

    // Play a short beep of `units` length starting at audio-time `at`.
    _beep(at, units) {
      const ctx = this.ctx;
      const dur = (units * this.unit()) / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = this.frequency;
      const ramp = 0.006; // short attack/release to avoid clicks
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.28, at + ramp);
      gain.gain.setValueAtTime(0.28, at + dur - ramp);
      gain.gain.linearRampToValueAtTime(0, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.01);
    }

    // Start a sustained tone (while the key is held down). Idempotent.
    startTone() {
      if (this.muted) return;
      const ctx = this._ensureCtx();
      if (this._liveOsc) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = this.frequency;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.006);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      this._liveOsc = osc;
      this._liveGain = gain;
    }

    stopTone() {
      if (!this._liveOsc) return;
      const ctx = this.ctx;
      const g = this._liveGain;
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.006);
      this._liveOsc.stop(now + 0.02);
      this._liveOsc = null;
      this._liveGain = null;
    }

    // Play a single dit or dah immediately (used for keyer feedback).
    playSymbol(symbol) {
      if (this.muted) return;
      const ctx = this._ensureCtx();
      this._beep(ctx.currentTime + 0.005, symbol === "-" ? 3 : 1);
    }

    // Play a full character. Returns a promise resolving when done (or cancelled).
    playChar(char) {
      const pattern = MORSE[char.toUpperCase()];
      if (!pattern) return Promise.resolve();
      return this.playPattern(pattern);
    }

    playPattern(pattern) {
      if (this.muted) return Promise.resolve();
      const ctx = this._ensureCtx();
      const u = this.unit() / 1000; // seconds
      let t = ctx.currentTime + 0.05;
      for (let i = 0; i < pattern.length; i++) {
        const sym = pattern[i];
        this._beep(t, sym === "-" ? 3 : 1);
        t += (sym === "-" ? 3 : 1) * u;
        if (i < pattern.length - 1) t += 1 * u; // intra-character gap
      }
      const totalMs = (t - ctx.currentTime) * 1000;
      return new Promise((resolve) => {
        const token = {};
        this._activeStop = token;
        setTimeout(() => {
          if (this._activeStop === token) this._activeStop = null;
          resolve();
        }, totalMs + 20);
      });
    }

    // Play a whole word: characters at full speed, separated by a 3-unit
    // inter-character gap (standard Morse letter spacing).
    playWord(word) {
      if (this.muted) return;
      const ctx = this._ensureCtx();
      const u = this.unit() / 1000;
      let t = ctx.currentTime + 0.05;
      const chars = word.toUpperCase().split("");
      chars.forEach((ch, ci) => {
        const pattern = MORSE[ch];
        if (!pattern) return;
        for (let i = 0; i < pattern.length; i++) {
          const sym = pattern[i];
          this._beep(t, sym === "-" ? 3 : 1);
          t += (sym === "-" ? 3 : 1) * u;
          if (i < pattern.length - 1) t += 1 * u; // intra-character gap
        }
        if (ci < chars.length - 1) t += 3 * u; // inter-character gap
      });
    }
  }

  window.MORSE = MORSE;
  window.CURRICULUM = CURRICULUM;
  window.charsThroughLesson = charsThroughLesson;
  window.patternToText = patternToText;
  window.AudioEngine = AudioEngine;
})();
