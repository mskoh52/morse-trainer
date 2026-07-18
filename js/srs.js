// Spaced repetition (SM-2 lite) applied per character.
// A "card" tracks how well a single Morse character is known.

(function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  function newCard() {
    return {
      reps: 0, // consecutive correct answers
      ease: 2.5, // SM-2 ease factor
      intervalDays: 0, // scheduling interval
      due: 0, // timestamp (ms) when next due; 0 = brand new
      lapses: 0, // times forgotten
      seen: 0, // total prompts
      correct: 0, // total correct
    };
  }

  // Update a card after a grade. `correct` is a boolean; `fast` indicates the
  // answer was both correct and prompt (used to bump ease slightly).
  function grade(card, correct, fast, now) {
    now = now || Date.now();
    card = Object.assign(newCard(), card);
    card.seen += 1;
    if (correct) {
      card.correct += 1;
      card.reps += 1;
      // Quality 4 (correct, some hesitation) or 5 (fast/confident).
      const quality = fast ? 5 : 4;
      card.ease = Math.max(1.3, card.ease + (0.1 - (5 - quality) * 0.08));
      if (card.reps === 1) card.intervalDays = 0; // same session again soon
      else if (card.reps === 2) card.intervalDays = 1;
      else card.intervalDays = Math.round(card.intervalDays * card.ease) || 1;
    } else {
      card.reps = 0;
      card.lapses += 1;
      card.ease = Math.max(1.3, card.ease - 0.2);
      card.intervalDays = 0;
    }
    card.due = now + card.intervalDays * DAY_MS;
    return card;
  }

  function isDue(card, now) {
    now = now || Date.now();
    if (!card || card.seen === 0) return true; // never seen -> due
    return card.due <= now;
  }

  // Rough mastery signal for a character (0..1), used to decide lesson pass.
  function accuracy(card) {
    if (!card || card.seen === 0) return 0;
    return card.correct / card.seen;
  }

  window.SRS = { newCard, grade, isDue, accuracy, DAY_MS };
})();
