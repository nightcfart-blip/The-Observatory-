
"use strict";

/* =========================================================
   WATCH ARCHIVE — STEP 2
   THE COSMIC LIBRARY

   Continuous world-space navigation
   Screen-space labels
   Smooth camera and semantic zoom
   Procedural astronomical background
   Production-only collection browsing
   Mobile-first touch interactions
========================================================= */

(() => {
  const DATA = window.WATCH_DATA;
  if (!DATA) {
    console.error("Watch Archive: data.js is missing.");
    return;
  }

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clone = v => JSON.parse(JSON.stringify(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const viewport = $("#viewport");
  const starLayer = $("#starLayer");
  const starCanvas = $("#constellationCanvas");
  const nebulaCanvas = $("#nebulaCanvas");
  const backgroundCanvas = $("#backgroundStars");

  const detailOverlay = $("#detailOverlay");
  const searchOverlay = $("#searchOverlay");

  const cameraConfig = DATA.camera;
  const MIN_ZOOM = cameraConfig.minZoom;
  const MAX_ZOOM = cameraConfig.maxZoom;

  const reducedMedia = matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let state = readStorage();

  let nodes = [];
  let connections = [];
  let nodeMap = new Map();
  let selectedId = null;
  let lastFocus = null;

  let modalFocus = null;
  let toastTimer = null;
  let activeModal = null;

  let currentCollection = null;
  let collectionOptions = {
    query: "",
    sort: "alphabetical",
    genre: "",
    mediaType: "",
    status: ""
  };

  const camera = {
    x: 0,
    y: 0,
    zoom: cameraConfig.initialZoom
  };

  const targetCamera = { ...camera };

  let cameraAnimating = false;
  let cameraStart = null;
  let cameraEnd = null;
  let cameraStartTime = 0;
  let cameraDuration = cameraConfig.travelDuration;

  const pointers = new Map();
  let gesture = null;
  let suppressClickUntil = 0;

  let width = innerWidth;
  let height = innerHeight;
  let dpr = 1;

  let canvasDirty = true;
  let lastFrameTime = 0;
  let animationFrame = null;
  let running = false;

  /* =====================================================
     1. STORAGE
  ===================================================== */

  function initialState() {
    const time = new Date().toISOString();

    return {
      schemaVersion: DATA.schemaVersion,
      createdAt: time,
      updatedAt: time,
      settings: clone(DATA.defaults.settings),
      archive: clone(DATA.defaults.archive)
    };
  }

  function validNumber(value, fallback, min, max) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n)
      ? clamp(n, min, max)
      : fallback;
  }

  function normalizeState(input) {
    const base = initialState();
    const settings = input?.settings || {};
    const archive = input?.archive || {};

    return {
      ...base,
      ...(input || {}),
      schemaVersion: DATA.schemaVersion,

      settings: {
        ...base.settings,
        ...settings,
        starDensity: validNumber(
          settings.starDensity, 75, 10, 100
        ),
        starBrightness: validNumber(
          settings.starBrightness, 60, 10, 100
        ),
        nebulaIntensity: validNumber(
          settings.nebulaIntensity, 65, 0, 100
        ),
        constellationGlow: validNumber(
          settings.constellationGlow, 65, 0, 100
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

  function readStorage() {
    try {
      const raw = localStorage.getItem(DATA.storageKey);
      if (!raw) return initialState();

      const parsed = JSON.parse(raw);

      if (parsed.schemaVersion !== DATA.schemaVersion) {
        console.warn("Archive schema differs; saved data was not overwritten.");
        return initialState();
      }

      return normalizeState(parsed);
    } catch (error) {
      console.error("Storage could not be read:", error);
      return initialState();
    }
  }

  function saveStorage() {
    const previousTime = state.updatedAt;
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(
        DATA.storageKey,
        JSON.stringify(state)
      );
      return true;
    } catch (error) {
      state.updatedAt = previousTime;
      console.error("Saving failed:", error);
      showToast("Unable to save locally.");
      return false;
    }
  }

  function reducedMotion() {
    return state.settings.reduceMotion ||
      reducedMedia.matches;
  }

  function applyMotionPreference() {
    document.body.classList.toggle(
      "reduce-motion",
      reducedMotion()
    );
    canvasDirty = true;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => toast.classList.remove("show"),
      3100
    );
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function hashString(value) {
    let h = 2166136261;

    for (const ch of String(value)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }

    return h >>> 0;
  }

  function seeded(seed) {
    let t = seed + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* =====================================================
     2. CAMERA COORDINATES
  ===================================================== */

  function worldToScreen(x, y) {
    return {
      x: width / 2 + (x - camera.x) * camera.zoom,
      y: height / 2 + (y - camera.y) * camera.zoom
    };
  }

  function screenToWorld(x, y) {
    return {
      x: camera.x + (x - width / 2) / camera.zoom,
      y: camera.y + (y - height / 2) / camera.zoom
    };
  }

  function stopCameraAnimation() {
    cameraAnimating = false;
    cameraStart = null;
    cameraEnd = null;
  }

  function setCamera(x, y, zoom) {
    camera.x = x;
    camera.y = y;
    camera.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    canvasDirty = true;
  }

  function moveCamera(target, duration) {
    stopCameraAnimation();

    const end = {
      x: target.x,
      y: target.y,
      zoom: clamp(target.zoom, MIN_ZOOM, MAX_ZOOM)
    };

    if (reducedMotion()) {
      setCamera(end.x, end.y, end.zoom);
      return;
    }

    cameraStart = { ...camera };
    cameraEnd = end;
    cameraStartTime = performance.now();
    cameraDuration = duration ?? cameraConfig.travelDuration;
    cameraAnimating = true;
  }

  function stepCamera(now) {
    if (!cameraAnimating) return;

    const t = clamp(
      (now - cameraStartTime) / cameraDuration,
      0, 1
    );

    const e = t * t * (3 - 2 * t);

    // Log-space interpolation avoids abrupt changes
    // when travelling between different zoom scales.
    const zoom = Math.exp(
      lerp(
        Math.log(cameraStart.zoom),
        Math.log(cameraEnd.zoom),
        e
      )
    );

    setCamera(
      lerp(cameraStart.x, cameraEnd.x, e),
      lerp(cameraStart.y, cameraEnd.y, e),
      zoom
    );

    if (t >= 1) {
      cameraAnimating = false;
      cameraStart = null;
      cameraEnd = null;
    }
  }

  function zoomAt(screenX, screenY, factor) {
    stopCameraAnimation();

    const anchor = screenToWorld(screenX, screenY);
    const zoom = clamp(
      camera.zoom * factor,
      MIN_ZOOM,
      MAX_ZOOM
    );

    const x = anchor.x -
      (screenX - width / 2) / zoom;

    const y = anchor.y -
      (screenY - height / 2) / zoom;

    setCamera(x, y, zoom);
  }

  function fitNavigation() {
    const nav = nodes.filter(n => n.type === "navigation");
    if (!nav.length) return { x: 0, y: 0, zoom: .8 };

    const xs = nav.map(n => n.x);
    const ys = nav.map(n => n.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const scale = Math.min(
      width * (width < 650 ? .79 : .70) / (maxX - minX + 110),
      height * .51 / (maxY - minY + 130),
      1.08
    );

    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: clamp(scale, MIN_ZOOM, MAX_ZOOM)
    };
  }

  function goHome() {
    selectedId = null;
    lastFocus = null;
    moveCamera(fitNavigation(), 850);
  }

  function focusNode(node, requestedZoom = null) {
    selectedId = node.id;
    lastFocus = node;

    const defaults = {
      navigation: 1.4,
      group: 2.1,
      production: 4.4,
      season: 9.2,
      episode: 12
    };

    let zoom = requestedZoom ?? defaults[node.type] ?? 2;

    // Keep navigation toward a parent gradual.
    // A repeated tap can bring the camera closer.
    if (Math.abs(camera.x - node.x) < 15 &&
        Math.abs(camera.y - node.y) < 15 &&
        camera.zoom >= zoom * .9) {
      zoom = Math.min(MAX_ZOOM, camera.zoom * 1.35);
    }

    moveCamera({
      x: node.x,
      y: node.y,
      zoom
    }, cameraConfig.travelDuration);
  }

  /* =====================================================
     3. THE UNIVERSE GRAPH
  ===================================================== */

  function createNode(source) {
    return {
      id: String(source.id),
      title: String(source.title || source.name || "Untitled"),
      type: source.type,
      x: source.x,
      y: source.y,
      parentId: source.parentId || null,
      depth: source.depth ?? 0,
      demo: source.demo === true,
      action: source.action || null,
      magnitude: source.magnitude ?? 2.5,
      data: source.data || null,

      element: null,
      visible: 0,
      screenX: -10000,
      screenY: -10000
    };
  }

  function addNode(node) {
    if (nodeMap.has(node.id)) return false;
    nodeMap.set(node.id, node);
    nodes.push(node);
    return true;
  }

  function childCollection(parent) {
    if (parent.demo) {
      return Array.isArray(parent.children)
        ? parent.children
        : [];
    }

    const collections = {
      group: state.archive.productions,
      production: state.archive.seasons,
      season: state.archive.episodes
    };

    const keys = {
      group: ["groupId", "parentId"],
      production: ["productionId", "parentId"],
      season: ["seasonId", "parentId"]
    };

    const collection = collections[parent.type];
    if (!collection) return [];

    return collection.filter(item =>
      keys[parent.type].some(key =>
        item[key] != null &&
        String(item[key]) === String(parent.id)
      )
    );
  }

  function childOffset(item, i, count, type) {
    const radiusByType = {
      production: 210,
      season: 93,
      episode: 36
    };

    const base = radiusByType[type] || 120;
    const seed = hashString(item.id || item.title || i);

    const angle =
      -Math.PI / 2 +
      i * Math.PI * 2 / Math.max(count, 1) +
      (seeded(seed) - .5) * .29;

    const r =
      base *
      (.86 + seeded(seed + 7) * .30) *
      (count > 8 ? 1 + (count - 8) * .035 : 1);

    if (count === 1) {
      return { x: base * .75, y: -base * .35 };
    }

    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r
    };
  }

  function addChildren(parentData, parentNode) {
    const nextType = {
      group: "production",
      production: "season",
      season: "episode"
    }[parentNode.type];

    if (!nextType) return;

    const children = childCollection(parentData);

    children.forEach((child, i) => {
      const offset = childOffset(
        child, i, children.length, nextType
      );

      const ownX = child.mapX != null
        ? Number(child.mapX)
        : NaN;

      const ownY = child.mapY != null
        ? Number(child.mapY)
        : NaN;

      const node = createNode({
        id: child.id,
        title: child.title || child.name,
        type: nextType,
        x: Number.isFinite(ownX)
          ? ownX
          : parentNode.x + offset.x,
        y: Number.isFinite(ownY)
          ? ownY
          : parentNode.y + offset.y,
        parentId: parentNode.id,
        depth: parentNode.depth + 1,
        demo: parentNode.demo,
        magnitude: 2.3 + seeded(
          hashString(child.id || String(i))
        ) * 2.1,
        data: child
      });

      if (addNode(node)) addChildren(child, node);
    });
  }

  function groupPosition(group, index) {
    const x = Number(group.mapX ?? group.x);
    const y = Number(group.mapY ?? group.y);

    if (
      (group.mapX != null || group.x != null) &&
      (group.mapY != null || group.y != null) &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      return { x, y };
    }

    const seed = hashString(group.id || String(index));
    const angle =
      DATA.groupPlacement.angleOffset +
      index * 2.3999632297 +
      (seeded(seed) - .5) * .2;

    const radius =
      DATA.groupPlacement.initialRadius +
      Math.sqrt(index) * DATA.groupPlacement.distanceGrowth;

    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  }

  function naturalConnections(siblings) {
    if (siblings.length < 2) return [];

    const attached = [siblings[0]];
    const remaining = siblings.slice(1);
    const results = [];

    while (remaining.length) {
      let best = null;

      for (const a of attached) {
        for (const b of remaining) {
          const distance = Math.hypot(
            a.x - b.x, a.y - b.y
          );

          if (!best || distance < best.distance) {
            best = { a, b, distance };
          }
        }
      }

      if (!best) break;

      results.push({
        a: best.a.id,
        b: best.b.id,
        type: "secondary"
      });

      attached.push(best.b);
      remaining.splice(remaining.indexOf(best.b), 1);
    }

    return results;
  }

  function rebuildUniverse() {
    nodes = [];
    connections = [];
    nodeMap = new Map();

    const navigationScale = width < 650 ? .58 : 1;

    DATA.navigation.nodes.forEach(item => {
      addNode(createNode({
        id: `nav-${item.id}`,
        title: item.title,
        type: "navigation",
        x: item.x * navigationScale,
        y: item.y * navigationScale,
        action: item.action,
        magnitude: item.magnitude,
        depth: 0
      }));
    });

    DATA.navigation.connections.forEach(([a, b]) => {
      connections.push({
        a: `nav-${a}`,
        b: `nav-${b}`,
        type: "navigation"
      });
    });

    const groupRecords = [
      ...DATA.demoGroups,
      ...state.archive.groups
    ];

    groupRecords.forEach((group, index) => {
      const position = groupPosition(group, index);

      const node = createNode({
        id: group.id,
        title: group.title || group.name,
        type: "group",
        x: position.x,
        y: position.y,
        depth: 0,
        magnitude: 2.1,
        demo: group.demo === true,
        data: group
      });

      if (addNode(node)) addChildren(group, node);
    });

    const parents = new Set(
      nodes.filter(n => n.parentId).map(n => n.parentId)
    );

    parents.forEach(parentId => {
      const siblings = nodes.filter(
        n => n.parentId === parentId
      );
      connections.push(...naturalConnections(siblings));
    });

    rebuildHTMLStars();
    canvasDirty = true;
  }

  /* =====================================================
     4. SCREEN-SPACE LABELS

     These HTML buttons are never scaled by CSS.
     Their positions are recalculated from the camera.
  ===================================================== */

  function rebuildHTMLStars() {
    starLayer.replaceChildren();

    for (const node of nodes) {
      const button = document.createElement("button");

      button.type = "button";
      button.className =
        `celestial-star ${node.type}-star` +
        (node.demo ? " demo-star" : "");

      button.setAttribute(
        "aria-label", `Explore ${node.title}`
      );

      const touch = document.createElement("span");
      touch.className = "star-touch-area";

      const label = document.createElement("span");
      label.className = "star-label";
      label.textContent = node.title;

      button.append(touch, label);

      button.addEventListener("click", event => {
        event.stopPropagation();

        if (performance.now() < suppressClickUntil) {
          return;
        }

        selectStar(node);
      });

      button.addEventListener("pointerenter", () => {
        selectedId = node.id;
        canvasDirty = true;
      });

      button.addEventListener("pointerleave", () => {
        if (selectedId === node.id) {
          selectedId = lastFocus?.id || null;
          canvasDirty = true;
        }
      });

      button.addEventListener("focus", () => {
        selectedId = node.id;
        canvasDirty = true;
      });

      node.element = button;
      starLayer.appendChild(button);
    }
  }

  function threshold(node) {
    if (node.type === "production") {
      return DATA.semanticZoom.productions;
    }

    if (node.type === "season") {
      return DATA.semanticZoom.seasons;
    }

    if (node.type === "episode") {
      return DATA.semanticZoom.episodes;
    }

    return null;
  }

  function visibility(node) {
    const rule = threshold(node);
    if (!rule) return 1;

    let value = smoothstep(
      rule.start, rule.full, camera.zoom
    );

    // Spatial gating keeps unrelated constellations
    // from all appearing simultaneously.
    const parent = nodeMap.get(node.parentId);

    if (parent) {
      const distance = Math.hypot(
        camera.x - parent.x,
        camera.y - parent.y
      ) * camera.zoom;

      const reach = node.type === "production"
        ? Math.max(width, height) * 1.4
        : Math.max(width, height) * 1.15;

      value *= 1 - smoothstep(
        reach * .8, reach * 1.5, distance
      );
    }

    return clamp(value, 0, 1);
  }

  function updateStarPositions() {
    const margin = 100;

    for (const node of nodes) {
      const p = worldToScreen(node.x, node.y);

      node.screenX = p.x;
      node.screenY = p.y;

      const alpha = visibility(node);
      node.visible = alpha;

      const onScreen =
        p.x > -margin &&
        p.x < width + margin &&
        p.y > -margin &&
        p.y < height + margin;

      const display = onScreen && alpha > .02;

      node.element.classList.toggle(
        "is-hidden", !display
      );

      if (!display) {
        node.element.tabIndex = -1;
        continue;
      }

      node.element.style.left = `${p.x}px`;
      node.element.style.top = `${p.y}px`;
      node.element.style.setProperty(
        "--visibility",
        alpha.toFixed(3)
      );

      node.element.disabled = alpha < .68;
      node.element.tabIndex = alpha >= .68 ? 0 : -1;
      node.element.classList.toggle(
        "selected", selectedId === node.id
      );
    }
  }

  /* =====================================================
     5. HIGH-DPI CANVAS HELPERS
  ===================================================== */

  function resizeCanvas(canvas, context, ratio) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function resizeAllCanvases() {
    width = innerWidth;
    height = innerHeight;

    dpr = Math.min(
      devicePixelRatio || 1,
      DATA.graphics.maxPixelRatio
    );

    resizeCanvas(
      starCanvas,
      constellationRenderer.ctx,
      dpr
    );

    resizeCanvas(
      backgroundCanvas,
      backgroundRenderer.ctx,
      dpr
    );

    resizeCanvas(
      nebulaCanvas,
      nebulaRenderer.ctx,
      Math.min(dpr, 1)
    );

    backgroundRenderer.rebuild();
    nebulaRenderer.resize();

    canvasDirty = true;
  }

  /* =====================================================
     6. REALISTIC CONSTELLATION RENDERER

     All glow and line effects are drawn at the
     displayed screen resolution, without scaling text.
  ===================================================== */

  class ConstellationRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
    }

    drawLine(a, b, alpha, highlighted) {
      const ctx = this.ctx;

      ctx.beginPath();
      ctx.moveTo(a.screenX, a.screenY);
      ctx.lineTo(b.screenX, b.screenY);

      ctx.lineWidth = highlighted ? 1.1 : .66;

      ctx.strokeStyle = highlighted
        ? `rgba(204,199,255,${alpha * .75})`
        : `rgba(160,174,232,${alpha * .37})`;

      ctx.stroke();

      if (highlighted) {
        ctx.save();
        ctx.shadowBlur = 9;
        ctx.shadowColor = "rgba(167,155,255,.55)";
        ctx.stroke();
        ctx.restore();
      }
    }

    drawStar(node, time) {
      const ctx = this.ctx;

      const { screenX: x, screenY: y } = node;
      const alpha = node.visible;

      if (alpha <= .01) return;

      const styles = {
        navigation: DATA.appearance.navigationStars,
        group: DATA.appearance.groupStars,
        production: DATA.appearance.productionStars,
        season: DATA.appearance.seasonStars,
        episode: DATA.appearance.episodeStars
      };

      const style = styles[node.type];
      if (!style) return;

      const [r, g, b] = style.color;

      const magnitudeBoost =
        clamp((4 - node.magnitude) * .12 + 1, .72, 1.35);

      const radius = style.radius * magnitudeBoost;

      const active = selectedId === node.id;
      const glowMultiplier =
        state.settings.constellationGlow / 65;

      const pulse = reducedMotion()
        ? 1
        : 1 + Math.sin(
            time * .0012 + hashString(node.id)
          ) * .05;

      const outerRadius =
        style.glow * glowMultiplier *
        (active ? 1.55 : 1) * pulse;

      // Low-intensity stellar halo.
      const halo = ctx.createRadialGradient(
        x, y, 0,
        x, y, outerRadius
      );

      halo.addColorStop(
        0, `rgba(${r},${g},${b},${alpha * .27})`
      );

      halo.addColorStop(
        .18, `rgba(${r},${g},${b},${alpha * .14})`
      );

      halo.addColorStop(
        .52, `rgba(${r},${g},${b},${alpha * .035})`
      );

      halo.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
      ctx.fill();

      // Bright stellar core.
      const core = ctx.createRadialGradient(
        x, y, 0,
        x, y, radius * 2.2
      );

      core.addColorStop(0, `rgba(255,255,255,${alpha})`);
      core.addColorStop(
        .22, `rgba(${r},${g},${b},${alpha * .95})`
      );
      core.addColorStop(
        .55, `rgba(${r},${g},${b},${alpha * .36})`
      );
      core.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Subtle diffraction spikes on bright stars.
      if (node.type === "navigation" ||
          (node.type === "group" && active)) {
        const length = radius * (active ? 6.8 : 5.0);

        ctx.save();
        ctx.translate(x, y);
        ctx.globalAlpha = alpha * .55;

        const rayH = ctx.createLinearGradient(
          -length, 0, length, 0
        );
        rayH.addColorStop(0, "transparent");
        rayH.addColorStop(.5, "rgba(224,229,255,.75)");
        rayH.addColorStop(1, "transparent");

        ctx.strokeStyle = rayH;
        ctx.lineWidth = .65;
        ctx.beginPath();
        ctx.moveTo(-length, 0);
        ctx.lineTo(length, 0);
        ctx.stroke();

        const rayV = ctx.createLinearGradient(
          0, -length, 0, length
        );
        rayV.addColorStop(0, "transparent");
        rayV.addColorStop(.5, "rgba(224,229,255,.75)");
        rayV.addColorStop(1, "transparent");

        ctx.strokeStyle = rayV;
        ctx.beginPath();
        ctx.moveTo(0, -length);
        ctx.lineTo(0, length);
        ctx.stroke();

        ctx.restore();
      }
    }

    draw(time) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, width, height);

      // Draw lines first so the stars cover endpoints.
      for (const line of connections) {
        const a = nodeMap.get(line.a);
        const b = nodeMap.get(line.b);

        if (!a || !b) continue;

        const alpha = Math.min(a.visible, b.visible);
        if (alpha < .015) continue;

        const margin = 65;

        if (
          Math.max(a.screenX, b.screenX) < -margin ||
          Math.min(a.screenX, b.screenX) > width + margin ||
          Math.max(a.screenY, b.screenY) < -margin ||
          Math.min(a.screenY, b.screenY) > height + margin
        ) continue;

        const highlighted =
          selectedId === line.a ||
          selectedId === line.b;

        this.drawLine(a, b, alpha, highlighted);
      }

      for (const node of nodes) {
        if (node.visible <= .015) continue;

        if (
          node.screenX < -90 ||
          node.screenX > width + 90 ||
          node.screenY < -90 ||
          node.screenY > height + 90
        ) continue;

        this.drawStar(node, time);
      }
    }
  }

  /* =====================================================
     7. DEEP-SPACE BACKGROUND STARS

     Several different populations create the impression
     of distant stars rather than uniform random dots.
  ===================================================== */

  class BackgroundRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.stars = [];
      this.seed = 48192;
    }

    rebuild() {
      const count = Math.min(
        DATA.graphics.maximumBackgroundStars,
        Math.round(
          DATA.graphics.backgroundStarCount *
          (width * height / 850000) *
          (state.settings.starDensity / 75)
        )
      );

      this.stars = [];

      for (let i = 0; i < Math.max(count, 90); i++) {
        const seed = this.seed + i * 149;
        const cls = seeded(seed + 1);

        const radius =
          cls < .83
            ? .18 + seeded(seed + 2) * .50
            : cls < .98
              ? .66 + seeded(seed + 3) * .55
              : 1.2 + seeded(seed + 4) * 1.3;

        const temperature = seeded(seed + 5);

        const color =
          temperature < .13
            ? [255, 218, 201]
            : temperature < .52
              ? [226, 230, 255]
              : [182, 209, 255];

        this.stars.push({
          x: seeded(seed + 6) * width,
          y: seeded(seed + 7) * height,
          radius,
          depth: .025 + seeded(seed + 8) * .22,
          alpha: .12 + seeded(seed + 9) * .78,
          phase: seeded(seed + 10) * Math.PI * 2,
          speed: .0002 + seeded(seed + 11) * .0005,
          color
        });
      }
    }

    draw(time) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, width, height);

      const brightness = state.settings.starBrightness / 100;

      for (const s of this.stars) {
        const x = (
          (s.x - camera.x * s.depth) % width + width
        ) % width;

        const y = (
          (s.y - camera.y * s.depth) % height + height
        ) % height;

        const twinkle = reducedMotion()
          ? 1
          : .88 + Math.sin(
              time * s.speed + s.phase
            ) * .12;

        const alpha = clamp(
          s.alpha * twinkle * (.45 + brightness),
          0, 1
        );

        const [r, g, b] = s.color;

        ctx.fillStyle =
          `rgba(${r},${g},${b},${alpha})`;

        ctx.beginPath();
        ctx.arc(x, y, s.radius, 0, Math.PI * 2);
        ctx.fill();

        if (s.radius > 1.6) {
          const glow = ctx.createRadialGradient(
            x, y, 0, x, y, s.radius * 6
          );

          glow.addColorStop(
            0, `rgba(${r},${g},${b},${alpha * .15})`
          );
          glow.addColorStop(1, "rgba(0,0,0,0)");

          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, s.radius * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /* =====================================================
     8. PROCEDURAL NEBULA

     A low-resolution cached texture is constructed
     from layered cloud shapes and fine star-dust.

     The texture is generated only during resize or
     quality changes, not every animation frame.
  ===================================================== */

  class NebulaRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.texture = document.createElement("canvas");
      this.textureCtx = this.texture.getContext("2d");
      this.resize();
    }

    resize() {
      const scale = DATA.graphics.nebulaResolution;

      this.texture.width = Math.max(
        320, Math.round(width * scale)
      );
      this.texture.height = Math.max(
        260, Math.round(height * scale)
      );

      this.generate();
    }

    generate() {
      const ctx = this.textureCtx;
      const w = this.texture.width;
      const h = this.texture.height;

      ctx.clearRect(0, 0, w, h);

      const clouds = [
        { x: .14, y: .20, r: .55, c: [23, 64, 135], a: .24 },
        { x: .31, y: .42, r: .49, c: [35, 81, 172], a: .26 },
        { x: .48, y: .47, r: .44, c: [60, 100, 194], a: .18 },
        { x: .62, y: .36, r: .50, c: [23, 51, 112], a: .23 },
        { x: .83, y: .65, r: .53, c: [49, 36, 117], a: .16 },
        { x: .17, y: .77, r: .43, c: [14, 35, 89], a: .15 },
        { x: .74, y: .20, r: .40, c: [34, 65, 129], a: .16 },
        { x: .48, y: .81, r: .42, c: [15, 36, 89], a: .14 }
      ];

      // Soft underlying clouds.
      for (const cloud of clouds) {
        const x = cloud.x * w;
        const y = cloud.y * h;
        const radius = cloud.r * Math.max(w, h);

        const [r, g, b] = cloud.c;
        const gradient = ctx.createRadialGradient(
          x, y, 0, x, y, radius
        );

        gradient.addColorStop(
          0, `rgba(${r},${g},${b},${cloud.a})`
        );
        gradient.addColorStop(
          .38, `rgba(${r},${g},${b},${cloud.a * .53})`
        );
        gradient.addColorStop(1, "rgba(0,0,0,0)");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }

      // A diagonal band of wispy clustered gas.
      // Use seeded positions for a stable background.
      const count = 240;

      for (let i = 0; i < count; i++) {
        const s = i * 37 + 109;

        const t = seeded(s);
        const spread = (seeded(s + 1) - .5);

        const x = (t * 1.35 - .17) * w;

        const y = (
          .62 - .36 * t +
          spread * .37
        ) * h;

        const radius =
          (9 + seeded(s + 2) * 58) *
          Math.min(w / 600, 1.4);

        const blue = seeded(s + 3) > .38;

        const color = blue
          ? [66, 103, 191]
          : [48, 42, 111];

        const alpha = .016 + seeded(s + 4) * .043;

        const gradient = ctx.createRadialGradient(
          x, y, 0, x, y, radius
        );

        gradient.addColorStop(
          0,
          `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
        );
        gradient.addColorStop(1, "rgba(0,0,0,0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fine mist texture and small dust points.
      const dots = Math.min(
        5000,
        Math.round(w * h / 110)
      );

      for (let i = 0; i < dots; i++) {
        const s = i * 19 + 5501;

        const x = seeded(s) * w;
        const y = seeded(s + 1) * h;

        const bandY = .62 - .36 * (x / w);
        const distance = Math.abs(y / h - bandY);

        const weight = Math.max(
          0, 1 - distance / .38
        );

        if (seeded(s + 2) > weight) continue;

        ctx.fillStyle =
          `rgba(142,173,239,${.015 + weight * .12})`;

        ctx.fillRect(
          x, y,
          .35 + seeded(s + 3) * .8,
          .35 + seeded(s + 4) * .8
        );
      }

      // Vignette inside texture.
      const vignette = ctx.createRadialGradient(
        w * .5, h * .48, w * .08,
        w * .5, h * .48, w * .76
      );

      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,.27)");

      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }

    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, width, height);

      const opacity =
        state.settings.nebulaIntensity / 100;

      ctx.save();
      ctx.globalAlpha = opacity;

      // Very slow spatial parallax.
      const shiftX = camera.x * .008;
      const shiftY = camera.y * .008;

      const overscan = 100;

      ctx.drawImage(
        this.texture,
        -overscan - shiftX,
        -overscan - shiftY,
        width + overscan * 2,
        height + overscan * 2
      );

      ctx.restore();
    }
  }

  const constellationRenderer =
    new ConstellationRenderer(starCanvas);

  const backgroundRenderer =
    new BackgroundRenderer(backgroundCanvas);

  const nebulaRenderer =
    new NebulaRenderer(nebulaCanvas);

  /* =====================================================
     9. RENDER LOOP

     Camera, backgrounds, stars, and labels are updated
     together. Expensive texture generation stays outside
     the animation loop.
  ===================================================== */

  function renderFrame(time) {
    if (!running) return;

    const targetInterval =
      1000 / DATA.graphics.targetFrameRate;

    if (time - lastFrameTime >= targetInterval - 1) {
      stepCamera(time);

      const moving = cameraAnimating;

      if (!reducedMotion() || canvasDirty || moving) {
        updateStarPositions();

        nebulaRenderer.draw();
        backgroundRenderer.draw(time);
        constellationRenderer.draw(time);

        canvasDirty = false;
      }

      lastFrameTime = time;
    }

    animationFrame = requestAnimationFrame(renderFrame);
  }

  function startRenderLoop() {
    if (running) return;
    running = true;
    animationFrame = requestAnimationFrame(renderFrame);
  }

  function stopRenderLoop() {
    running = false;

    if (animationFrame != null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  /* =====================================================
     10. USER INTERACTIONS
  ===================================================== */

  function pointerPoint(e) {
    return { x: e.clientX, y: e.clientY };
  }

  function pointerDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pointerCenter(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function beginPinch() {
    if (pointers.size < 2) return;

    const [a, b] = [...pointers.values()];
    const center = pointerCenter(a, b);

    gesture = {
      type: "pinch",
      originalDistance: Math.max(
        1, pointerDistance(a, b)
      ),
      originalZoom: camera.zoom,
      anchor: screenToWorld(center.x, center.y),
      moved: true
    };

    suppressClickUntil = performance.now() + 500;
  }

  function bindGestures() {
    viewport.addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }

      stopCameraAnimation();

      pointers.set(e.pointerId, pointerPoint(e));

      if (pointers.size === 1) {
        gesture = {
          type: "drag",
          total: 0,
          moved: false
        };
      }

      if (pointers.size >= 2) {
        beginPinch();
      }
    });

    viewport.addEventListener("pointermove", e => {
      if (!pointers.has(e.pointerId)) return;

      const previous = pointers.get(e.pointerId);
      const current = pointerPoint(e);

      pointers.set(e.pointerId, current);

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];

        if (!gesture || gesture.type !== "pinch") {
          beginPinch();
        }

        const center = pointerCenter(a, b);
        const dist = Math.max(1, pointerDistance(a, b));

        const zoom = clamp(
          gesture.originalZoom *
          dist / gesture.originalDistance,
          MIN_ZOOM,
          MAX_ZOOM
        );

        setCamera(
          gesture.anchor.x -
            (center.x - width / 2) / zoom,
          gesture.anchor.y -
            (center.y - height / 2) / zoom,
          zoom
        );

        gesture.moved = true;
        suppressClickUntil = performance.now() + 450;

        return;
      }

      if (!gesture || gesture.type !== "drag") {
        gesture = {
          type: "drag",
          total: 0,
          moved: false
        };
      }

      const dx = current.x - previous.x;
      const dy = current.y - previous.y;

      gesture.total += Math.hypot(dx, dy);

      if (gesture.total > cameraConfig.tapThreshold) {
        gesture.moved = true;
        viewport.classList.add("dragging");

        suppressClickUntil = performance.now() + 350;

        if (!viewport.hasPointerCapture(e.pointerId)) {
          viewport.setPointerCapture(e.pointerId);
        }
      }

      setCamera(
        camera.x - dx / camera.zoom,
        camera.y - dy / camera.zoom,
        camera.zoom
      );
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;

      pointers.delete(e.pointerId);

      if (viewport.hasPointerCapture(e.pointerId)) {
        viewport.releasePointerCapture(e.pointerId);
      }

      if (gesture?.moved) {
        suppressClickUntil = performance.now() + 350;
      }

      if (pointers.size === 0) {
        gesture = null;
        viewport.classList.remove("dragging");
      } else if (pointers.size === 1) {
        gesture = {
          type: "drag",
          total: 0,
          moved: true
        };
      }
    }

    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);

    viewport.addEventListener("wheel", e => {
      e.preventDefault();

      const factor = Math.exp(
        -e.deltaY * cameraConfig.wheelSensitivity
      );

      zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    viewport.addEventListener("click", e => {
      if (performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    viewport.addEventListener("keydown", e => {
      if (e.target !== viewport) return;

      const step = 85 / camera.zoom;

      switch (e.key) {
        case "ArrowLeft":
          setCamera(camera.x - step, camera.y, camera.zoom);
          break;
        case "ArrowRight":
          setCamera(camera.x + step, camera.y, camera.zoom);
          break;
        case "ArrowUp":
          setCamera(camera.x, camera.y - step, camera.zoom);
          break;
        case "ArrowDown":
          setCamera(camera.x, camera.y + step, camera.zoom);
          break;
        case "+":
        case "=":
          zoomAt(width / 2, height / 2, 1.25);
          break;
        case "-":
          zoomAt(width / 2, height / 2, .8);
          break;
        default:
          return;
      }

      e.preventDefault();
    });
  }

  /* =====================================================
     11. MEDIA COLLECTIONS

     Library / History / Rankings / Watchlist
     operate exclusively on saved productions.
  ===================================================== */

  function productions() {
    return state.archive.productions.filter(
      p => p && typeof p === "object"
    );
  }

  function titleOf(item) {
    return String(item.title || item.name || "Untitled");
  }

  function getRating(item) {
    const raw =
      item.averageRating ??
      item.calculatedRating ??
      item.rating;

    if (raw === null || raw === undefined || raw === "") {
      return null;
    }

    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function getLastWatched(item) {
    const raw =
      item.lastWatched ??
      item.lastSeen ??
      item.watchedAt;

    if (!raw) return 0;

    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function getReleaseYear(item) {
    const raw =
      item.startYear ??
      item.releaseYear ??
      item.year;

    const n = Number(raw);
    return raw == null || !Number.isFinite(n)
      ? null
      : n;
  }

  function addedTime(item) {
    const raw = item.createdAt || item.addedAt;
    if (!raw) return 0;

    const n = new Date(raw).getTime();
    return Number.isFinite(n) ? n : 0;
  }

  function genreList(item) {
    const genres = item.genres || item.mainGenres || [];
    return Array.isArray(genres)
      ? genres
      : typeof genres === "string"
        ? genres.split(",").map(s => s.trim())
        : [];
  }

  function isWatchlisted(item) {
    return item.watchlist === true ||
      item.status === "Planned" ||
      item.status === "Watchlist";
  }

  function viewItems(type) {
    let list = [...productions()];

    if (type === "history") {
      list = list.filter(p => getLastWatched(p) > 0);
    } else if (type === "rankings") {
      list = list.filter(p => getRating(p) !== null);
    } else if (type === "watchlist") {
      list = list.filter(isWatchlisted);
    }

    return list;
  }

  function sortedItems(list, sort) {
    const result = [...list];
    const byTitle = (a, b) =>
      titleOf(a).localeCompare(titleOf(b), undefined, {
        sensitivity: "base"
      });

    result.sort((a, b) => {
      switch (sort) {
        case "alphabeticalReverse":
          return -byTitle(a, b);
        case "highestRated":
          return (getRating(b) ?? -1) -
            (getRating(a) ?? -1) || byTitle(a, b);
        case "lowestRated":
          return (getRating(a) ?? 999) -
            (getRating(b) ?? 999) || byTitle(a, b);
        case "lastWatched":
          return getLastWatched(b) -
            getLastWatched(a) || byTitle(a, b);
        case "oldestAdded":
          return addedTime(a) - addedTime(b) ||
            byTitle(a, b);
        case "newestAdded":
          return addedTime(b) - addedTime(a) ||
            byTitle(a, b);
        case "earliestRelease":
          return (getReleaseYear(a) ?? 99999) -
            (getReleaseYear(b) ?? 99999) ||
            byTitle(a, b);
        case "latestRelease":
          return (getReleaseYear(b) ?? -99999) -
            (getReleaseYear(a) ?? -99999) ||
            byTitle(a, b);
        default:
          return byTitle(a, b);
      }
    });

    return result;
  }

  function filteredCollection(type) {
    let items = viewItems(type);

    const q = collectionOptions.query.trim().toLowerCase();

    if (q) {
      items = items.filter(item =>
        titleOf(item).toLowerCase().includes(q)
      );
    }

    if (collectionOptions.genre) {
      items = items.filter(item =>
        genreList(item).some(g =>
          g.toLowerCase() ===
          collectionOptions.genre.toLowerCase()
        )
      );
    }

    if (collectionOptions.mediaType) {
      items = items.filter(item =>
        (item.mediaType || item.type || "") ===
        collectionOptions.mediaType
      );
    }

    if (collectionOptions.status) {
      items = items.filter(item =>
        item.status === collectionOptions.status
      );
    }

    return sortedItems(items, collectionOptions.sort);
  }

  function collectionHeader(type) {
    const config = DATA.libraryViews[type];

    return `
      <span class="detail-eyebrow">YOUR ARCHIVE</span>
      <h2 id="detailTitle">${escapeHTML(config.title)}</h2>
      <p>${escapeHTML(config.description)}</p>
    `;
  }

  function collectionToolbar() {
    const sortOptions = DATA.sorting.map(opt =>
      `<option value="${escapeHTML(opt.id)}">
        ${escapeHTML(opt.title)}
      </option>`
    ).join("");

    const genreOptions = DATA.mainGenres.map(genre =>
      `<option value="${escapeHTML(genre)}">
        ${escapeHTML(genre)}
      </option>`
    ).join("");

    const mediaOptions = DATA.mediaTypes.map(type =>
      `<option value="${escapeHTML(type)}">
        ${escapeHTML(type)}
      </option>`
    ).join("");

    const statusOptions = DATA.statuses.map(status =>
      `<option value="${escapeHTML(status)}">
        ${escapeHTML(status)}
      </option>`
    ).join("");

    return `
      <div class="library-toolbar">

        <div class="library-control">
          <label for="collectionSearch">Search</label>
          <input
            id="collectionSearch"
            class="library-input"
            type="search"
            placeholder="Find a title..."
          >
        </div>

        <div class="library-control">
          <label for="collectionSort">Sort by</label>
          <select id="collectionSort" class="library-select">
            ${sortOptions}
          </select>
        </div>

        <div class="library-control">
          <label for="collectionGenre">Main genre</label>
          <select id="collectionGenre" class="library-select">
            <option value="">All genres</option>
            ${genreOptions}
          </select>
        </div>

        <div class="library-control">
          <label for="collectionMedia">Media type</label>
          <select id="collectionMedia" class="library-select">
            <option value="">All media</option>
            ${mediaOptions}
          </select>
        </div>

        <div class="library-control">
          <label for="collectionStatus">Status</label>
          <select id="collectionStatus" class="library-select">
            <option value="">All statuses</option>
            ${statusOptions}
          </select>
        </div>

      </div>

      <div id="collectionCount" class="library-count"></div>
      <div id="collectionResults" class="library-results"></div>
    `;
  }

  function renderCollectionResults() {
    if (!currentCollection) return;

    const items = filteredCollection(currentCollection);
    const count = $("#collectionCount");
    const results = $("#collectionResults");

    if (!results) return;

    count.textContent =
      `${items.length} ${items.length === 1 ? "production" : "productions"}`;

    if (!items.length) {
      results.innerHTML = `
        <div class="library-empty">
          <span class="library-empty-symbol">✧</span>
          <h3>Nothing among the stars yet.</h3>
          <p>
            ${state.archive.productions.length
              ? "No productions match these filters."
              : "Your personal productions will appear here once you begin adding them in Step 3."}
          </p>
        </div>
      `;
      return;
    }

    results.innerHTML = items.map(item => {
      const rating = getRating(item);
      const year = getReleaseYear(item);

      return `
        <button
          type="button"
          class="library-entry"
          data-id="${escapeHTML(item.id)}"
        >
          <span class="library-entry-main">
            <span class="library-entry-title">
              ${escapeHTML(titleOf(item))}
            </span>
            <span class="library-entry-meta">
              ${escapeHTML(item.mediaType || "Production")}
              ${year == null ? "" : " · " + year}
              ${item.status
                ? " · " + escapeHTML(item.status)
                : ""}
            </span>
          </span>

          <span class="library-entry-rating">
            ${rating == null ? "—" : rating.toFixed(1) + " / 10"}
          </span>
        </button>
      `;
    }).join("");

    results.querySelectorAll(".library-entry")
      .forEach(button => {
        button.addEventListener("click", () => {
          const node = nodes.find(n =>
            n.type === "production" &&
            n.id === button.dataset.id
          );

          closeOverlay();

          if (node) focusNode(node);
          else showToast("This production has no constellation position yet.");
        });
      });
  }

  function openCollection(type) {
    if (!DATA.libraryViews[type]) return;

    currentCollection = type;
    collectionOptions = {
      query: "",
      sort: DATA.libraryViews[type].defaultSort,
      genre: "",
      mediaType: "",
      status: ""
    };

    openDetail(
      collectionHeader(type) + collectionToolbar()
    );

    $("#collectionSort").value = collectionOptions.sort;

    const map = [
      ["collectionSearch", "query"],
      ["collectionSort", "sort"],
      ["collectionGenre", "genre"],
      ["collectionMedia", "mediaType"],
      ["collectionStatus", "status"]
    ];

    for (const [id, key] of map) {
      $("#" + id).addEventListener(
        key === "query" ? "input" : "change",
        e => {
          collectionOptions[key] = e.target.value;
          renderCollectionResults();
        }
      );
    }

    renderCollectionResults();
  }

  function selectStar(node) {
    if (node.type === "navigation") {
      if (node.action === "settings") {
        openSettings();
      } else {
        openCollection(node.action);
      }
      return;
    }

    if (node.type === "episode") {
      focusNode(node);
      openEpisode(node);
      return;
    }

    focusNode(node);
  }

  /* =====================================================
     12. SEARCH THE ENTIRE SAVED ARCHIVE
  ===================================================== */

  function globalSearchItems(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const types = [
      ["groups", "Group"],
      ["productions", "Production"],
      ["seasons", "Season"],
      ["episodes", "Episode"]
    ];

    const matches = [];

    for (const [collection, label] of types) {
      for (const item of state.archive[collection]) {
        if (titleOf(item).toLowerCase().includes(q)) {
          matches.push({ ...item, searchType: label });
        }
      }
    }

    return matches.slice(0, 60);
  }

  function renderSearchResults() {
    const query = $("#globalSearch").value;
    const results = $("#searchResults");

    const matches = globalSearchItems(query);

    if (!query.trim()) {
      results.innerHTML = `
        <p style="color:#8c89a4;font-size:12px;">
          Search your saved groups, series, movies, seasons and episodes.
        </p>
      `;
      return;
    }

    if (!matches.length) {
      results.innerHTML = `
        <p style="color:#8c89a4;font-size:12px;">
          No matching entries were found.
        </p>
      `;
      return;
    }

    results.innerHTML = matches.map(item => `
      <button
        type="button"
        class="search-result"
        data-id="${escapeHTML(item.id)}"
      >
        <span>${escapeHTML(titleOf(item))}</span>
        <small>${escapeHTML(item.searchType)}</small>
      </button>
    `).join("");

    results.querySelectorAll(".search-result")
      .forEach(button => {
        button.addEventListener("click", () => {
          const node = nodeMap.get(button.dataset.id);
          closeOverlay();

          if (node) {
            focusNode(node);
          } else {
            showToast("No constellation position available.");
          }
        });
      });
  }

  /* =====================================================
     13. TRANSIENT OVERLAYS
  ===================================================== */

  function openModal(overlay) {
    if (activeModal && activeModal !== overlay) {
      closeOverlay(false);
    }

    modalFocus = document.activeElement;
    activeModal = overlay;

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");

    viewport.inert = true;
    $("#globalSearch")?.blur();
  }

  function openDetail(html) {
    $("#detailContent").innerHTML = html;
    $("#detailSheet").scrollTop = 0;

    openModal(detailOverlay);
    $("#closeDetailButton").focus();
  }

  function openSearch() {
    openModal(searchOverlay);
    $("#globalSearch").value = "";
    renderSearchResults();
    $("#globalSearch").focus();
  }

  function closeOverlay(restoreFocus = true) {
    for (const overlay of [detailOverlay, searchOverlay]) {
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
    }

    activeModal = null;
    currentCollection = null;
    viewport.inert = false;

    if (restoreFocus) {
      if (modalFocus?.isConnected) {
        modalFocus.focus();
      } else {
        viewport.focus();
      }
    }
  }

  function openEpisode(node) {
    openDetail(`
      <span class="detail-eyebrow">EPISODE</span>
      <h2 id="detailTitle">${escapeHTML(node.title)}</h2>
      <p>
        ${escapeHTML(
          node.data?.notes ||
          node.data?.observations ||
          "Episode observations and ratings will be added in Step 5 and Step 6."
        )}
      </p>
    `);
  }

  /* =====================================================
     14. SETTINGS
  ===================================================== */

  function settingRange(id, title, value, min = 0) {
    return `
      <div class="detail-row">
        <label for="${id}">${title}</label>
        <div>
          <input
            id="${id}"
            class="setting-range"
            type="range"
            min="${min}"
            max="100"
            step="5"
            value="${value}"
          >
          <output class="setting-value" id="${id}Value">
            ${value}
          </output>
        </div>
      </div>
    `;
  }

  function openSettings() {
    openDetail(`
      <span class="detail-eyebrow">YOUR UNIVERSE</span>
      <h2 id="detailTitle">Settings</h2>
      <p>Adjust the atmosphere of your personal archive.</p>

      <h3>Atmosphere</h3>

      ${settingRange(
        "settingDensity",
        "Star density",
        state.settings.starDensity,
        10
      )}

      ${settingRange(
        "settingBrightness",
        "Star brightness",
        state.settings.starBrightness,
        10
      )}

      ${settingRange(
        "settingNebula",
        "Nebula intensity",
        state.settings.nebulaIntensity
      )}

      ${settingRange(
        "settingGlow",
        "Constellation glow",
        state.settings.constellationGlow
      )}

      <div class="detail-row">
        <label for="settingMotion">Reduce motion</label>
        <input
          id="settingMotion"
          class="motion-checkbox"
          type="checkbox"
          ${state.settings.reduceMotion ? "checked" : ""}
        >
      </div>

      <h3>Storage & Backups</h3>

      <p>
        Your archive is saved in this browser.
        Export a backup regularly to protect your records.
      </p>

      <button id="exportButton" class="detail-action">
        Export archive ↗
      </button>

      <button id="importButton" class="detail-action">
        Import archive ↙
      </button>
    `);

    const ranges = [
      ["settingDensity", "starDensity", () =>
        backgroundRenderer.rebuild()
      ],
      ["settingBrightness", "starBrightness", () => {}],
      ["settingNebula", "nebulaIntensity", () => {}],
      ["settingGlow", "constellationGlow", () => {}]
    ];

    for (const [id, key, callback] of ranges) {
      $("#" + id).addEventListener("input", e => {
        state.settings[key] = Number(e.target.value);
        $("#" + id + "Value").textContent = e.target.value;

        callback();
        saveStorage();
        canvasDirty = true;
      });
    }

    $("#settingMotion").addEventListener("change", e => {
      state.settings.reduceMotion = e.target.checked;
      applyMotionPreference();
      saveStorage();
    });

    $("#exportButton").addEventListener(
      "click", exportBackup
    );

    $("#importButton").addEventListener(
      "click", () => $("#importFile").click()
    );
  }

  /* =====================================================
     15. EXPORT / IMPORT
  ===================================================== */

  function exportBackup() {
    const backup = {
      app: DATA.appName,
      schemaVersion: DATA.schemaVersion,
      exportedAt: new Date().toISOString(),
      data: state
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download =
      `watch-archive-${new Date().toISOString().slice(0,10)}.json`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast("Backup prepared.");
  }

  async function importBackup(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (
        backup.app !== DATA.appName ||
        backup.schemaVersion !== DATA.schemaVersion ||
        !backup.data?.archive ||
        !["groups", "productions", "seasons", "episodes"]
          .every(key =>
            Array.isArray(backup.data.archive[key])
          )
      ) {
        throw new Error("Invalid backup structure");
      }

      if (!confirm(
        "Replace your current local archive with this backup?\n" +
        "Export your existing archive first if you want to keep it."
      )) return;

      const previous = state;
      state = normalizeState(backup.data);

      if (!saveStorage()) {
        state = previous;
        return;
      }

      closeOverlay();

      backgroundRenderer.rebuild();
      rebuildUniverse();
      applyMotionPreference();
      goHome();

      showToast("Archive imported.");

    } catch (error) {
      console.error("Import failed:", error);
      showToast("Invalid or incompatible archive file.");
    } finally {
      $("#importFile").value = "";
    }
  }

  /* =====================================================
     16. CONTROLS & LIFECYCLE
  ===================================================== */

  function bindControls() {
    $("#homeButton").addEventListener("click", goHome);

    $("#focusButton").addEventListener("click", () => {
      if (lastFocus) {
        focusNode(lastFocus);
      } else {
        const closest = nodes
          .filter(n => n.visible > .6)
          .map(n => ({
            node: n,
            distance: Math.hypot(
              n.screenX - width / 2,
              n.screenY - height / 2
            )
          }))
          .sort((a, b) => a.distance - b.distance)[0];

        if (closest) focusNode(closest.node);
        else goHome();
      }
    });

    $("#searchButton").addEventListener(
      "click", openSearch
    );

    $("#closeDetailButton").addEventListener(
      "click", () => closeOverlay()
    );

    $("#detailBackdrop").addEventListener(
      "click", () => closeOverlay()
    );

    $("#closeSearchButton").addEventListener(
      "click", () => closeOverlay()
    );

    $("#searchBackdrop").addEventListener(
      "click", () => closeOverlay()
    );

    $("#globalSearch").addEventListener(
      "input", renderSearchResults
    );

    $("#importFile").addEventListener("change", e => {
      importBackup(e.target.files?.[0]);
    });

    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && activeModal) {
        closeOverlay();
      }
    });

    let resizeTimer;

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        const wasMobile = width < 650;
        const nowMobile = innerWidth < 650;

        resizeAllCanvases();

        if (wasMobile !== nowMobile) {
          rebuildUniverse();
          goHome();
        }

        canvasDirty = true;
      }, 150);
    });

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          stopRenderLoop();
        } else {
          lastFrameTime = 0;
          canvasDirty = true;
          startRenderLoop();
        }
      }
    );

    reducedMedia.addEventListener(
      "change",
      applyMotionPreference
    );

    window.addEventListener("storage", e => {
      if (e.key !== DATA.storageKey) return;

      state = readStorage();
      rebuildUniverse();
      backgroundRenderer.rebuild();
      applyMotionPreference();

      showToast("Archive refreshed from another tab.");
    });
  }

  /* =====================================================
     17. INITIALIZATION
  ===================================================== */

  function initialize() {
    applyMotionPreference();

    resizeAllCanvases();
    rebuildUniverse();

    bindGestures();
    bindControls();

    const initial = fitNavigation();

    setCamera(
      initial.x,
      initial.y,
      initial.zoom
    );

    startRenderLoop();

    if (!localStorage.getItem(DATA.storageKey)) {
      saveStorage();
    }
  }

  initialize();

})();
