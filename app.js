
"use strict";

/* =====================================================
   WATCH ARCHIVE — STEP 1C.1
   THE LIVING UNIVERSE

   One world.
   One camera.
   Continuous constellations.
   No page changes or scene cuts.
===================================================== */

(() => {

  const DATA = window.WATCH_DATA;

  if (!DATA) {
    console.error("Watch Archive: data.js is missing.");
    return;
  }

  const $ = selector => document.querySelector(selector);

  const $$ = selector =>
    [...document.querySelectorAll(selector)];

  const clone = value =>
    JSON.parse(JSON.stringify(value));

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  const lerp = (a, b, t) =>
    a + (b - a) * t;

  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const viewport = $("#viewport");
  const world = $("#world");
  const starLayer = $("#starLayer");
  const lineLayer = $("#connectionLayer");

  const detailOverlay = $("#detailOverlay");
  const detailContent = $("#detailContent");

  const MIN_ZOOM = DATA.camera.minZoom;
  const MAX_ZOOM = DATA.camera.maxZoom;

  const motionPreference = matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let state = loadState();

  let allNodes = [];
  let allLines = [];
  let nodeLookup = new Map();

  let background = null;

  let cameraFrame = null;
  let cameraAnimationToken = 0;

  let lastFocusedNode = null;
  let previousModalFocus = null;
  let toastTimeout = null;

  const camera = {
    x: 0,
    y: 0,
    zoom: DATA.camera.initialZoom
  };

  const activePointers = new Map();

  let gesture = null;
  let gestureMoved = false;
  let suppressClickUntil = 0;

  /* =====================================================
     1. LOCAL STORAGE
  ===================================================== */

  function initialState() {
    const now = new Date().toISOString();

    return {
      schemaVersion: DATA.schemaVersion,
      createdAt: now,
      updatedAt: now,

      settings: clone(DATA.defaults.settings),
      archive: clone(DATA.defaults.archive)
    };
  }

  function normalizeState(input) {
    const defaults = initialState();

    const settings = input?.settings || {};
    const archive = input?.archive || {};

    return {
      ...defaults,
      ...(input || {}),

      schemaVersion: DATA.schemaVersion,

      settings: {
        ...defaults.settings,
        ...settings,

        starDensity: clamp(
          Number(settings.starDensity) || 65,
          10, 100
        ),

        starBrightness: clamp(
          Number(settings.starBrightness) || 55,
          10, 100
        ),

        reduceMotion:
          settings.reduceMotion === true
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
      const raw = localStorage.getItem(DATA.storageKey);

      if (!raw) return initialState();

      const parsed = JSON.parse(raw);

      if (parsed.schemaVersion !== DATA.schemaVersion) {
        console.warn(
          "Different archive schema. Existing data is untouched."
        );

        return initialState();
      }

      return normalizeState(parsed);

    } catch (error) {
      console.error("Could not load archive:", error);
      return initialState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(
        DATA.storageKey,
        JSON.stringify(state)
      );

      return true;

    } catch (error) {
      console.error("Could not save archive:", error);

      notify("Local saving failed.");

      return false;
    }
  }

  function motionReduced() {
    return (
      state.settings.reduceMotion ||
      motionPreference.matches
    );
  }

  function applyMotionSettings() {
    document.body.classList.toggle(
      "reduce-motion",
      motionReduced()
    );
  }

  /* =====================================================
     2. NOTIFICATIONS
  ===================================================== */

  function notify(message) {
    const element = $("#toast");

    if (!element) return;

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
      element.classList.remove("show");
    }, 3000);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
    );
  }

  /* =====================================================
     3. DETERMINISTIC POSITIONS

     The same object always receives the same position.
     Reloading does not randomly rearrange the archive.
  ===================================================== */

  function hashString(value) {
    let hash = 2166136261;

    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  function seededValue(seed) {
    let t = seed + 0x6D2B79F5;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return (
      ((t ^ (t >>> 14)) >>> 0) / 4294967296
    );
  }

  function positionForGroup(item, index) {
    const givenX = Number(item.mapX ?? item.x);
    const givenY = Number(item.mapY ?? item.y);

    if (
      (item.mapX != null || item.x != null) &&
      (item.mapY != null || item.y != null) &&
      Number.isFinite(givenX) &&
      Number.isFinite(givenY)
    ) {
      return { x: givenX, y: givenY };
    }

    const seed = hashString(
      String(item.id || item.title || index)
    );

    const angle =
      index * 2.399963229728653 +
      seededValue(seed) * .4;

    const radius =
      DATA.groupPlacement.preferredDistance +
      Math.sqrt(index) *
      DATA.groupPlacement.minimumDistanceBetweenGroups;

    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  }

  function childOffset(item, index, count, type) {
    const radii = {
      production: 205,
      season: 98,
      episode: 43
    };

    const baseRadius = radii[type] || 130;

    const seed = hashString(
      String(item.id || item.title || index)
    );

    const offset =
      (seededValue(seed) - .5) * .32;

    if (count === 1) {
      return {
        x: baseRadius * .65,
        y: -baseRadius * .45
      };
    }

    const angle =
      -Math.PI / 2 +
      index * (Math.PI * 2 / count) +
      offset;

    const irregularity =
      .82 + seededValue(seed + 37) * .36;

    const radius =
      baseRadius *
      irregularity *
      (count > 8 ? 1 + (count - 8) * .035 : 1);

    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  }

  function mobileNavigationScale() {
    return innerWidth <= 650 ? .57 : 1;
  }

  /* =====================================================
     4. BUILD THE SINGLE UNIVERSE TREE

     All coordinates are absolute world coordinates.

     Parent constellations and their children coexist.
     Nothing is removed when navigating or zooming.
  ===================================================== */

  function makeNode({
    id,
    title,
    type,
    x,
    y,
    parentId = null,
    depth = 0,
    demo = false,
    data = null,
    action = null,
    size = null
  }) {
    return {
      id: String(id),
      title: String(title || "Untitled"),
      type,
      x,
      y,
      parentId,
      depth,
      demo,
      data,
      action,

      size: size || 8,
      element: null,

      visible: 0
    };
  }

  function appendNode(node) {
    if (nodeLookup.has(node.id)) return false;

    allNodes.push(node);
    nodeLookup.set(node.id, node);

    return true;
  }

  function childrenOf(parent, source) {
    if (parent.demo) {
      return (parent.children || []).map(item => ({
        ...item,
        demo: true
      }));
    }

    const collection = {
      group: state.archive.productions,
      production: state.archive.seasons,
      season: state.archive.episodes
    }[parent.type];

    if (!collection) return [];

    const possibleKeys = {
      group: ["groupId", "parentId"],
      production: ["productionId", "parentId"],
      season: ["seasonId", "parentId"]
    }[parent.type];

    return collection.filter(item =>
      possibleKeys.some(key =>
        item[key] != null &&
        String(item[key]) === String(parent.id)
      )
    );
  }

  function addHierarchy(parentData, parentNode, type) {
    if (parentNode.depth >= 4) return;

    const children = childrenOf(parentData, type);

    const nextType = {
      group: "production",
      production: "season",
      season: "episode"
    }[parentNode.type];

    if (!nextType) return;

    children.forEach((child, index) => {
      const offset = childOffset(
        child,
        index,
        children.length,
        nextType
      );

      const positionX =
        child.mapX != null && Number.isFinite(Number(child.mapX))
          ? Number(child.mapX)
          : parentNode.x + offset.x;

      const positionY =
        child.mapY != null && Number.isFinite(Number(child.mapY))
          ? Number(child.mapY)
          : parentNode.y + offset.y;

      const childNode = makeNode({
        id: child.id,
        title: child.title || child.name,
        type: nextType,
        x: positionX,
        y: positionY,
        parentId: parentNode.id,
        depth: parentNode.depth + 1,
        demo: parentNode.demo || child.demo === true,
        data: child
      });

      if (appendNode(childNode)) {
        addHierarchy(child, childNode, nextType);
      }
    });
  }

  function buildUniverse() {
    allNodes = [];
    allLines = [];
    nodeLookup = new Map();

    // Cassiopeia-inspired navigation.

    const navigationScale = mobileNavigationScale();

    DATA.navigation.nodes.forEach(item => {
      appendNode(makeNode({
        id: `nav-${item.id}`,
        title: item.title,
        type: "navigation",
        x: item.x * navigationScale,
        y: item.y * navigationScale,
        depth: 0,
        action: item.action,
        size: item.size
      }));
    });

    DATA.navigation.connections.forEach(([a, b]) => {
      allLines.push({
        a: `nav-${a}`,
        b: `nav-${b}`,
        type: "navigation",
        depth: 0,
        parentId: null,
        element: null
      });
    });

    // Every group becomes its own world-space star.

    const groups = [
      ...DATA.demoGroups,
      ...state.archive.groups
    ];

    groups.forEach((item, index) => {
      const position = positionForGroup(item, index);

      const node = makeNode({
        id: item.id,
        title: item.title || item.name,
        type: "group",
        x: position.x,
        y: position.y,
        depth: 0,
        demo: item.demo === true,
        data: item
      });

      if (appendNode(node)) {
        addHierarchy(item, node, "production");
      }
    });

    // Connect siblings into individual constellations.

    const parentIds = new Set(
      allNodes
        .filter(node => node.parentId)
        .map(node => node.parentId)
    );

    parentIds.forEach(parentId => {
      const siblings = allNodes.filter(
        node => node.parentId === parentId
      );

      const edges = createNaturalConnections(siblings);

      edges.forEach(([a, b]) => {
        allLines.push({
          a: a.id,
          b: b.id,
          type: "secondary",
          depth: a.depth,
          parentId,
          element: null
        });
      });
    });
  }

  /* =====================================================
     5. NATURAL CONSTELLATION CONNECTIONS

     A minimum-spanning tree gives organic paths
     without forcing shapes into regular polygons.
  ===================================================== */

  function createNaturalConnections(nodes) {
    if (nodes.length < 2) return [];

    const connected = [nodes[0]];
    const remaining = nodes.slice(1);
    const edges = [];

    while (remaining.length) {
      let best = null;

      connected.forEach(a => {
        remaining.forEach(b => {
          const distance = Math.hypot(
            b.x - a.x,
            b.y - a.y
          );

          if (!best || distance < best.distance) {
            best = { a, b, distance };
          }
        });
      });

      if (!best) break;

      edges.push([best.a, best.b]);

      connected.push(best.b);

      remaining.splice(
        remaining.indexOf(best.b), 1
      );
    }

    return edges;
  }

  /* =====================================================
     6. CREATE ALL STARS

     Rendered once. Zoom changes their visibility,
     not their existence or coordinates.
  ===================================================== */

  function renderUniverse() {
    starLayer.replaceChildren();
    lineLayer.replaceChildren();

    const svgNS = "http://www.w3.org/2000/svg";

    allLines.forEach(line => {
      const a = nodeLookup.get(line.a);
      const b = nodeLookup.get(line.b);

      if (!a || !b) return;

      const element = document.createElementNS(
        svgNS,
        "line"
      );

      element.setAttribute("x1", a.x);
      element.setAttribute("y1", a.y);
      element.setAttribute("x2", b.x);
      element.setAttribute("y2", b.y);

      element.classList.add("constellation-line");

      if (line.type === "secondary") {
        element.classList.add("secondary");
      }

      line.element = element;

      lineLayer.appendChild(element);
    });

    allNodes.forEach(node => {
      const element = document.createElement("button");

      element.type = "button";

      element.className =
        "celestial-star " +
        `${node.type}-star` +
        (node.demo ? " demo-star" : "");

      element.style.left = `${node.x}px`;
      element.style.top = `${node.y}px`;

      element.setAttribute(
        "aria-label",
        `Explore ${node.title}`
      );

      const aura = document.createElement("span");
      aura.className = "star-aura";

      const core = document.createElement("span");
      core.className = "star-core";

      const label = document.createElement("span");
      label.className = "star-label";
      label.textContent = node.title;

      element.append(aura, core, label);

      element.addEventListener("click", event => {
        event.stopPropagation();

        if (performance.now() < suppressClickUntil) {
          return;
        }

        selectStar(node);
      });

      element.addEventListener("pointerenter", () => {
        illuminate(node.id);
      });

      element.addEventListener("pointerleave", () => {
        illuminate(null);
      });

      element.addEventListener("focus", () => {
        illuminate(node.id);
      });

      element.addEventListener("blur", () => {
        illuminate(null);
      });

      node.element = element;

      starLayer.appendChild(element);
    });

    updateVisibility();
  }

  function illuminate(id) {
    allNodes.forEach(node => {
      node.element?.classList.toggle(
        "selected",
        node.id === id
      );
    });

    allLines.forEach(line => {
      line.element?.classList.toggle(
        "highlighted",
        id === line.a || id === line.b
      );
    });
  }

  /* =====================================================
     7. CAMERA
  ===================================================== */

  function screenToWorld(screenX, screenY) {
    return {
      x: camera.x +
        (screenX - innerWidth / 2) / camera.zoom,

      y: camera.y +
        (screenY - innerHeight / 2) / camera.zoom
    };
  }

  function worldToScreen(x, y) {
    return {
      x: innerWidth / 2 +
        (x - camera.x) * camera.zoom,

      y: innerHeight / 2 +
        (y - camera.y) * camera.zoom
    };
  }

  function renderCamera() {
    world.style.transform =
      `translate3d(${innerWidth / 2}px,` +
      `${innerHeight / 2}px,0) ` +
      `scale(${camera.zoom}) ` +
      `translate3d(${-camera.x}px,` +
      `${-camera.y}px,0)`;

    updateVisibility();
    updateZoomIndicator();

    if (background) {
      background.setCamera(camera.x, camera.y);
    }
  }

  function setCamera(x, y, zoom) {
    camera.x = x;
    camera.y = y;
    camera.zoom = clamp(
      zoom, MIN_ZOOM, MAX_ZOOM
    );

    renderCamera();
  }

  function zoomAt(screenX, screenY, factor) {
    cancelCameraAnimation();

    const anchor = screenToWorld(screenX, screenY);

    const newZoom = clamp(
      camera.zoom * factor,
      MIN_ZOOM,
      MAX_ZOOM
    );

    camera.zoom = newZoom;

    camera.x = anchor.x -
      (screenX - innerWidth / 2) / newZoom;

    camera.y = anchor.y -
      (screenY - innerHeight / 2) / newZoom;

    renderCamera();
  }

  function updateZoomIndicator() {
    const marker = $("#zoomMarker");

    if (!marker) return;

    const amount =
      (Math.log(camera.zoom) - Math.log(MIN_ZOOM)) /
      (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM));

    marker.style.left =
      `${clamp(amount, 0, 1) * 100}%`;
  }

  /* =====================================================
     8. CONTINUOUS CAMERA ANIMATION

     The world never gets replaced.
     Only camera position and zoom change.
  ===================================================== */

  function cancelCameraAnimation() {
    cameraAnimationToken++;

    if (cameraFrame != null) {
      cancelAnimationFrame(cameraFrame);
      cameraFrame = null;
    }
  }

  function animateCamera(target, duration) {
    cancelCameraAnimation();

    const token = cameraAnimationToken;

    const start = { ...camera };

    const end = {
      x: target.x,
      y: target.y,
      zoom: clamp(
        target.zoom, MIN_ZOOM, MAX_ZOOM
      )
    };

    if (motionReduced()) {
      setCamera(end.x, end.y, end.zoom);
      return;
    }

    const beginning = performance.now();

    const timeLength =
      duration ?? DATA.camera.transitionDuration;

    function frame(time) {
      if (token !== cameraAnimationToken) return;

      const progress = clamp(
        (time - beginning) / timeLength,
        0, 1
      );

      const eased =
        progress * progress * (3 - 2 * progress);

      // Logarithmic zoom feels more natural
      // when traveling between large scale differences.

      const zoom =
        Math.exp(
          lerp(
            Math.log(start.zoom),
            Math.log(end.zoom),
            eased
          )
        );

      setCamera(
        lerp(start.x, end.x, eased),
        lerp(start.y, end.y, eased),
        zoom
      );

      if (progress < 1) {
        cameraFrame = requestAnimationFrame(frame);
      } else {
        cameraFrame = null;
      }
    }

    cameraFrame = requestAnimationFrame(frame);
  }

  function focusNode(node, desiredZoom) {
    lastFocusedNode = node;

    const zoomTargets = {
      navigation: 1.7,
      group: 2.1,
      production: 4.1,
      season: 7.1,
      episode: 9.6
    };

    const zoom = desiredZoom ??
      zoomTargets[node.type] ??
      camera.zoom;

    animateCamera({
      x: node.x,
      y: node.y,
      zoom
    });
  }

  function focusMainConstellation() {
    lastFocusedNode = null;

    const navigation = allNodes.filter(
      node => node.type === "navigation"
    );

    if (!navigation.length) return;

    const xs = navigation.map(node => node.x);
    const ys = navigation.map(node => node.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const width = maxX - minX;
    const height = maxY - minY;

    const availableWidth =
      innerWidth * (innerWidth < 650 ? .78 : .73);

    const availableHeight =
      innerHeight * .55;

    const zoom = clamp(
      Math.min(
        availableWidth / (width + 100),
        availableHeight / (height + 90),
        1.05
      ),
      MIN_ZOOM,
      1.05
    );

    animateCamera({
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom
    }, 800);
  }

  /* =====================================================
     9. SEMANTIC ZOOM

     Child stars gradually materialize as you approach.

     Visibility depends on camera zoom.

     The visibility of a descendant also depends on
     its ancestors' visibility.

     No page cut or scene replacement occurs.
  ===================================================== */

  function thresholdForNode(node) {
    const config = DATA.semanticZoom;

    switch (node.type) {
      case "production":
        return config.groupContents;

      case "season":
        return config.productionContents;

      case "episode":
        return config.seasonContents;

      default:
        return null;
    }
  }

  function visibilityForNode(node) {
    if (
      node.type === "navigation" ||
      node.type === "group"
    ) {
      return 1;
    }

    const threshold = thresholdForNode(node);

    if (!threshold) return 1;

    let visibility = smoothstep(
      threshold.start,
      threshold.fullyVisible,
      camera.zoom
    );

    const parent = nodeLookup.get(node.parentId);

    if (parent && parent.type !== "navigation") {
      const parentThreshold = thresholdForNode(parent);

      if (parentThreshold) {
        visibility *= smoothstep(
          parentThreshold.start,
          parentThreshold.fullyVisible,
          camera.zoom
        );
      }
    }

    return clamp(visibility, 0, 1);
  }

  function updateVisibility() {
    if (!allNodes.length) return;

    const zoom = camera.zoom;

    // Maintain readable and tappable stars as
    // the camera moves between zoom levels.
    const counterScale = clamp(
      1 / zoom,
      .16,
      3.5
    );

    const margin = 175;

    allNodes.forEach(node => {
      if (!node.element) return;

      const visibility = visibilityForNode(node);

      const screen = worldToScreen(
        node.x,
        node.y
      );

      const onScreen =
        screen.x >= -margin &&
        screen.x <= innerWidth + margin &&
        screen.y >= -margin &&
        screen.y <= innerHeight + margin;

      node.visible = visibility;

      const display =
        onScreen && visibility > .015;

      node.element.classList.toggle(
        "is-hidden",
        !display
      );

      node.element.style.setProperty(
        "--visibility",
        visibility.toFixed(3)
      );

      node.element.style.setProperty(
        "--node-scale",
        counterScale.toFixed(4)
      );

      node.element.disabled =
        !display || visibility < .72;

      node.element.tabIndex =
        display && visibility >= .72 ? 0 : -1;
    });

    allLines.forEach(line => {
      if (!line.element) return;

      const a = nodeLookup.get(line.a);
      const b = nodeLookup.get(line.b);

      if (!a || !b) return;

      const visibility =
        Math.min(a.visible, b.visible);

      const first = worldToScreen(a.x, a.y);
      const second = worldToScreen(b.x, b.y);

      const visibleArea =
        Math.max(first.x, second.x) >= -margin &&
        Math.min(first.x, second.x) <= innerWidth + margin &&
        Math.max(first.y, second.y) >= -margin &&
        Math.min(first.y, second.y) <= innerHeight + margin;

      line.element.style.display =
        visibleArea && visibility > .02
          ? ""
          : "none";

      line.element.style.setProperty(
        "--visibility",
        visibility.toFixed(3)
      );
    });
  }

  /* =====================================================
     10. MAIN NAVIGATION STARS

     These are production-level library views only.
     They never contain groups, seasons, or episodes.
  ===================================================== */

  function selectStar(node) {
    if (node.type === "navigation") {
      activateNavigation(node);
      return;
    }

    if (node.type === "episode") {
      focusNode(node);
      openEpisodeDetails(node);
      return;
    }

    focusNode(node);
  }

  function activateNavigation(node) {
    const action = node.action;

    if (action === "settings") {
      openSettings();
      return;
    }

    if (
      action === "library" ||
      action === "history" ||
      action === "rankings" ||
      action === "watchlist"
    ) {
      openCollection(action);
    }
  }

  function allProductions() {
    return state.archive.productions.filter(
      item => item && typeof item === "object"
    );
  }

  function productionRating(item) {
    const explicit = Number(
      item.averageRating ??
      item.calculatedRating ??
      item.rating
    );

    return Number.isFinite(explicit)
      ? explicit
      : null;
  }

  function productionLastWatched(item) {
    const value =
      item.lastWatched ??
      item.lastSeen ??
      item.watchedAt ??
      null;

    if (!value) return 0;

    const date = new Date(value).getTime();

    return Number.isFinite(date) ? date : 0;
  }

  function getCollection(type) {
    const items = [...allProductions()];

    switch (type) {

      case "library":
        return items.sort((a, b) =>
          String(a.title || a.name || "")
            .localeCompare(
              String(b.title || b.name || ""),
              undefined,
              { sensitivity: "base" }
            )
        );

      case "history":
        return items
          .filter(item =>
            productionLastWatched(item) > 0
          )
          .sort((a, b) =>
            productionLastWatched(b) -
            productionLastWatched(a)
          );

      case "rankings":
        return items
          .filter(item =>
            productionRating(item) !== null
          )
          .sort((a, b) =>
            productionRating(b) -
            productionRating(a)
          );

      case "watchlist":
        return items.filter(item =>
          item.watchlist === true ||
          item.status === "Planned" ||
          item.status === "Watchlist"
        );

      default:
        return [];
    }
  }

  function openCollection(type) {
    const titles = {
      library: "Library",
      history: "History",
      rankings: "Rankings",
      watchlist: "Watchlist"
    };

    const descriptions = {
      library: "All your productions, arranged alphabetically.",
      history: "Productions ordered by the date you last watched them.",
      rankings: "Your highest-rated productions.",
      watchlist: "The stories you plan to watch."
    };

    const items = getCollection(type);

    let content = `
      <span class="detail-eyebrow">
        YOUR PERSONAL ARCHIVE
      </span>

      <h2 id="detailTitle">
        ${titles[type]}
      </h2>

      <p>${descriptions[type]}</p>
    `;

    if (!items.length) {
      content += `
        <p style="margin-top:45px;opacity:.68;">
          Nothing has been added to this collection yet.
          Your personal entries will appear here once
          the archive editor is available.
        </p>
      `;
    } else {
      content += `
        <div style="margin-top:38px;">
          ${items.map(item => {
            const name = escapeHTML(
              item.title || item.name || "Untitled"
            );

            const rating = productionRating(item);

            return `
              <button
                type="button"
                class="detail-action collection-entry"
                data-production-id="${escapeHTML(item.id)}"
                style="
                  display:flex;
                  width:100%;
                  justify-content:space-between;
                  align-items:center;
                  gap:15px;
                  margin:0;
                  padding:17px 0;
                  border:0;
                  border-bottom:1px solid rgba(205,201,240,.09);
                  border-radius:0;
                  background:transparent;
                  text-align:left;
                "
              >
                <span>${name}</span>
                <span style="color:#aaa4ca;">
                  ${rating === null
                    ? ""
                    : rating.toFixed(1) + " / 10"}
                </span>
              </button>
            `;
          }).join("")}
        </div>
      `;
    }

    openOverlay(content);

    $$(".collection-entry").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.productionId;

        const node = allNodes.find(
          item =>
            item.type === "production" &&
            item.id === id
        );

        closeOverlay();

        if (node) {
          focusNode(node);
        } else {
          notify("This production has no map position yet.");
        }
      });
    });
  }

  /* =====================================================
     11. DETAILS & SETTINGS
  ===================================================== */

  function openOverlay(html) {
    previousModalFocus = document.activeElement;

    detailContent.innerHTML = html;

    detailOverlay.classList.add("open");

    detailOverlay.setAttribute(
      "aria-hidden", "false"
    );

    viewport.inert = true;

    $("#detailSheet").scrollTop = 0;
    $("#closeDetailButton").focus();
  }

  function closeOverlay() {
    detailOverlay.classList.remove("open");

    detailOverlay.setAttribute(
      "aria-hidden", "true"
    );

    viewport.inert = false;

    if (previousModalFocus?.isConnected) {
      previousModalFocus.focus();
    } else {
      viewport.focus();
    }
  }

  function openEpisodeDetails(node) {
    const title = escapeHTML(node.title);

    const notes = escapeHTML(
      node.data?.notes ||
      node.data?.observations ||
      "This episode will receive its full detail page in Step 5."
    );

    openOverlay(`
      <span class="detail-eyebrow">EPISODE</span>
      <h2 id="detailTitle">${title}</h2>
      <p>${notes}</p>
    `);
  }

  function openSettings() {
    openOverlay(`
      <span class="detail-eyebrow">
        YOUR UNIVERSE
      </span>

      <h2 id="detailTitle">Settings</h2>

      <p>
        Adjust the atmosphere without leaving
        your personal universe.
      </p>

      <h3>Atmosphere</h3>

      <div class="detail-row">
        <label for="settingDensity">
          Star density
        </label>

        <div>
          <input
            id="settingDensity"
            class="setting-range"
            type="range"
            min="10"
            max="100"
            step="5"
            value="${state.settings.starDensity}"
          >

          <output id="densityOutput">
            ${state.settings.starDensity}
          </output>
        </div>
      </div>

      <div class="detail-row">
        <label for="settingBrightness">
          Star brightness
        </label>

        <div>
          <input
            id="settingBrightness"
            class="setting-range"
            type="range"
            min="10"
            max="100"
            step="5"
            value="${state.settings.starBrightness}"
          >

          <output id="brightnessOutput">
            ${state.settings.starBrightness}
          </output>
        </div>
      </div>

      <div class="detail-row">
        <label for="settingMotion">
          Reduce motion
        </label>

        <input
          id="settingMotion"
          class="motion-toggle"
          type="checkbox"
          ${state.settings.reduceMotion ? "checked" : ""}
        >
      </div>

      <h3>Storage & Backups</h3>

      <p>
        Your archive is saved locally in this browser.
        Export backups regularly, especially before
        clearing browser data or changing devices.
      </p>

      <button
        id="exportButton"
        class="detail-action"
        type="button"
      >
        Export archive ↗
      </button>

      <button
        id="importButton"
        class="detail-action"
        type="button"
      >
        Import archive ↙
      </button>
    `);

    $("#settingDensity").addEventListener(
      "input",
      event => {
        const value = Number(event.target.value);

        state.settings.starDensity = value;
        $("#densityOutput").textContent = value;

        background.rebuild();
        saveState();
      }
    );

    $("#settingBrightness").addEventListener(
      "input",
      event => {
        const value = Number(event.target.value);

        state.settings.starBrightness = value;
        $("#brightnessOutput").textContent = value;

        background.draw(performance.now());
        saveState();
      }
    );

    $("#settingMotion").addEventListener(
      "change",
      event => {
        state.settings.reduceMotion =
          event.target.checked;

        applyMotionSettings();
        background.draw(performance.now());
        saveState();
      }
    );

    $("#exportButton").addEventListener(
      "click",
      exportBackup
    );

    $("#importButton").addEventListener(
      "click",
      () => $("#importFile").click()
    );
  }

  /* =====================================================
     12. EXPORT / IMPORT
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

    const link = document.createElement("a");

    link.href = url;

    link.download =
      "watch-archive-" +
      new Date().toISOString().slice(0, 10) +
      ".json";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);

    notify("Archive backup prepared.");
  }

  async function importBackup(file) {
    if (!file) return;

    try {
      const text = await file.text();

      const backup = JSON.parse(text);

      if (
        backup.app !== DATA.appName ||
        backup.schemaVersion !== DATA.schemaVersion ||
        !backup.data ||
        !backup.data.archive ||
        !["groups", "productions", "seasons", "episodes"]
          .every(key =>
            Array.isArray(backup.data.archive[key])
          )
      ) {
        throw new Error("Invalid backup format");
      }

      const confirmed = confirm(
        "Import this archive?\n\n" +
        "Your current local archive will be replaced. " +
        "Export your existing data first if needed."
      );

      if (!confirmed) return;

      const oldState = state;

      state = normalizeState(backup.data);

      if (!saveState()) {
        state = oldState;
        return;
      }

      closeOverlay();

      applyMotionSettings();

      background.rebuild();

      buildUniverse();
      renderUniverse();

      focusMainConstellation();

      notify("Archive imported successfully.");

    } catch (error) {
      console.error(error);
      notify("Import failed. Check the backup file.");

    } finally {
      $("#importFile").value = "";
    }
  }

  /* =====================================================
     13. BACKGROUND STARFIELD

     Background stars move at different parallax
     speeds when the camera travels.

     Rendered on a separate canvas for performance.
  ===================================================== */

  class CosmicBackground {

    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");

      this.stars = [];

      this.width = 0;
      this.height = 0;

      this.cameraX = 0;
      this.cameraY = 0;

      this.running = false;
      this.frame = null;
      this.lastFrame = 0;

      this.rebuild();
    }

    rebuild() {
      if (!this.ctx) return;

      this.width = innerWidth;
      this.height = innerHeight;

      const dpr = Math.min(
        devicePixelRatio || 1,
        1.5
      );

      this.canvas.width = Math.round(
        this.width * dpr
      );

      this.canvas.height = Math.round(
        this.height * dpr
      );

      this.ctx.setTransform(
        dpr, 0, 0, dpr, 0, 0
      );

      const density =
        state.settings.starDensity / 100;

      const count = clamp(
        Math.round(
          this.width * this.height *
          .00056 * density
        ),
        90,
        1400
      );

      this.stars = [];

      for (let i = 0; i < count; i++) {
        const large = Math.random() > .965;

        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,

          radius: large
            ? 1 + Math.random() * .75
            : .22 + Math.random() * .65,

          alpha: .15 + Math.random() * .7,

          depth: .025 + Math.random() * .19,

          phase: Math.random() * Math.PI * 2,

          speed: .00012 + Math.random() * .00043,

          warm: Math.random() < .075
        });
      }

      this.draw(performance.now());
    }

    setCamera(x, y) {
      this.cameraX = x;
      this.cameraY = y;

      if (motionReduced() || !this.running) {
        this.draw(performance.now());
      }
    }

    draw(time) {
      if (!this.ctx) return;

      const ctx = this.ctx;

      ctx.clearRect(
        0, 0,
        this.width,
        this.height
      );

      const brightness =
        state.settings.starBrightness / 100;

      for (const star of this.stars) {
        const x = (
          (
            star.x -
            this.cameraX * star.depth
          ) % this.width +
          this.width
        ) % this.width;

        const y = (
          (
            star.y -
            this.cameraY * star.depth
          ) % this.height +
          this.height
        ) % this.height;

        const twinkle = motionReduced()
          ? 1
          : .82 + Math.sin(
              time * star.speed + star.phase
            ) * .18;

        const opacity = clamp(
          star.alpha *
          twinkle *
          (.35 + brightness * 1.13),
          0, 1
        );

        ctx.beginPath();

        ctx.arc(
          x, y,
          star.radius,
          0,
          Math.PI * 2
        );

        ctx.fillStyle = star.warm
          ? `rgba(230,211,229,${opacity})`
          : `rgba(211,219,246,${opacity})`;

        ctx.fill();
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

  /* =====================================================
     14. FREE MOVEMENT AND TOUCH GESTURES

     - Drag in any direction
     - Pinch to zoom
     - Zoom around gesture center
     - Tap stars without triggering dragging
  ===================================================== */

  function pointerPoint(event) {
    return {
      x: event.clientX,
      y: event.clientY
    };
  }

  function midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function pointerDistance(a, b) {
    return Math.hypot(
      a.x - b.x,
      a.y - b.y
    );
  }

  function bindGestures() {

    viewport.addEventListener(
      "pointerdown",
      event => {

        if (
          event.pointerType === "mouse" &&
          event.button !== 0
        ) {
          return;
        }

        cancelCameraAnimation();

        const point = pointerPoint(event);

        activePointers.set(
          event.pointerId,
          point
        );

        if (activePointers.size === 1) {
          gestureMoved = false;

          gesture = {
            type: "drag",
            start: point,
            last: point,
            totalDistance: 0
          };
        }

        if (activePointers.size >= 2) {
          const [a, b] =
            [...activePointers.values()];

          const center = midpoint(a, b);

          gesture = {
            type: "pinch",
            distance: Math.max(
              1,
              pointerDistance(a, b)
            ),

            startZoom: camera.zoom,

            anchor: screenToWorld(
              center.x,
              center.y
            )
          };

          gestureMoved = true;
          suppressClickUntil =
            performance.now() + 500;
        }
      }
    );

    viewport.addEventListener(
      "pointermove",
      event => {

        if (!activePointers.has(event.pointerId)) {
          return;
        }

        const previous =
          activePointers.get(event.pointerId);

        const current = pointerPoint(event);

        activePointers.set(
          event.pointerId,
          current
        );

        if (activePointers.size >= 2) {
          const [a, b] =
            [...activePointers.values()];

          const center = midpoint(a, b);

          if (!gesture || gesture.type !== "pinch") {
            gesture = {
              type: "pinch",
              distance: Math.max(
                1,
                pointerDistance(a, b)
              ),
              startZoom: camera.zoom,
              anchor: screenToWorld(
                center.x,
                center.y
              )
            };
          }

          const currentDistance = Math.max(
            1,
            pointerDistance(a, b)
          );

          const newZoom = clamp(
            gesture.startZoom *
            currentDistance /
            gesture.distance,
            MIN_ZOOM,
            MAX_ZOOM
          );

          camera.zoom = newZoom;

          camera.x = gesture.anchor.x -
            (center.x - innerWidth / 2) / newZoom;

          camera.y = gesture.anchor.y -
            (center.y - innerHeight / 2) / newZoom;

          gestureMoved = true;

          suppressClickUntil =
            performance.now() + 450;

          viewport.classList.add("dragging");

          renderCamera();
          return;
        }

        if (
          !gesture ||
          gesture.type !== "drag"
        ) {
          gesture = {
            type: "drag",
            start: current,
            last: previous,
            totalDistance: 0
          };
        }

        const dx = current.x - previous.x;
        const dy = current.y - previous.y;

        gesture.totalDistance += Math.hypot(
          dx, dy
        );

        if (
          gesture.totalDistance >
          DATA.camera.tapMovementThreshold
        ) {
          gestureMoved = true;

          suppressClickUntil =
            performance.now() + 450;

          viewport.classList.add("dragging");

          if (
            !viewport.hasPointerCapture(event.pointerId)
          ) {
            viewport.setPointerCapture(
              event.pointerId
            );
          }
        }

        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;

        renderCamera();
      }
    );

    function endPointer(event) {
      if (!activePointers.has(event.pointerId)) {
        return;
      }

      activePointers.delete(event.pointerId);

      if (
        viewport.hasPointerCapture(event.pointerId)
      ) {
        viewport.releasePointerCapture(
          event.pointerId
        );
      }

      if (gestureMoved) {
        suppressClickUntil =
          performance.now() + 350;
      }

      if (activePointers.size === 0) {
        gesture = null;
        gestureMoved = false;

        viewport.classList.remove("dragging");
      } else if (activePointers.size === 1) {
        const remaining =
          [...activePointers.values()][0];

        gesture = {
          type: "drag",
          start: remaining,
          last: remaining,
          totalDistance: 0
        };
      }
    }

    viewport.addEventListener(
      "pointerup",
      endPointer
    );

    viewport.addEventListener(
      "pointercancel",
      endPointer
    );

    viewport.addEventListener(
      "lostpointercapture",
      event => {
        if (activePointers.has(event.pointerId)) {
          activePointers.delete(event.pointerId);
        }

        if (activePointers.size === 0) {
          gesture = null;
          viewport.classList.remove("dragging");
        }
      }
    );

    viewport.addEventListener(
      "click",
      event => {
        if (
          performance.now() <
          suppressClickUntil
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );

    viewport.addEventListener(
      "wheel",
      event => {
        event.preventDefault();

        const factor = Math.exp(
          -event.deltaY *
          DATA.camera.zoomSensitivity
        );

        zoomAt(
          event.clientX,
          event.clientY,
          factor
        );
      },
      { passive: false }
    );

    viewport.addEventListener(
      "keydown",
      event => {

        if (event.target !== viewport) return;

        const step = 90 / camera.zoom;

        switch (event.key) {

          case "ArrowUp":
            camera.y -= step;
            break;

          case "ArrowDown":
            camera.y += step;
            break;

          case "ArrowLeft":
            camera.x -= step;
            break;

          case "ArrowRight":
            camera.x += step;
            break;

          case "+":
          case "=":
            zoomAt(
              innerWidth / 2,
              innerHeight / 2,
              1.25
            );
            break;

          case "-":
            zoomAt(
              innerWidth / 2,
              innerHeight / 2,
              .8
            );
            break;

          default:
            return;
        }

        event.preventDefault();

        renderCamera();
      }
    );
  }

  /* =====================================================
     15. FIXED CONTROLS
  ===================================================== */

  function bindControls() {
    $("#homeButton").addEventListener(
      "click",
      focusMainConstellation
    );

    $("#focusButton").addEventListener(
      "click",
      () => {
        if (lastFocusedNode) {
          focusNode(lastFocusedNode);
        } else {
          focusMainConstellation();
        }
      }
    );

    $("#closeDetailButton").addEventListener(
      "click",
      closeOverlay
    );

    $("#detailBackdrop").addEventListener(
      "click",
      closeOverlay
    );

    window.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          detailOverlay.classList.contains("open")
        ) {
          closeOverlay();
        }
      }
    );

    $("#importFile").addEventListener(
      "change",
      event => {
        importBackup(event.target.files?.[0]);
      }
    );

    motionPreference.addEventListener(
      "change",
      () => {
        applyMotionSettings();

        background.draw(performance.now());
      }
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          background.stop();
        } else {
          background.start();
        }
      }
    );

    let resizeTimer;

    window.addEventListener(
      "resize",
      () => {
        clearTimeout(resizeTimer);

        resizeTimer = setTimeout(() => {
          background.rebuild();

          const wasMobileLayout =
            allNodes.find(n => n.id === "nav-library");

          const expectedX =
            DATA.navigation.nodes[0].x *
            mobileNavigationScale();

          if (
            wasMobileLayout &&
            Math.abs(wasMobileLayout.x - expectedX) > 1
          ) {
            buildUniverse();
            renderUniverse();
          }

          renderCamera();
        }, 180);
      }
    );

    window.addEventListener(
      "storage",
      event => {
        if (event.key !== DATA.storageKey) {
          return;
        }

        state = loadState();

        applyMotionSettings();
        background.rebuild();

        buildUniverse();
        renderUniverse();

        notify("Archive refreshed.");
      }
    );
  }

  /* =====================================================
     16. INITIALIZE
  ===================================================== */

  function initialize() {
    applyMotionSettings();

    background = new CosmicBackground(
      $("#backgroundStars")
    );

    buildUniverse();
    renderUniverse();

    bindGestures();
    bindControls();

    // Start by fitting the main Cassiopeia
    // constellation into the current screen.
    focusMainConstellation();

    background.start();

    if (!localStorage.getItem(DATA.storageKey)) {
      saveState();
    }
  }

  initialize();

})();
