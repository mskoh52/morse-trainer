// Morse Trainer — UI controller. Vanilla JS, no framework, works from file://.

(function () {
  "use strict";

  const SESSION_LENGTH = 20; // prompts per session (fixed; 2 misses = 90% = pass)
  const FOCUS_REPS = 5; // minimum times each new character appears
  const PASS_ACCURACY = 0.9; // Koch method: advance at >= 90% correct
  const FAST_MS = 4500; // correct answer within this window counts as "fast"
  const WORD_START_LESSON = 3; // first vowels (U, A) arrive in lesson 3
  const WORDS_PER_SESSION = 10; // words appended after the character drill

  const audio = new AudioEngine();

  // Reverse lookup (pattern -> character) for decoding keyed words.
  const MORSE_REVERSE = {};
  Object.keys(MORSE).forEach((c) => (MORSE_REVERSE[MORSE[c]] = c));

  // Common short words. Only those spellable from already-learned characters
  // are offered, and each session prefers words containing the lesson's new
  // characters. Word practice begins at lesson 3 (K M R S U A -> first vowels).
  const WORD_BANK = (
    "am as us rum sum arm ram ark ask mar mask arms mars aura karma musk skua " +
    "at up put tap rat mat art part trap task mast mart star maps tram smart stamp strap puma tsar apart " +
    "to or so lot pot top rot oral plot slot salt tool pool roll troll molar solar alto atom stool motor polar mortal parrot " +
    "it is wit win rim sir air sail wait swim milk silk trim pair stir worm word world twirl pilot limit wrist " +
    "an in on nut run sun man pan tin rain main jump join jam jar nails piano minor manor normal junior " +
    "fear fire fine free feet life safe fern felt often offer frame flame fuel leaf reef file mile mole more lose nose note time lime rise wise wife wire snore store stone steam stream forest master faster " +
    "by boy bit bat bad bird black block basic table cabin robin bacon " +
    "cat car can cut cost coast crash chart clock cross clean cream crown " +
    "dog day did drum dream drop dust down " +
    "give gold good game gate great green group grand ground " +
    "hat has had house heart hunt hint help hero " +
    "very vote void grave voice event seven eleven"
  )
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);

  // Pick up to `count` words spellable from characters learned by `lessonId`,
  // preferring words that include at least one of the lesson's new characters.
  function pickWords(lessonId, count) {
    const learned = new Set(charsThroughLesson(lessonId));
    const focus = CURRICULUM[lessonId - 1].chars;
    const spellable = WORD_BANK.filter((w) =>
      w.split("").every((ch) => learned.has(ch))
    );
    const withFocus = spellable.filter((w) =>
      focus.some((f) => w.includes(f))
    );
    const pool = withFocus.length ? withFocus : spellable;
    if (!pool.length) return [];
    if (pool.length >= count) {
      return shuffleNoAdjacentRepeat(pool.slice()).slice(0, count);
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return out;
  }

  // ---- Mutable app state ---------------------------------------------------
  let profileId = null;
  let progress = null;
  let session = null; // active practice session
  let advanceTimer = null; // between-prompt delay timer (char practice)

  const $ = (sel) => document.querySelector(sel);
  const el = (id) => document.getElementById(id);

  // ---- Screen routing ------------------------------------------------------
  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    el("screen-" + name).classList.add("active");
    window.scrollTo(0, 0);
  }

  // ---- Modal ---------------------------------------------------------------
  function openModal(html) {
    el("modal").innerHTML = html;
    el("modal-backdrop").classList.remove("hidden");
  }
  function closeModal() {
    el("modal-backdrop").classList.add("hidden");
    el("modal").innerHTML = "";
  }
  el("modal-backdrop").addEventListener("click", (e) => {
    if (e.target === el("modal-backdrop")) closeModal();
  });

  // ===========================================================================
  // PROFILE SELECT
  // ===========================================================================
  function renderProfiles() {
    const profiles = Store.listProfiles();
    const container = el("profile-list");
    container.innerHTML = "";

    profiles.forEach((p) => {
      const card = document.createElement("button");
      card.className = "profile-card";
      const prog = Store.getProgress(p.id);
      card.innerHTML =
        '<span class="profile-avatar">' + p.avatar + "</span>" +
        '<span class="profile-name">' + escapeHtml(p.name) + "</span>" +
        '<span class="profile-meta">Lesson ' + prog.currentLesson + "</span>";
      card.addEventListener("click", () => selectProfile(p.id));
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        confirmDeleteProfile(p);
      });
      container.appendChild(card);
    });

    const add = document.createElement("button");
    add.className = "profile-card add";
    add.innerHTML =
      '<span class="profile-avatar">+</span><span class="profile-name">New profile</span>';
    add.addEventListener("click", openNewProfile);
    container.appendChild(add);

    // "Manage profiles" is only useful once at least one profile exists.
    el("btn-manage-profiles").classList.toggle("hidden", profiles.length === 0);
  }

  // Manage-profiles modal: a list of every profile with a Delete button that
  // routes through the same confirmation dialog. Reopens itself after a delete
  // so several can be removed in one sitting.
  function openManageProfiles() {
    const profiles = Store.listProfiles();
    const rows = profiles
      .map(
        (p) =>
          '<div class="manage-row" data-id="' + p.id + '">' +
          '<span class="manage-avatar">' + p.avatar + "</span>" +
          '<span class="manage-name">' + escapeHtml(p.name) + "</span>" +
          '<button class="btn danger small manage-del" data-id="' + p.id + '">Delete</button>' +
          "</div>"
      )
      .join("");
    openModal(
      "<h3>Manage profiles</h3>" +
        (rows
          ? '<div class="manage-list">' + rows + "</div>"
          : "<p>No profiles yet.</p>") +
        '<div class="modal-actions">' +
        '<button class="btn" id="manage-done">Done</button>' +
        "</div>"
    );
    el("manage-done").addEventListener("click", closeModal);
    el("modal").querySelectorAll(".manage-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = Store.getProfile(btn.dataset.id);
        if (p) confirmDeleteProfile(p, openManageProfiles);
      });
    });
  }

  function openNewProfile() {
    const avatars = Store.AVATARS.map(
      (a, i) =>
        '<button type="button" class="avatar-choice' +
        (i === 0 ? " selected" : "") +
        '" data-avatar="' + a + '">' + a + "</button>"
    ).join("");
    openModal(
      '<h3>New profile</h3>' +
        '<label class="field-label">Name</label>' +
        '<input id="new-name" class="text-input" maxlength="16" placeholder="Your name" />' +
        '<label class="field-label">Choose an avatar</label>' +
        '<div class="avatar-grid" id="avatar-grid">' + avatars + "</div>" +
        '<div class="modal-actions">' +
        '<button class="btn" id="cancel-profile">Cancel</button>' +
        '<button class="btn primary" id="save-profile">Create</button>' +
        "</div>"
    );
    let chosen = Store.AVATARS[0];
    el("avatar-grid").addEventListener("click", (e) => {
      const btn = e.target.closest(".avatar-choice");
      if (!btn) return;
      el("avatar-grid").querySelectorAll(".avatar-choice").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      chosen = btn.dataset.avatar;
    });
    el("cancel-profile").addEventListener("click", closeModal);
    el("save-profile").addEventListener("click", () => {
      const name = el("new-name").value;
      const p = Store.createProfile(name, chosen);
      closeModal();
      selectProfile(p.id);
    });
    el("new-name").focus();
  }

  // Confirm and delete a profile. `afterDelete` runs once the profile is gone
  // (defaults to just refreshing the grid); the manage modal passes a callback
  // that reopens itself.
  function confirmDeleteProfile(p, afterDelete) {
    openModal(
      "<h3>Delete profile?</h3>" +
        "<p>" + p.avatar + " <strong>" + escapeHtml(p.name) +
        "</strong> and all of this profile's progress will be permanently removed.</p>" +
        '<div class="modal-actions">' +
        '<button class="btn" id="cancel-del">Cancel</button>' +
        '<button class="btn danger" id="do-del">Delete</button>' +
        "</div>"
    );
    el("cancel-del").addEventListener("click", closeModal);
    el("do-del").addEventListener("click", () => {
      Store.deleteProfile(p.id);
      closeModal();
      renderProfiles();
      if (typeof afterDelete === "function") afterDelete();
    });
  }

  function selectProfile(id) {
    profileId = id;
    Store.setActiveProfileId(id);
    progress = Store.getProgress(id);
    applyAudioSettings();
    renderHome();
    showScreen("home");
  }

  // ===========================================================================
  // HOME / LESSON MAP
  // ===========================================================================
  function renderHome() {
    const profile = Store.getProfile(profileId);
    el("home-avatar").textContent = profile.avatar;
    el("home-name").textContent = profile.name;

    const learned = charsThroughLesson(progress.currentLesson - 1);
    el("progress-summary").innerHTML =
      '<div class="stat"><div class="stat-num">' + progress.currentLesson + "</div><div class=\"stat-lbl\">Current lesson</div></div>" +
      '<div class="stat"><div class="stat-num">' + learned.length + "</div><div class=\"stat-lbl\">Characters learned</div></div>" +
      '<div class="stat"><div class="stat-num">' + Object.keys(progress.completed).length + "</div><div class=\"stat-lbl\">Lessons cleared</div></div>";

    const list = el("lesson-list");
    list.innerHTML = "";
    CURRICULUM.forEach((lesson) => {
      const status = lessonStatus(lesson.id);
      const row = document.createElement("button");
      row.className = "lesson-row " + status;
      const done = progress.completed[lesson.id];
      const chips = lesson.chars
        .map((c) => '<span class="chip">' + c + "</span>")
        .join("");
      let badge = "";
      if (status === "completed") {
        const acc = done ? Math.round(done.bestAccuracy * 100) : 0;
        badge = '<span class="lesson-badge done">✓ ' + acc + "%</span>";
      } else if (status === "current") {
        badge = '<span class="lesson-badge current">Start</span>';
      } else {
        badge = '<span class="lesson-badge locked">🔒</span>';
      }
      row.innerHTML =
        '<span class="lesson-num">' + lesson.id + "</span>" +
        '<span class="lesson-body"><span class="lesson-name">Lesson ' + lesson.id +
        '</span><span class="lesson-chars">' + chips + "</span></span>" +
        badge;
      row.addEventListener("click", () => onLessonClick(lesson.id, status));
      list.appendChild(row);
    });
  }

  function lessonStatus(lessonId) {
    if (progress.completed[lessonId]) return "completed";
    if (lessonId <= progress.maxUnlocked) return "current";
    return "locked";
  }

  function onLessonClick(lessonId, status) {
    if (status === "locked") {
      confirmUnlock(lessonId);
      return;
    }
    startSession(lessonId);
  }

  function confirmUnlock(lessonId) {
    const chars = CURRICULUM[lessonId - 1].chars.join(", ");
    openModal(
      "<h3>Unlock Lesson " + lessonId + "?</h3>" +
        "<p>The recommended path is to clear lessons in order. Unlocking early jumps ahead to new characters (<strong>" +
        chars + "</strong>) before earlier ones are mastered.</p>" +
        '<div class="modal-actions">' +
        '<button class="btn" id="cancel-unlock">Cancel</button>' +
        '<button class="btn primary" id="do-unlock">Unlock &amp; practice</button>' +
        "</div>"
    );
    el("cancel-unlock").addEventListener("click", closeModal);
    el("do-unlock").addEventListener("click", () => {
      progress.maxUnlocked = Math.max(progress.maxUnlocked, lessonId);
      if (progress.currentLesson < lessonId) progress.currentLesson = lessonId;
      Store.saveProgress(profileId, progress);
      closeModal();
      startSession(lessonId);
    });
  }

  // ===========================================================================
  // PRACTICE SESSION
  // ===========================================================================
  function buildQueue(lessonId) {
    const lesson = CURRICULUM[lessonId - 1];
    const focus = lesson.chars.slice();
    const review = charsThroughLesson(lessonId - 1); // chars from earlier lessons

    const queue = [];
    // Heavy repetition of the new characters (Koch: drill the new sound).
    focus.forEach((c) => {
      for (let i = 0; i < FOCUS_REPS; i++) queue.push(c);
    });
    // Mix in due review characters to keep older material fresh (SRS).
    const dueReview = review.filter((c) => SRS.isDue(progress.srs[c]));
    dueReview.forEach((c) => queue.push(c));
    // Fill the rest to the target length with earlier characters. Lesson 1 has
    // none, so it stays short (just the focus reps).
    while (queue.length < SESSION_LENGTH && review.length) {
      queue.push(review[Math.floor(Math.random() * review.length)]);
    }
    // Keep every focus rep even if due-review overflowed the target length.
    const trimmed = queue.slice(0, Math.max(SESSION_LENGTH, focus.length * FOCUS_REPS));
    shuffleNoAdjacentRepeat(trimmed);
    return trimmed;
  }

  function startSession(lessonId) {
    const lesson = CURRICULUM[lessonId - 1];

    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    session = {
      lessonId,
      kind: null, // "chars" or "words" once a practice mode is chosen
      queue: [], // character-drill prompts (built when char practice starts)
      index: 0,
      advancePending: false, // a next-prompt advance fired while on the hub
      results: [], // { char, correct }
      perChar: {}, // char -> { seen, correct }
      teachChars: lesson.chars.slice(), // navigable during the presentation
      teachIndex: 0,
      mode: "see",
      target: null,
      promptShownAt: 0,
      entry: "", // dits/dahs entered so far
      locked: false, // true while showing feedback / between prompts
      acceptingInput: false, // true only while a real prompt is on screen
      inPractice: false, // a practice run has started (enables resume)
      words: [], // words in the active word/comprehension run
      wordIndex: 0,
      wordMarks: [], // durations (ms) of each keyed element in the current word
      wordGaps: [], // silence (ms) before each element (wordGaps[0] unused)
      wordReviewed: false, // current word has been submitted and checked
      comprehendAwarded: false, // current comprehension word already credited
      lessonWords: null, // the lesson's word set, shared by both word modes
    };

    el("practice-title").textContent = "Lesson " + lessonId;
    hideSummary();
    showScreen("practice");
    startTeach(false); // land on the presentation hub
  }

  // Toggle the practice controls (prompt, entry, keyer, choices) as a group.
  function setPracticeUiVisible(visible) {
    ["prompt-area", "entry-row", "feedback", "keyer-area", "choices"].forEach((id) =>
      el(id).classList.toggle("hidden", !visible)
    );
  }

  // Choose which answer surface is active: the key (character/word production)
  // or the multiple-choice buttons (word comprehension).
  function setInputMode(kind) {
    el("keyer-area").classList.toggle("hidden", kind !== "key");
    el("entry-row").classList.toggle("hidden", kind !== "key");
    el("choices").classList.toggle("hidden", kind !== "choice");
  }

  // The lesson's word set, picked once and shared by production and
  // comprehension so both drill the same words (comprehension just reorders).
  function getLessonWords() {
    if (!session.lessonWords) {
      session.lessonWords = pickWords(session.lessonId, WORDS_PER_SESSION);
    }
    return session.lessonWords;
  }

  // Show the presentation. `fromReview` = the learner stepped back from an
  // active practice (offer Resume); otherwise this is the lesson's entry hub
  // (offer the Character / Word practice choices).
  function startTeach(fromReview) {
    session.acceptingInput = false;
    session.teachIndex = 0;
    tpReset();
    setPracticeUiVisible(false);
    el("teach-phase").classList.remove("hidden");
    el("teach-label").textContent =
      session.teachChars.length > 1 ? "New characters" : "New character";

    const resuming = fromReview && session.inPractice;
    el("teach-actions").classList.toggle("hidden", resuming);
    el("teach-resume").classList.toggle("hidden", !resuming);

    // Word practice unlocks once the first vowels arrive and words are spellable.
    // Word practice is a bonus: it unlocks only once this lesson's character
    // practice has been passed (and words exist for the learned characters).
    const charsPassed = !!progress.completed[session.lessonId];
    const hasWords =
      session.lessonId >= WORD_START_LESSON &&
      pickWords(session.lessonId, 1).length > 0;
    const wordsReady = charsPassed && hasWords;
    // Both word modes share gating: hidden entirely before lesson 3, then shown
    // but locked until this lesson's character practice is passed.
    ["teach-start-words", "teach-start-listen"].forEach((id) => {
      const btn = el(id);
      btn.classList.toggle("hidden", session.lessonId < WORD_START_LESSON);
      btn.disabled = !wordsReady;
      btn.title = wordsReady ? "" : "Pass character practice to unlock";
    });

    renderTeachDots();
    renderTeachChar(true);
  }

  function renderTeachChar(play) {
    const char = session.teachChars[session.teachIndex];
    el("teach-char").textContent = char;
    el("teach-pattern").textContent = patternToText(MORSE[char]);
    el("teach-prev").disabled = session.teachIndex === 0;
    el("teach-next").disabled = session.teachIndex === session.teachChars.length - 1;
    updateTeachDots();
    if (play) playAndFlash(char, "teach-light");
    else clearFlash();
  }

  function renderTeachDots() {
    const dots = el("teach-dots");
    if (session.teachChars.length <= 1) {
      dots.innerHTML = "";
      return;
    }
    dots.innerHTML = session.teachChars
      .map((_, i) => '<span class="teach-dot" data-i="' + i + '"></span>')
      .join("");
    updateTeachDots();
  }

  function updateTeachDots() {
    document.querySelectorAll("#teach-dots .teach-dot").forEach((d, i) =>
      d.classList.toggle("active", i === session.teachIndex)
    );
  }

  function teachGo(delta) {
    const n = session.teachChars.length;
    const next = Math.min(n - 1, Math.max(0, session.teachIndex + delta));
    if (next === session.teachIndex) return;
    session.teachIndex = next;
    renderTeachChar(true);
  }

  // Start character practice fresh (rebuilds the drill queue).
  function beginCharacterPractice() {
    session.kind = "chars";
    session.inPractice = true;
    session.mode = "see";
    session.index = 0;
    session.results = [];
    session.perChar = {};
    session.target = null;
    session.advancePending = false;
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    session.queue = buildQueue(session.lessonId);
    tpReset();
    el("teach-phase").classList.add("hidden");
    setPracticeUiVisible(true);
    setInputMode("key");
    nextPrompt();
  }

  // Start word production practice: key each word (same set as comprehension).
  function beginWordPractice() {
    const words = getLessonWords();
    if (!words.length) return;
    session.kind = "words";
    session.inPractice = true;
    session.mode = "word";
    session.words = words.slice();
    session.wordIndex = 0;
    tpReset();
    el("teach-phase").classList.add("hidden");
    setPracticeUiVisible(true);
    setInputMode("key");
    showWordPrompt();
  }

  // Start word comprehension: hear a word, pick it from choices. Same words as
  // production, reordered.
  function beginComprehension() {
    const words = getLessonWords();
    if (!words.length) return;
    session.kind = "comprehend";
    session.inPractice = true;
    session.mode = "comprehend";
    session.words = shuffleNoAdjacentRepeat(words.slice());
    session.wordIndex = 0;
    tpReset();
    el("teach-phase").classList.add("hidden");
    setPracticeUiVisible(true);
    setInputMode("choice");
    showComprehension();
  }

  function goToWord(delta) {
    const next = Math.min(
      session.words.length - 1,
      Math.max(0, session.wordIndex + delta)
    );
    if (next === session.wordIndex) return;
    session.wordIndex = next;
    showCurrentWord();
  }

  // Render the current word in whichever word mode is active.
  function showCurrentWord() {
    if (session.kind === "comprehend") showComprehension();
    else showWordPrompt();
  }

  // Resume the practice that was paused when the learner stepped back.
  function resumePractice() {
    tpReset();
    el("teach-phase").classList.add("hidden");
    setPracticeUiVisible(true);
    if (session.kind === "words") {
      setInputMode("key");
      showWordPrompt();
    } else if (session.kind === "comprehend") {
      setInputMode("choice");
      showComprehension();
    } else {
      setInputMode("key");
      if (session.advancePending) {
        // A between-prompt advance fired while the hub was up: present it now.
        session.advancePending = false;
        nextPrompt();
      } else if (advanceTimer == null) {
        // No advance in flight: resume the current, still-unanswered prompt.
        showCurrentPrompt();
      }
      // Otherwise an advance is still scheduled; its timer will present the next
      // prompt. The lingering feedback stays visible until then.
    }
  }

  // "Hear it" replays the current character; it does not advance.
  el("teach-play").addEventListener("click", () => {
    if (session) playAndFlash(session.teachChars[session.teachIndex], "teach-light");
  });
  el("teach-prev").addEventListener("click", () => teachGo(-1));
  el("teach-next").addEventListener("click", () => teachGo(1));
  el("teach-start-chars").addEventListener("click", beginCharacterPractice);
  el("teach-start-words").addEventListener("click", () => {
    if (!el("teach-start-words").disabled) beginWordPractice();
  });
  el("teach-start-listen").addEventListener("click", () => {
    if (!el("teach-start-listen").disabled) beginComprehension();
  });
  el("teach-resume").addEventListener("click", resumePractice);
  el("word-prev").addEventListener("click", () => goToWord(-1));
  el("word-next").addEventListener("click", () => goToWord(1));

  el("teach-dots").addEventListener("click", (e) => {
    const dot = e.target.closest(".teach-dot");
    if (!dot || !session) return;
    session.teachIndex = Number(dot.dataset.i);
    renderTeachChar(true);
  });

  // Swipe left/right on the character box to move between characters.
  let teachTouchX = null;
  el("teach-box").addEventListener(
    "touchstart",
    (e) => {
      teachTouchX = e.changedTouches[0].clientX;
    },
    { passive: true }
  );
  el("teach-box").addEventListener("touchend", (e) => {
    if (teachTouchX === null) return;
    const dx = e.changedTouches[0].clientX - teachTouchX;
    teachTouchX = null;
    if (Math.abs(dx) > 40) teachGo(dx < 0 ? 1 : -1);
  });

  // Advance to the next queued prompt (picks a new target).
  function nextPrompt() {
    if (!session) return; // session was left before the timer fired
    // If the learner stepped back to the presentation, hold the next prompt
    // until they return. resumePractice replays it; the scheduling timer has
    // already run, so only the visible/audible presentation is deferred.
    if (teachPhaseVisible()) {
      session.advancePending = true;
      return;
    }
    if (session.index >= session.queue.length) {
      finishSession();
      return;
    }
    const char = session.queue[session.index];
    session.target = char;
    // Newly taught characters are shown more often; otherwise favor ear training.
    const justTaught = CURRICULUM[session.lessonId - 1].chars.includes(char);
    session.mode = Math.random() < (justTaught ? 0.5 : 0.35) ? "see" : "listen";
    showCurrentPrompt();
  }

  // ---- Word phase ----------------------------------------------------------
  // Exploratory whole-word practice (entered via the presentation hub). The
  // learner keys a whole word at a natural rhythm; there is no per-letter
  // timeout and no auto-submit. Pressing Submit decodes the entire keyed stream
  // at once, inferring letter boundaries adaptively from the learner's own
  // timing. Not graded: retry freely and move between words with the arrows.
  function showWordPrompt() {
    session.locked = false;
    session.wordMarks = [];
    session.wordGaps = [];
    session.wordReviewed = false;
    wordLastRelease = 0;
    clearFlash();
    resetSubmitFill();
    setInputMode("key");
    el("feedback").textContent = "";
    el("feedback").className = "feedback";

    const total = session.words.length;
    session.target = session.words[session.wordIndex];
    el("practice-progress-bar").style.width =
      Math.round(((session.wordIndex + 1) / total) * 100) + "%";

    el("prompt-instruction").textContent = "Key this word, then press Submit";
    el("prompt-target").textContent = session.target;
    el("prompt-target").classList.remove("mystery");
    el("prompt-target").classList.add("word");
    el("prompt-hint").textContent = progress.settings.showHints
      ? session.target.split("").map((c) => patternToText(MORSE[c])).join("  ")
      : "";
    el("word-nav").classList.remove("hidden");
    el("word-count").textContent = session.wordIndex + 1 + " / " + total;
    el("word-prev").disabled = session.wordIndex === 0;
    el("word-next").disabled = session.wordIndex === total - 1;
    updateEntryDisplay();
    session.promptShownAt = Date.now();
    session.acceptingInput = true;
    startHoldDots();
  }

  // ---- Word comprehension --------------------------------------------------
  // Receiving practice: play a word in Morse; the learner picks it from
  // multiple choices. Same word set as production, reordered. Ungraded.
  function showComprehension() {
    session.locked = false;
    session.comprehendAwarded = false;
    session.acceptingInput = false; // answers come from the choice buttons
    clearFlash();
    resetSubmitFill();
    setInputMode("choice");
    el("feedback").textContent = "";
    el("feedback").className = "feedback";

    const total = session.words.length;
    session.target = session.words[session.wordIndex];
    el("practice-progress-bar").style.width =
      Math.round(((session.wordIndex + 1) / total) * 100) + "%";

    el("prompt-instruction").textContent = "Which word did you hear? (tap ? to replay)";
    el("prompt-target").textContent = "?";
    el("prompt-target").classList.add("mystery");
    el("prompt-target").classList.remove("word");
    el("prompt-hint").textContent = "";
    el("word-nav").classList.remove("hidden");
    el("word-count").textContent = session.wordIndex + 1 + " / " + total;
    el("word-prev").disabled = session.wordIndex === 0;
    el("word-next").disabled = session.wordIndex === total - 1;
    renderChoices();
    playWordAudio(session.target, el("signal-light"));
    session.promptShownAt = Date.now();
  }

  function renderChoices() {
    const correct = session.target;
    const pool = session.words.filter((w) => w !== correct);
    const distractors = shuffleNoAdjacentRepeat(pool.slice()).slice(
      0,
      Math.min(3, pool.length)
    );
    const options = shuffleNoAdjacentRepeat([correct].concat(distractors));
    el("choices").innerHTML = options
      .map(
        (w) =>
          '<button class="btn choice-btn" data-word="' + w + '">' +
          escapeHtml(w) + "</button>"
      )
      .join("");
  }

  el("choices").addEventListener("click", (e) => {
    const btn = e.target.closest(".choice-btn");
    if (!btn || !session || session.mode !== "comprehend") return;
    const chosen = btn.dataset.word;
    const correct = session.target;
    el("choices").querySelectorAll(".choice-btn").forEach((b) =>
      b.classList.remove("correct", "wrong")
    );
    const fb = el("feedback");
    if (chosen === correct) {
      btn.classList.add("correct");
      fb.className = "feedback ok";
      fb.innerHTML = "✓ " + correct + " — ▸ for the next word";
      if (!session.comprehendAwarded) {
        new Set(correct.split("")).forEach((c) => {
          progress.srs[c] = SRS.grade(progress.srs[c], true, false);
        });
        Store.saveProgress(profileId, progress);
        session.comprehendAwarded = true;
      }
    } else {
      btn.classList.add("wrong");
      const right = el("choices").querySelector('[data-word="' + correct + '"]');
      if (right) right.classList.add("correct");
      fb.className = "feedback bad";
      fb.innerHTML = "✗ that was <strong>" + escapeHtml(correct) + "</strong>";
    }
  });

  // Decode a keyed stream into letters. Pure and testable: dit/dah come from
  // the press length vs `threshold` (absolute); letter boundaries come from each
  // gap vs the chosen speed's unit (`unit` ms = 1200 / wpm), NOT from the
  // learner's own rhythm. The learner is expected to key at the speed they set.
  function decodeMarks(marks, gaps, threshold, unit) {
    if (!marks.length) return { letters: [], text: "" };
    const letterGap = 2 * unit; // > this gap = new letter (intra=1, inter=3)

    const letters = [];
    let current = "";
    marks.forEach((mark, i) => {
      if (i > 0 && gaps[i] >= letterGap) {
        letters.push(current);
        current = "";
      }
      current += mark >= threshold ? "-" : ".";
    });
    if (current) letters.push(current);
    const text = letters.map((p) => MORSE_REVERSE[p] || "?").join("");
    return { letters, text };
  }

  function decodeWord() {
    return decodeMarks(
      session.wordMarks,
      session.wordGaps,
      progress.settings.keyThresholdMs,
      1200 / progress.settings.wpm
    );
  }

  function submitWord() {
    if (!session || !session.acceptingInput || !session.wordMarks.length) return;
    session.acceptingInput = false;
    session.locked = true;
    session.wordReviewed = true;
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    const target = session.target;
    const decoded = decodeWord().text;
    const correct = decoded === target;

    // Reward the constituent characters in SRS only on a fully correct word.
    if (correct) {
      new Set(target.split("")).forEach((c) => {
        progress.srs[c] = SRS.grade(progress.srs[c], true, false);
      });
      Store.saveProgress(profileId, progress);
    }

    const fb = el("feedback");
    if (correct) {
      fb.className = "feedback ok";
      fb.innerHTML = "✓ " + target + " — tap the key to try again, or ▸ for the next word";
    } else {
      fb.className = "feedback bad";
      fb.innerHTML =
        "✗ You keyed <strong>" + escapeHtml(decoded || "—") +
        "</strong><br>target was <strong>" + escapeHtml(target) +
        "</strong> — tap the key to try again";
    }
    // Stay on this word; the learner retries or navigates. Re-enable input so a
    // fresh tap starts a new attempt (handled in onKeyPress via wordReviewed).
    session.acceptingInput = true;
  }

  // Render the current target. Used both to start a prompt and to resume one
  // after visiting the presentation phase, so it must not advance the queue.
  function showCurrentPrompt() {
    session.locked = false;
    session.entry = "";
    resetSubmitFill();
    setInputMode("key");
    updateEntryDisplay();
    el("feedback").textContent = "";
    el("feedback").className = "feedback";

    const char = session.target;
    const total = session.queue.length;
    el("practice-progress-bar").style.width =
      Math.round((session.index / total) * 100) + "%";
    el("prompt-target").classList.remove("word");
    el("word-nav").classList.add("hidden");

    if (session.mode === "see") {
      el("prompt-instruction").textContent = "Key this character";
      el("prompt-target").textContent = char;
      el("prompt-target").classList.remove("mystery");
      clearFlash();
    } else {
      el("prompt-instruction").textContent = "Key what you hear (tap ? to replay)";
      el("prompt-target").textContent = "?";
      el("prompt-target").classList.add("mystery");
      playAndFlash(char);
    }
    el("prompt-hint").textContent = progress.settings.showHints
      ? patternToText(MORSE[char])
      : "";
    session.promptShownAt = Date.now();
    session.acceptingInput = true;
    startHoldDots();
  }

  // Tap the mystery "?" to replay the sound: single character in listen mode,
  // the whole word in comprehension mode.
  el("prompt-target").addEventListener("click", () => {
    if (!session) return;
    if (session.mode === "listen" && session.acceptingInput) {
      playAndFlash(session.target);
    } else if (session.mode === "comprehend") {
      playWordAudio(session.target, el("signal-light"));
    }
  });

  // ---- Signal light --------------------------------------------------------
  // A lamp beside the character (both in the presentation and the prompt) that
  // is a full second modality: it blinks the code in step with the sidetone,
  // and it also lights up live while the learner holds the key.
  let flashTimers = [];
  let flashLight = null; // element currently being blinked (for cleanup)
  const LIGHT_IDS = ["signal-light", "teach-light"];

  function clearFlash() {
    flashTimers.forEach(clearTimeout);
    flashTimers = [];
    LIGHT_IDS.forEach((id) => el(id).classList.remove("on"));
    if (flashLight) {
      flashLight.classList.remove("on");
      flashLight = null;
    }
  }

  // Blink a pattern on any lamp element, timed to the audio unit.
  function flashPatternEl(light, pattern) {
    clearFlash();
    flashLight = light;
    const unit = 1200 / progress.settings.wpm; // ms per dit, matches audio
    const startDelay = 60; // roughly the audio scheduling offset
    let t = startDelay;
    pattern.split("").forEach((sym) => {
      const len = (sym === "-" ? 3 : 1) * unit;
      flashTimers.push(setTimeout(() => light.classList.add("on"), t));
      flashTimers.push(setTimeout(() => light.classList.remove("on"), t + len));
      t += len + unit; // one-unit gap between elements
    });
  }

  function flashPattern(pattern, lightId) {
    flashPatternEl(el(lightId || "signal-light"), pattern);
  }

  // Play a character and blink it on the given light (default: the prompt light).
  function playAndFlash(char, lightId) {
    audio.playChar(char);
    flashPattern(MORSE[char], lightId);
  }

  // Blink a whole word on `light`, with 3-unit gaps between letters, matching
  // the audio in playWord.
  function flashWord(light, word) {
    clearFlash();
    flashLight = light;
    const unit = 1200 / progress.settings.wpm;
    let t = 60; // audio scheduling offset
    word.split("").forEach((ch, ci) => {
      MORSE[ch].split("").forEach((sym) => {
        const len = (sym === "-" ? 3 : 1) * unit;
        flashTimers.push(setTimeout(() => light.classList.add("on"), t));
        flashTimers.push(setTimeout(() => light.classList.remove("on"), t + len));
        t += len + unit; // one-unit gap after each element
      });
      if (ci < word.length - 1) t += 2 * unit; // bring gap up to ~3 units
    });
  }

  function playWordAudio(word, light) {
    audio.playWord(word);
    flashWord(light, word);
  }

  // ---- Keyer ---------------------------------------------------------------
  let keyDown = false;
  let pressStart = 0;
  let gapTimer = null;
  let wordLastRelease = 0; // release time of the previous element (word mode)

  // ---- Hold indicator ------------------------------------------------------
  // Seven dots above the key show timing at the chosen speed (1 dot = 1 unit =
  // 1200 / wpm ms). Yellow fills with how long the key is held (dit = 1, dah =
  // 3); red fills with how long silence has lasted (letter gap = 3, word gap =
  // 7). A single rAF loop drives both keyers — the graded prompt (`#hold-dots`)
  // and the presentation free-practice keyer (`#tp-hold-dots`) — since only one
  // is ever on screen at a time. Both look and behave identically.
  let holdRaf = null;
  let holdReleaseAt = 0; // last release on the graded keyer (drives its red fill)
  const HOLD_UNITS = 7;

  function holdDotsActive() {
    return !!(
      session &&
      el("screen-practice").classList.contains("active") &&
      !el("keyer-area").classList.contains("hidden") &&
      (session.mode === "see" || session.mode === "listen" || session.mode === "word")
    );
  }

  function clearDots(selector) {
    document.querySelectorAll(selector).forEach((d) =>
      d.classList.remove("yellow", "red")
    );
  }

  // Light `selector`'s dots: yellow up to `downSince` (units held), else red up
  // to `silenceSince` (units of silence). Pass null to skip a fill.
  function paintDots(selector, unit, now, downSince, silenceSince) {
    const dots = document.querySelectorAll(selector);
    if (!dots.length) return;
    let yellow = 0;
    let red = 0;
    if (downSince != null) {
      // Units fully held: a dit (1 unit) lights 1 dot, a dah (3 units) lights 3.
      yellow = Math.min(HOLD_UNITS, Math.floor((now - downSince) / unit));
    } else if (silenceSince) {
      red = Math.min(HOLD_UNITS, Math.floor((now - silenceSince) / unit));
    }
    dots.forEach((d, i) => {
      d.classList.toggle("yellow", i < yellow);
      d.classList.toggle("red", yellow === 0 && i < red);
    });
  }

  function renderHoldDots() {
    const unit = 1200 / progress.settings.wpm;
    const now = Date.now();
    if (teachPhaseVisible()) {
      paintDots(
        "#tp-hold-dots .hold-dot",
        unit,
        now,
        tpDown ? tpPressStart : null,
        tpDown ? 0 : tpReleaseAt
      );
    } else if (holdDotsActive()) {
      paintDots(
        "#hold-dots .hold-dot",
        unit,
        now,
        keyDown ? pressStart : null,
        keyDown || !(session && session.acceptingInput) ? 0 : holdReleaseAt
      );
    }
  }

  function holdLoop() {
    if (!(teachPhaseVisible() || holdDotsActive())) {
      holdRaf = null;
      clearDots("#hold-dots .hold-dot");
      clearDots("#tp-hold-dots .hold-dot");
      return;
    }
    renderHoldDots();
    holdRaf = requestAnimationFrame(holdLoop);
  }

  function startHoldLoop() {
    if (holdRaf == null && typeof requestAnimationFrame === "function") {
      holdRaf = requestAnimationFrame(holdLoop);
    }
  }

  function startHoldDots() {
    holdReleaseAt = 0;
    clearDots("#hold-dots .hold-dot");
    startHoldLoop();
  }

  function onKeyPress() {
    if (!session || !session.acceptingInput) return;
    if (keyDown) return;
    // In word mode, tapping after a checked attempt starts a fresh attempt.
    if (session.mode === "word" && session.wordReviewed) resetWordAttempt();
    keyDown = true;
    pressStart = Date.now();
    audio.startTone();
    el("key").classList.add("active");
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    resetSubmitFill(); // a new element restarts any auto-submit countdown
    holdReleaseAt = 0; // pressing clears the silence (red) count
    startHoldDots();
    // The light mirrors the learner's own keying, lit while the key is held.
    clearFlash();
    el("signal-light").classList.add("on");
  }

  // Grow the Submit button's fill from empty to full over `ms`, visualizing the
  // time left before character auto-submit fires. Reset cancels it.
  function startSubmitFill(ms) {
    const fill = el("submit-fill");
    if (!fill.style) return;
    fill.style.transition = "none";
    fill.style.width = "0%";
    void fill.offsetWidth; // force reflow so the next transition animates
    fill.style.transition = "width " + ms + "ms linear";
    fill.style.width = "100%";
  }

  function resetSubmitFill() {
    const fill = el("submit-fill");
    if (!fill.style) return;
    fill.style.transition = "none";
    fill.style.width = "0%";
  }

  function onKeyRelease() {
    if (!keyDown) return;
    keyDown = false;
    audio.stopTone();
    el("key").classList.remove("active");
    el("signal-light").classList.remove("on");
    const now = Date.now();
    const held = now - pressStart;
    holdReleaseAt = now; // start counting silence for the red fill

    if (session.mode === "word") {
      // Record the raw element and the gap before it; letters are decoded
      // holistically on Submit. No timeout gates or auto-submits the input.
      const gap = session.wordMarks.length ? pressStart - wordLastRelease : 0;
      session.wordMarks.push(held);
      session.wordGaps.push(gap);
      wordLastRelease = now;
      updateEntryDisplay();
      return;
    }

    session.entry += symbolFor(held);
    updateEntryDisplay();
    scheduleGapSubmit();
  }

  // Classify a key press by its hold time. Shared by both keyers.
  function symbolFor(heldMs) {
    return heldMs >= progress.settings.keyThresholdMs ? "-" : ".";
  }

  // Wire a key element's pointer events (and suppress the long-hold context
  // menu). Both keyers share this; each supplies its own press/release/isDown.
  function bindKey(keyEl, onDown, onUp, isDown) {
    keyEl.addEventListener("pointerdown", (e) => { e.preventDefault(); onDown(); });
    keyEl.addEventListener("pointerup", (e) => { e.preventDefault(); onUp(); });
    keyEl.addEventListener("pointerleave", () => { if (isDown()) onUp(); });
    keyEl.addEventListener("pointercancel", () => { if (isDown()) onUp(); });
    keyEl.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function resetWordAttempt() {
    session.wordMarks = [];
    session.wordGaps = [];
    session.wordReviewed = false;
    session.acceptingInput = true;
    wordLastRelease = 0;
    el("feedback").textContent = "";
    el("feedback").className = "feedback";
    updateEntryDisplay();
  }

  // Character mode only: auto-submit the single character after a pause.
  function scheduleGapSubmit() {
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    if (!progress.settings.autoSubmit) return;
    const ms = progress.settings.gapTimeoutMs;
    startSubmitFill(ms);
    gapTimer = setTimeout(() => {
      gapTimer = null;
      if (session && session.acceptingInput && session.entry) submitEntry();
    }, ms);
  }

  function updateEntryDisplay() {
    const d = el("entry-display");
    if (!session) {
      d.textContent = " ";
      return;
    }
    if (session.mode === "word") {
      // Show the running decode (adaptive letter segmentation) as it is keyed.
      d.textContent = decodeWord().text || " ";
    } else {
      d.textContent = session.entry ? patternToText(session.entry) : " ";
    }
  }

  function submitEntry() {
    if (!session || !session.acceptingInput || !session.entry) return;
    session.acceptingInput = false;
    session.locked = true;
    resetSubmitFill();
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    const target = session.target;
    const expected = MORSE[target];
    const correct = session.entry === expected;
    const elapsed = Date.now() - session.promptShownAt;
    const fast = correct && elapsed <= FAST_MS;

    // Update SRS + session tallies.
    progress.srs[target] = SRS.grade(progress.srs[target], correct, fast);
    session.results.push({ char: target, correct });
    const pc = session.perChar[target] || { seen: 0, correct: 0 };
    pc.seen += 1;
    if (correct) pc.correct += 1;
    session.perChar[target] = pc;
    Store.saveProgress(profileId, progress);

    showAnswerFeedback(correct, target);
    session.index += 1;
    // Linger longer on listen prompts so the just-revealed character registers.
    const listen = session.mode === "listen";
    const delay = correct ? (listen ? 1400 : 750) : (listen ? 2400 : 1600);
    advanceTimer = setTimeout(() => {
      advanceTimer = null;
      nextPrompt();
    }, delay);
  }

  function showAnswerFeedback(correct, target) {
    const fb = el("feedback");
    if (correct) {
      fb.className = "feedback ok";
      fb.innerHTML = "✓ " + target + " &nbsp; " + patternToText(MORSE[target]);
    } else {
      fb.className = "feedback bad";
      fb.innerHTML =
        "✗ That was <strong>" + escapeHtml(patternToText(session.entry || "—")) +
        "</strong><br>" + target + " is <strong>" + patternToText(MORSE[target]) + "</strong>";
      playAndFlash(target);
    }
    if (session.mode === "listen") {
      el("prompt-target").textContent = target;
      el("prompt-target").classList.remove("mystery");
    }
  }

  bindKey(el("key"), onKeyPress, onKeyRelease, () => keyDown);

  // Desktop: spacebar acts as the key. On the presentation hub it drives the
  // free-practice keyer; during a prompt it drives the main keyer.
  function teachPhaseVisible() {
    return !el("teach-phase").classList.contains("hidden");
  }
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (!el("screen-practice").classList.contains("active")) return;
    if (e.repeat) return;
    e.preventDefault();
    if (teachPhaseVisible()) tpPress();
    else onKeyPress();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    if (!el("screen-practice").classList.contains("active")) return;
    e.preventDefault();
    if (teachPhaseVisible()) tpRelease();
    else onKeyRelease();
  });

  el("btn-clear").addEventListener("click", () => {
    if (!session || !session.acceptingInput) return;
    if (session.mode === "word") {
      session.wordMarks = [];
      session.wordGaps = [];
      session.wordReviewed = false;
      wordLastRelease = 0;
    } else {
      session.entry = "";
    }
    updateEntryDisplay();
    if (gapTimer) clearTimeout(gapTimer);
    resetSubmitFill();
  });
  el("btn-submit").addEventListener("click", () => {
    if (!session) return;
    if (session.mode === "word") submitWord();
    else submitEntry();
  });

  // ---- Presentation free-practice keyer ------------------------------------
  // A standalone keyer on the presentation hub for trying the new characters.
  // It decodes on its own: after a character-separation gap of silence the keyed
  // pattern is resolved to a letter, shown for 2 s (or until keying resumes).
  // Independent of the graded `session`, so it never touches lesson progress.
  let tpEntry = "";
  let tpDown = false;
  let tpPressStart = 0;
  let tpReleaseAt = 0; // last release (drives this keyer's red fill)
  let tpGapTimer = null;
  let tpClearTimer = null;
  let tpShowing = false; // a decoded letter is currently on screen

  function tpBlank() {
    el("tp-letter").innerHTML = "&#160;";
    el("tp-entry").innerHTML = "&#160;";
  }

  // Cancel timers, stop any tone, and clear the display. Called on entering the
  // hub and whenever the hub is left for a practice mode.
  function tpReset() {
    if (tpDown) {
      audio.stopTone();
      tpDown = false;
    }
    el("tp-key").classList.remove("active");
    if (tpGapTimer) { clearTimeout(tpGapTimer); tpGapTimer = null; }
    if (tpClearTimer) { clearTimeout(tpClearTimer); tpClearTimer = null; }
    tpEntry = "";
    tpReleaseAt = 0;
    tpShowing = false;
    tpBlank();
    clearDots("#tp-hold-dots .hold-dot");
    startHoldLoop(); // paint the dots while the hub is on screen
  }

  function tpPress() {
    if (tpDown) return;
    if (tpGapTimer) { clearTimeout(tpGapTimer); tpGapTimer = null; }
    if (tpClearTimer) { clearTimeout(tpClearTimer); tpClearTimer = null; }
    // Keying again clears a previously decoded letter and starts fresh.
    if (tpShowing) {
      tpShowing = false;
      tpEntry = "";
      tpBlank();
    }
    tpDown = true;
    tpReleaseAt = 0; // pressing clears the silence (red) count
    tpPressStart = Date.now();
    audio.startTone();
    el("tp-key").classList.add("active");
  }

  function tpRelease() {
    if (!tpDown) return;
    tpDown = false;
    audio.stopTone();
    el("tp-key").classList.remove("active");
    const now = Date.now();
    tpReleaseAt = now; // start counting silence for the red fill
    tpEntry += symbolFor(now - tpPressStart);
    el("tp-entry").textContent = patternToText(tpEntry);
    el("tp-letter").innerHTML = "&#160;";
    // Terminate the character once silence reaches the inter-character gap
    // (3 units at the chosen speed).
    const charSepMs = 3 * (1200 / progress.settings.wpm);
    tpGapTimer = setTimeout(tpFinalize, charSepMs);
  }

  function tpFinalize() {
    tpGapTimer = null;
    if (!tpEntry) return;
    el("tp-letter").textContent = MORSE_REVERSE[tpEntry] || "?";
    el("tp-entry").textContent = patternToText(tpEntry);
    tpEntry = "";
    tpShowing = true;
    // Hold the letter for 2 s, then blank (unless keying resumes first).
    tpClearTimer = setTimeout(() => {
      tpClearTimer = null;
      tpShowing = false;
      tpBlank();
    }, 2000);
  }

  bindKey(el("tp-key"), tpPress, tpRelease, () => tpDown);

  // ---- Session end ---------------------------------------------------------
  // Only character practice ends in a summary. Word practice is exploratory:
  // the learner leaves via the back button, so it never reaches finishSession.
  function finishSession() {
    clearFlash();
    el("practice-progress-bar").style.width = "100%";

    const total = session.results.length;
    const right = session.results.filter((r) => r.correct).length;
    const accuracy = total ? right / total : 0;

    const lesson = CURRICULUM[session.lessonId - 1];
    // Pass requires overall accuracy AND that each new character was attempted.
    const focusAttempted = lesson.chars.every(
      (c) => (session.perChar[c] || { seen: 0 }).seen > 0
    );
    const passed = accuracy >= PASS_ACCURACY && focusAttempted;

    if (passed) {
      const prev = progress.completed[session.lessonId];
      progress.completed[session.lessonId] = {
        bestAccuracy: Math.max(accuracy, prev ? prev.bestAccuracy : 0),
        completedAt: Date.now(),
      };
      // Advance the working lesson and unlock the next one.
      if (session.lessonId === progress.currentLesson && session.lessonId < CURRICULUM.length) {
        progress.currentLesson = session.lessonId + 1;
        progress.maxUnlocked = Math.max(progress.maxUnlocked, session.lessonId + 1);
      }
      Store.saveProgress(profileId, progress);
    }

    renderCharSummary(accuracy, right, total, passed);
  }

  function renderCharSummary(accuracy, right, total, passed) {
    const pct = Math.round(accuracy * 100);
    const perCharRows = Object.keys(session.perChar)
      .sort()
      .map((c) => {
        const pc = session.perChar[c];
        const a = Math.round((pc.correct / pc.seen) * 100);
        return (
          '<div class="pc-row"><span class="pc-char">' + c + "</span>" +
          '<span class="pc-bar"><span style="width:' + a + '%"></span></span>' +
          '<span class="pc-pct">' + a + "%</span></div>"
        );
      })
      .join("");

    const isLast = session.lessonId >= CURRICULUM.length;
    let cta;
    if (passed) {
      // Passing returns to the lesson hub (word practice now unlocked there),
      // and offers Next lesson — which only exists once the lesson is passed.
      cta =
        (isLast ? "" : '<button class="btn primary" id="sum-next">Next lesson &rarr;</button>') +
        '<button class="btn" id="sum-lesson">Back to lesson</button>' +
        '<button class="btn" id="sum-home">Back to lessons</button>';
    } else {
      cta =
        '<button class="btn primary" id="sum-again">Try again</button>' +
        '<button class="btn" id="sum-home">Back to lessons</button>';
    }

    const headline = passed
      ? '<div class="sum-headline pass">Lesson cleared! 🎉</div>'
      : '<div class="sum-headline fail">' + pct + "% — aim for 90% to advance</div>";

    el("summary").innerHTML =
      '<div class="sum-inner">' +
      headline +
      '<div class="sum-score"><span class="sum-pct">' + pct + '%</span>' +
      '<span class="sum-frac">' + right + " / " + total + " characters correct</span></div>" +
      '<div class="pc-list">' + perCharRows + "</div>" +
      '<div class="sum-actions">' + cta + "</div>" +
      "</div>";
    el("summary").classList.remove("hidden");

    const next = el("sum-next");
    const lesson = el("sum-lesson");
    const again = el("sum-again");
    const home = el("sum-home");
    if (next) next.addEventListener("click", () => startSession(session.lessonId + 1));
    if (lesson) lesson.addEventListener("click", () => startSession(session.lessonId));
    if (again) {
      again.addEventListener("click", () => {
        startSession(session.lessonId);
        beginCharacterPractice();
      });
    }
    if (home) home.addEventListener("click", goHome);
  }

  function hideSummary() {
    el("summary").classList.add("hidden");
    el("summary").innerHTML = "";
  }

  function goHome() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    session = null;
    renderHome();
    showScreen("home");
  }

  // Back button (X). In a drill it steps back to the lesson's presentation hub;
  // from the hub it leaves to the lesson list. Leaving mid-session is safe —
  // each answer is persisted as it happens.
  el("btn-quit-practice").addEventListener("click", () => {
    if (!session) {
      goHome();
      return;
    }
    // Already on the hub → go out to the lesson list.
    if (!el("teach-phase").classList.contains("hidden")) {
      goHome();
      return;
    }
    // In a drill → step back to the hub, pausing the run (resume from there).
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    if (keyDown) onKeyRelease();
    startTeach(true);
  });

  // ===========================================================================
  // CHARACTER REFERENCE
  // ===========================================================================
  const REFERENCE_GROUPS = [
    { title: "Letters", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") },
    { title: "Numbers", chars: "0123456789".split("") },
    { title: "Punctuation", chars: [".", ",", "?", "/"] },
  ];

  function isLearned(char) {
    const card = progress.srs[char];
    return !!(card && card.seen > 0);
  }

  function renderReference() {
    let learnedCount = 0;
    let total = 0;
    const html = REFERENCE_GROUPS.map((group) => {
      const tiles = group.chars
        .map((c) => {
          total += 1;
          const learned = isLearned(c);
          if (learned) learnedCount += 1;
          const pattern = learned ? patternToText(MORSE[c]) : "";
          const light = learned
            ? '<span class="signal-light ref-light" aria-hidden="true"></span>'
            : "";
          return (
            '<button class="ref-tile' + (learned ? "" : " locked") +
            '" data-char="' + c + '"' + (learned ? "" : " disabled") + ">" +
            '<span class="ref-char">' + escapeHtml(c) + "</span>" +
            '<span class="ref-pattern">' + pattern + "</span>" +
            light + "</button>"
          );
        })
        .join("");
      return (
        '<h3 class="ref-group-title">' + group.title + "</h3>" +
        '<div class="ref-grid">' + tiles + "</div>"
      );
    }).join("");

    el("ref-hint").textContent =
      learnedCount +
      " of " +
      total +
      " characters learned · tap a learned character to hear and see it";
    el("reference-body").innerHTML = html;
  }

  el("reference-body").addEventListener("click", (e) => {
    const tile = e.target.closest(".ref-tile");
    if (!tile || tile.classList.contains("locked")) return;
    const char = tile.dataset.char;
    audio.playChar(char);
    const light = tile.querySelector(".ref-light");
    if (light) flashPatternEl(light, MORSE[char]);
    tile.classList.add("active");
    setTimeout(() => tile.classList.remove("active"), 300);
  });

  el("btn-reference").addEventListener("click", () => {
    applyAudioSettings();
    renderReference();
    showScreen("reference");
  });
  el("btn-close-reference").addEventListener("click", () => showScreen("home"));

  // ===========================================================================
  // SETTINGS
  // ===========================================================================
  function applyAudioSettings() {
    const s = progress.settings;
    audio.setWpm(s.wpm);
    audio.frequency = s.frequency;
    audio.muted = s.muted;
  }

  function renderSettings() {
    const s = progress.settings;
    el("settings-body").innerHTML =
      settingSlider("wpm", "Speed", s.wpm, 5, 30, 1, "WPM — PARIS standard: dit 1 unit, dah 3, letter gap 3, word gap 7") +
      '<button class="btn" id="settings-paris">&#9835; Play “PARIS” at this speed</button>' +
      settingSlider("frequency", "Tone pitch", s.frequency, 400, 900, 10, "Hz") +
      settingSlider("keyThresholdMs", "Dit / dah threshold", s.keyThresholdMs, 80, 400, 10, "ms — hold longer than this for a dah") +
      settingSlider("gapTimeoutMs", "Auto-submit gap", s.gapTimeoutMs, 400, 2000, 50, "ms of silence before the character is checked") +
      settingToggle("autoSubmit", "Auto-submit after a pause", s.autoSubmit) +
      settingToggle("showHints", "Show dot/dash hint", s.showHints, "Off is recommended — learn by sound.") +
      settingToggle("muted", "Mute audio", s.muted) +
      '<button class="btn" id="settings-test">&#9835; Test tone (play “K”)</button>' +
      '<button class="btn" id="settings-reset">Reset progress for this profile</button>';

    el("settings-body").addEventListener("input", onSettingChange);
    el("settings-body").addEventListener("click", onSettingClick);
  }

  function settingSlider(key, label, value, min, max, step, unit) {
    return (
      '<div class="setting">' +
      '<div class="setting-head"><label>' + label + "</label>" +
      '<span class="setting-val" id="val-' + key + '">' + value + " " + (unit.split(" ")[0]) + "</span></div>" +
      '<input type="range" class="slider" data-key="' + key + '" min="' + min +
      '" max="' + max + '" step="' + step + '" value="' + value + '" />' +
      '<div class="setting-note">' + unit + "</div></div>"
    );
  }

  function settingToggle(key, label, value, note) {
    return (
      '<div class="setting toggle-setting">' +
      '<label class="toggle"><input type="checkbox" data-key="' + key + '"' +
      (value ? " checked" : "") + ' /><span class="toggle-track"></span></label>' +
      '<div class="toggle-label"><span>' + label + "</span>" +
      (note ? '<span class="setting-note">' + note + "</span>" : "") + "</div></div>"
    );
  }

  function onSettingChange(e) {
    const target = e.target;
    const key = target.dataset.key;
    if (!key) return;
    if (target.type === "range") {
      const num = Number(target.value);
      progress.settings[key] = num;
      const valEl = el("val-" + key);
      if (valEl) {
        const unit = valEl.textContent.split(" ").slice(1).join(" ");
        valEl.textContent = num + " " + unit;
      }
    } else if (target.type === "checkbox") {
      progress.settings[key] = target.checked;
    }
    applyAudioSettings();
    Store.saveProgress(profileId, progress);
  }

  function onSettingClick(e) {
    if (e.target.id === "settings-test") {
      applyAudioSettings();
      audio.playChar("K");
    } else if (e.target.id === "settings-paris") {
      applyAudioSettings();
      audio.playWord("PARIS");
    } else if (e.target.id === "settings-reset") {
      confirmResetProgress();
    }
  }

  function confirmResetProgress() {
    openModal(
      "<h3>Reset progress?</h3>" +
        "<p>This clears completed lessons and spaced-repetition history for this profile. Settings are kept.</p>" +
        '<div class="modal-actions">' +
        '<button class="btn" id="cancel-reset">Cancel</button>' +
        '<button class="btn danger" id="do-reset">Reset</button>' +
        "</div>"
    );
    el("cancel-reset").addEventListener("click", closeModal);
    el("do-reset").addEventListener("click", () => {
      const kept = progress.settings;
      progress = Store._blankProgress();
      progress.settings = kept;
      Store.saveProgress(profileId, progress);
      closeModal();
      renderSettings();
    });
  }

  // ===========================================================================
  // NAV WIRING
  // ===========================================================================
  el("btn-manage-profiles").addEventListener("click", openManageProfiles);
  el("btn-switch-profile").addEventListener("click", () => {
    Store.setActiveProfileId(null);
    profileId = null;
    progress = null;
    renderProfiles();
    showScreen("profiles");
  });
  el("btn-settings").addEventListener("click", () => {
    renderSettings();
    showScreen("settings");
  });
  el("btn-close-settings").addEventListener("click", () => {
    renderHome();
    showScreen("home");
  });

  // Intro-to-Morse popup, opened from the lesson list.
  el("btn-intro").addEventListener("click", openIntro);
  function openIntro() {
    openModal(
      "<h3>A quick intro to Morse code</h3>" +
      '<div class="intro-body">' +
        "<p>Morse code sends text as two sounds — short beeps and long ones. " +
        "Samuel Morse and Alfred Vail devised it in the 1830s–40s for the electric " +
        "telegraph; the first long line's opening message (1844) was " +
        "<em>“What hath God wrought”</em>. It carried the world's news for a century " +
        "and is still used today by amateur-radio operators and as a fallback signal.</p>" +
        "<p><strong>Dits &amp; dahs:</strong> every character is a short pattern of a " +
        "<strong>dit</strong> (·, a short beep) and a <strong>dah</strong> (−, three " +
        "times as long). For example <strong>E</strong> is ·, <strong>T</strong> is −, " +
        "and <strong>A</strong> is ·−.</p>" +
        "<p><strong>Timing</strong> is built on one <em>unit</em> of time:</p>" +
        '<ul class="intro-timing">' +
          "<li>dit = 1 unit,&nbsp; dah = 3 units</li>" +
          "<li>gap within a character = 1 unit</li>" +
          "<li>gap between characters = 3 units</li>" +
          "<li>gap between words = 7 units</li>" +
        "</ul>" +
        "<p><strong>The lights help you feel that timing.</strong> The round " +
        "<strong>lamp</strong> next to a character blinks its dits and dahs in step with " +
        "the sound, so the code is visible as well as audible. Above the input key, the " +
        "<strong>row of dots</strong> is a timing ruler: while you hold the key they fill " +
        "<span class=\"intro-yellow\">yellow</span> one per unit (a dit lights 1, a dah " +
        "3), and during silence they fill <span class=\"intro-red\">red</span> (3 dots = " +
        "a gap between characters, 7 = a gap between words).</p>" +
        "<p>Learn each character at <strong>full speed</strong>, so you know it by its " +
        "rhythm as a single sound rather than by counting beeps. The speed can be " +
        "adjusted anytime in <strong>Settings</strong>.</p>" +
        '<p class="intro-signoff">Have fun!' +
          '<span class="intro-morse">···· ·− ···− ·&nbsp;&nbsp;&nbsp;··−· ··− −·</span>' +
        "</p>" +
      "</div>" +
      '<div class="modal-actions">' +
        '<button class="btn primary" id="intro-close">Got it</button>' +
      "</div>"
    );
    el("intro-close").addEventListener("click", closeModal);
  }

  // ---- Utilities -----------------------------------------------------------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function shuffleNoAdjacentRepeat(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Nudge apart any adjacent duplicates.
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1]) {
        for (let k = i + 1; k < arr.length; k++) {
          if (arr[k] !== arr[i]) {
            [arr[i], arr[k]] = [arr[k], arr[i]];
            break;
          }
        }
      }
    }
    return arr;
  }

  // Exposed for the test harness (tests/app.test.js). Pure helpers only; no
  // effect in the browser beyond attaching a property to window.
  window.__morseTest = {
    pickWords,
    decodeMarks,
    WORD_BANK,
    MORSE_REVERSE,
    SESSION_LENGTH,
    WORD_START_LESSON,
    WORDS_PER_SESSION,
    // Entry points for the flow smoke test.
    selectProfile,
    startSession,
    beginCharacterPractice,
    beginWordPractice,
    beginComprehension,
    getSession: () => session,
  };

  // ---- Boot ----------------------------------------------------------------
  function boot() {
    const active = Store.getActiveProfileId();
    if (active && Store.getProfile(active)) {
      selectProfile(active);
    } else {
      renderProfiles();
      showScreen("profiles");
    }
  }

  boot();
})();
