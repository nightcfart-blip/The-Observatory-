
"use strict";

(() => {
  const CONFIG = window.WATCH_DATA;
  if (!CONFIG) {
    console.error("Missing data.js");
    return;
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const storageKey = CONFIG.storageKey;

  const systemMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let state = loadState();
  let toastTimeout = null;

  function motionReduced() {
    return systemMotion.matches || state.settings.reduceMotion;
  }

  /* ======================================
     STORAGE
  ====================================== */

  function initialState() {
    const now = new Date().toISOString();
    return {
      schemaVersion: CONFIG.schemaVersion,
      createdAt: now,
      updatedAt: now,
      settings: clone(CONFIG.defaults.settings),
      archive: clone(CONFIG.defaults.archive)
    };
  }

  function normalizeState(input) {
    const base = initialState();
    const archive = input?.archive || {};
    const settings = input?.settings || {};

    return {
      schemaVersion: CONFIG.schemaVersion,
      createdAt: input?.createdAt || base.createdAt,
      updatedAt: input?.updatedAt || base.updatedAt,
      settings: {
        starDensity: safeNumber(
          settings.starDensity, 10, 100, 65
        ),
        starBrightness: safeNumber(
          settings.starBrightness, 10, 100, 55
        ),
        reduceMotion: settings.reduceMotion === true
      },
      archive: {
        groups: Array.isArray(archive.groups)
          ? archive.groups : [],
        productions: Array.isArray(archive.productions)
          ? archive.productions : [],
        seasons: Array.isArray(archive.seasons)
          ? archive.seasons : [],
        episodes: Array.isArray(archive.episodes)
          ? archive.episodes : []
      }
    };
  }

  function safeNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.min(max, Math.max(min, n))
      : fallback;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return initialState();

      const saved = JSON.parse(raw);
      if (saved.schemaVersion !== CONFIG.schemaVersion) {
        throw new Error("Unsupported storage version");
      }
      return normalizeState(saved);
    } catch (error) {
      console.warn("Storage unavailable or incompatible:", error);
      return initialState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      setSaveStatus(true);
      return true;
    } catch (error) {
      console.error("Storage error:", error);
      setSaveStatus(false);
      toast("Unable to save in this browser.");
      return false;
    }
  }

  function setSaveStatus(success) {
    $("#saveStatus").classList.toggle("error", !success);
    $("#saveText").textContent =
      success ? "Saved locally" : "Save failed";
  }

  /* ======================================
     BACKUP SYSTEM
  ====================================== */

  function exportBackup() {
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
    link.href = url;
    link.download =
      "watch-archive-" +
      new Date().toISOString().slice(0, 10) +
      ".json";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup prepared.");
  }

  async function importBackup(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (
        backup.app !== CONFIG.appName ||
        backup.schemaVersion !== CONFIG.schemaVersion ||
        !backup.data ||
        !backup.data.archive ||
        !["groups", "productions", "seasons", "episodes"]
          .every(k => Array.isArray(backup.data.archive[k]))
      ) {
        throw new Error("Invalid archive backup");
      }

      const proceed = confirm(
        "Replace the current local archive with this backup?\n\n" +
        "Export your current archive first if you want to keep it."
      );

      if (!proceed) return;

      const previousState = state;
      state = normalizeState(backup.data);

      if (!saveState()) {
        state = previousState;
        return;
      }

      populateSettings();
      updateMotion();
      sky.rebuild();
      toast("Archive restored.");

    } catch (error) {
      console.error(error);
      toast("Invalid or incompatible backup file.");
    } finally {
      $("#importFile").value = "";
    }
  }

  /* ======================================
     STARFIELD
  ====================================== */

  class CosmicSky {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.stars = [];
      this.width = 0;
      this.height = 0;
      this.frame = null;
      this.lastFrame = 0;
      this.running = false;
      this.scrollY = 0;
      this.rebuild();
    }

    rebuild() {
      if (!this.ctx) return;

      this.width = window.innerWidth;
      this.height = window.innerHeight;

      const dpr = Math.min(
        window.devicePixelRatio || 1, 1.5
      );

      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = this.width * this.height;
      const density = state.settings.starDensity / 100;

      const count = Math.min(
        1600,
        Math.max(70, Math.round(area * .00052 * density))
      );

      this.stars = [];

      for (let i = 0; i < count; i++) {
        const r = Math.random();
        let radius;

        if (r < .78) {
          radius = .25 + Math.random() * .48;
        } else if (r < .975) {
          radius = .7 + Math.random() * .55;
        } else {
          radius = 1.15 + Math.random() * .85;
        }

        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius,
          alpha: .16 + Math.random() * .66,
          phase: Math.random() * Math.PI * 2,
          speed: .00018 + Math.random() * .00055,
          depth: .15 + Math.random() * .85,
          warm: Math.random() < .08
        });
      }

      this.draw(performance.now());
    }

    draw(time) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      const bright = state.settings.starBrightness / 100;
      const reduced = motionReduced();

      for (const star of this.stars) {
        const twinkle = reduced
          ? 1
          : .82 + Math.sin(
              time * star.speed + star.phase
            ) * .18;

        const opacity = Math.min(
          1,
          star.alpha * twinkle * (.45 + bright * 1.1)
        );

        const shift = reduced ? 0 :
          this.scrollY * star.depth * .025;

        const y = (
          (star.y - shift) % this.height +
          this.height
        ) % this.height;

        ctx.beginPath();
        ctx.arc(star.x, y, star.radius, 0, Math.PI * 2);

        ctx.fillStyle = star.warm
          ? `rgba(232,207,216,${opacity})`
          : `rgba(209,218,245,${opacity})`;
        ctx.fill();

        if (star.radius > 1.4 && opacity > .35) {
          const glow = ctx.createRadialGradient(
            star.x, y, 0,
            star.x, y, star.radius * 7
          );
          glow.addColorStop(
            0, `rgba(185,187,255,${opacity * .15})`
          );
          glow.addColorStop(1, "rgba(185,187,255,0)");

          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(
            star.x, y, star.radius * 7,
            0, Math.PI * 2
          );
          ctx.fill();
        }
      }
    }

    start() {
      if (this.running || !this.ctx) return;
      this.running = true;

      const loop = time => {
        if (!this.running) return;

        if (time - this.lastFrame >= 33) {
          this.draw(time);
          this.lastFrame = time;
        }

        this.frame = requestAnimationFrame(loop);
      };

      this.frame = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      if (this.frame != null) {
        cancelAnimationFrame(this.frame);
        this.frame = null;
      }
    }
  }

  const sky = new CosmicSky($("#stars"));

  /* ======================================
     CONSTELLATION
  ====================================== */

  function updateConstellationGeometry() {
    // The lines must always connect to the
    // precise center of their corresponding stars.
    const points = {};

    $$(".celestial-node").forEach(node => {
      const id = node.dataset.node;
      const left = parseFloat(getComputedStyle(node).left);
      const top = parseFloat(getComputedStyle(node).top);
      const constellation = $("#constellation");

      points[id] = {
        x: (left / constellation.clientWidth) * 100,
        y: (top / constellation.clientHeight) * 100
      };
    });

    $$(".constellation-lines line").forEach(line => {
      const [a, b] = line.dataset.link.split("-");
      if (!points[a] || !points[b]) return;

      line.setAttribute("x1", points[a].x);
      line.setAttribute("y1", points[a].y);
      line.setAttribute("x2", points[b].x);
      line.setAttribute("y2", points[b].y);
    });
  }

  function highlightNode(name) {
    $$(".celestial-node").forEach(node => {
      node.classList.toggle(
        "active",
        node.dataset.node === name
      );
    });

    $$(".constellation-lines line").forEach(line => {
      line.classList.toggle(
        "illuminated",
        name && line.dataset.link.split("-").includes(name)
      );
    });
  }

  function bindConstellation() {
    $$(".celestial-node").forEach(node => {
      node.addEventListener("pointerenter", () => {
        highlightNode(node.dataset.node);
      });

      node.addEventListener("pointerleave", () => {
        highlightNode("");
      });

      node.addEventListener("focus", () => {
        highlightNode(node.dataset.node);
      });

      node.addEventListener("blur", () => {
        highlightNode("");
      });
    });

    updateConstellationGeometry();
  }

  /* ======================================
     SECTION NAVIGATION
  ====================================== */

  function scrollToTarget(id, updateUrl = true) {
    const target = document.getElementById(id);
    if (!target) return;

    if (updateUrl) {
      history.pushState(null, "", `#${id}`);
    }

    target.scrollIntoView({
      behavior: motionReduced() ? "instant" : "smooth",
      block: "start"
    });
  }

  function bindNavigation() {
    $$('a[href^="#"]').forEach(link => {
      link.addEventListener("click", event => {
        const id = link.getAttribute("href").slice(1);
        if (!document.getElementById(id)) return;

        event.preventDefault();
        scrollToTarget(id);
      });
    });

    window.addEventListener("popstate", () => {
      const id = location.hash.slice(1) || "home";
      scrollToTarget(id, false);
    });

    if (location.hash) {
      requestAnimationFrame(() => {
        scrollToTarget(location.hash.slice(1), false);
      });
    }
  }

  /* ======================================
     SCROLL & REVEALS
  ====================================== */

  function bindScroll() {
    const returnStar = $("#returnStar");

    const onScroll = () => {
      sky.scrollY = window.scrollY;

      returnStar.classList.toggle(
        "visible",
        window.scrollY > window.innerHeight * .55
      );
    };

    window.addEventListener(
      "scroll", onScroll, { passive: true }
    );

    onScroll();

    if (!("IntersectionObserver" in window)) {
      $$(".reveal").forEach(el =>
        el.classList.add("visible")
      );
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: .08 }
    );

    $$(".reveal").forEach(el => observer.observe(el));
  }

  /* ======================================
     SETTINGS
  ====================================== */

  function populateSettings() {
    $("#density").value = state.settings.starDensity;
    $("#brightness").value = state.settings.starBrightness;
    $("#motion").checked = state.settings.reduceMotion;

    $("#densityValue").textContent =
      state.settings.starDensity;
    $("#brightnessValue").textContent =
      state.settings.starBrightness;
  }

  function updateMotion() {
    document.body.classList.toggle(
      "reduce-motion",
      motionReduced()
    );
    sky.draw(performance.now());
  }

  function bindSettings() {
    populateSettings();

    $("#density").addEventListener("input", e => {
      const value = Number(e.target.value);
      state.settings.starDensity = value;
      $("#densityValue").textContent = value;

      sky.rebuild();
      saveState();
    });

    $("#brightness").addEventListener("input", e => {
      const value = Number(e.target.value);
      state.settings.starBrightness = value;
      $("#brightnessValue").textContent = value;

      sky.draw(performance.now());
      saveState();
    });

    $("#motion").addEventListener("change", e => {
      state.settings.reduceMotion = e.target.checked;
      updateMotion();
      saveState();
    });

    $("#exportButton").addEventListener(
      "click", exportBackup
    );

    $("#importButton").addEventListener(
      "click", () => $("#importFile").click()
    );

    $("#importFile").addEventListener("change", e => {
      importBackup(e.target.files?.[0]);
    });
  }

  /* ======================================
     NOTIFICATIONS
  ====================================== */

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.classList.remove("show");
    }, 3000);
  }

  /* ======================================
     GLOBAL EVENTS
  ====================================== */

  function bindGlobalEvents() {
    let resizeTimer;

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        sky.rebuild();
        updateConstellationGeometry();
      }, 150);
    });

    document.addEventListener(
      "visibilitychange", () => {
        if (document.hidden) sky.stop();
        else sky.start();
      }
    );

    systemMotion.addEventListener(
      "change", updateMotion
    );

    window.addEventListener("storage", e => {
      if (e.key !== storageKey) return;
      state = loadState();
      populateSettings();
      updateMotion();
      sky.rebuild();
      toast("Archive updated from another tab.");
    });
  }

  /* ======================================
     INITIALIZATION
  ====================================== */

  function initialize() {
    bindConstellation();
    bindNavigation();
    bindScroll();
    bindSettings();
    bindGlobalEvents();
    updateMotion();
    sky.start();

    // Save the initial structure if no data exists.
    // Existing Step 1 preferences and records remain.
    if (!localStorage.getItem(storageKey)) {
      saveState();
    }
  }

  initialize();
})();
