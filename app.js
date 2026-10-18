
"use strict";

/* =========================================
   WATCH ARCHIVE — V1
   APPLICATION FOUNDATION
========================================= */

(() => {
  const CONFIG = window.WATCH_DATA;

  if (!CONFIG) {
    console.error("data.js has not loaded.");
    return;
  }

  const KEY = CONFIG.storageKey;

  const $ = (selector) =>
    document.querySelector(selector);

  const $$ = (selector) =>
    [...document.querySelectorAll(selector)];

  const clone = (value) =>
    JSON.parse(JSON.stringify(value));

  let state = loadState();
  let currentPage = "";
  let toastTimer = null;

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  /* =====================================
     STORAGE
  ===================================== */

  function createInitialState() {
    return {
      schemaVersion: CONFIG.schemaVersion,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: clone(CONFIG.defaults.settings),
      archive: clone(CONFIG.defaults.archive)
    };
  }

  function normalizeState(input) {
    const initial = createInitialState();

    if (!input || typeof input !== "object") {
      return initial;
    }

    return {
      schemaVersion: CONFIG.schemaVersion,

      createdAt:
        typeof input.createdAt === "string"
          ? input.createdAt
          : initial.createdAt,

      updatedAt:
        typeof input.updatedAt === "string"
          ? input.updatedAt
          : initial.updatedAt,

      settings: {
        ...initial.settings,
        ...(input.settings || {})
      },

      archive: {
        groups: Array.isArray(input.archive?.groups)
          ? input.archive.groups
          : [],

        productions: Array.isArray(input.archive?.productions)
          ? input.archive.productions
          : [],

        seasons: Array.isArray(input.archive?.seasons)
          ? input.archive.seasons
          : [],

        episodes: Array.isArray(input.archive?.episodes)
          ? input.archive.episodes
          : []
      }
    };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(KEY);

      if (!saved) {
        return createInitialState();
      }

      const parsed = JSON.parse(saved);

      if (parsed.schemaVersion !== CONFIG.schemaVersion) {
        console.warn("Different storage schema detected.");
        return createInitialState();
      }

      return normalizeState(parsed);

    } catch (error) {
      console.error("Could not read saved data:", error);
      return createInitialState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      updateSaveIndicator(true);
      return true;

    } catch (error) {
      console.error("Saving failed:", error);
      updateSaveIndicator(false);
      showToast("Could not save. Check browser storage.");
      return false;
    }
  }

  function updateSaveIndicator(success) {
    const indicator = $("#saveIndicator");

    if (!indicator) return;

    indicator.dataset.state = success ? "saved" : "error";

    const label = success
      ? "Saved locally"
      : "Save failed";

    indicator.lastChild.textContent = label;
  }

  /* =====================================
     BACKUP EXPORT / IMPORT
  ===================================== */

  function exportArchive() {
    const backup = {
      app: CONFIG.appName,
      schemaVersion: CONFIG.schemaVersion,
      exportedAt: new Date().toISOString(),
      data: state
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `watch-archive-${date}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast("Backup file prepared.");
  }

  async function importArchive(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (
        backup.app !== CONFIG.appName ||
        backup.schemaVersion !== CONFIG.schemaVersion ||
        !backup.data ||
        typeof backup.data !== "object"
      ) {
        throw new Error("Unsupported backup format.");
      }

      const archive = backup.data.archive;

      if (
        !archive ||
        !["groups", "productions", "seasons", "episodes"]
          .every(key => Array.isArray(archive[key]))
      ) {
        throw new Error("Backup archive is incomplete.");
      }

      const accepted = window.confirm(
        "Import this backup?\n\n" +
        "This will replace your current local archive. " +
        "Export a backup first if you want to keep it."
      );

      if (!accepted) return;

      const previous = state;
      state = normalizeState(backup.data);

      if (!saveState()) {
        state = previous;
        return;
      }

      applyMotionSetting();
      starfield.rebuild();
      renderPage();

      showToast("Backup imported successfully.");

    } catch (error) {
      console.error(error);
      showToast("Import failed: invalid or incompatible file.");

    } finally {
      $("#importFile").value = "";
    }
  }

  /* =====================================
     PAGE TEMPLATES
  ===================================== */

  function pageHeader(page, eyebrow = "YOUR UNIVERSE") {
    const config = CONFIG.pages[page];

    return `
      <header class="page-header">
        <p class="page-eyebrow">${eyebrow}</p>
        <h1 class="page-title">${config.title}</h1>
        <p class="page-subtitle">${config.subtitle}</p>
      </header>
    `;
  }

  function emptyState(symbol, title, description, note) {
    return `
      <div class="empty-state glass-surface">
        <div class="empty-symbol" aria-hidden="true">
          ${symbol}
        </div>

        <h2 class="empty-title">${title}</h2>

        <p class="empty-description">
          ${description}
        </p>

        <div class="empty-note">${note}</div>
      </div>
    `;
  }

  function libraryPage() {
    return `
      ${pageHeader("library", "THE COLLECTION")}

      <div class="soft-rule"></div>

      ${emptyState(
        "✧",
        "A universe waiting to be written",
        "Every great story begins somewhere. " +
        "Your collection will find its home here.",
        "Archive entries arrive in Step 3"
      )}
    `;
  }

  function groupsPage() {
    return `
      ${pageHeader("groups", "CONNECTED WORLDS")}

      <div class="soft-rule"></div>

      ${emptyState(
        "◇",
        "Worlds within worlds",
        "Gather stories that belong together. " +
        "Entire universes, connected productions, " +
        "and the worlds you return to.",
        "Group management arrives in Step 3"
      )}
    `;
  }

  function rankingsPage() {
    return `
      ${pageHeader("rankings", "PERSONAL EVALUATIONS")}

      <div class="soft-rule"></div>

      ${emptyState(
        "✦",
        "Not all stars shine equally",
        "Your highest-rated and most memorable " +
        "stories will eventually gather here.",
        "Ranking statistics arrive in Step 11"
      )}
    `;
  }

  function historyPage() {
    return `
      ${pageHeader("history", "THROUGH TIME")}

      <div class="soft-rule"></div>

      ${emptyState(
        "◷",
        "Every story leaves a trace",
        "A personal record of what you've watched, " +
        "when you watched it, and where your " +
        "journey took you.",
        "Watch history arrives in Step 10"
      )}
    `;
  }

  function settingsPage() {
    const settings = state.settings;

    return `
      ${pageHeader("settings", "PREFERENCES")}

      <div class="settings-stack">

        <section class="settings-section glass-surface">
          <h2 class="settings-heading">Atmosphere</h2>

          <div class="setting-row">
            <div class="setting-copy">
              <label class="setting-name" for="starDensity">
                Star density
              </label>
              <span class="setting-description">
                Adjust how many stars fill the background.
              </span>
            </div>

            <div class="range-wrap">
              <input
                id="starDensity"
                class="range-control"
                type="range"
                min="10"
                max="100"
                step="5"
                value="${settings.starDensity}"
              >
              <output class="setting-value" id="densityValue">
                ${settings.starDensity}
              </output>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <label class="setting-name" for="starBrightness">
                Star brightness
              </label>
              <span class="setting-description">
                Choose how visible the stars should be.
              </span>
            </div>

            <div class="range-wrap">
              <input
                id="starBrightness"
                class="range-control"
                type="range"
                min="10"
                max="100"
                step="5"
                value="${settings.starBrightness}"
              >
              <output class="setting-value" id="brightnessValue">
                ${settings.starBrightness}
              </output>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <label class="setting-name" for="reduceMotion">
                Reduce motion
              </label>
              <span class="setting-description">
                Disable ambient animation and moving stars.
              </span>
            </div>

            <label class="switch">
              <input
                id="reduceMotion"
                type="checkbox"
                ${settings.reduceMotion ? "checked" : ""}
              >
              <span class="switch-track"></span>
            </label>
          </div>
        </section>

        <section class="settings-section glass-surface">
          <h2 class="settings-heading">Your Archive</h2>

          <div class="button-row">
            <button
              class="action-button"
              id="exportButton"
              type="button"
            >
              Export backup
            </button>

            <button
              class="action-button"
              id="importButton"
              type="button"
            >
              Import backup
            </button>
          </div>

          <p class="settings-warning">
            Your archive is currently stored in this browser.
            Export backups regularly. Clearing browser data may
            permanently erase locally saved information.
          </p>
        </section>

        <section class="settings-section glass-surface">
          <h2 class="settings-heading">About</h2>

          <div class="setting-row">
            <div class="setting-copy">
              <span class="setting-name">Watch Archive</span>
              <span class="setting-description">
                A private space for stories and observations.
              </span>
            </div>

            <span class="setting-value">
              ${CONFIG.version}
            </span>
          </div>
        </section>

      </div>
    `;
  }

  const pageBuilders = {
    library: libraryPage,
    groups: groupsPage,
    rankings: rankingsPage,
    history: historyPage,
    settings: settingsPage
  };

  /* =====================================
     NAVIGATION
  ===================================== */

  function getPageFromHash() {
    const hash = location.hash.slice(1).toLowerCase();

    return pageBuilders[hash] ? hash : "library";
  }

  function renderPage() {
    const page = getPageFromHash();

    currentPage = page;

    const target = $("#pageContent");
    target.innerHTML = pageBuilders[page]();

    $$(".nav-link, .mobile-link").forEach(link => {
      const active = link.dataset.page === page;

      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    const breadcrumb = $("#breadcrumb");

    breadcrumb.replaceChildren();

    const home = document.createElement("span");
    home.textContent = "Archive";

    const slash = document.createElement("span");
    slash.className = "breadcrumb-divider";
    slash.textContent = "/";

    const current = document.createElement("strong");
    current.textContent = CONFIG.pages[page].title;

    breadcrumb.append(home, slash, current);

    document.title =
      `${CONFIG.pages[page].title} — ${CONFIG.appName}`;

    if (page === "settings") {
      bindSettings();
    }
  }

  function navigate(page) {
    if (!pageBuilders[page]) return;

    if (location.hash === `#${page}`) {
      renderPage();
      return;
    }

    location.hash = page;
  }

  /* =====================================
     SETTINGS INTERACTION
  ===================================== */

  function applyMotionSetting() {
    const reduced =
      state.settings.reduceMotion ||
      prefersReducedMotion.matches;

    document.body.classList.toggle(
      "reduce-motion",
      reduced
    );
  }

  function bindSettings() {
    const density = $("#starDensity");
    const brightness = $("#starBrightness");
    const motion = $("#reduceMotion");

    density.addEventListener("input", () => {
      const value = Number(density.value);

      state.settings.starDensity = value;
      $("#densityValue").textContent = value;

      starfield.rebuild();
      saveState();
    });

    brightness.addEventListener("input", () => {
      const value = Number(brightness.value);

      state.settings.starBrightness = value;
      $("#brightnessValue").textContent = value;

      starfield.draw(performance.now());
      saveState();
    });

    motion.addEventListener("change", () => {
      state.settings.reduceMotion = motion.checked;

      applyMotionSetting();
      starfield.draw(performance.now());
      saveState();
    });

    $("#exportButton").addEventListener(
      "click",
      exportArchive
    );

    $("#importButton").addEventListener(
      "click",
      () => $("#importFile").click()
    );
  }

  /* =====================================
     TOAST NOTIFICATIONS
  ===================================== */

  function showToast(message) {
    const container = $("#toastContainer");

    container.replaceChildren();

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    container.appendChild(toast);

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.remove();
    }, 3500);
  }

  /* =====================================
     STARFIELD ENGINE
  ===================================== */

  class Starfield {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", {
        alpha: true
      });

      this.stars = [];
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.lastFrame = 0;
      this.running = false;
      this.raf = null;

      this.rebuild();
    }

    rebuild() {
      if (!this.ctx) return;

      this.width = window.innerWidth;
      this.height = window.innerHeight;

      this.dpr = Math.min(
        window.devicePixelRatio || 1,
        1.5
      );

      this.canvas.width = Math.round(
        this.width * this.dpr
      );

      this.canvas.height = Math.round(
        this.height * this.dpr
      );

      this.ctx.setTransform(
        this.dpr, 0, 0, this.dpr, 0, 0
      );

      const area = this.width * this.height;

      const density =
        state.settings.starDensity / 100;

      const count = Math.min(
        1100,
        Math.max(
          35,
          Math.floor(area * 0.00028 * density)
        )
      );

      this.stars = [];

      for (let i = 0; i < count; i++) {
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,

          radius:
            Math.random() < .92
              ? .25 + Math.random() * .75
              : .8 + Math.random() * .8,

          alpha: .2 + Math.random() * .65,
          phase: Math.random() * Math.PI * 2,
          speed: .0002 + Math.random() * .00065,

          warm: Math.random() < .08
        });
      }

      this.draw(performance.now());
    }

    draw(time) {
      if (!this.ctx) return;

      const ctx = this.ctx;

      ctx.clearRect(
        0, 0, this.width, this.height
      );

      const brightness =
        state.settings.starBrightness / 100;

      const reduced =
        state.settings.reduceMotion ||
        prefersReducedMotion.matches;

      for (const star of this.stars) {
        const twinkle = reduced
          ? .8
          : .78 + Math.sin(
              time * star.speed + star.phase
            ) * .22;

        const alpha = Math.min(
          1,
          star.alpha * twinkle *
          (.3 + brightness * 1.15)
        );

        ctx.beginPath();

        ctx.arc(
          star.x,
          star.y,
          star.radius,
          0,
          Math.PI * 2
        );

        ctx.fillStyle = star.warm
          ? `rgba(220,204,238,${alpha})`
          : `rgba(203,216,245,${alpha})`;

        ctx.fill();
      }
    }

    start() {
      if (this.running || !this.ctx) return;

      this.running = true;

      const animate = (time) => {
        if (!this.running) return;

        if (time - this.lastFrame >= 33) {
          this.draw(time);
          this.lastFrame = time;
        }

        this.raf = requestAnimationFrame(
          animate
        );
      };

      this.raf = requestAnimationFrame(
        animate
      );
    }

    stop() {
      this.running = false;

      if (this.raf !== null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
    }
  }

  const starfield = new Starfield(
    $("#starfield")
  );

  /* =====================================
     GLOBAL EVENTS
  ===================================== */

  function bindGlobalEvents() {
    window.addEventListener(
      "hashchange",
      () => {
        renderPage();

        window.scrollTo({
          top: 0,
          behavior: "instant"
        });
      }
    );

    let resizeTimer;

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        starfield.rebuild();
      }, 180);
    });

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          starfield.stop();
        } else {
          starfield.start();
        }
      }
    );

    prefersReducedMotion.addEventListener(
      "change",
      () => {
        applyMotionSetting();
        starfield.draw(performance.now());
      }
    );

    $("#settingsShortcut").addEventListener(
      "click",
      () => navigate("settings")
    );

    $("#importFile").addEventListener(
      "change",
      (event) => {
        const file = event.target.files?.[0];

        importArchive(file);
      }
    );

    window.addEventListener(
      "storage",
      (event) => {
        if (event.key !== KEY) return;

        state = loadState();
        applyMotionSetting();
        starfield.rebuild();
        renderPage();

        showToast("Archive refreshed from another tab.");
      }
    );
  }

  /* =====================================
     INITIALIZE
  ===================================== */

  function initialize() {
    applyMotionSetting();
    bindGlobalEvents();

    if (!location.hash) {
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#library`
      );
    }

    renderPage();
    starfield.start();

    $("#footerVersion").textContent =
      `V${CONFIG.version}`;
  }

  initialize();

})();

