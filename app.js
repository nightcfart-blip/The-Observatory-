
"use strict";

(() => {
  const CONFIG = window.WATCH_DATA;
  if (!CONFIG) return;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clone = value => JSON.parse(JSON.stringify(value));

  const STORAGE_KEY = CONFIG.storageKey;
  const MIN_ZOOM = 0.18;
  const MAX_ZOOM = 3.8;
  const TAP_THRESHOLD = 9;

  const systemMotion = matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  const viewport = $("#viewport");
  const world = $("#world");
  const layer = $("#starLayer");
  const connections = $("#connectionLayer");

  let state = loadState();
  let scene = null;
  let stack = [];
  let transitionTimer = null;
  let transitionToken = 0;
  let toastTimer = null;
  let previousFocus = null;

  const camera = {
    x: 0,
    y: 0,
    zoom: 1
  };

  const pointers = new Map();

  let dragDistance = 0;
  let pinch = null;
  let suppressClickUntil = 0;

  /* =====================================
     STORAGE
  ===================================== */

  function createState() {
    const now = new Date().toISOString();

    return {
      schemaVersion: CONFIG.schemaVersion,
      createdAt: now,
      updatedAt: now,
      settings: clone(CONFIG.defaults.settings),
      archive: clone(CONFIG.defaults.archive)
    };
  }

  function numberBetween(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  }

  function normalizeState(input) {
    const base = createState();
    const settings = input?.settings || {};
    const archive = input?.archive || {};

    return {
      ...base,
      ...(input || {}),
      schemaVersion: CONFIG.schemaVersion,

      settings: {
        ...base.settings,
        ...settings,
        starDensity: numberBetween(
          settings.starDensity, 10, 100, 65
        ),
        starBrightness: numberBetween(
          settings.starBrightness, 10, 100, 55
        ),
        reduceMotion: settings.reduceMotion === true
      },

      archive: {
        ...archive,
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

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createState();

      const parsed = JSON.parse(raw);

      if (parsed.schemaVersion !== CONFIG.schemaVersion) {
        throw new Error("Unsupported schema version");
      }

      return normalizeState(parsed);
    } catch (error) {
      console.error("Could not load archive:", error);
      return createState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state)
      );
      updateSaveStatus(true);
      return true;
    } catch (error) {
      updateSaveStatus(false);
      notify("Saving failed.");
      console.error(error);
      return false;
    }
  }

  function updateSaveStatus(success) {
    $("#saveStatus").classList.toggle(
      "error", !success
    );
    $("#saveText").textContent = success
      ? "Saved locally"
      : "Save failed";
  }

  /* =====================================
     HELPERS
  ===================================== */

  function motionReduced() {
    return (
      systemMotion.matches ||
      state.settings.reduceMotion
    );
  }

  function updateMotion() {
    document.body.classList.toggle(
      "reduce-motion",
      motionReduced()
    );
  }

  function notify(message) {
    const toast = $("#toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  }

  function hashValue(str) {
    let h = 2166136261;

    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return h >>> 0;
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(
      /[&<>"']/g,
      c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[c]
    );
  }

  /* =====================================
     CAMERA MATH
  ===================================== */

  function screenToWorld(sx, sy) {
    return {
      x: camera.x +
        (sx - window.innerWidth / 2) / camera.zoom,
      y: camera.y +
        (sy - window.innerHeight / 2) / camera.zoom
    };
  }

  function worldToScreen(x, y) {
    return {
      x: window.innerWidth / 2 +
        (x - camera.x) * camera.zoom,
      y: window.innerHeight / 2 +
        (y - camera.y) * camera.zoom
    };
  }

  function renderCamera() {
    world.style.transform =
      `translate3d(${window.innerWidth / 2}px,` +
      `${window.innerHeight / 2}px,0) ` +
      `scale(${camera.zoom}) ` +
      `translate3d(${-camera.x}px,${-camera.y}px,0)`;

    if (sky) sky.offset(camera.x, camera.y);
  }

  function setCamera(x, y, zoom) {
    camera.x = x;
    camera.y = y;
    camera.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    renderCamera();
  }

  function zoomAt(screenX, screenY, factor) {
    const before = screenToWorld(screenX, screenY);
    const newZoom = clamp(
      camera.zoom * factor,
      MIN_ZOOM,
      MAX_ZOOM
    );

    camera.zoom = newZoom;

    camera.x = before.x -
      (screenX - window.innerWidth / 2) / newZoom;

    camera.y = before.y -
      (screenY - window.innerHeight / 2) / newZoom;

    renderCamera();
  }

  let cameraAnimation = null;

  function animateCamera(target, duration = 650) {
    if (cameraAnimation) {
      cancelAnimationFrame(cameraAnimation);
      cameraAnimation = null;
    }

    if (motionReduced() || duration <= 0) {
      setCamera(target.x, target.y, target.zoom);
      return Promise.resolve();
    }

    const start = {...camera};
    const startTime = performance.now();

    return new Promise(resolve => {
      function frame(now) {
        const t = clamp(
          (now - startTime) / duration, 0, 1
        );

        const ease = 1 - Math.pow(1 - t, 3);

        setCamera(
          start.x + (target.x - start.x) * ease,
          start.y + (target.y - start.y) * ease,
          start.zoom + (target.zoom - start.zoom) * ease
        );

        if (t < 1) {
          cameraAnimation = requestAnimationFrame(frame);
        } else {
          cameraAnimation = null;
          resolve();
        }
      }

      cameraAnimation = requestAnimationFrame(frame);
    });
  }

  function fitZoom(nodes) {
    if (!nodes.length) return 1;

    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);

    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    const availableWidth = Math.max(
      180,
      window.innerWidth - (window.innerWidth < 650 ? 110 : 300)
    );

    const availableHeight = Math.max(
      160,
      window.innerHeight - (window.innerWidth < 650 ? 340 : 320)
    );

    return clamp(
      Math.min(
        availableWidth / Math.max(width + 160, 1),
        availableHeight / Math.max(height + 170, 1),
        1.1
      ),
      .26,
      1.1
    );
  }

  function sceneCamera(nodes) {
    if (!nodes.length) {
      return { x: 0, y: 0, zoom: 1 };
    }

    return {
      x: (
        Math.min(...nodes.map(n => n.x)) +
        Math.max(...nodes.map(n => n.x))
      ) / 2,
      y: (
        Math.min(...nodes.map(n => n.y)) +
        Math.max(...nodes.map(n => n.y))
      ) / 2,
      zoom: fitZoom(nodes)
    };
  }

  /* =====================================
     PROCEDURAL BACKGROUND
  ===================================== */

  class SpaceBackground {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.stars = [];
      this.x = 0;
      this.y = 0;
      this.running = false;
      this.frame = 0;
      this.lastDraw = 0;

      this.resize();
    }

    resize() {
      if (!this.ctx) return;

      this.width = window.innerWidth;
      this.height = window.innerHeight;

      const dpr = Math.min(
        window.devicePixelRatio || 1, 1.5
      );

      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const density = state.settings.starDensity / 100;

      const count = Math.min(
        1300,
        Math.max(
          75,
          Math.round(this.width * this.height * .00045 * density)
        )
      );

      this.stars = [];

      for (let i = 0; i < count; i++) {
        const large = Math.random() > .96;

        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius: large
            ? .9 + Math.random() * .85
            : .2 + Math.random() * .65,
          alpha: .17 + Math.random() * .66,
          depth: .04 + Math.random() * .22,
          phase: Math.random() * Math.PI * 2,
          speed: .00015 + Math.random() * .00045,
          warm: Math.random() < .08
        });
      }

      this.draw(performance.now());
    }

    offset(x, y) {
      this.x = x;
      this.y = y;

      if (motionReduced()) {
        this.draw(performance.now());
      }
    }

    draw(time) {
      if (!this.ctx) return;

      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      const brightness =
        state.settings.starBrightness / 100;

      const reduced = motionReduced();

      for (const star of this.stars) {
        const sx = reduced ? star.x :
          ((star.x - this.x * star.depth) %
          this.width + this.width) % this.width;

        const sy = reduced ? star.y :
          ((star.y - this.y * star.depth) %
          this.height + this.height) % this.height;

        const twinkle = reduced ? 1 :
          .82 + Math.sin(
            time * star.speed + star.phase
          ) * .18;

        const alpha = clamp(
          star.alpha * twinkle * (.4 + brightness),
          0, 1
        );

        ctx.beginPath();
        ctx.arc(
          sx, sy, star.radius,
          0, Math.PI * 2
        );

        ctx.fillStyle = star.warm
          ? `rgba(228,207,224,${alpha})`
          : `rgba(207,213,245,${alpha})`;

        ctx.fill();
      }
    }

    start() {
      if (this.running || !this.ctx) return;

      this.running = true;

      const loop = t => {
        if (!this.running) return;

        if (t - this.lastDraw >= 33) {
          this.draw(t);
          this.lastDraw = t;
        }

        this.frame = requestAnimationFrame(loop);
      };

      this.frame = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.frame);
    }
  }

  let sky = new SpaceBackground(
    $("#backgroundStars")
  );

  /* =====================================
     ARCHIVE RELATIONSHIPS
  ===================================== */

  function relatedItems(parent) {
    const archive = state.archive;

    if (parent.type === "group") {
      return archive.productions.filter(item =>
        item.groupId === parent.id ||
        item.parentId === parent.id
      );
    }

    if (parent.type === "production") {
      return archive.seasons.filter(item =>
        item.productionId === parent.id ||
        item.parentId === parent.id
      );
    }

    if (parent.type === "season") {
      return archive.episodes.filter(item =>
        item.seasonId === parent.id ||
        item.parentId === parent.id
      );
    }

    return [];
  }

  function makeArchiveNode(item, type) {
    return {
      id: item.id,
      name: item.title || item.name || "Untitled",
      type,
      data: item,
      demo: false
    };
  }

  function getChildren(parent) {
    if (parent.demo) {
      return (parent.children || []).map(item => ({
        ...item,
        demo: true
      }));
    }

    if (parent.type === "root") {
      return [];
    }

    return relatedItems(parent).map(item => {
      const types = {
        group: "production",
        production: "season",
        season: "episode"
      };

      return makeArchiveNode(
        item,
        types[parent.type]
      );
    });
  }

  /* =====================================
     CONSTELLATION LAYOUT
  ===================================== */

  function positionNodes(items) {
    if (!items.length) return [];

    return items.map((item, index) => {
      if (
        Number.isFinite(item.data?.mapX) &&
        Number.isFinite(item.data?.mapY)
      ) {
        return {
          ...item,
          x: item.data.mapX,
          y: item.data.mapY
        };
      }

      const count = items.length;
      const hash = hashValue(item.id || item.name);

      const angle =
        -Math.PI / 2 +
        index * (Math.PI * 2 / Math.max(count, 3)) +
        ((hash % 21) - 10) * .008;

      const radius = count === 1
        ? 0
        : count === 2
          ? 225
          : 260 + Math.sqrt(count) * 48;

      return {
        ...item,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      };
    });
  }

  function makeConnections(nodes) {
    const result = [];

    if (nodes.length < 2) return result;

    // A simple nearest-neighbor constellation,
    // with an extra link for each star.
    const used = new Set();

    nodes.forEach((node, i) => {
      const nearest = nodes
        .filter(other => other.id !== node.id)
        .map(other => ({
          other,
          distance: Math.hypot(
            other.x - node.x,
            other.y - node.y
          )
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, nodes.length > 3 ? 2 : 1);

      nearest.forEach(({other}) => {
        const key = [node.id, other.id]
          .sort().join("|");

        if (!used.has(key)) {
          used.add(key);
          result.push([node.id, other.id]);
        }
      });
    });

    return result;
  }

  function makeScene(parent) {
    if (parent.type === "root") {
      return {
        parent,
        title: "Your Universe",
        eyebrow: "THE OBSERVATORY",
        subtitle: "Every story leaves a star behind.",
        nodes: clone(CONFIG.mainNodes),
        edges: clone(CONFIG.mainConnections)
      };
    }

    if (parent.type === "library") {
      const productions = state.archive.productions
        .map(p => makeArchiveNode(p, "production"));

      return {
        parent,
        title: "Library",
        eyebrow: "THE COLLECTION",
        subtitle: "All your stories, wherever they belong.",
        nodes: positionNodes(productions),
        edges: null
      };
    }

    if (parent.type === "groups") {
      const groups = state.archive.groups
        .map(g => makeArchiveNode(g, "group"));

      // A temporary example until Step 3.
      groups.push({
        ...CONFIG.demo,
        demo: true
      });

      return {
        parent,
        title: "Groups",
        eyebrow: "CONNECTED WORLDS",
        subtitle: "Each star contains another universe.",
        nodes: positionNodes(groups),
        edges: null
      };
    }

    const types = {
      group: "A CONSTELLATION OF STORIES",
      production: "THE SERIES",
      season: "THE SEASON",
      episode: "AN EPISODE"
    };

    const children = getChildren(parent);

    return {
      parent,
      title: parent.name,
      eyebrow: types[parent.type] || "THE ARCHIVE",
      subtitle: children.length
        ? "Look closer. There is more to discover."
        : "A quiet corner of your universe.",
      nodes: positionNodes(children),
      edges: null
    };
  }

  function drawScene(next) {
    scene = next;

    layer.replaceChildren();
    connections.replaceChildren();

    const ns = "http://www.w3.org/2000/svg";

    const nodeById = new Map(
      next.nodes.map(node => [node.id, node])
    );

    const edges = next.edges ||
      makeConnections(next.nodes);

    edges.forEach(([a, b]) => {
      const start = nodeById.get(a);
      const end = nodeById.get(b);

      if (!start || !end) return;

      const line = document.createElementNS(
        ns, "line"
      );

      line.setAttribute("x1", start.x);
      line.setAttribute("y1", start.y);
      line.setAttribute("x2", end.x);
      line.setAttribute("y2", end.y);

      line.dataset.from = a;
      line.dataset.to = b;

      connections.appendChild(line);
    });

    next.nodes.forEach(node => {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "celestial-star" +
        (node.type === "episode" ? " minor" : "") +
        (node.demo ? " demo" : "");

      button.style.left = `${node.x}px`;
      button.style.top = `${node.y}px`;
      button.style.setProperty(
        "--core-size",
        `${node.size || 8}px`
      );

      button.dataset.id = node.id;
      button.setAttribute(
        "aria-label",
        `Explore ${node.name}`
      );

      const aura = document.createElement("span");
      aura.className = "star-aura";

      const halo = document.createElement("span");
      halo.className = "star-halo";

      const core = document.createElement("span");
      core.className = "star-core";

      const label = document.createElement("span");
      label.className = "star-label";
      label.textContent = node.name;

      button.append(aura, halo, core, label);

      button.addEventListener("pointerenter", () => {
        highlight(node.id);
      });

      button.addEventListener("pointerleave", () => {
        highlight(null);
      });

      button.addEventListener("focus", () => {
        highlight(node.id);
      });

      button.addEventListener("blur", () => {
        highlight(null);
      });

      button.addEventListener("click", event => {
        event.stopPropagation();

        if (performance.now() < suppressClickUntil) {
          return;
        }

        selectNode(node);
      });

      layer.appendChild(button);
    });

    updateSceneHeading();
    updateBreadcrumbs();
    updateControls();
    updateEmptyHint();
  }

  function highlight(id) {
    $$(".celestial-star").forEach(button => {
      button.classList.toggle(
        "selected",
        button.dataset.id === id
      );
    });

    $$(".connection-layer line").forEach(line => {
      line.classList.toggle(
        "lit",
        id && (
          line.dataset.from === id ||
          line.dataset.to === id
        )
      );
    });
  }

  /* =====================================
     SCENE NAVIGATION
  ===================================== */

  function updateSceneHeading() {
    $("#sceneEyebrow").textContent = scene.eyebrow;
    $("#sceneTitle").textContent = scene.title;
    $("#sceneSubtitle").textContent = scene.subtitle;
  }

  function updateBreadcrumbs() {
    const nav = $("#breadcrumbs");
    nav.replaceChildren();

    const parents = [
      { label: "Universe", depth: -1 },
      ...stack.map((entry, index) => ({
        label: entry.scene.parent.type === "root"
          ? "Universe"
          : entry.scene.title,
        depth: index
      }))
    ];

    const unique = parents.filter(
      (entry, index) =>
        !(index === 1 && entry.label === "Universe")
    );

    unique.forEach(entry => {
      const button = document.createElement("button");
      button.className = "crumb";
      button.textContent = entry.label;
      button.type = "button";

      button.addEventListener("click", () => {
        if (entry.depth < 0) goHome();
        else returnToDepth(entry.depth);
      });

      nav.appendChild(button);

      const slash = document.createElement("span");
      slash.className = "crumb-divider";
      slash.textContent = "/";

      nav.appendChild(slash);
    });

    const current = document.createElement("span");
    current.className = "crumb current";
    current.textContent = scene.title;

    nav.appendChild(current);
  }

  function updateControls() {
    $("#backButton").disabled = stack.length === 0;
  }

  function updateEmptyHint() {
    const hint = $("#interactionHint");

    if (scene.nodes.length === 0) {
      hint.textContent =
        "THIS CONSTELLATION IS EMPTY — ENTRIES ARRIVE IN STEP 3";
    } else {
      hint.innerHTML =
        "<span>DRAG TO EXPLORE</span>" +
        "<span class='hint-divider'>·</span>" +
        "<span>PINCH TO ZOOM</span>" +
        "<span class='hint-divider'>·</span>" +
        "<span>TAP A STAR</span>";
    }
  }

  function enterScene(parent, focusNode = null) {
    const next = makeScene(parent);

    stack.push({
      scene,
      camera: {...camera}
    });

    const target = sceneCamera(next.nodes);
    const token = ++transitionToken;

    clearTimeout(transitionTimer);

    function finish() {
      if (token !== transitionToken) return;

      drawScene(next);
      setCamera(
        target.x, target.y, target.zoom
      );
    }

    if (focusNode && !motionReduced()) {
      animateCamera({
        x: focusNode.x,
        y: focusNode.y,
        zoom: Math.min(
          MAX_ZOOM, camera.zoom * 1.7
        )
      }, 350);

      transitionTimer = setTimeout(finish, 370);
    } else {
      finish();
    }
  }

  function goBack() {
    if (!stack.length) return;

    ++transitionToken;
    clearTimeout(transitionTimer);

    const previous = stack.pop();
    drawScene(previous.scene);

    animateCamera(previous.camera, 550);
  }

  function returnToDepth(depth) {
    if (depth < 0) {
      goHome();
      return;
    }

    if (depth >= stack.length) return;

    const chosen = stack[depth];
    stack = stack.slice(0, depth);

    ++transitionToken;
    clearTimeout(transitionTimer);

    drawScene(chosen.scene);
    animateCamera(chosen.camera, 550);
  }

  function goHome() {
    ++transitionToken;
    clearTimeout(transitionTimer);
    stack = [];

    const home = makeScene({
      id: "root",
      name: "Universe",
      type: "root"
    });

    drawScene(home);
    animateCamera(
      sceneCamera(home.nodes),
      650
    );
  }

  function selectNode(node) {
    if (node.type === "navigation") {
      if (node.id === "settings") {
        openSettings();
        return;
      }

      if (node.id === "rankings" ||
          node.id === "history") {
        openInformation(node.id);
        return;
      }

      enterScene({
        id: node.id,
        name: node.name,
        type: node.id
      }, node);

      return;
    }

    if (node.type === "episode") {
      openEntry(node);
      return;
    }

    enterScene(node, node);
  }

  /* =====================================
     DETAIL OVERLAY
  ===================================== */

  const overlay = $("#detailOverlay");
  const detailContent = $("#detailContent");

  let previousFocusElement = null;

  function openOverlay(html) {
    previousFocusElement = document.activeElement;

    detailContent.innerHTML = html;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    $("#closeDetailButton").focus();

    $("#viewport").inert = true;
  }

  function closeOverlay() {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    $("#viewport").inert = false;

    if (previousFocusElement?.isConnected) {
      previousFocusElement.focus();
    } else {
      $("#viewport").focus();
    }
  }

  function openInformation(type) {
    const info = type === "rankings"
      ? {
          title: "Rankings",
          eyebrow: "THE STORIES THAT STAYED",
          body: "Your ratings, favorite productions, " +
            "and personal statistics will appear here " +
            "as the archive develops."
        }
      : {
          title: "History",
          eyebrow: "THROUGH TIME",
          body: "Your watching history, rewatches, " +
            "and personal timeline will eventually " +
            "live here."
        };

    openOverlay(`
      <span class="detail-eyebrow">${info.eyebrow}</span>
      <h2 id="detailTitle">${info.title}</h2>
      <p>${info.body}</p>
    `);
  }

  function openEntry(node) {
    const data = node.data || {};
    const title = escapeHtml(node.name);

    const notes = data.notes ||
      data.observations ||
      "This entry will have its own detailed page in Step 5.";

    openOverlay(`
      <span class="detail-eyebrow">EPISODE</span>
      <h2 id="detailTitle">${title}</h2>
      <p>${escapeHtml(notes)}</p>
    `);
  }

  function openSettings() {
    openOverlay(`
      <span class="detail-eyebrow">THE OBSERVATORY</span>
      <h2 id="detailTitle">Settings</h2>
      <p>
        Adjust the atmosphere of your personal universe.
      </p>

      <h3>Atmosphere</h3>

      <div class="detail-field setting-field">
        <label for="starDensity">Star density</label>
        <div>
          <input
            id="starDensity"
            class="setting-range"
            type="range"
            min="10"
            max="100"
            step="5"
            value="${state.settings.starDensity}"
          >
          <output id="densityValue">
            ${state.settings.starDensity}
          </output>
        </div>
      </div>

      <div class="detail-field setting-field">
        <label for="starBrightness">Star brightness</label>
        <div>
          <input
            id="starBrightness"
            class="setting-range"
            type="range"
            min="10"
            max="100"
            step="5"
            value="${state.settings.starBrightness}"
          >
          <output id="brightnessValue">
            ${state.settings.starBrightness}
          </output>
        </div>
      </div>

      <div class="detail-field setting-field">
        <label for="reduceMotion">Reduce motion</label>
        <input
          id="reduceMotion"
          class="motion-toggle"
          type="checkbox"
          ${state.settings.reduceMotion ? "checked" : ""}
        >
      </div>

      <h3>Archive & Storage</h3>

      <p>
        Your personal records are stored locally in
        this browser. Export backups regularly.
      </p>

      <button class="detail-action"
        type="button" id="exportButton">
        Export backup ↗
      </button>

      <button class="detail-action"
        type="button" id="importButton">
        Import backup ↙
      </button>
    `);

    $("#starDensity").addEventListener("input", e => {
      state.settings.starDensity = Number(e.target.value);
      $("#densityValue").textContent = e.target.value;
      sky.resize();
      saveState();
    });

    $("#starBrightness").addEventListener("input", e => {
      state.settings.starBrightness = Number(e.target.value);
      $("#brightnessValue").textContent = e.target.value;
      sky.draw(performance.now());
      saveState();
    });

    $("#reduceMotion").addEventListener("change", e => {
      state.settings.reduceMotion = e.target.checked;
      updateMotion();
      sky.draw(performance.now());
      saveState();
    });

    $("#exportButton").addEventListener(
      "click", exportBackup
    );

    $("#importButton").addEventListener(
      "click", () => $("#importFile").click()
    );
  }

  /* =====================================
     BACKUP IMPORT / EXPORT
  ===================================== */

  function exportBackup() {
    const backup = {
      app: CONFIG.appName,
      schemaVersion: CONFIG.schemaVersion,
      exportedAt: new Date().toISOString(),
      data: state
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      {type: "application/json"}
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "watch-archive-" +
      new Date().toISOString().slice(0, 10) +
      ".json";

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Backup prepared.");
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
        !["groups","productions","seasons","episodes"]
          .every(k => Array.isArray(backup.data.archive[k]))
      ) {
        throw new Error("Invalid backup");
      }

      if (!confirm(
        "Replace your current archive with this backup?\n" +
        "Export the current archive first if needed."
      )) return;

      const oldState = state;
      state = normalizeState(backup.data);

      if (!saveState()) {
        state = oldState;
        return;
      }

      updateMotion();
      sky.resize();
      closeOverlay();
      goHome();

      notify("Archive imported successfully.");
    } catch (error) {
      console.error(error);
      notify("Backup import failed.");
    } finally {
      $("#importFile").value = "";
    }
  }

  /* =====================================
     POINTER INTERACTION
  ===================================== */

  function pointerPosition(event) {
    return {x: event.clientX, y: event.clientY};
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function middle(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function beginPinch() {
    if (pointers.size < 2) return;

    const [a, b] = [...pointers.values()];
    const center = middle(a, b);

    pinch = {
      distance: Math.max(1, distance(a, b)),
      zoom: camera.zoom,
      worldPoint: screenToWorld(center.x, center.y)
    };

    suppressClickUntil = performance.now() + 400;
  }

  function bindPointerControls() {
    viewport.addEventListener("pointerdown", e => {
      if (e.button !== 0 && e.pointerType === "mouse") {
        return;
      }

      if (cameraAnimation) {
        cancelAnimationFrame(cameraAnimation);
        cameraAnimation = null;
      }

      viewport.setPointerCapture(e.pointerId);
      pointers.set(
        e.pointerId,
        pointerPosition(e)
      );

      if (pointers.size === 1) {
        dragDistance = 0;
      } else if (pointers.size === 2) {
        beginPinch();
      }
    });

    viewport.addEventListener("pointermove", e => {
      if (!pointers.has(e.pointerId)) return;

      const old = pointers.get(e.pointerId);
      const next = pointerPosition(e);

      pointers.set(e.pointerId, next);

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        if (!pinch) beginPinch();

        const center = middle(a, b);
        const d = Math.max(1, distance(a, b));

        camera.zoom = clamp(
          pinch.zoom * d / pinch.distance,
          MIN_ZOOM,
          MAX_ZOOM
        );

        camera.x = pinch.worldPoint.x -
          (center.x - innerWidth / 2) / camera.zoom;

        camera.y = pinch.worldPoint.y -
          (center.y - innerHeight / 2) / camera.zoom;

        renderCamera();
        dragDistance = TAP_THRESHOLD + 1;
        suppressClickUntil = performance.now() + 400;
        return;
      }

      const dx = next.x - old.x;
      const dy = next.y - old.y;

      dragDistance += Math.hypot(dx, dy);

      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;

      renderCamera();

      if (dragDistance > TAP_THRESHOLD) {
        viewport.classList.add("dragging");
        suppressClickUntil = performance.now() + 350;
      }
    });

    function pointerEnd(e) {
      if (!pointers.has(e.pointerId)) return;

      pointers.delete(e.pointerId);

      if (viewport.hasPointerCapture(e.pointerId)) {
        viewport.releasePointerCapture(e.pointerId);
      }

      viewport.classList.remove("dragging");

      if (pointers.size < 2) {
        pinch = null;
      }

      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        pinch = null;
        dragDistance = 0;
      }
    }

    viewport.addEventListener("pointerup", pointerEnd);
    viewport.addEventListener("pointercancel", pointerEnd);

    viewport.addEventListener("wheel", e => {
      e.preventDefault();

      const factor = Math.exp(-e.deltaY * .0011);
      zoomAt(e.clientX, e.clientY, factor);
    }, {passive: false});

    viewport.addEventListener("click", e => {
      if (e.target === viewport &&
          performance.now() < suppressClickUntil) {
        e.preventDefault();
      }
    });

    viewport.addEventListener("keydown", e => {
      if (e.target !== viewport) return;

      const step = 80 / camera.zoom;

      if (e.key === "ArrowUp") camera.y -= step;
      else if (e.key === "ArrowDown") camera.y += step;
      else if (e.key === "ArrowLeft") camera.x -= step;
      else if (e.key === "ArrowRight") camera.x += step;
      else if (e.key === "+" || e.key === "=") {
        zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
      } else if (e.key === "-") {
        zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
      } else return;

      e.preventDefault();
      renderCamera();
    });
  }

  /* =====================================
     BUTTONS & GLOBAL EVENTS
  ===================================== */

  function bindControls() {
    $("#brandButton").addEventListener(
      "click", goHome
    );

    $("#homeButton").addEventListener(
      "click", goHome
    );

    $("#backButton").addEventListener(
      "click", goBack
    );

    $("#zoomInButton").addEventListener(
      "click", () => {
        zoomAt(innerWidth / 2, innerHeight / 2, 1.3);
      }
    );

    $("#zoomOutButton").addEventListener(
      "click", () => {
        zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.3);
      }
    );

    $("#focusButton").addEventListener(
      "click", () => {
        animateCamera(
          sceneCamera(scene.nodes), 650
        );
      }
    );

    $("#closeDetailButton").addEventListener(
      "click", closeOverlay
    );

    $("#detailBackdrop").addEventListener(
      "click", closeOverlay
    );

    window.addEventListener("keydown", e => {
      if (e.key === "Escape" &&
          overlay.classList.contains("open")) {
        closeOverlay();
      }
    });

    $("#importFile").addEventListener("change", e => {
      importBackup(e.target.files?.[0]);
    });

    let resizeTimer;

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        sky.resize();
        renderCamera();
      }, 130);
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
      if (e.key !== STORAGE_KEY) return;

      state = loadState();
      updateMotion();
      sky.resize();
      goHome();
      notify("Archive updated from another tab.");
    });
  }

  /* =====================================
     START THE UNIVERSE
  ===================================== */

  function initialize() {
    updateMotion();
    bindPointerControls();
    bindControls();

    const root = {
      id: "root",
      name: "Universe",
      type: "root"
    };

    const home = makeScene(root);
    drawScene(home);

    const start = sceneCamera(home.nodes);

    setCamera(
      start.x,
      start.y,
      start.zoom
    );

    sky.start();

    if (!localStorage.getItem(STORAGE_KEY)) {
      saveState();
    }
  }

  initialize();

})();
