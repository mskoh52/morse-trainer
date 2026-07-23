// Local-storage persistence for profiles and per-profile progress.
// Everything lives in the browser; there is no server.

(function () {
  "use strict";

  const PROFILES_KEY = "morse.profiles.v1";
  const ACTIVE_KEY = "morse.activeProfile.v1";
  const PROGRESS_PREFIX = "morse.progress.v1.";

  const AVATARS = [
    "🦊", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵", "🐧", "🐙", "🦄",
    "🐢", "🐝", "🦋", "🐬", "🦉", "🐰", "🐱", "🐶", "🐳", "🦥",
  ];

  const DEFAULT_SETTINGS = {
    wpm: 20, // single PARIS-standard speed (1 unit = 1200 / wpm ms)
    frequency: 600,
    keyThresholdMs: 180, // press >= threshold counts as a dah
    gapTimeoutMs: 900, // silence before a character auto-submits
    showHints: false, // show dot/dash pattern during practice (off = learn by sound)
    autoSubmit: true,
    muted: false,
  };

  function _readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn("storage read failed", key, err);
      return fallback;
    }
  }

  function _writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // A small, dependency-free unique id. Randomness is fine here.
  function _newId() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
    );
  }

  const Store = {
    AVATARS,
    DEFAULT_SETTINGS,

    listProfiles() {
      return _readJson(PROFILES_KEY, []);
    },

    getProfile(id) {
      return this.listProfiles().find((p) => p.id === id) || null;
    },

    createProfile(name, avatar) {
      const profiles = this.listProfiles();
      const profile = {
        id: _newId(),
        name: name.trim() || "Anonymous",
        avatar: avatar || AVATARS[0],
        createdAt: Date.now(),
      };
      profiles.push(profile);
      _writeJson(PROFILES_KEY, profiles);
      _writeJson(PROGRESS_PREFIX + profile.id, this._blankProgress());
      return profile;
    },

    updateProfile(id, patch) {
      const profiles = this.listProfiles();
      const idx = profiles.findIndex((p) => p.id === id);
      if (idx < 0) return null;
      profiles[idx] = Object.assign({}, profiles[idx], patch);
      _writeJson(PROFILES_KEY, profiles);
      return profiles[idx];
    },

    deleteProfile(id) {
      const profiles = this.listProfiles().filter((p) => p.id !== id);
      _writeJson(PROFILES_KEY, profiles);
      localStorage.removeItem(PROGRESS_PREFIX + id);
      if (this.getActiveProfileId() === id) this.setActiveProfileId(null);
    },

    getActiveProfileId() {
      return _readJson(ACTIVE_KEY, null);
    },

    setActiveProfileId(id) {
      if (id === null) localStorage.removeItem(ACTIVE_KEY);
      else _writeJson(ACTIVE_KEY, id);
    },

    _blankProgress() {
      return {
        currentLesson: 1, // lesson the learner is working on
        maxUnlocked: 1, // highest lesson that can be entered
        completed: {}, // lessonId -> { bestAccuracy, completedAt }
        srs: {}, // char -> SRS card (see srs.js)
        settings: Object.assign({}, DEFAULT_SETTINGS),
      };
    },

    getProgress(profileId) {
      const raw = _readJson(PROGRESS_PREFIX + profileId, null);
      if (!raw) return this._blankProgress();
      // Backfill any settings added in later versions.
      raw.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
      raw.completed = raw.completed || {};
      raw.srs = raw.srs || {};
      return raw;
    },

    saveProgress(profileId, progress) {
      _writeJson(PROGRESS_PREFIX + profileId, progress);
    },
  };

  window.Store = Store;
})();
