
/* ==========================================
   GEM LIBRARY — FAMILY ATLAS
   APP.JS
========================================== */

"use strict";

(() => {

  const D = GEM_DATA;

  const $ = id => document.getElementById(id);

  const clamp = (n, min, max) =>
    Math.min(max, Math.max(min, n));

  const esc = value =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const uid = () =>
    "g-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2, 10);

  const NODE_W = 166;
  const NODE_H = 91;
  const GRID = 25;

  let db;
  let activeView = "atlas";
  let mode = "explore";
  let editingGem = null;
  let editingConnection = null;
  let profileGem = null;
  let toastTimer = null;
  let saveTimer = null;
  let confirmAction = null;
  let suppressClickUntil = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let initializedCamera = false;

  const camera = {
    x: 0,
    y: 0,
    zoom: 1
  };

  const MIN_ZOOM = .18;
  const MAX_ZOOM = 3;

  const pointers = new Map();

  let gesture = null;
  let nodeDrag = null;

  /* ======================================
     STORAGE
  ====================================== */

  function load() {
    try {
      const raw = localStorage.getItem(D.storageKey);

      if (!raw) {
        return D.createDemo();
      }

      return normalizeDatabase(JSON.parse(raw));

    } catch (err) {
      console.error("Storage load failed:", err);
      toast("Could not read saved data. Demo opened.");
      return D.createDemo();
    }
  }

  function normalizeDatabase(input) {
    if (
      !input ||
      !Array.isArray(input.gems) ||
      !Array.isArray(input.connections)
    ) {
      throw new Error("Invalid library structure");
    }

    const ids = new Set();

    const gems = input.gems.map(raw => {
      if (!raw || typeof raw !== "object") {
        throw new Error("Invalid gem entry");
      }

      const g = {
        ...D.createGem(),
        ...raw
      };

      g.id = String(g.id || "");

      if (!g.id || ids.has(g.id)) {
        throw new Error("Invalid or duplicate gemstone ID");
      }

      ids.add(g.id);

      g.name = String(g.name ?? "").slice(0, 100);
      g.title = String(g.title ?? "").slice(0, 140);
      g.color = String(g.color ?? "").slice(0, 120);
      g.notes = String(g.notes ?? "").slice(0, 100000);

      g.classifications = Array.isArray(g.classifications)
        ? g.classifications.filter(x =>
            D.classifications.includes(x)
          )
        : [];

      g.x = Number.isFinite(Number(g.x)) ? Number(g.x) : 0;
      g.y = Number.isFinite(Number(g.y)) ? Number(g.y) : 0;

      g.accent = safeColor(g.accent);
      g.symbol = D.symbols.includes(g.symbol)
        ? g.symbol
        : "◆";

      return g;
    });

    const connectionIds = new Set();

    const connections = input.connections.map(c => {
      if (!c || typeof c !== "object") {
        throw new Error("Invalid connection");
      }

      const id = String(c.id || "");
      const a = String(c.a || "");
      const b = String(c.b || "");
      const type = String(c.type || "");

      if (
        !id ||
        connectionIds.has(id) ||
        !ids.has(a) ||
        !ids.has(b) ||
        a === b ||
        !D.relationshipTypes[type]
      ) {
        throw new Error("Invalid connection reference");
      }

      connectionIds.add(id);

      return {
        id,
        a,
        b,
        type,
        notes: String(c.notes ?? "").slice(0, 100000),
        createdAt: Number(c.createdAt) || Date.now()
      };
    });

    return {
      version: D.version,
      settings: {
        ...D.defaultSettings,
        ...(input.settings || {})
      },
      gems,
      connections
    };
  }

  function save() {
    try {
      localStorage.setItem(
        D.storageKey,
        JSON.stringify(db)
      );
      return true;
    } catch (err) {
      console.error("Save failed:", err);
      toast("Save failed. Export a backup.");
      return false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 160);
  }

  function gem(id) {
    return db.gems.find(g => g.id === id) || null;
  }

  function gemName(id) {
    return gem(id)?.name || "Unknown Gem";
  }

  function safeColor(value) {
    const v = String(value || "").trim();

    if (
      /^#[0-9a-f]{3}$/i.test(v) ||
      /^#[0-9a-f]{6}$/i.test(v)
    ) {
      return v;
    }

    return "#a7a6d2";
  }

  function sortNames(a, b) {
    return a.name.localeCompare(b.name, undefined, {
      sensitivity: "base"
    });
  }

  /* ======================================
     UI HELPERS
  ====================================== */

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.classList.remove("visible");
    }, 2600);
  }

  function show(id) {
    $(id)?.classList.remove("hidden");
  }

  function hide(id) {
    $(id)?.classList.add("hidden");
  }

  function closeOverlays() {
    [
      "searchOverlay",
      "profileOverlay",
      "editorOverlay",
      "connectionOverlay",
      "confirmOverlay"
    ].forEach(hide);
  }

  function openOnly(id) {
    closeOverlays();
    show(id);
  }

  function confirmDialog(title, message, action, label) {
    confirmAction = action;

    $("confirmTitle").textContent = title;
    $("confirmMessage").textContent = message;
    $("confirmAccept").textContent = label || "Confirm";

    openOnly("confirmOverlay");
  }

  function optionsHTML(values, selected = "") {
    return [
      '<option value="">Not specified</option>',
      ...values.map(v =>
        `<option value="${esc(v)}" ${
          String(v) === String(selected) ? "selected" : ""
        }>${esc(v)}</option>`
      )
    ].join("");
  }

  function gemOptions(selected = "") {
    return [
      '<option value="">Select gemstone...</option>',
      ...[...db.gems].sort(sortNames).map(g =>
        `<option value="${esc(g.id)}" ${
          g.id === selected ? "selected" : ""
        }>${esc(g.name)}</option>`
      )
    ].join("");
  }

  function classificationText(g) {
    return (g.classifications || []).join(" · ") ||
      "Unclassified";
  }

  function metadata(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "—";
    }
    return esc(value);
  }

  function switchView(name) {
    activeView = name;
    closeOverlays();

    document.querySelectorAll(".view").forEach(v => {
      v.classList.toggle(
        "active",
        v.id === name + "View"
      );
    });

    document.querySelectorAll(".nav-item").forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.view === name
      );
    });

    if (name === "atlas") {
      renderAtlas();
      requestAnimationFrame(() => {
        if (!initializedCamera) {
          fitAtlas();
          initializedCamera = true;
        } else {
          updateWorld();
        }
      });
    }

    if (name === "library") renderLibrary();
    if (name === "relations") renderRelations();
    if (name === "settings") syncSettings();
  }

  /* ======================================
     ATLAS RENDERING
  ====================================== */

  function updateWorld() {
    $("atlasWorld").style.transform =
      `translate(${camera.x}px, ${camera.y}px) ` +
      `scale(${camera.zoom})`;

    $("zoomLevel").textContent =
      Math.round(camera.zoom * 100) + "%";
  }

  function renderAtlas() {
    const layer = $("nodeLayer");

    layer.innerHTML = db.gems.map(g => {
      const color = safeColor(g.accent);
      const symbol = D.symbols.includes(g.symbol)
        ? g.symbol
        : "◆";

      return `
        <div class="atlas-node"
          data-gem="${esc(g.id)}"
          style="
            left:${g.x}px;
            top:${g.y}px;
            --gem-color:${color};
          ">

          <div class="node-anchor top"></div>
          <div class="node-anchor bottom"></div>
          <div class="node-anchor left"></div>
          <div class="node-anchor right"></div>

          <div class="node-gem">${esc(symbol)}</div>

          <div class="node-info">
            <div class="node-name">${esc(g.name)}</div>
            ${
              g.title
                ? `<div class="node-title">${esc(g.title)}</div>`
                : ""
            }
            ${
              db.settings.showDetails
                ? `<div class="node-classification">
                    ${esc(classificationText(g))}
                   </div>`
                : ""
            }
          </div>

        </div>
      `;
    }).join("");

    $("atlasEmpty").classList.toggle(
      "hidden",
      db.gems.length > 0
    );

    $("atlasSummary").textContent =
      `${db.gems.length} gemstones · ` +
      `${db.connections.length} direct connections`;

    $("canvasCount").textContent =
      `${db.gems.length} GEMS`;

    $("canvasHint").textContent =
      mode === "arrange"
        ? "Drag gemstones to rearrange · Drag empty space to pan"
        : "Drag to explore · Pinch to zoom · Tap a gem";

    $("atlasViewport").classList.toggle(
      "arrange",
      mode === "arrange"
    );

    document.querySelectorAll(".mode-btn").forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.mode === mode
      );
    });

    bindNodeEvents();
    drawConnections();
    updateWorld();
  }

  /* ======================================
     CONNECTION DRAWING
  ====================================== */

  function nodeCenter(g) {
    return {
      x: g.x + NODE_W / 2,
      y: g.y + NODE_H / 2
    };
  }

  function connectorGeometry(a, b, type) {
    const ac = nodeCenter(a);
    const bc = nodeCenter(b);

    let start;
    let end;
    let vertical;

    const dx = bc.x - ac.x;
    const dy = bc.y - ac.y;

    if (
      Math.abs(dy) > Math.abs(dx) * .48 ||
      type === "parent" ||
      type === "adoptive"
    ) {
      vertical = true;

      if (dy >= 0) {
        start = {
          x: ac.x,
          y: a.y + NODE_H
        };
        end = {
          x: bc.x,
          y: b.y
        };
      } else {
        start = {
          x: ac.x,
          y: a.y
        };
        end = {
          x: bc.x,
          y: b.y + NODE_H
        };
      }

    } else {
      vertical = false;

      if (dx >= 0) {
        start = {
          x: a.x + NODE_W,
          y: ac.y
        };
        end = {
          x: b.x,
          y: bc.y
        };
      } else {
        start = {
          x: a.x,
          y: ac.y
        };
        end = {
          x: b.x + NODE_W,
          y: bc.y
        };
      }
    }

    let d;

    if (db.settings.curvedLines) {
      if (vertical) {
        const mid = (start.y + end.y) / 2;

        d =
          `M ${start.x} ${start.y} ` +
          `C ${start.x} ${mid}, ` +
          `${end.x} ${mid}, ` +
          `${end.x} ${end.y}`;
      } else {
        const mid = (start.x + end.x) / 2;

        d =
          `M ${start.x} ${start.y} ` +
          `C ${mid} ${start.y}, ` +
          `${mid} ${end.y}, ` +
          `${end.x} ${end.y}`;
      }
    } else {
      d = vertical
        ? `M ${start.x} ${start.y}
           V ${(start.y + end.y) / 2}
           H ${end.x}
           V ${end.y}`
        : `M ${start.x} ${start.y}
           H ${(start.x + end.x) / 2}
           V ${end.y}
           H ${end.x}`;
    }

    return {
      d,
      labelX: (start.x + end.x) / 2,
      labelY: (start.y + end.y) / 2
    };
  }

  function drawConnections() {
    const svg = $("connectionSvg");

    if (!db.settings.showLines) {
      svg.innerHTML = "";
      return;
    }

    svg.innerHTML = db.connections.map(c => {
      const a = gem(c.a);
      const b = gem(c.b);

      if (!a || !b) return "";

      const geometry =
        connectorGeometry(a, b, c.type);

      const definition = D.relationshipTypes[c.type];

      return `
        <g>
          <path class="connection-path ${esc(c.type)}"
            d="${geometry.d}"></path>

          <text class="connection-label"
            x="${geometry.labelX}"
            y="${geometry.labelY - 8}">
            ${esc(definition?.symbol || "⋯")}
          </text>
        </g>
      `;
    }).join("");
  }

  /* ======================================
     CAMERA AND ZOOM
  ====================================== */

  function viewportPoint(clientX, clientY) {
    const rect = $("atlasViewport").getBoundingClientRect();

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function screenToWorld(point) {
    return {
      x: (point.x - camera.x) / camera.zoom,
      y: (point.y - camera.y) / camera.zoom
    };
  }

  function zoomAt(newZoom, point) {
    newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);

    const world = screenToWorld(point);

    camera.zoom = newZoom;
    camera.x = point.x - world.x * newZoom;
    camera.y = point.y - world.y * newZoom;

    updateWorld();
  }

  function zoomBy(factor) {
    const vp = $("atlasViewport");

    zoomAt(camera.zoom * factor, {
      x: vp.clientWidth / 2,
      y: vp.clientHeight / 2
    });
  }

  function fitAtlas() {
    const vp = $("atlasViewport");

    if (!vp.clientWidth || !vp.clientHeight) return;

    if (!db.gems.length) {
      camera.zoom = 1;
      camera.x = vp.clientWidth / 2;
      camera.y = vp.clientHeight / 2;
      updateWorld();
      return;
    }

    const minX = Math.min(...db.gems.map(g => g.x));
    const maxX = Math.max(...db.gems.map(g => g.x + NODE_W));
    const minY = Math.min(...db.gems.map(g => g.y));
    const maxY = Math.max(...db.gems.map(g => g.y + NODE_H));

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const padding = 65;

    const zx = (vp.clientWidth - padding * 2) / width;
    const zy = (vp.clientHeight - padding * 2) / height;

    camera.zoom = clamp(
      Math.min(zx, zy, 1.35),
      MIN_ZOOM,
      MAX_ZOOM
    );

    camera.x =
      vp.clientWidth / 2 -
      ((minX + maxX) / 2) * camera.zoom;

    camera.y =
      vp.clientHeight / 2 -
      ((minY + maxY) / 2) * camera.zoom;

    updateWorld();
  }

  function focusGem(id, open = true) {
    const g = gem(id);
    if (!g) return;

    if (activeView !== "atlas") {
      switchView("atlas");
    }

    const vp = $("atlasViewport");

    camera.zoom = Math.max(camera.zoom, .8);

    camera.x =
      vp.clientWidth / 2 -
      (g.x + NODE_W / 2) * camera.zoom;

    camera.y =
      vp.clientHeight / 2 -
      (g.y + NODE_H / 2) * camera.zoom;

    updateWorld();

    if (open) openProfile(id);
  }

  /* ======================================
     TOUCH & POINTER NAVIGATION
  ====================================== */

  function pinchInfo() {
    const arr = [...pointers.values()];

    if (arr.length < 2) return null;

    const a = arr[0];
    const b = arr[1];

    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y)
    };
  }

  function startGesture() {
    const arr = [...pointers.values()];

    if (arr.length >= 2) {
      const p = pinchInfo();
      const local = viewportPoint(p.x, p.y);

      gesture = {
        type: "pinch",
        startDistance: Math.max(p.distance, 1),
        startZoom: camera.zoom,
        world: screenToWorld(local)
      };

    } else if (arr.length === 1) {
      gesture = {
        type: "pan",
        startX: arr[0].x,
        startY: arr[0].y,
        cameraX: camera.x,
        cameraY: camera.y,
        moved: false
      };
    }
  }

  function onViewportDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) {
      return;
    }

    if (nodeDrag) return;

    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    startGesture();
  }

  function onGlobalPointerMove(e) {
    if (nodeDrag && e.pointerId === nodeDrag.pointerId) {
      dragNodeMove(e);
      return;
    }

    if (!pointers.has(e.pointerId)) return;

    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY
    });

    if (!gesture) return;

    if (pointers.size >= 2) {
      if (gesture.type !== "pinch") {
        startGesture();
      }

      const p = pinchInfo();
      const local = viewportPoint(p.x, p.y);

      const newZoom = clamp(
        gesture.startZoom *
        p.distance /
        gesture.startDistance,
        MIN_ZOOM,
        MAX_ZOOM
      );

      camera.zoom = newZoom;

      camera.x =
        local.x - gesture.world.x * newZoom;

      camera.y =
        local.y - gesture.world.y * newZoom;

      suppressClickUntil = Date.now() + 250;
      updateWorld();

      return;
    }

    if (gesture.type === "pan") {
      const p = [...pointers.values()][0];

      const dx = p.x - gesture.startX;
      const dy = p.y - gesture.startY;

      if (Math.hypot(dx, dy) > 5) {
        gesture.moved = true;
        suppressClickUntil = Date.now() + 250;
      }

      camera.x = gesture.cameraX + dx;
      camera.y = gesture.cameraY + dy;

      updateWorld();
    }
  }

  function onGlobalPointerUp(e) {
    if (nodeDrag && e.pointerId === nodeDrag.pointerId) {
      finishNodeDrag();
      return;
    }

    if (!pointers.has(e.pointerId)) return;

    pointers.delete(e.pointerId);

    if (pointers.size) {
      startGesture();
    } else {
      gesture = null;
    }
  }

  function bindNodeEvents() {
    document.querySelectorAll(".atlas-node").forEach(el => {

      el.addEventListener("pointerdown", e => {
        if (mode !== "arrange") return;

        if (e.pointerType === "mouse" && e.button !== 0) {
          return;
        }

        e.stopPropagation();

        const g = gem(el.dataset.gem);
        if (!g) return;

        const point = viewportPoint(e.clientX, e.clientY);
        const world = screenToWorld(point);

        nodeDrag = {
          pointerId: e.pointerId,
          id: g.id,
          element: el,
          offsetX: world.x - g.x,
          offsetY: world.y - g.y,
          moved: false,
          startX: e.clientX,
          startY: e.clientY
        };

        el.classList.add("dragging");
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener("click", e => {
        e.stopPropagation();

        if (
          Date.now() < suppressClickUntil ||
          mode === "arrange"
        ) {
          return;
        }

        openProfile(el.dataset.gem);
      });

      el.addEventListener("dblclick", e => {
        e.stopPropagation();

        if (mode === "arrange") {
          openProfile(el.dataset.gem);
        }
      });

    });
  }

  function dragNodeMove(e) {
    const drag = nodeDrag;
    if (!drag) return;

    const g = gem(drag.id);
    if (!g) return;

    const local = viewportPoint(e.clientX, e.clientY);
    const world = screenToWorld(local);

    let x = world.x - drag.offsetX;
    let y = world.y - drag.offsetY;

    if (db.settings.snapGrid) {
      x = Math.round(x / GRID) * GRID;
      y = Math.round(y / GRID) * GRID;
    }

    g.x = Math.round(x);
    g.y = Math.round(y);

    drag.element.style.left = g.x + "px";
    drag.element.style.top = g.y + "px";

    if (
      Math.hypot(
        e.clientX - drag.startX,
        e.clientY - drag.startY
      ) > 4
    ) {
      drag.moved = true;
    }

    drawConnections();
  }

  function finishNodeDrag() {
    if (!nodeDrag) return;

    const drag = nodeDrag;
    nodeDrag = null;

    drag.element.classList.remove("dragging");

    if (drag.moved) {
      const g = gem(drag.id);
      if (g) g.updatedAt = Date.now();

      suppressClickUntil = Date.now() + 250;
      scheduleSave();
    }
  }

  function initializeCanvasEvents() {
    const vp = $("atlasViewport");

    vp.addEventListener("pointerdown", onViewportDown);

    window.addEventListener(
      "pointermove",
      onGlobalPointerMove
    );

    window.addEventListener(
      "pointerup",
      onGlobalPointerUp
    );

    window.addEventListener(
      "pointercancel",
      onGlobalPointerUp
    );

    vp.addEventListener("wheel", e => {
      e.preventDefault();

      const point = viewportPoint(e.clientX, e.clientY);

      zoomAt(
        camera.zoom * (e.deltaY < 0 ? 1.12 : .89),
        point
      );
    }, { passive: false });

    vp.addEventListener("dblclick", e => {
      if (e.target.closest(".atlas-node")) return;

      zoomAt(
        camera.zoom * 1.3,
        viewportPoint(e.clientX, e.clientY)
      );
    });
  }

  /* ======================================
     LIBRARY
  ====================================== */

  function renderLibrary() {
    const query =
      $("librarySearch").value.trim().toLowerCase();

    const sort = $("librarySort").value;

    const order = {
      Common: 1,
      Uncommon: 2,
      Rare: 3,
      "Very Rare": 4
    };

    let gems = db.gems.filter(g => {
      const haystack = [
        g.name,
        g.title,
        g.color,
        g.mineralRarity,
        g.gemRarity,
        ...(g.classifications || [])
      ].join(" ").toLowerCase();

      return haystack.includes(query);
    });

    gems = [...gems];

    if (sort === "name") {
      gems.sort(sortNames);
    }

    if (sort === "recent") {
      gems.sort((a, b) =>
        (b.updatedAt || 0) - (a.updatedAt || 0)
      );
    }

    if (sort === "rarity") {
      gems.sort((a, b) =>
        (order[b.mineralRarity] || 0) -
        (order[a.mineralRarity] || 0)
      );
    }

    if (sort === "mohs") {
      gems.sort((a, b) =>
        (Number(b.mohs) || 0) -
        (Number(a.mohs) || 0)
      );
    }

    $("libraryCount").textContent =
      `${gems.length} OF ${db.gems.length} GEMSTONES`;

    $("libraryGrid").innerHTML = gems.length
      ? gems.map(g => `
        <button class="library-card"
          data-open-gem="${esc(g.id)}"
          style="--gem-color:${safeColor(g.accent)}">

          <div class="library-card-symbol">
            ${esc(g.symbol)}
          </div>

          <div class="library-card-name">
            ${esc(g.name)}
          </div>

          <div class="library-card-title">
            ${esc(g.title || "Untitled Gemstone")}
          </div>

          <div class="library-card-tags">
            <span class="mini-tag">
              ${esc(g.mineralRarity || "Unrated")}
            </span>

            ${
              g.mohs !== ""
                ? `<span class="mini-tag">
                    Mohs ${esc(g.mohs)}
                   </span>`
                : ""
            }
          </div>

        </button>
      `).join("")
      : `<div class="profile-empty">
           No gemstones found.
         </div>`;

    $("libraryGrid").querySelectorAll(
      "[data-open-gem]"
    ).forEach(el => {
      el.addEventListener("click", () =>
        openProfile(el.dataset.openGem)
      );
    });
  }

  /* ======================================
     GEM EDITOR
  ====================================== */

  function populateEditorOptions() {
    $("gemMineralRarity").innerHTML =
      optionsHTML(D.rarities);

    $("gemGemRarity").innerHTML =
      optionsHTML(D.rarities);

    $("gemMohs").innerHTML =
      optionsHTML(D.mohs.map(String));

    $("gemCrystal").innerHTML =
      optionsHTML(D.crystalSystems);

    $("gemTransparency").innerHTML =
      optionsHTML(D.transparencies);

    $("classificationChoices").innerHTML =
      D.classifications.map(c => `
        <label class="choice-chip">
          <input type="checkbox"
            value="${esc(c)}">
          <span>${esc(c)}</span>
        </label>
      `).join("");
  }

  function openGemEditor(id = null) {
    editingGem = id;

    const existing = id ? gem(id) : null;

    if (id && !existing) return;

    const g = existing || D.createGem();

    $("editorTitle").textContent =
      existing ? "Edit Gemstone" : "Create Gemstone";

    $("gemName").value = g.name;
    $("gemTitle").value = g.title;

    $("gemMineralRarity").value = g.mineralRarity;
    $("gemGemRarity").value = g.gemRarity;
    $("gemMohs").value =
      g.mohs === "" ? "" : String(g.mohs);

    $("gemCrystal").value = g.crystalSystem;
    $("gemColor").value = g.color;
    $("gemTransparency").value = g.transparency;
    $("gemAccent").value = g.accent;
    $("gemSymbol").value = g.symbol;
    $("gemNotes").value = g.notes;

    document.querySelectorAll(
      "#classificationChoices input"
    ).forEach(input => {
      input.checked =
        g.classifications.includes(input.value);
    });

    $("deleteGemBtn").classList.toggle(
      "hidden",
      !existing
    );

    openOnly("editorOverlay");
  }

  function saveGemForm(e) {
    e.preventDefault();

    const name = $("gemName").value.trim();

    if (!name) {
      toast("A gemstone name is required.");
      return;
    }

    const selectedClassifications = [
      ...document.querySelectorAll(
        "#classificationChoices input:checked"
      )
    ].map(i => i.value);

    let g = editingGem ? gem(editingGem) : null;

    if (editingGem && !g) {
      toast("Gemstone no longer exists.");
      return;
    }

    if (!g) {
      g = D.createGem();
      g.id = uid();

      // New gemstones appear near the currently visible
      // center of the canvas.

      const vp = $("atlasViewport");

      const world = screenToWorld({
        x: vp.clientWidth / 2,
        y: vp.clientHeight / 2
      });

      const offset = db.gems.length % 6;

      g.x = Math.round(world.x - NODE_W / 2 + offset * 25);
      g.y = Math.round(world.y - NODE_H / 2 + offset * 25);

      db.gems.push(g);
    }

    g.name = name;
    g.title = $("gemTitle").value.trim();
    g.classifications = selectedClassifications;
    g.mineralRarity = $("gemMineralRarity").value;
    g.gemRarity = $("gemGemRarity").value;

    g.mohs = $("gemMohs").value === ""
      ? ""
      : Number($("gemMohs").value);

    g.crystalSystem = $("gemCrystal").value;
    g.color = $("gemColor").value.trim();
    g.transparency = $("gemTransparency").value;
    g.accent = safeColor($("gemAccent").value);
    g.symbol = $("gemSymbol").value;
    g.notes = $("gemNotes").value.trim();
    g.updatedAt = Date.now();

    if (!save()) return;

    renderAtlas();
    renderLibrary();
    renderRelations();

    hide("editorOverlay");
    openProfile(g.id);

    toast("Gemstone saved.");
  }

  function deleteGem(id) {
    const g = gem(id);
    if (!g) return;

    confirmDialog(
      "Delete Gemstone?",
      `Delete "${g.name}" and all of its direct ` +
      "connections? This cannot be undone.",
      () => {
        db.gems = db.gems.filter(x => x.id !== id);

        db.connections = db.connections.filter(c =>
          c.a !== id && c.b !== id
        );

        save();
        closeOverlays();
        renderAll();
        toast("Gemstone deleted.");
      },
      "Delete Gem"
    );
  }

  /* ======================================
     RELATIONSHIP EDITOR
  ====================================== */

  function populateConnectionTypes() {
    $("connectionType").innerHTML =
      Object.entries(D.relationshipTypes)
        .map(([key, type]) => `
          <option value="${esc(key)}">
            ${esc(type.label)}
          </option>
        `).join("");
  }

  function openConnectionEditor(
    id = null,
    presetA = "",
    presetB = ""
  ) {
    if (db.gems.length < 2) {
      toast("Create at least two gemstones first.");
      return;
    }

    editingConnection = id;

    const c = id
      ? db.connections.find(x => x.id === id)
      : null;

    if (id && !c) return;

    $("connectionTitle").textContent =
      c ? "Edit Relationship" : "Create Relationship";

    $("connectionA").innerHTML =
      gemOptions(c?.a || presetA);

    $("connectionB").innerHTML =
      gemOptions(c?.b || presetB);

    $("connectionType").value =
      c?.type || "parent";

    $("connectionNotes").value =
      c?.notes || "";

    $("deleteConnectionBtn").classList.toggle(
      "hidden",
      !c
    );

    updateConnectionExplanation();

    openOnly("connectionOverlay");
  }

  function updateConnectionExplanation() {
    const type = $("connectionType").value;
    const definition = D.relationshipTypes[type];

    $("connectionExplanation").textContent =
      definition?.explanation || "";
  }

  function parentEdges(excludingId = null) {
    return db.connections.filter(c =>
      c.id !== excludingId &&
      (c.type === "parent" || c.type === "adoptive")
    );
  }

  function hasAncestralPath(start, target, excludingId = null) {
    const edges = parentEdges(excludingId);

    const stack = [start];
    const seen = new Set();

    while (stack.length) {
      const current = stack.pop();

      if (current === target) return true;
      if (seen.has(current)) continue;

      seen.add(current);

      for (const e of edges) {
        if (e.a === current && !seen.has(e.b)) {
          stack.push(e.b);
        }
      }
    }

    return false;
  }

  function saveConnectionForm(e) {
    e.preventDefault();

    const a = $("connectionA").value;
    const b = $("connectionB").value;
    const type = $("connectionType").value;
    const notes = $("connectionNotes").value.trim();

    if (!gem(a) || !gem(b)) {
      toast("Select two gemstones.");
      return;
    }

    if (a === b) {
      toast("A gemstone cannot connect to itself.");
      return;
    }

    if (!D.relationshipTypes[type]) {
      toast("Invalid relationship type.");
      return;
    }

    const directional =
      D.relationshipTypes[type].directional;

    const duplicate = db.connections.find(c => {
      if (c.id === editingConnection || c.type !== type) {
        return false;
      }

      if (directional) {
        return c.a === a && c.b === b;
      }

      return (
        (c.a === a && c.b === b) ||
        (c.a === b && c.b === a)
      );
    });

    if (duplicate) {
      toast("That direct connection already exists.");
      return;
    }

    if (type === "parent" || type === "adoptive") {
      if (hasAncestralPath(b, a, editingConnection)) {
        toast("This parent connection would create an ancestry cycle.");
        return;
      }
    }

    let c = editingConnection
      ? db.connections.find(x => x.id === editingConnection)
      : null;

    if (editingConnection && !c) {
      toast("Relationship no longer exists.");
      return;
    }

    if (!c) {
      c = {
        id: uid(),
        a,
        b,
        type,
        notes,
        createdAt: Date.now()
      };

      db.connections.push(c);

    } else {
      c.a = a;
      c.b = b;
      c.type = type;
      c.notes = notes;
    }

    if (!save()) return;

    renderAll();
    closeOverlays();

    toast("Relationship saved.");
  }

  function deleteConnection(id) {
    const c = db.connections.find(x => x.id === id);
    if (!c) return;

    confirmDialog(
      "Delete Connection?",
      "This removes the selected direct relationship. " +
      "Other family calculations will update automatically.",
      () => {
        db.connections = db.connections.filter(
          x => x.id !== id
        );

        save();
        closeOverlays();
        renderAll();
        toast("Connection deleted.");
      },
      "Delete Connection"
    );
  }

  /* ======================================
     GENEALOGY ENGINE
  ====================================== */

  function getParents(id) {
    return parentEdges()
      .filter(c => c.b === id)
      .map(c => c.a);
  }

  function getChildren(id) {
    return parentEdges()
      .filter(c => c.a === id)
      .map(c => c.b);
  }

  function ancestryMap(id) {
    // Map: ancestor ID -> shortest number of
    // generations between subject and ancestor.

    const result = new Map();
    const queue = [{ id, depth: 0 }];
    let head = 0;

    result.set(id, 0);

    while (head < queue.length) {
      const current = queue[head++];

      for (const parent of getParents(current.id)) {
        const nextDepth = current.depth + 1;
        const previous = result.get(parent);

        if (
          previous === undefined ||
          nextDepth < previous
        ) {
          result.set(parent, nextDepth);

          queue.push({
            id: parent,
            depth: nextDepth
          });
        }
      }
    }

    return result;
  }

  function ordinal(n) {
    const names = [
      "",
      "1st",
      "2nd",
      "3rd",
      "4th",
      "5th",
      "6th",
      "7th",
      "8th",
      "9th",
      "10th"
    ];

    if (names[n]) return names[n];

    const lastTwo = n % 100;
    const last = n % 10;

    let suffix = "th";

    if (lastTwo < 11 || lastTwo > 13) {
      if (last === 1) suffix = "st";
      if (last === 2) suffix = "nd";
      if (last === 3) suffix = "rd";
    }

    return `${n}${suffix}`;
  }

  function greatPrefix(count) {
    if (count <= 0) return "";

    if (count <= 3) {
      return "Great-".repeat(count);
    }

    return `${count}× Great-`;
  }

  function ancestorTerm(depth) {
    if (depth === 1) return "Parent";
    if (depth === 2) return "Grandparent";

    return greatPrefix(depth - 2) + "Grandparent";
  }

  function descendantTerm(depth) {
    if (depth === 1) return "Child";
    if (depth === 2) return "Grandchild";

    return greatPrefix(depth - 2) + "Grandchild";
  }

  function auntUncleTerm(greats) {
    if (greats <= 0) return "Aunt / Uncle";

    return greatPrefix(greats) + "Aunt / Uncle";
  }

  function nieceNephewTerm(greats) {
    if (greats <= 0) return "Niece / Nephew";

    return greatPrefix(greats) + "Niece / Nephew";
  }

  function explicitRelations(a, b) {
    const result = [];

    for (const c of db.connections) {
      const ab = c.a === a && c.b === b;
      const ba = c.a === b && c.b === a;

      if (!ab && !ba) continue;

      if (c.type === "parent") {
        result.push(ab ? "Parent" : "Child");
      }

      if (c.type === "adoptive") {
        result.push(ab ? "Adoptive Parent" : "Adoptive Child");
      }

      if (c.type === "sibling") {
        result.push("Sibling");
      }

      if (c.type === "partner") {
        result.push("Partner / Lover");
      }

      if (c.type === "guardian") {
        result.push(ab ? "Guardian" : "Ward");
      }

      if (c.type === "family") {
        result.push("Family Bound");
      }

      if (c.type === "associated") {
        result.push("Associated");
      }
    }

    return [...new Set(result)];
  }

  function relationship(a, b) {
    if (!gem(a) || !gem(b)) {
      return {
        name: "Unknown",
        description: "One of the gemstones does not exist.",
        connected: false
      };
    }

    if (a === b) {
      return {
        name: "Same Gemstone",
        description: "Both selections refer to the same gemstone.",
        connected: true
      };
    }

    const direct = explicitRelations(a, b);

    const aAnc = ancestryMap(a);
    const bAnc = ancestryMap(b);

    // Is B an ancestor of A?
    if (aAnc.has(b)) {
      const depth = aAnc.get(b);

      return {
        name: ancestorTerm(depth),
        description:
          `${gemName(b)} is ${depth} generation(s) ` +
          `above ${gemName(a)} in the family graph.`,
        connected: true,
        direct
      };
    }

    // Is A an ancestor of B?
    if (bAnc.has(a)) {
      const depth = bAnc.get(a);

      return {
        name: descendantTerm(depth),
        description:
          `${gemName(b)} is ${depth} generation(s) ` +
          `below ${gemName(a)} in the family graph.`,
        connected: true,
        direct
      };
    }

    // Find common ancestors and favor the nearest
    // genealogical route.

    const common = [];

    for (const [ancestor, depthA] of aAnc) {
      if (!bAnc.has(ancestor)) continue;

      const depthB = bAnc.get(ancestor);

      if (depthA === 0 || depthB === 0) {
        continue;
      }

      common.push({
        ancestor,
        depthA,
        depthB,
        total: depthA + depthB
      });
    }

    common.sort((x, y) =>
      x.total - y.total ||
      Math.max(x.depthA, x.depthB) -
      Math.max(y.depthA, y.depthB)
    );

    if (common.length) {
      const best = common[0];
      const m = best.depthA;
      const n = best.depthB;

      // Both one generation below common ancestor.
      if (m === 1 && n === 1) {
        const parentsA = new Set(getParents(a));
        const parentsB = new Set(getParents(b));

        const shared = [...parentsA].filter(id =>
          parentsB.has(id)
        );

        const name =
          shared.length >= 2
            ? "Sibling"
            : "Sibling / Half-Sibling";

        return {
          name,
          description:
            `${gemName(a)} and ${gemName(b)} ` +
            `share ${shared.length} recorded parent(s). ` +
            `The distinction between full and half ` +
            `siblings depends on complete parent records.`,
          connected: true,
          direct,
          ancestor: best.ancestor
        };
      }

      // One person is sibling of the other's ancestor.
      if (m === 1 && n >= 2) {
        const greats = n - 2;

        return {
          name: nieceNephewTerm(greats),
          description:
            `${gemName(b)} is ${n - 1} generation(s) ` +
            `below a shared ancestor's child in ` +
            `the genealogy.`,
          connected: true,
          direct,
          ancestor: best.ancestor
        };
      }

      if (n === 1 && m >= 2) {
        const greats = m - 2;

        return {
          name: auntUncleTerm(greats),
          description:
            `${gemName(b)} belongs to an older ` +
            `collateral branch of ${gemName(a)}'s family.`,
          connected: true,
          direct,
          ancestor: best.ancestor
        };
      }

      // Cousins.
      if (m >= 2 && n >= 2) {
        const degree = Math.min(m, n) - 1;
        const removed = Math.abs(m - n);

        let name = `${ordinal(degree)} Cousin`;

        if (removed === 1) {
          name += " Once Removed";
        } else if (removed === 2) {
          name += " Twice Removed";
        } else if (removed === 3) {
          name += " Three Times Removed";
        } else if (removed > 3) {
          name += ` ${removed} Times Removed`;
        }

        return {
          name,
          description:
            `${gemName(a)} and ${gemName(b)} ` +
            `share the ancestor ${gemName(best.ancestor)}. ` +
            `Their nearest recorded distances from that ` +
            `ancestor are ${m} and ${n} generations.`,
          connected: true,
          direct,
          ancestor: best.ancestor
        };
      }
    }

    // No ancestry result: use direct non-genealogical
    // relationships.

    if (direct.length) {
      return {
        name: direct.join(" · "),
        description:
          "These gemstones have a manually defined " +
          "connection, without a calculated ancestral path.",
        connected: true,
        direct
      };
    }

    // Look for an indirect association path.
    const indirect = shortestConnectionPath(a, b);

    if (indirect) {
      return {
        name: "Indirectly Connected",
        description:
          `A network path of ${indirect.length - 1} ` +
          `connection(s) exists, but no specific family ` +
          `relationship can be inferred from it.`,
        connected: true,
        path: indirect
      };
    }

    return {
      name: "No Known Relationship",
      description:
        "These gemstones have no known family or " +
        "association path in the current atlas.",
      connected: false
    };
  }

  function shortestConnectionPath(a, b) {
    const queue = [[a]];
    const seen = new Set([a]);
    let head = 0;

    while (head < queue.length) {
      const path = queue[head++];

      const current = path[path.length - 1];

      if (current === b) return path;

      for (const c of db.connections) {
        let next = null;

        if (c.a === current) next = c.b;
        if (c.b === current) next = c.a;

        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push([...path, next]);
        }
      }
    }

    return null;
  }

  function relatedGems(id) {
    const result = [];

    for (const g of db.gems) {
      if (g.id === id) continue;

      const rel = relationship(id, g.id);

      if (rel.connected) {
        result.push({
          id: g.id,
          name: g.name,
          relation: rel.name
        });
      }
    }

    const priority = name => {
      if (/^Parent$|^Child$/.test(name)) return 0;
      if (/^Adoptive/.test(name)) return 1;
      if (/Sibling/.test(name)) return 2;
      if (/Partner/.test(name)) return 3;
      if (/Grand/.test(name)) return 4;
      if (/Great/.test(name)) return 5;
      if (/Cousin/.test(name)) return 6;
      if (/Aunt|Uncle|Niece|Nephew/.test(name)) return 7;
      return 8;
    };

    result.sort((a, b) =>
      priority(a.relation) - priority(b.relation) ||
      a.name.localeCompare(b.name)
    );

    return result;
  }

  /* ======================================
     GEM PROFILE
  ====================================== */

  function profileField(label, value) {
    return `
      <div class="profile-field">
        <div class="profile-label">${esc(label)}</div>
        <div class="profile-value">${metadata(value)}</div>
      </div>
    `;
  }

  function openProfile(id) {
    const g = gem(id);
    if (!g) return;

    profileGem = id;

    const relatives = relatedGems(id);

    const relationHTML = relatives.length
      ? relatives.map(r => `
          <button class="profile-relation"
            data-relative="${esc(r.id)}">

            <span class="profile-relation-type">
              ${esc(r.relation)}
            </span>

            <span class="profile-relation-name">
              ${esc(r.name)} ↗
            </span>
          </button>
        `).join("")
      : `<div class="profile-empty">
           No relationships recorded yet.
         </div>`;

    $("profileContent").innerHTML = `
      <div class="profile-hero">

        <div class="profile-gem"
          style="--gem-color:${safeColor(g.accent)}">
          ${esc(g.symbol)}
        </div>

        <div>
          <div class="eyebrow">GEMSTONE PROFILE</div>

          <div class="profile-name">
            ${esc(g.name)}
          </div>

          ${
            g.title
              ? `<div class="profile-title">
                  ${esc(g.title)}
                 </div>`
              : ""
          }
        </div>

      </div>

      <div class="profile-divider"></div>

      <div class="profile-grid">
        ${profileField(
          "Classification",
          classificationText(g)
        )}

        ${profileField(
          "Mineral Rarity",
          g.mineralRarity
        )}
      </div>

      <div class="profile-divider"></div>

      <div class="profile-grid">
        ${profileField(
          "Mohs",
          g.mohs
        )}

        ${profileField(
          "Crystal System",
          g.crystalSystem
        )}

        ${profileField(
          "Color",
          g.color
        )}

        ${profileField(
          "Transparency",
          g.transparency
        )}
      </div>

      <div class="profile-divider"></div>

      <div class="profile-grid">
        ${profileField(
          "Gem Rarity",
          g.gemRarity
        )}

        ${profileField(
          "Direct Connections",
          db.connections.filter(c =>
            c.a === id || c.b === id
          ).length
        )}
      </div>

      <div class="profile-divider"></div>

      <div class="profile-section-title">
        Genealogical Relationships
      </div>

      <div class="profile-relations">
        ${relationHTML}
      </div>

      ${
        g.notes
          ? `
            <div class="profile-section-title">
              Personal Notes
            </div>

            <div class="profile-notes">
              ${esc(g.notes)}
            </div>
          `
          : ""
      }

      <div class="profile-actions">

        <button class="primary-btn"
          id="profileEditBtn">
          ✎ Edit Gem
        </button>

        <button class="secondary-btn"
          id="profileConnectBtn">
          ⤳ Connect
        </button>

        <button class="secondary-btn"
          id="profileFocusBtn">
          ◇ Locate
        </button>

      </div>
    `;

    $("profileEditBtn").onclick = () =>
      openGemEditor(id);

    $("profileConnectBtn").onclick = () =>
      openConnectionEditor(null, id);

    $("profileFocusBtn").onclick = () =>
      focusGem(id, true);

    document.querySelectorAll(
      "[data-relative]"
    ).forEach(button => {
      button.addEventListener("click", () => {
        openProfile(button.dataset.relative);
      });
    });

    openOnly("profileOverlay");
  }

  /* ======================================
     RELATION DIRECTORY
  ====================================== */

  function renderRelations() {
    const genealogical = parentEdges().length;

    $("relationStats").innerHTML = `
      <div class="stat-card">
        <div class="stat-number">
          ${db.gems.length}
        </div>
        <div class="stat-label">Gems</div>
      </div>

      <div class="stat-card">
        <div class="stat-number">
          ${db.connections.length}
        </div>
        <div class="stat-label">Connections</div>
      </div>

      <div class="stat-card">
        <div class="stat-number">
          ${genealogical}
        </div>
        <div class="stat-label">Parent Links</div>
      </div>
    `;

    const oldA = $("calculateA").value;
    const oldB = $("calculateB").value;

    $("calculateA").innerHTML = gemOptions(oldA);
    $("calculateB").innerHTML = gemOptions(oldB);

    $("relationList").innerHTML =
      db.connections.length
        ? db.connections.map(c => {
            const def = D.relationshipTypes[c.type];

            return `
              <button class="relation-row"
                data-connection="${esc(c.id)}">

                <span class="relation-row-symbol">
                  ${esc(def.symbol)}
                </span>

                <span class="relation-row-main">
                  <div class="relation-row-name">
                    ${esc(gemName(c.a))}
                    ${def.directional ? "→" : "↔"}
                    ${esc(gemName(c.b))}
                  </div>

                  <div class="relation-row-type">
                    ${esc(def.label)}
                  </div>
                </span>

                <span class="relation-row-arrow">›</span>
              </button>
            `;
          }).join("")
        : `<div class="profile-empty">
             No connections yet.
           </div>`;

    document.querySelectorAll(
      "[data-connection]"
    ).forEach(el => {
      el.addEventListener("click", () =>
        openConnectionEditor(el.dataset.connection)
      );
    });
  }

  function calculateSelected() {
    const a = $("calculateA").value;
    const b = $("calculateB").value;

    if (!a || !b) {
      toast("Select two gemstones first.");
      return;
    }

    const rel = relationship(a, b);

    // Results are expressed as:
    // How is gemstone B related to gemstone A?

    $("calculationResult").innerHTML = `
      <div class="result-title">
        ${esc(rel.name)}
      </div>

      <div class="result-description">
        <strong>${esc(gemName(b))}</strong>
        relative to
        <strong>${esc(gemName(a))}</strong>.
        <br><br>
        ${esc(rel.description)}
      </div>
    `;

    show("calculationResult");
  }

  /* ======================================
     GLOBAL SEARCH
  ====================================== */

  function openSearch() {
    openOnly("searchOverlay");
    $("globalSearch").value = "";
    renderSearch();

    setTimeout(() => $("globalSearch").focus(), 50);
  }

  function renderSearch() {
    const query =
      $("globalSearch").value.trim().toLowerCase();

    const results = [...db.gems]
      .filter(g => (
        g.name + " " +
        g.title + " " +
        g.color + " " +
        classificationText(g)
      ).toLowerCase().includes(query))
      .sort(sortNames)
      .slice(0, 100);

    $("searchResults").innerHTML = results.length
      ? results.map(g => `
          <button class="search-result"
            data-search-gem="${esc(g.id)}">

            <span class="search-result-symbol"
              style="color:${safeColor(g.accent)}">
              ${esc(g.symbol)}
            </span>

            <span>
              <div class="search-result-title">
                ${esc(g.name)}
              </div>

              <div class="search-result-sub">
                ${esc(g.title || classificationText(g))}
              </div>
            </span>

          </button>
        `).join("")
      : `<div class="profile-empty">
           No gemstones found.
         </div>`;

    document.querySelectorAll(
      "[data-search-gem]"
    ).forEach(el => {
      el.addEventListener("click", () => {
        openProfile(el.dataset.searchGem);
      });
    });
  }

  /* ======================================
     SETTINGS
  ====================================== */

  function syncSettings() {
    for (const key of Object.keys(D.defaultSettings)) {
      const input = $(key);

      if (input) {
        input.checked = Boolean(db.settings[key]);
      }
    }
  }

  function exportData() {
    save();

    const blob = new Blob(
      [JSON.stringify(db, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;

    const date = new Date()
      .toISOString()
      .slice(0, 10);

    anchor.download =
      `gem-family-atlas-${date}.json`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast("Backup export started.");
  }

  async function importData(file) {
    if (!file) return;

    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error("File exceeds 20 MB");
      }

      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = normalizeDatabase(parsed);

      confirmDialog(
        "Import Library?",
        "Importing will replace the current collection. " +
        "Export your existing collection first if needed.",
        () => {
          const previous = db;
          db = imported;

          if (!save()) {
            db = previous;
            return;
          }

          initializedCamera = false;
          closeOverlays();
          switchView("atlas");
          fitAtlas();
          renderAll();
          toast("Library imported.");
        },
        "Replace Library"
      );

    } catch (err) {
      console.error(err);
      toast("Import failed: invalid JSON library.");
    }

    $("importFile").value = "";
  }

  function resetLibrary() {
    confirmDialog(
      "Reset Entire Library?",
      "This permanently removes all gemstones and " +
      "connections from this browser. Export a backup first.",
      () => {
        db = D.createEmpty();

        if (!save()) return;

        initializedCamera = false;
        closeOverlays();
        renderAll();
        switchView("atlas");

        toast("Library reset.");
      },
      "Reset Library"
    );
  }

  /* ======================================
     GENERAL RENDER
  ====================================== */

  function renderAll() {
    renderAtlas();
    renderLibrary();
    renderRelations();
    syncSettings();
  }

  /* ======================================
     EVENT BINDING
  ====================================== */

  function bindEvents() {

    // Navigation

    document.querySelectorAll(".nav-item").forEach(b => {
      b.addEventListener("click", () =>
        switchView(b.dataset.view)
      );
    });

    // Atlas toolbar

    document.querySelectorAll(".mode-btn").forEach(b => {
      b.addEventListener("click", () => {
        mode = b.dataset.mode;
        renderAtlas();

        toast(
          mode === "arrange"
            ? "Arrange mode: drag gemstone cards."
            : "Explore mode: tap cards to open."
        );
      });
    });

    $("fitBtn").onclick = fitAtlas;
    $("zoomInBtn").onclick = () => zoomBy(1.2);
    $("zoomOutBtn").onclick = () => zoomBy(1 / 1.2);

    $("addGemBtn").onclick = () => openGemEditor();
    $("emptyAddBtn").onclick = () => openGemEditor();
    $("libraryAddBtn").onclick = () => openGemEditor();

    $("connectBtn").onclick = () =>
      openConnectionEditor();

    // Library

    $("librarySearch").addEventListener(
      "input",
      renderLibrary
    );

    $("librarySort").addEventListener(
      "change",
      renderLibrary
    );

    // Relation editor

    $("relationsAddBtn").onclick = () =>
      openConnectionEditor();

    $("connectionType").onchange =
      updateConnectionExplanation;

    $("connectionForm").addEventListener(
      "submit",
      saveConnectionForm
    );

    $("closeConnection").onclick = closeOverlays;
    $("cancelConnectionBtn").onclick = closeOverlays;

    $("deleteConnectionBtn").onclick = () => {
      if (editingConnection) {
        deleteConnection(editingConnection);
      }
    };

    // Gem editor

    $("gemForm").addEventListener(
      "submit",
      saveGemForm
    );

    $("closeEditor").onclick = closeOverlays;
    $("cancelGemBtn").onclick = closeOverlays;
    $("closeProfile").onclick = closeOverlays;

    $("deleteGemBtn").onclick = () => {
      if (editingGem) deleteGem(editingGem);
    };

    // Calculator

    $("calculateBtn").onclick = calculateSelected;

    $("calculateA").onchange = () =>
      hide("calculationResult");

    $("calculateB").onchange = () =>
      hide("calculationResult");

    // Search

    $("searchBtn").onclick = openSearch;
    $("closeSearch").onclick = closeOverlays;

    $("globalSearch").addEventListener(
      "input",
      renderSearch
    );

    // Settings

    $("settingsBtn").onclick = () =>
      switchView("settings");

    for (const key of Object.keys(D.defaultSettings)) {
      const input = $(key);

      if (!input) continue;

      input.addEventListener("change", () => {
        db.settings[key] = input.checked;
        save();
        renderAtlas();
      });
    }

    $("exportBtn").onclick = exportData;

    $("importBtn").onclick = () =>
      $("importFile").click();

    $("importFile").addEventListener(
      "change",
      e => importData(e.target.files[0])
    );

    $("resetBtn").onclick = resetLibrary;

    // Confirmation

    $("confirmCancel").onclick = closeOverlays;

    $("confirmAccept").onclick = () => {
      const action = confirmAction;
      confirmAction = null;

      if (typeof action === "function") {
        action();
      }
    };

    // Close on backdrop tap

    document.querySelectorAll(".overlay").forEach(o => {
      o.addEventListener("click", e => {
        if (e.target !== o) return;

        // Confirmation requires explicit choice.
        if (o.id === "confirmOverlay") return;

        closeOverlays();
      });
    });

    // Escape

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeOverlays();
      }
    });

    // Resize

    window.addEventListener("resize", () => {
      if (activeView === "atlas") {
        updateWorld();
      }
    });

    initializeCanvasEvents();
  }

  /* ======================================
     INITIALIZATION
  ====================================== */

  function init() {
    try {
      db = load();

      populateEditorOptions();
      populateConnectionTypes();

      bindEvents();
      renderAll();
      switchView("atlas");

      console.info(
        "Gem Family Atlas initialized.",
        db.gems.length,
        "gems."
      );

    } catch (err) {
      console.error("Atlas initialization failed:", err);
      alert(
        "The Gem Atlas could not initialize. " +
        "Check that data.js loads before app.js."
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
