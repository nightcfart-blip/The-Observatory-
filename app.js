
"use strict";

/* ==========================================================
   WATCH ARCHIVE — STEP 4.2
   THE CELESTIAL POPUP ENGINE

   Single continuous universe
   Fixed holographic detail popups
   Group / Production / Season / Episode
   No full-popup scrolling
   Scrollable child collections only
   Editable four-level hierarchy
   Manual genres and secondary tags
   Phone-gallery banner uploads
   IndexedDB image storage
   Portable JSON backups with images
========================================================== */

(() => {
  const D = window.WATCH_DATA;

  if (!D) {
    console.error("Watch Archive: data.js was not loaded.");
    return;
  }

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  function smooth(a, b, n) {
    if (b <= a) return n >= b ? 1 : 0;
    const t = clamp((n - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function hash(value) {
    let result = 2166136261;

    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }

    return result >>> 0;
  }

  function random(seed) {
    let t = seed + 0x6D2B79F5;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function newID() {
    if (window.crypto?.randomUUID) {
      return crypto.randomUUID();
    }

    return "wa-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 12);
  }

  function titleOf(item) {
    return String(item?.title || item?.name || "Untitled");
  }

  function numeric(value, fallback, min, max) {
    if (value == null || value === "") return fallback;

    const n = Number(value);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  }

  function timeOf(value) {
    if (!value) return 0;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  const TYPES = [
    "group",
    "production",
    "season",
    "episode"
  ];

  const COLLECTION = {
    group: "groups",
    production: "productions",
    season: "seasons",
    episode: "episodes"
  };

  const NEXT = {
    group: "production",
    production: "season",
    season: "episode"
  };

  const PREVIOUS = {
    production: "group",
    season: "production",
    episode: "season"
  };

  const PARENT_KEY = {
    production: "groupId",
    season: "productionId",
    episode: "seasonId"
  };

  const viewport = $("#viewport");
  const starLayer = $("#starLayer");

  const mapCanvas = $("#constellationCanvas");
  const backgroundCanvas = $("#backgroundStars");
  const nebulaCanvas = $("#nebulaCanvas");

  const mapCtx = mapCanvas.getContext("2d");
  const backgroundCtx = backgroundCanvas.getContext("2d");
  const nebulaCtx = nebulaCanvas.getContext("2d");

  const popupOverlay = $("#popupOverlay");
  const popup = $("#archivePopup");

  const editorOverlay = $("#editorOverlay");
  const detailOverlay = $("#detailOverlay");
  const searchOverlay = $("#searchOverlay");
  const confirmOverlay = $("#confirmOverlay");

  const otherOverlays = [
    editorOverlay,
    detailOverlay,
    searchOverlay
  ];

  const reducedMedia = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let state = loadState();

  let width = innerWidth;
  let height = innerHeight;

  let nodes = [];
  let edges = [];
  let nodeMap = new Map();

  let focusedID = null;
  let highlightedID = null;

  const camera = {
    x: 0,
    y: 0,
    zoom: 1
  };

  let cameraTravel = null;

  let running = false;
  let animationHandle = 0;
  let lastFrame = 0;

  let backgroundStars = [];
  let nebulaTexture = null;

  const pointers = new Map();
  let gesture = null;
  let ignoreClickUntil = 0;

  let activeOverlay = null;
  let returnFocus = null;

  let currentPopup = null;
  let popupHistory = [];
  let popupRenderToken = 0;

  let editorReturn = null;
  let editorContext = null;

  let pendingBanner = null;
  let pendingBannerURL = null;
  let galleryToken = 0;

  let confirmationCallback = null;
  let confirmationFocus = null;

  let toastTimer = null;

  let activeCollection = "library";
  let collectionSearch = "";
  let collectionSort = "alphabetical";
  let collectionGenre = "";
  let collectionFormat = "";

  /* ======================================================
     1. LOCAL STATE
  ====================================================== */

  function initialState() {
    const now = new Date().toISOString();

    return {
      schemaVersion: D.schemaVersion,
      createdAt: now,
      updatedAt: now,
      settings: clone(D.defaults.settings),
      archive: clone(D.defaults.archive)
    };
  }

  function normalizeState(value) {
    const base = initialState();
    const input = value && typeof value === "object"
      ? value : {};

    const sourceArchive = input.archive || {};
    const sourceSettings = input.settings || {};

    const archive = { ...sourceArchive };

    for (const type of TYPES) {
      const key = COLLECTION[type];

      archive[key] = Array.isArray(sourceArchive[key])
        ? sourceArchive[key] : [];
    }

    archive.genres = Array.isArray(sourceArchive.genres)
      ? sourceArchive.genres : [];

    archive.secondaryGenres = Array.isArray(
      sourceArchive.secondaryGenres
    ) ? sourceArchive.secondaryGenres : [];

    return {
      ...base,
      ...input,

      schemaVersion: D.schemaVersion,

      settings: {
        ...base.settings,
        ...sourceSettings,

        starDensity: numeric(
          sourceSettings.starDensity, 75, 10, 100
        ),

        starBrightness: numeric(
          sourceSettings.starBrightness, 60, 10, 100
        ),

        nebulaIntensity: numeric(
          sourceSettings.nebulaIntensity, 68, 0, 100
        ),

        constellationGlow: numeric(
          sourceSettings.constellationGlow, 68, 0, 100
        ),

        reduceMotion:
          sourceSettings.reduceMotion === true
      },

      archive
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(D.storageKey);

      if (!raw) return initialState();

      const parsed = JSON.parse(raw);

      if (parsed.schemaVersion !== D.schemaVersion) {
        console.warn("Unsupported archive schema.");
        return initialState();
      }

      return normalizeState(parsed);

    } catch (error) {
      console.error("Archive load failed:", error);
      return initialState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(
        D.storageKey,
        JSON.stringify(state)
      );

      return true;

    } catch (error) {
      console.error("Archive save failed:", error);
      notify("Saving failed. Check browser storage.");
      return false;
    }
  }

  function commit(message) {
    if (!saveState()) return false;

    rebuildUniverse();

    if (message) notify(message);

    return true;
  }

  function motionReduced() {
    return state.settings.reduceMotion ||
      reducedMedia.matches;
  }

  function applyMotion() {
    document.body.classList.toggle(
      "reduce-motion",
      motionReduced()
    );
  }

  function notify(message) {
    const el = $("#toast");

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 3000);
  }

  /* ======================================================
     2. RECORDS, PARENTS AND CHILDREN
  ====================================================== */

  function records(type) {
    return state.archive[COLLECTION[type]];
  }

  function record(type, recordID) {
    return records(type).find(item =>
      String(item.id) === String(recordID)
    ) || null;
  }

  function recordParentID(type, item) {
    if (type === "group") return null;

    return item[PARENT_KEY[type]] ??
      item.parentId ??
      null;
  }

  function realChildren(type, recordID) {
    const nextType = NEXT[type];

    if (!nextType) return [];

    return records(nextType)
      .filter(item =>
        String(recordParentID(nextType, item) ?? "") ===
        String(recordID)
      )
      .sort((a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        titleOf(a).localeCompare(titleOf(b))
      );
  }

  function nextOrder(type, parentID = null) {
    const siblings = records(type).filter(item =>
      String(recordParentID(type, item) ?? "") ===
      String(parentID ?? "")
    );

    return Math.max(
      -1,
      ...siblings.map(item => Number(item.order) || 0)
    ) + 1;
  }

  function resolveEntry(type, recordID) {
    const real = record(type, recordID);

    if (real) {
      return {
        item: real,
        demo: false
      };
    }

    const node = nodeMap.get(String(recordID));

    if (node && node.type === type && node.demo) {
      return {
        item: node.record,
        demo: true
      };
    }

    return null;
  }

  function entryChildren(type, item, demo) {
    return demo
      ? (Array.isArray(item.children) ? item.children : [])
      : realChildren(type, item.id);
  }

  /* ======================================================
     3. MANUAL GENRES
  ====================================================== */

  function genreRecords(type) {
    return type === "secondary"
      ? state.archive.secondaryGenres
      : state.archive.genres;
  }

  function genreNames(ids, type) {
    if (!Array.isArray(ids)) return [];

    return ids.map(id => {
      return genreRecords(type).find(
        item => item.id === id
      )?.name;
    }).filter(Boolean);
  }

  function createGenre(type, name) {
    const clean = String(name || "").trim();
    if (!clean) return notify("Enter a genre name.");

    const list = genreRecords(type);

    if (list.some(item =>
      item.name.toLowerCase() === clean.toLowerCase()
    )) {
      notify("This genre already exists.");
      return;
    }

    list.push({
      id: newID(),
      name: clean,
      createdAt: new Date().toISOString()
    });

    if (commit("Genre created.")) openGenres();
  }

  function renameGenre(type, genreID) {
    const item = genreRecords(type).find(
      genre => genre.id === genreID
    );

    if (!item) return;

    const newName = prompt("Rename genre:", item.name);

    if (newName === null) return;

    const clean = newName.trim();

    if (!clean) {
      notify("The name cannot be empty.");
      return;
    }

    if (genreRecords(type).some(genre =>
      genre.id !== genreID &&
      genre.name.toLowerCase() === clean.toLowerCase()
    )) {
      notify("That name already exists.");
      return;
    }

    item.name = clean;

    if (commit("Genre renamed.")) openGenres();
  }

  function deleteGenre(type, genreID) {
    const list = genreRecords(type);
    const index = list.findIndex(
      genre => genre.id === genreID
    );

    if (index < 0) return;

    list.splice(index, 1);

    const field = type === "main"
      ? "mainGenreIds"
      : "secondaryGenreIds";

    for (const entityType of ["group", "production"]) {
      for (const item of records(entityType)) {
        if (Array.isArray(item[field])) {
          item[field] = item[field].filter(
            id => id !== genreID
          );
        }
      }
    }

    if (commit("Genre deleted.")) openGenres();
  }

  /* ======================================================
     4. IMAGE STORAGE — INDEXEDDB
  ====================================================== */

  let imageDatabasePromise = null;

  const imageURLCache = new Map();

  function openImageDatabase() {
    if (!imageDatabasePromise) {
      imageDatabasePromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("Image storage unavailable."));
          return;
        }

        const request = indexedDB.open(
          D.images.databaseName,
          D.images.databaseVersion
        );

        request.onupgradeneeded = () => {
          const db = request.result;

          if (!db.objectStoreNames.contains(
            D.images.objectStore
          )) {
            db.createObjectStore(D.images.objectStore);
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch(error => {
        imageDatabasePromise = null;
        throw error;
      });
    }

    return imageDatabasePromise;
  }

  async function getImage(key) {
    if (!key) return null;

    const db = await openImageDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        D.images.objectStore,
        "readonly"
      );

      const request = tx.objectStore(
        D.images.objectStore
      ).get(key);

      request.onsuccess = () =>
        resolve(request.result || null);

      request.onerror = () =>
        reject(request.error);
    });
  }

  async function putImage(key, blob) {
    const db = await openImageDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        D.images.objectStore,
        "readwrite"
      );

      tx.objectStore(D.images.objectStore).put(
        blob,
        key
      );

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function removeImage(key) {
    if (!key) return;

    const db = await openImageDatabase();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(
        D.images.objectStore,
        "readwrite"
      );

      tx.objectStore(D.images.objectStore).delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (imageURLCache.has(key)) {
      URL.revokeObjectURL(imageURLCache.get(key));
      imageURLCache.delete(key);
    }
  }

  async function imageURL(key) {
    if (!key) return "";

    if (imageURLCache.has(key)) {
      return imageURLCache.get(key);
    }

    const blob = await getImage(key);

    if (!blob) return "";

    const url = URL.createObjectURL(blob);

    imageURLCache.set(key, url);

    return url;
  }

  async function bannerURL(item) {
    if (item?.bannerImageId) {
      try {
        const url = await imageURL(item.bannerImageId);
        if (url) return url;
      } catch (error) {
        console.warn("Banner could not be loaded:", error);
      }
    }

    return item?.banner || "";
  }

  async function compressImage(file) {
    if (file.size >
        D.images.maximumInputMB * 1024 * 1024) {
      throw new Error("That image is too large.");
    }

    if (!file.type.startsWith("image/") &&
        !/\.(heic|heif|avif)$/i.test(file.name)) {
      throw new Error("Select a picture from your gallery.");
    }

    let bitmap = null;
    let image = null;
    let sourceURL = null;

    try {
      if ("createImageBitmap" in window) {
        try {
          bitmap = await createImageBitmap(file);
        } catch (_) {
          // Some phones need the HTML image fallback.
        }
      }

      if (bitmap) {
        image = bitmap;
      } else {
        sourceURL = URL.createObjectURL(file);

        image = await new Promise((resolve, reject) => {
          const img = new Image();

          img.onload = () => resolve(img);
          img.onerror = () => reject(
            new Error("This image cannot be opened.")
          );

          img.src = sourceURL;
        });
      }

      const ratio = Math.min(
        1,
        D.images.maximumWidth / image.width,
        D.images.maximumHeight / image.height
      );

      const canvas = document.createElement("canvas");

      canvas.width = Math.max(
        1,
        Math.round(image.width * ratio)
      );

      canvas.height = Math.max(
        1,
        Math.round(image.height * ratio)
      );

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Image conversion unavailable.");
      }

      context.fillStyle = "#02040b";
      context.fillRect(
        0, 0, canvas.width, canvas.height
      );

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      context.drawImage(
        image,
        0, 0,
        canvas.width,
        canvas.height
      );

      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          blob => blob
            ? resolve(blob)
            : reject(new Error("Could not compress image.")),
          D.images.preferredFormat,
          D.images.quality
        );
      });

    } finally {
      bitmap?.close?.();

      if (sourceURL) {
        URL.revokeObjectURL(sourceURL);
      }
    }
  }

  function revokePendingBanner() {
    galleryToken++;

    if (pendingBannerURL) {
      URL.revokeObjectURL(pendingBannerURL);
    }

    pendingBannerURL = null;
    pendingBanner = null;
  }

  async function removeOrphanImages() {
    const keep = new Set();

    for (const type of ["group", "production"]) {
      for (const item of records(type)) {
        if (item.bannerImageId) {
          keep.add(item.bannerImageId);
        }
      }
    }

    const db = await openImageDatabase();

    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(
        D.images.objectStore,
        "readonly"
      );

      const request = tx.objectStore(
        D.images.objectStore
      ).getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    for (const key of keys) {
      if (!keep.has(key)) {
        await removeImage(key);
      }
    }
  }

  /* ======================================================
     5. EDITABLE RECORD OPERATIONS
  ====================================================== */

  function validParent(type, values) {
    if (type === "group") return true;

    const parent = values[PARENT_KEY[type]];

    if (type === "production" && !parent) {
      return true;
    }

    return !!record(PREVIOUS[type], parent);
  }

  function createRecord(type, values) {
    const name = String(values.title || "").trim();

    if (!name) {
      notify("Please enter a title.");
      return null;
    }

    if (!validParent(type, values)) {
      notify("Please select a valid parent.");
      return null;
    }

    const now = new Date().toISOString();

    const item = {
      id: newID(),
      title: name,
      notes: "",
      createdAt: now,
      updatedAt: now,
      ...values,
      title: name,
      order: nextOrder(
        type,
        values[PARENT_KEY[type]] || null
      )
    };

    if (type === "group" || type === "production") {
      item.mainGenreIds = values.mainGenreIds || [];
      item.secondaryGenreIds =
        values.secondaryGenreIds || [];
    }

    if (type === "production") {
      item.groupId = values.groupId || null;
      item.watchlist = values.watchlist === true;
    }

    records(type).push(item);

    if (!commit("Entry created.")) {
      records(type).pop();
      return null;
    }

    return item;
  }

  function updateRecord(type, recordID, values) {
    const item = record(type, recordID);

    if (!item) return false;

    if (!String(values.title || "").trim()) {
      notify("A title is required.");
      return false;
    }

    if (!validParent(type, values)) {
      notify("Invalid parent selected.");
      return false;
    }

    const before = clone(item);
    const pkey = PARENT_KEY[type];

    if (pkey &&
        String(item[pkey] || "") !==
        String(values[pkey] || "")) {
      values.order = nextOrder(
        type,
        values[pkey] || null
      );

      delete item.mapX;
      delete item.mapY;
    }

    Object.assign(item, values, {
      id: before.id,
      createdAt: before.createdAt,
      updatedAt: new Date().toISOString()
    });

    if (!commit("Changes saved.")) {
      for (const key of Object.keys(item)) {
        delete item[key];
      }

      Object.assign(item, before);

      return false;
    }

    return true;
  }

  function deleteRecordTree(type, recordID) {
    for (const child of realChildren(type, recordID)) {
      deleteRecordTree(NEXT[type], child.id);
    }

    const list = records(type);
    const index = list.findIndex(
      item => item.id === recordID
    );

    if (index >= 0) {
      list.splice(index, 1);
    }
  }

  async function deleteRecord(type, recordID) {
    deleteRecordTree(type, recordID);

    commit("Entry deleted.");

    if (currentPopup &&
        !resolveEntry(currentPopup.type, currentPopup.id)) {
      closePopup();
    }

    try {
      await removeOrphanImages();
    } catch (error) {
      console.warn("Image cleanup deferred:", error);
    }
  }

  function reorderRecord(type, recordID, direction) {
    const item = record(type, recordID);
    if (!item) return;

    const pid = recordParentID(type, item);

    const siblings = records(type)
      .filter(other =>
        String(recordParentID(type, other) || "") ===
        String(pid || "")
      )
      .sort((a, b) =>
        (a.order ?? 0) - (b.order ?? 0)
      );

    const index = siblings.findIndex(
      other => other.id === recordID
    );

    const target = index + direction;

    if (target < 0 || target >= siblings.length) {
      return;
    }

    [siblings[index], siblings[target]] =
      [siblings[target], siblings[index]];

    siblings.forEach((other, i) => {
      other.order = i;
    });

    commit("Order updated.");
  }

  /* ======================================================
     6. CONSTELLATION GRAPH
  ====================================================== */

  function starAppearance(key) {
    const seed = hash(key);
    const temperature = random(seed + 18);

    return {
      color:
        temperature < .12 ? [255, 225, 208] :
        temperature < .41 ? [230, 236, 255] :
        temperature < .83 ? [185, 207, 255] :
        [220, 201, 255],

      size: .70 + random(seed + 7) * .88,
      halo: .58 + random(seed + 8) * 1.28,
      alpha: .67 + random(seed + 9) * .33,

      spikes: random(seed + 10) > .59,
      angle: random(seed + 11) * Math.PI,
      spikeLength: .6 + random(seed + 12) * 1.15,

      speed: .00017 + random(seed + 13) * .00052,
      phase: random(seed + 14) * Math.PI * 2,

      oval: .84 + random(seed + 15) * .33
    };
  }

  function makeNode(item, type, x, y, options = {}) {
    return {
      id: String(item.id),
      title: titleOf(item),
      record: item,
      type,
      x,
      y,

      parentId: options.parentId || null,
      demo: options.demo === true,
      standalone: options.standalone === true,
      action: options.action || null,

      appearance: starAppearance(item.id),

      sx: -9999,
      sy: -9999,
      visible: 0,
      button: null
    };
  }

  function addNode(node) {
    if (nodeMap.has(node.id)) return;

    nodeMap.set(node.id, node);
    nodes.push(node);
  }

  function groupPosition(item, index) {
    if (item.mapX != null && item.mapY != null) {
      return {
        x: Number(item.mapX),
        y: Number(item.mapY)
      };
    }

    if (item.x != null && item.y != null) {
      return {
        x: Number(item.x),
        y: Number(item.y)
      };
    }

    const angle =
      D.groupPlacement.angleOffset +
      index * 2.39996323 +
      (random(hash(item.id) + 5) - .5) * .38;

    const distance =
      D.groupPlacement.initialRadius +
      Math.sqrt(index) *
      D.groupPlacement.distanceGrowth;

    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance
    };
  }

  function childPosition(item, index, count, type) {
    const radius = {
      production: 215,
      season: 102,
      episode: 44
    }[type] || 140;

    const ring = Math.floor(index / 9);
    const ringIndex = index % 9;

    const ringCount = Math.min(
      9,
      count - ring * 9
    );

    const seed = hash(item.id);

    const angle =
      -Math.PI / 2 +
      ringIndex * Math.PI * 2 /
      Math.max(ringCount, 2) +
      (random(seed + 2) - .5) * .32;

    const r =
      radius *
      (1 + ring * .90) *
      (.75 + random(seed + 3) * .55);

    return {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r
    };
  }

  function addHierarchy(parent, parentNode) {
    const nextType = NEXT[parentNode.type];

    if (!nextType) return;

    const children = entryChildren(
      parentNode.type,
      parent,
      parentNode.demo
    );

    children.forEach((child, index) => {
      const offset = childPosition(
        child,
        index,
        children.length,
        nextType
      );

      const node = makeNode(
        child,
        nextType,

        child.mapX != null
          ? Number(child.mapX)
          : parentNode.x + offset.x,

        child.mapY != null
          ? Number(child.mapY)
          : parentNode.y + offset.y,

        {
          parentId: parentNode.id,
          demo: parentNode.demo
        }
      );

      addNode(node);
      addHierarchy(child, node);
    });
  }

  function connectNaturally(siblings) {
    if (siblings.length < 2) return;

    const connected = [siblings[0]];
    const remaining = siblings.slice(1);

    while (remaining.length) {
      let closest = null;

      for (const a of connected) {
        for (const b of remaining) {
          const distance = Math.hypot(
            a.x - b.x,
            a.y - b.y
          );

          if (!closest || distance < closest.distance) {
            closest = { a, b, distance };
          }
        }
      }

      edges.push([
        closest.a.id,
        closest.b.id
      ]);

      connected.push(closest.b);

      remaining.splice(
        remaining.indexOf(closest.b),
        1
      );
    }
  }

  function rebuildUniverse() {
    nodes = [];
    edges = [];
    nodeMap = new Map();

    const navScale = width < 650 ? .58 : 1;

    for (const nav of D.navigation.nodes) {
      addNode(makeNode(
        {
          id: "nav-" + nav.id,
          title: nav.title
        },
        "navigation",
        nav.x * navScale,
        nav.y * navScale,
        { action: nav.action }
      ));
    }

    for (const [a, b] of D.navigation.connections) {
      edges.push([
        "nav-" + a,
        "nav-" + b
      ]);
    }

    const actualGroups = records("group");

    const groups = actualGroups.length
      ? actualGroups
      : D.demoGroups;

    groups.forEach((item, index) => {
      const p = groupPosition(item, index);

      const node = makeNode(
        item,
        "group",
        p.x,
        p.y,
        { demo: item.demo === true }
      );

      addNode(node);
      addHierarchy(item, node);
    });

    const standalone = records("production").filter(
      item => !recordParentID("production", item)
    );

    standalone.forEach((item, index) => {
      const angle = index * 2.39996323 + 1.6;
      const radius = 1120 + Math.sqrt(index) * 360;

      const node = makeNode(
        item,
        "production",

        item.mapX != null
          ? Number(item.mapX)
          : Math.cos(angle) * radius,

        item.mapY != null
          ? Number(item.mapY)
          : Math.sin(angle) * radius,

        { standalone: true }
      );

      addNode(node);
      addHierarchy(item, node);
    });

    const parentIDs = new Set(
      nodes.filter(node => node.parentId)
        .map(node => node.parentId)
    );

    for (const parentID of parentIDs) {
      connectNaturally(nodes.filter(
        node => node.parentId === parentID
      ));
    }

    buildStarButtons();
  }

  function buildStarButtons() {
    starLayer.replaceChildren();

    for (const node of nodes) {
      const button = document.createElement("button");

      button.type = "button";
      button.className =
        `celestial-star ${node.type}-star` +
        (node.demo ? " demo-star" : "");

      button.setAttribute(
        "aria-label",
        "Explore " + node.title
      );

      const hit = document.createElement("span");
      hit.className = "star-touch-area";

      const label = document.createElement("span");
      label.className = "star-label";
      label.textContent = node.title;

      const labelOffset = node.type === "group"
        ? 22
        : 22 + Math.round(node.appearance.size * 5);

      label.style.setProperty(
        "--label-distance",
        labelOffset + "px"
      );

      button.append(hit, label);

      button.addEventListener("click", event => {
        event.stopPropagation();

        if (performance.now() < ignoreClickUntil) {
          return;
        }

        selectStar(node);
      });

      button.addEventListener("pointerenter", () => {
        highlightedID = node.id;
      });

      button.addEventListener("pointerleave", () => {
        highlightedID = focusedID;
      });

      button.addEventListener("focus", () => {
        highlightedID = node.id;
      });

      node.button = button;
      starLayer.appendChild(button);
    }
  }

  /* ======================================================
     7. CAMERA
  ====================================================== */

  function worldToScreen(x, y) {
    return {
      x: width / 2 +
        (x - camera.x) * camera.zoom,

      y: height / 2 +
        (y - camera.y) * camera.zoom
    };
  }

  function screenToWorld(x, y) {
    return {
      x: camera.x +
        (x - width / 2) / camera.zoom,

      y: camera.y +
        (y - height / 2) / camera.zoom
    };
  }

  function setCamera(x, y, zoom) {
    camera.x = x;
    camera.y = y;

    camera.zoom = clamp(
      zoom,
      D.camera.minZoom,
      D.camera.maxZoom
    );
  }

  function animateCamera(target, duration = 900) {
    cameraTravel = motionReduced()
      ? null
      : {
          start: { ...camera },
          target,
          startTime: performance.now(),
          duration
        };

    if (motionReduced()) {
      setCamera(
        target.x,
        target.y,
        target.zoom
      );
    }
  }

  function updateCamera(time) {
    if (!cameraTravel) return;

    const { start, target, startTime, duration } =
      cameraTravel;

    const t = clamp(
      (time - startTime) / duration,
      0, 1
    );

    const eased = t * t * (3 - 2 * t);

    const zoom = Math.exp(lerp(
      Math.log(start.zoom),
      Math.log(target.zoom),
      eased
    ));

    setCamera(
      lerp(start.x, target.x, eased),
      lerp(start.y, target.y, eased),
      zoom
    );

    if (t >= 1) {
      cameraTravel = null;
    }
  }

  function zoomAt(screenX, screenY, factor) {
    cameraTravel = null;

    const anchor = screenToWorld(
      screenX,
      screenY
    );

    const zoom = clamp(
      camera.zoom * factor,
      D.camera.minZoom,
      D.camera.maxZoom
    );

    setCamera(
      anchor.x -
        (screenX - width / 2) / zoom,

      anchor.y -
        (screenY - height / 2) / zoom,

      zoom
    );
  }

  function homeCamera() {
    const nav = nodes.filter(
      node => node.type === "navigation"
    );

    if (!nav.length) {
      return { x: 0, y: 0, zoom: 1 };
    }

    const xs = nav.map(node => node.x);
    const ys = nav.map(node => node.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);

    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,

      zoom: clamp(Math.min(
        width * (width < 650 ? .79 : .72) /
          (maxX - minX + 110),

        height * .52 /
          (maxY - minY + 130),

        1.1
      ), D.camera.minZoom, 1.1)
    };
  }

  function goHome() {
    focusedID = null;
    highlightedID = null;

    animateCamera(homeCamera(), 800);
  }

  function focusNode(node) {
    focusedID = node.id;
    highlightedID = node.id;

    const zoom = {
      navigation: 1.35,
      group: 2.15,
      production: 4.5,
      season: 9.2,
      episode: 13
    }[node.type] || 2;

    animateCamera({
      x: node.x,
      y: node.y,
      zoom
    }, D.camera.travelDuration);
  }

  function nodeVisibility(node) {
    if (
      node.type === "navigation" ||
      node.type === "group" ||
      node.standalone
    ) {
      return 1;
    }

    const rule = {
      production: D.semanticZoom.productions,
      season: D.semanticZoom.seasons,
      episode: D.semanticZoom.episodes
    }[node.type];

    if (!rule) return 1;

    let opacity = smooth(
      rule.start,
      rule.full,
      camera.zoom
    );

    const parent = nodeMap.get(node.parentId);

    if (parent) {
      const distance = Math.hypot(
        camera.x - parent.x,
        camera.y - parent.y
      ) * camera.zoom;

      const reach = Math.max(width, height) * 1.5;

      opacity *= 1 - smooth(
        reach * .75,
        reach * 1.6,
        distance
      );
    }

    return clamp(opacity, 0, 1);
  }

  function positionStarButtons() {
    for (const node of nodes) {
      const screen = worldToScreen(
        node.x,
        node.y
      );

      node.sx = screen.x;
      node.sy = screen.y;
      node.visible = nodeVisibility(node);

      const visible =
        node.visible > .025 &&
        screen.x > -130 &&
        screen.x < width + 130 &&
        screen.y > -130 &&
        screen.y < height + 130;

      node.button.classList.toggle(
        "is-hidden",
        !visible
      );

      if (!visible) {
        node.button.tabIndex = -1;
        continue;
      }

      node.button.style.left = screen.x + "px";
      node.button.style.top = screen.y + "px";

      node.button.style.setProperty(
        "--visibility",
        node.visible.toFixed(3)
      );

      node.button.disabled = node.visible < .67;
      node.button.tabIndex =
        node.visible >= .67 ? 0 : -1;

      node.button.classList.toggle(
        "selected",
        highlightedID === node.id
      );
    }
  }

  /* ======================================================
     8. NATURAL-LOOKING CONSTELLATION STARS
  ====================================================== */

  function drawStar(node, time) {
    if (node.visible < .02) return;

    const x = node.sx;
    const y = node.sy;

    if (
      x < -100 || x > width + 100 ||
      y < -100 || y > height + 100
    ) {
      return;
    }

    const style = {
      navigation: D.appearance.navigationStars,
      group: D.appearance.groupStars,
      production: D.appearance.productionStars,
      season: D.appearance.seasonStars,
      episode: D.appearance.episodeStars
    }[node.type];

    if (!style) return;

    const v = node.appearance;
    const [r, g, b] = v.color;

    const active = highlightedID === node.id;

    const pulse = motionReduced()
      ? 1
      : 1 + Math.sin(
          time * v.speed + v.phase
        ) * .045;

    const radius = style.radius * v.size * pulse;

    const glow =
      style.glow *
      v.halo *
      (state.settings.constellationGlow / 65) *
      (active ? 1.48 : 1);

    const opacity = node.visible * v.alpha;

    // Group stars are intentionally more restrained.
    const lightMultiplier =
      node.type === "group" ? .76 : 1;

    const halo = mapCtx.createRadialGradient(
      x, y, 0,
      x, y, glow
    );

    halo.addColorStop(
      0,
      `rgba(${r},${g},${b},${opacity * .23 * lightMultiplier})`
    );

    halo.addColorStop(
      .23,
      `rgba(${r},${g},${b},${opacity * .11 * lightMultiplier})`
    );

    halo.addColorStop(1, "transparent");

    mapCtx.fillStyle = halo;
    mapCtx.beginPath();
    mapCtx.arc(x, y, glow, 0, Math.PI * 2);
    mapCtx.fill();

    const core = mapCtx.createRadialGradient(
      x, y, 0,
      x, y, radius * 2.7
    );

    core.addColorStop(
      0,
      `rgba(255,255,255,${opacity * lightMultiplier})`
    );

    core.addColorStop(
      .18,
      `rgba(${r},${g},${b},${opacity * lightMultiplier})`
    );

    core.addColorStop(
      .55,
      `rgba(${r},${g},${b},${opacity * .31})`
    );

    core.addColorStop(1, "transparent");

    mapCtx.fillStyle = core;
    mapCtx.beginPath();

    mapCtx.ellipse(
      x,
      y,
      radius * 2.7,
      radius * 2.7 * v.oval,
      v.angle,
      0,
      Math.PI * 2
    );

    mapCtx.fill();

    if (v.spikes && (radius > 2.3 || active)) {
      mapCtx.save();

      mapCtx.translate(x, y);
      mapCtx.rotate(v.angle);
      mapCtx.globalAlpha = opacity * .43;

      const length =
        radius * (active ? 7 : 4.4) *
        v.spikeLength;

      for (let axis = 0; axis < 2; axis++) {
        const rayLength = axis
          ? length * .66
          : length;

        const ray = mapCtx.createLinearGradient(
          -rayLength, 0,
          rayLength, 0
        );

        ray.addColorStop(0, "transparent");
        ray.addColorStop(
          .5,
          `rgba(${r},${g},${b},.8)`
        );
        ray.addColorStop(1, "transparent");

        mapCtx.strokeStyle = ray;
        mapCtx.lineWidth = .55;

        mapCtx.beginPath();
        mapCtx.moveTo(-rayLength, 0);
        mapCtx.lineTo(rayLength, 0);
        mapCtx.stroke();

        mapCtx.rotate(Math.PI / 2);
      }

      mapCtx.restore();
    }
  }

  function drawConstellations(time) {
    mapCtx.clearRect(
      0, 0, width, height
    );

    for (const [aID, bID] of edges) {
      const a = nodeMap.get(aID);
      const b = nodeMap.get(bID);

      if (!a || !b) continue;

      const alpha = Math.min(
        a.visible,
        b.visible
      );

      if (alpha < .02) continue;

      if (
        Math.max(a.sx, b.sx) < -70 ||
        Math.min(a.sx, b.sx) > width + 70 ||
        Math.max(a.sy, b.sy) < -70 ||
        Math.min(a.sy, b.sy) > height + 70
      ) {
        continue;
      }

      const active =
        highlightedID === aID ||
        highlightedID === bID;

      mapCtx.beginPath();
      mapCtx.moveTo(a.sx, a.sy);
      mapCtx.lineTo(b.sx, b.sy);

      mapCtx.strokeStyle = active
        ? `rgba(210,207,255,${alpha * .58})`
        : `rgba(161,174,227,${alpha * .23})`;

      mapCtx.lineWidth = active ? 1 : .65;
      mapCtx.stroke();
    }

    for (const node of nodes) {
      drawStar(node, time);
    }
  }

  /* ======================================================
     9. SPACE BACKGROUND
  ====================================================== */

  function resizeCanvas(canvas, context, dpr) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    context.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );
  }

  function buildBackgroundStars() {
    const count = clamp(
      Math.round(
        D.graphics.backgroundStarCount *
        width * height / 850000 *
        state.settings.starDensity / 75
      ),
      100,
      D.graphics.maximumBackgroundStars
    );

    backgroundStars = [];

    for (let i = 0; i < count; i++) {
      const seed = i * 173 + 48192;
      const rarity = random(seed + 1);

      backgroundStars.push({
        x: random(seed + 2) * width,
        y: random(seed + 3) * height,

        radius: rarity < .84
          ? .18 + random(seed + 4) * .49
          : rarity < .98
            ? .68 + random(seed + 5) * .53
            : 1.25 + random(seed + 6) * 1.1,

        alpha: .13 + random(seed + 7) * .74,
        depth: .018 + random(seed + 8) * .18,

        speed: .00014 +
          random(seed + 9) * .00048,

        phase: random(seed + 10) * Math.PI * 2,

        color: random(seed + 11) < .13
          ? [245, 221, 209]
          : random(seed + 12) < .60
            ? [216, 225, 255]
            : [180, 202, 250]
      });
    }
  }

  function drawBackground(time) {
    backgroundCtx.clearRect(
      0, 0, width, height
    );

    const brightness =
      state.settings.starBrightness / 100;

    for (const star of backgroundStars) {
      const x = (
        (star.x - camera.x * star.depth) %
        width + width
      ) % width;

      const y = (
        (star.y - camera.y * star.depth) %
        height + height
      ) % height;

      const pulse = motionReduced()
        ? 1
        : .88 + Math.sin(
            time * star.speed + star.phase
          ) * .12;

      const alpha = clamp(
        star.alpha * pulse * (.42 + brightness),
        0, 1
      );

      const [r, g, b] = star.color;

      backgroundCtx.fillStyle =
        `rgba(${r},${g},${b},${alpha})`;

      backgroundCtx.beginPath();
      backgroundCtx.arc(
        x, y, star.radius, 0, Math.PI * 2
      );
      backgroundCtx.fill();
    }
  }

  function buildNebula() {
    const texture = document.createElement("canvas");

    const ratio = D.graphics.nebulaResolution;

    texture.width = Math.max(
      320,
      Math.round(width * ratio)
    );

    texture.height = Math.max(
      260,
      Math.round(height * ratio)
    );

    const ctx = texture.getContext("2d");
    const w = texture.width;
    const h = texture.height;

    const clouds = [
      [.12,.25,.57,24,68,150,.24],
      [.33,.48,.50,42,88,173,.23],
      [.51,.40,.43,52,104,192,.20],
      [.78,.61,.58,42,39,111,.17],
      [.83,.20,.47,26,61,133,.17],
      [.15,.79,.43,20,44,102,.14]
    ];

    for (const [px, py, size, r, g, b, alpha] of clouds) {
      const x = px * w;
      const y = py * h;

      const radius = size * Math.max(w, h);

      const gradient = ctx.createRadialGradient(
        x, y, 0,
        x, y, radius
      );

      gradient.addColorStop(
        0,
        `rgba(${r},${g},${b},${alpha})`
      );

      gradient.addColorStop(
        .38,
        `rgba(${r},${g},${b},${alpha * .52})`
      );

      gradient.addColorStop(1, "transparent");

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    for (let i = 0; i < 300; i++) {
      const seed = i * 37 + 181;
      const progress = random(seed);

      const x = (progress * 1.3 - .14) * w;

      const y = (
        .65 - .37 * progress +
        (random(seed + 1) - .5) * .38
      ) * h;

      const radius = 8 + random(seed + 2) * 55;
      const opacity = .012 + random(seed + 3) * .044;

      const gradient = ctx.createRadialGradient(
        x, y, 0,
        x, y, radius
      );

      gradient.addColorStop(
        0,
        `rgba(85,122,207,${opacity})`
      );

      gradient.addColorStop(1, "transparent");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    nebulaTexture = texture;
  }

  function drawNebula() {
    if (!nebulaTexture) return;

    nebulaCtx.clearRect(
      0, 0, width, height
    );

    const x = clamp(camera.x * .007, -80, 80);
    const y = clamp(camera.y * .007, -80, 80);

    nebulaCtx.globalAlpha =
      state.settings.nebulaIntensity / 100;

    nebulaCtx.drawImage(
      nebulaTexture,
      -80 - x,
      -80 - y,
      width + 160,
      height + 160
    );

    nebulaCtx.globalAlpha = 1;
  }

  function resizeGraphics() {
    width = innerWidth;
    height = innerHeight;

    const dpr = Math.min(
      devicePixelRatio || 1,
      D.graphics.maxPixelRatio
    );

    resizeCanvas(mapCanvas, mapCtx, dpr);
    resizeCanvas(backgroundCanvas, backgroundCtx, dpr);
    resizeCanvas(nebulaCanvas, nebulaCtx, 1);

    buildBackgroundStars();
    buildNebula();
  }

  function renderFrame(time) {
    if (!running) return;

    if (time - lastFrame >= 16) {
      updateCamera(time);
      positionStarButtons();

      drawNebula();
      drawBackground(time);
      drawConstellations(time);

      lastFrame = time;
    }

    animationHandle = requestAnimationFrame(
      renderFrame
    );
  }

  function startLoop() {
    if (running) return;

    running = true;
    lastFrame = 0;

    animationHandle = requestAnimationFrame(
      renderFrame
    );
  }

  function stopLoop() {
    running = false;
    cancelAnimationFrame(animationHandle);
  }

  /* ======================================================
     10. FREE PAN AND PINCH ZOOM
  ====================================================== */

  function pointerPoint(event) {
    return {
      x: event.clientX,
      y: event.clientY
    };
  }

  function distance(a, b) {
    return Math.hypot(
      a.x - b.x,
      a.y - b.y
    );
  }

  function center(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function startPinch() {
    if (pointers.size < 2) return;

    const [a, b] = [...pointers.values()];
    const point = center(a, b);

    gesture = {
      type: "pinch",

      distance: Math.max(
        1,
        distance(a, b)
      ),

      zoom: camera.zoom,

      anchor: screenToWorld(
        point.x,
        point.y
      ),

      moved: true
    };

    ignoreClickUntil = performance.now() + 450;
  }

  function bindGestures() {
    viewport.addEventListener("pointerdown", event => {
      if (
        event.pointerType === "mouse" &&
        event.button !== 0
      ) {
        return;
      }

      cameraTravel = null;

      pointers.set(
        event.pointerId,
        pointerPoint(event)
      );

      if (pointers.size === 1) {
        gesture = {
          type: "drag",
          distance: 0,
          moved: false
        };
      } else {
        startPinch();
      }
    });

    viewport.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;

      const old = pointers.get(event.pointerId);
      const current = pointerPoint(event);

      pointers.set(
        event.pointerId,
        current
      );

      if (pointers.size >= 2) {
        if (gesture?.type !== "pinch") {
          startPinch();
        }

        const [a, b] = [...pointers.values()];
        const midpoint = center(a, b);

        const zoom = clamp(
          gesture.zoom *
          Math.max(1, distance(a, b)) /
          gesture.distance,

          D.camera.minZoom,
          D.camera.maxZoom
        );

        setCamera(
          gesture.anchor.x -
            (midpoint.x - width / 2) / zoom,

          gesture.anchor.y -
            (midpoint.y - height / 2) / zoom,

          zoom
        );

        gesture.moved = true;
        ignoreClickUntil = performance.now() + 400;

        return;
      }

      if (!gesture || gesture.type !== "drag") {
        gesture = {
          type: "drag",
          distance: 0,
          moved: false
        };
      }

      const dx = current.x - old.x;
      const dy = current.y - old.y;

      gesture.distance += Math.hypot(dx, dy);

      if (
        gesture.distance >
        D.camera.tapThreshold
      ) {
        gesture.moved = true;
        ignoreClickUntil = performance.now() + 350;

        viewport.classList.add("dragging");

        if (!viewport.hasPointerCapture(event.pointerId)) {
          viewport.setPointerCapture(event.pointerId);
        }
      }

      setCamera(
        camera.x - dx / camera.zoom,
        camera.y - dy / camera.zoom,
        camera.zoom
      );
    });

    function endPointer(event) {
      if (!pointers.has(event.pointerId)) return;

      pointers.delete(event.pointerId);

      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(
          event.pointerId
        );
      }

      if (gesture?.moved) {
        ignoreClickUntil = performance.now() + 350;
      }

      if (pointers.size === 0) {
        gesture = null;
        viewport.classList.remove("dragging");
      } else if (pointers.size === 1) {
        gesture = {
          type: "drag",
          distance: 0,
          moved: true
        };
      }
    }

    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);

    viewport.addEventListener(
      "lostpointercapture",
      event => {
        if (pointers.has(event.pointerId)) {
          pointers.delete(event.pointerId);
        }

        if (!pointers.size) {
          gesture = null;
          viewport.classList.remove("dragging");
        }
      }
    );

    viewport.addEventListener("click", event => {
      if (performance.now() < ignoreClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    viewport.addEventListener("wheel", event => {
      event.preventDefault();

      zoomAt(
        event.clientX,
        event.clientY,

        Math.exp(
          -event.deltaY *
          D.camera.wheelSensitivity
        )
      );
    }, { passive: false });

    viewport.addEventListener("keydown", event => {
      if (event.target !== viewport) return;

      const step = 85 / camera.zoom;

      switch (event.key) {
        case "ArrowLeft":
          camera.x -= step;
          break;

        case "ArrowRight":
          camera.x += step;
          break;

        case "ArrowUp":
          camera.y -= step;
          break;

        case "ArrowDown":
          camera.y += step;
          break;

        case "+":
        case "=":
          zoomAt(
            width / 2,
            height / 2,
            1.25
          );
          break;

        case "-":
          zoomAt(
            width / 2,
            height / 2,
            .8
          );
          break;

        default:
          return;
      }

      event.preventDefault();
    });
  }

  /* ======================================================
     11. HOLOGRAPHIC POPUP
     ALL FOUR LEVELS — NO PAGE NAVIGATION
  ====================================================== */

  function popupOpen() {
    return popupOverlay.classList.contains("open");
  }

  function updateBackgroundInteraction() {
    const blocked =
      popupOpen() ||
      activeOverlay !== null;

    viewport.inert = blocked;

    const controls = $(".universe-controls");

    if (controls) {
      controls.inert = blocked;
    }
  }

  function closePopup() {
    popupRenderToken++;
    currentPopup = null;
    popupHistory = [];

    popupOverlay.classList.remove("open");
    popupOverlay.setAttribute("aria-hidden", "true");

    updateBackgroundInteraction();

    if (!activeOverlay) {
      viewport.focus();
    }
  }

  function popupBack() {
    if (!popupHistory.length) {
      closePopup();
      return;
    }

    const previous = popupHistory.pop();

    openPopup(
      previous.type,
      previous.id,
      false
    );
  }

  function ratingValue(item) {
    const raw =
      item?.averageRating ??
      item?.calculatedRating ??
      item?.rating;

    if (
      raw === null ||
      raw === undefined ||
      raw === ""
    ) {
      return null;
    }

    const value = Number(raw);

    return Number.isFinite(value)
      ? clamp(value, 0, 10)
      : null;
  }

  function ratingStar(fill, index) {
    const percentage = clamp(fill, 0, 1) * 100;

    const gradientID =
      "star-" + index + "-" +
      Math.random().toString(36).slice(2, 9);

    return `
      <span class="rating-star">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="${gradientID}">
              <stop
                offset="${percentage}%"
                stop-color="#ddd5ff"
              />
              <stop
                offset="${percentage}%"
                stop-color="transparent"
              />
            </linearGradient>
          </defs>
          <path
            d="M12 2.5L14.9 8.5 21.5 9.4
               16.75 14.1 17.9 20.8 12 17.65
               6.1 20.8 7.25 14.1 2.5 9.4
               9.1 8.5Z"
            fill="url(#${gradientID})"
            stroke="#938bb9"
            stroke-width=".8"
          />
        </svg>
      </span>
    `;
  }

  function displayRating(item) {
    const value = ratingValue(item);

    if (value === null) {
      return `
        <span class="rating-unrated">
          Not rated yet
        </span>
      `;
    }

    return `
      <span class="rating-stars">
        ${Array.from(
          { length: 10 },
          (_, index) => ratingStar(value - index, index)
        ).join("")}
      </span>

      <span class="rating-value">
        ${value.toFixed(2)} / 10
      </span>
    `;
  }

  function dateLabel(value) {
    if (!value) return "";

    const date = new Date(
      String(value).slice(0, 10) + "T12:00:00"
    );

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function setPopupBanner(item, token) {
    const banner = $("#popupBanner");

    banner.style.backgroundImage = "";
    banner.classList.add("is-empty");

    banner.style.backgroundPosition =
      `${numeric(item.bannerPositionX, 50, 0, 100)}% ` +
      `${numeric(item.bannerPositionY, 35, 0, 100)}%`;

    bannerURL(item).then(url => {
      if (token !== popupRenderToken) return;

      if (url) {
        banner.style.backgroundImage =
          `url(${JSON.stringify(url)})`;

        banner.classList.remove("is-empty");
      }

    }).catch(error => {
      console.warn("Popup banner unavailable:", error);
    });
  }

  function popupTypeLabel(type, item) {
    if (type === "group") return "COLLECTION";
    if (type === "production") {
      return (item.mediaType || "PRODUCTION").toUpperCase();
    }
    return type.toUpperCase();
  }

  function setPopupMeta(type, item) {
    const sub = $("#popupSubMeta");
    const primary = $("#popupMetaPrimary");
    const secondary = $("#popupMetaSecondary");

    sub.textContent = "";
    primary.textContent = "";
    secondary.textContent = "";

    const main = genreNames(
      item.mainGenreIds,
      "main"
    );

    const tags = genreNames(
      item.secondaryGenreIds,
      "secondary"
    );

    if (type === "group") {
      primary.textContent = main.join(" · ");
      secondary.textContent = tags.join(" · ");
      return;
    }

    if (type === "production") {
      const years = [
        item.releaseStart,
        item.releaseEnd
      ].filter(Boolean);

      if (years.length) {
        sub.textContent = years
          .map(value => dateLabel(value))
          .join(" — ");
      }

      primary.textContent =
        main.join(" · ") ||
        item.mediaType ||
        "";

      secondary.textContent =
        tags.join(" · ") ||
        item.status ||
        "";

      return;
    }

    if (type === "season") {
      const parts = [];

      if (item.releaseStart) {
        parts.push(dateLabel(item.releaseStart));
      }

      if (item.releaseEnd) {
        parts.push(dateLabel(item.releaseEnd));
      }

      sub.textContent = parts.join(" — ");
      primary.textContent = item.status || "";
      return;
    }

    if (type === "episode") {
      const minutes = Number(item.duration);

      if (Number.isFinite(minutes) && minutes > 0) {
        primary.textContent = minutes + " min";
      }

      secondary.textContent = item.watchedAt
        ? dateLabel(item.watchedAt)
        : "";

      sub.textContent = "";
    }
  }

  function popupChildrenLabel(type, count) {
    const names = {
      group: ["PRODUCTION", "PRODUCTIONS"],
      production: ["SEASON", "SEASONS"],
      season: ["EPISODE", "EPISODES"]
    }[type];

    if (!names) return "";

    return `${count} ${count === 1 ? names[0] : names[1]}`;
  }

  function renderPopupChildren(type, item, demo, token) {
    const container = $("#popupChildren");
    const section = $("#popupChildrenSection");
    const addButton = $("#popupAddChildButton");

    const childType = NEXT[type];

    if (!childType) {
      section.hidden = true;
      container.replaceChildren();
      addButton.hidden = true;
      return;
    }

    section.hidden = false;

    const items = entryChildren(type, item, demo);

    $("#popupChildrenLabel").textContent =
      popupChildrenLabel(type, items.length);

    container.className =
      "popup-children is-" + type;

    const noSeasons =
      type === "production" &&
      ["Movie", "Short Film", "Special"].includes(
        item.mediaType
      );

    addButton.hidden = demo || noSeasons;

    if (!items.length) {
      container.innerHTML = `
        <p class="popup-children-empty">
          ${type === "group"
            ? "No productions yet."
            : type === "production"
              ? "No seasons yet."
              : "No episodes yet."}
        </p>
      `;

      return;
    }

    if (type === "group") {
      container.innerHTML = items.map(child => `
        <button
          type="button"
          class="child-production-card"
          data-child-id="${escapeHTML(child.id)}"
        >
          <span class="child-production-title">
            ${escapeHTML(titleOf(child))}
          </span>

          <span class="child-production-sub">
            ${escapeHTML(child.mediaType || "Production")}
          </span>
        </button>
      `).join("");
    }

    if (type === "production") {
      container.innerHTML = items.map(child => `
        <button
          type="button"
          class="child-season-card"
          data-child-id="${escapeHTML(child.id)}"
        >
          <span class="child-season-title">
            ${escapeHTML(titleOf(child))}
          </span>

          <span class="child-season-meta">
            ${ratingValue(child) === null
              ? ""
              : ratingValue(child).toFixed(1) + " / 10"}
            <span aria-hidden="true">↗</span>
          </span>
        </button>
      `).join("");
    }

    if (type === "season") {
      container.innerHTML = items.map((child, index) => `
        <button
          type="button"
          class="child-episode-card"
          data-child-id="${escapeHTML(child.id)}"
        >
          <span class="child-episode-number">
            EPISODE ${index + 1}
          </span>

          <span class="child-episode-title">
            ${escapeHTML(titleOf(child))}
          </span>

          <span class="child-episode-meta">
            ${Number(child.duration) > 0
              ? escapeHTML(child.duration) + " min"
              : ""}
          </span>
        </button>
      `).join("");
    }

    container.querySelectorAll("[data-child-id]")
      .forEach(button => {
        button.addEventListener("click", () => {
          if (token !== popupRenderToken) return;

          openPopup(
            childType,
            button.dataset.childId,
            true
          );
        });
      });
  }

  function openPopup(type, recordID, pushHistory = true) {
    const resolved = resolveEntry(type, recordID);

    if (!resolved) {
      notify("This entry could not be found.");
      return;
    }

    if (
      pushHistory &&
      currentPopup &&
      !(currentPopup.type === type &&
        currentPopup.id === recordID)
    ) {
      popupHistory.push({ ...currentPopup });
    }

    const item = resolved.item;

    currentPopup = {
      type,
      id: String(recordID),
      demo: resolved.demo
    };

    const token = ++popupRenderToken;

    closeOverlay(false);

    popupOverlay.classList.add("open");
    popupOverlay.setAttribute(
      "aria-hidden",
      "false"
    );

    updateBackgroundInteraction();

    $("#popupType").textContent =
      popupTypeLabel(type, item);

    $("#popupTitle").textContent = titleOf(item);
    $("#popupRating").innerHTML = displayRating(item);

    setPopupMeta(type, item);
    setPopupBanner(item, token);

    const paperclip = $("#popupPaperclip");

    paperclip.hidden = type !== "production";

    if (type === "production") {
      const status = D.statusVisuals[item.status] ||
        D.statusVisuals.Planned;

      paperclip.dataset.status = status.key;

      paperclip.setAttribute(
        "aria-label",
        "Watching status: " + (item.status || "Planned")
      );
    }

    const notes = $("#popupNotes");

    notes.textContent = item.notes || "";
    notes.classList.toggle(
      "is-empty",
      !item.notes
    );

    $("#popupEditButton").hidden = resolved.demo;

    $("#popupBackButton").hidden =
      popupHistory.length === 0;

    renderPopupChildren(
      type,
      item,
      resolved.demo,
      token
    );

    // Make absolutely sure the popup itself
    // does not start a scroll position.
    popup.scrollTop = 0;

    if (popupOpen()) {
      popup.focus();
    }
  }

  /* ======================================================
     12. OVERLAY MANAGEMENT
  ====================================================== */

  function openOverlay(overlay) {
    if (activeOverlay && activeOverlay !== overlay) {
      activeOverlay.classList.remove("open");

      activeOverlay.setAttribute(
        "aria-hidden",
        "true"
      );
    }

    if (!activeOverlay) {
      returnFocus = document.activeElement;
    }

    activeOverlay = overlay;

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");

    updateBackgroundInteraction();
  }

  function closeOverlay(restore = true) {
    if (!activeOverlay) return;

    activeOverlay.classList.remove("open");

    activeOverlay.setAttribute(
      "aria-hidden",
      "true"
    );

    activeOverlay = null;

    updateBackgroundInteraction();

    if (restore) {
      if (popupOpen()) {
        popup.focus();
      } else if (returnFocus?.isConnected) {
        returnFocus.focus();
      } else {
        viewport.focus();
      }
    }
  }

  function detail(html) {
    $("#detailContent").innerHTML = html;
    $("#detailSheet").scrollTop = 0;

    openOverlay(detailOverlay);
    $("#closeDetailButton").focus();
  }

  function editor(html, heading = "Create & Edit") {
    $("#editorTitle").textContent = heading;
    $("#editorEyebrow").textContent = "ARCHIVE EDITOR";

    $("#editorContent").innerHTML = html;
    $("#editorSheet").scrollTop = 0;

    openOverlay(editorOverlay);
    $("#closeEditorButton").focus();
  }

  function confirmDeletion(message, action) {
    confirmationCallback = action;
    confirmationFocus = document.activeElement;

    $("#confirmMessage").textContent = message;

    confirmOverlay.classList.add("open");

    confirmOverlay.setAttribute(
      "aria-hidden",
      "false"
    );

    $("#cancelConfirmButton").focus();
  }

  function closeConfirmation() {
    confirmOverlay.classList.remove("open");

    confirmOverlay.setAttribute(
      "aria-hidden",
      "true"
    );

    confirmationCallback = null;

    if (confirmationFocus?.isConnected) {
      confirmationFocus.focus();
    }
  }

  /* ======================================================
     13. MAIN CONSTELLATION ACTIONS
  ====================================================== */

  function selectStar(node) {
    if (node.type === "navigation") {
      switch (node.action) {
        case "library":
          openLibrary("library");
          return;

        case "genres":
          openGenres();
          return;

        case "create":
          openManager();
          return;

        case "watchlist":
          openLibrary("watchlist");
          return;

        case "settings":
          openSettings();
          return;
      }
    }

    const distanceToNode = Math.hypot(
      camera.x - node.x,
      camera.y - node.y
    );

    const minimumZoom = {
      group: 1.6,
      production: 3.3,
      season: 6.7,
      episode: 9
    }[node.type] || 1;

    if (
      distanceToNode < 80 &&
      camera.zoom >= minimumZoom
    ) {
      openPopup(node.type, node.id);
      return;
    }

    focusNode(node);
  }

  /* ======================================================
     14. CREATE & EDIT MANAGER
  ====================================================== */

  function parentName(type, item) {
    const pid = recordParentID(type, item);

    if (!pid) {
      return type === "production" ? "Standalone" : "";
    }

    return titleOf(record(PREVIOUS[type], pid));
  }

  function managerSection(type) {
    const items = [...records(type)].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );

    return `
      <section class="manager-section">
        <div class="manager-section-title">
          <h3>
            ${type.charAt(0).toUpperCase() +
              type.slice(1)}s
          </h3>

          <span class="manager-count">
            ${items.length}
          </span>
        </div>

        <div class="manager-list">
          ${items.length
            ? items.map(item => `
              <div class="manager-item">
                <div class="manager-item-main">
                  <span class="manager-item-title">
                    ${escapeHTML(titleOf(item))}
                  </span>
                  <span class="manager-item-subtitle">
                    ${escapeHTML(parentName(type, item))}
                  </span>
                </div>

                <div class="manager-item-actions">
                  <button
                    type="button"
                    class="mini-button"
                    data-edit="${type}"
                    data-id="${escapeHTML(item.id)}"
                    aria-label="Edit"
                  >✎</button>

                  <button
                    type="button"
                    class="mini-button"
                    data-up="${type}"
                    data-id="${escapeHTML(item.id)}"
                    aria-label="Move up"
                  >↑</button>

                  <button
                    type="button"
                    class="mini-button"
                    data-down="${type}"
                    data-id="${escapeHTML(item.id)}"
                    aria-label="Move down"
                  >↓</button>

                  <button
                    type="button"
                    class="mini-button"
                    data-delete="${type}"
                    data-id="${escapeHTML(item.id)}"
                    aria-label="Delete"
                  >×</button>
                </div>
              </div>
            `).join("")
            : `<p class="manager-empty">
                No entries yet.
              </p>`
          }
        </div>
      </section>
    `;
  }

  function openManager() {
    editorReturn = null;
    clearPendingBanner();

    editor(`
      <p>
        Create and rearrange your universe.
        All saved entries remain connected
        to their parents.
      </p>

      <div class="manager-actions">
        ${TYPES.map(type => `
          <button
            type="button"
            class="soft-button"
            data-create="${type}"
          >
            + ${type.charAt(0).toUpperCase() +
              type.slice(1)}
          </button>
        `).join("")}
      </div>

      ${TYPES.map(managerSection).join("")}
    `);

    $$("#editorContent [data-create]").forEach(
      button => {
        button.onclick = () => openForm(
          button.dataset.create
        );
      }
    );

    $$("#editorContent [data-edit]").forEach(
      button => {
        button.onclick = () => openForm(
          button.dataset.edit,
          button.dataset.id
        );
      }
    );

    for (const direction of ["up", "down"]) {
      $$(`#editorContent [data-${direction}]`).forEach(
        button => {
          button.onclick = () => {
            reorderRecord(
              button.dataset[direction],
              button.dataset.id,
              direction === "up" ? -1 : 1
            );

            openManager();
          };
        }
      );
    }

    $$("#editorContent [data-delete]").forEach(
      button => {
        button.onclick = () => {
          const type = button.dataset.delete;
          const rid = button.dataset.id;
          const item = record(type, rid);

          if (!item) return;

          confirmDeletion(
            `Delete "${titleOf(item)}" and all of its descendants?`,
            async () => {
              await deleteRecord(type, rid);
              openManager();
            }
          );
        };
      }
    );
  }

  function inputField(
    key,
    label,
    value = "",
    inputType = "text"
  ) {
    return `
      <div class="form-field">
        <label for="field-${key}">
          ${escapeHTML(label)}
        </label>

        <input
          id="field-${key}"
          class="form-input"
          type="${inputType}"
          value="${escapeHTML(value)}"
        >
      </div>
    `;
  }

  function selectField(key, label, options, selected) {
    return `
      <div class="form-field">
        <label for="field-${key}">
          ${escapeHTML(label)}
        </label>

        <select
          id="field-${key}"
          class="form-select"
        >
          ${options.map(option => `
            <option
              value="${escapeHTML(option.id)}"
              ${String(option.id) === String(selected || "")
                ? "selected" : ""}
            >
              ${escapeHTML(option.title)}
            </option>
          `).join("")}
        </select>
      </div>
    `;
  }

  function genreFields(type, selected = []) {
    return `
      <div class="form-field">
        <label>
          ${type === "main"
            ? "Main Genres"
            : "Secondary Genres & Tags"}
        </label>

        ${genreRecords(type).length
          ? genreRecords(type).map(genre => `
            <label class="field-checkbox">
              <input
                type="checkbox"
                data-genre="${type}"
                value="${escapeHTML(genre.id)}"
                ${selected.includes(genre.id)
                  ? "checked" : ""}
              >

              ${escapeHTML(genre.name)}
            </label>
          `).join("")
          : `<small>
              Create your genres from the Genre Creation star.
            </small>`
        }
      </div>
    `;
  }

  function bannerForm() {
    return `
      <div class="form-field banner-upload">
        <label>Banner image</label>

        <div
          id="bannerPreview"
          class="banner-upload-preview"
        >
          <span class="banner-preview-empty">✧</span>
        </div>

        <div class="banner-upload-actions">
          <button
            type="button"
            id="chooseBanner"
            class="soft-button"
          >
            Choose from gallery
          </button>

          <button
            type="button"
            id="removeBanner"
            class="soft-button"
          >
            Remove image
          </button>
        </div>

        <span class="banner-upload-note">
          Your picture stays in your browser's local image storage.
        </span>

        <div class="form-grid">
          ${inputField(
            "bannerPositionX",
            "Horizontal focus (%)",
            50,
            "number"
          )}

          ${inputField(
            "bannerPositionY",
            "Vertical focus (%)",
            35,
            "number"
          )}
        </div>
      </div>
    `;
  }

  function clearPendingBanner() {
    revokePendingBanner();
    editorContext = null;
  }

  async function showBannerPreview(item, token) {
    const url = await bannerURL(item);

    if (token !== galleryToken) return;

    const box = $("#bannerPreview");

    if (!box) return;

    if (!url) {
      box.innerHTML = `
        <span class="banner-preview-empty">✧</span>
      `;
      return;
    }

    box.innerHTML = `
      <img
        class="banner-preview-image"
        alt="Banner preview"
      >
    `;

    box.querySelector("img").src = url;
  }

  function returnFromEditor() {
    clearPendingBanner();
    closeOverlay(false);

    if (editorReturn) {
      const previous = editorReturn;
      editorReturn = null;

      openPopup(
        previous.type,
        previous.id,
        false
      );

      return;
    }

    openManager();
  }

  function openForm(type, recordID = null, parentID = null) {
    revokePendingBanner();

    const item = recordID
      ? record(type, recordID)
      : null;

    if (recordID && !item) {
      notify("Entry not found.");
      return;
    }

    const values = item || {};

    const options = t => records(t).map(record => ({
      id: record.id,
      title: titleOf(record)
    }));

    let html = `
      <form id="archiveForm" class="archive-form">
        ${inputField(
          "title",
          "Title",
          values.title || ""
        )}
    `;

    if (type === "production") {
      html += selectField(
        "groupId",
        "Parent Group",
        [
          { id: "", title: "None — standalone" },
          ...options("group")
        ],
        values.groupId || parentID || ""
      );

      html += selectField(
        "mediaType",
        "Media Format",
        D.mediaTypes.map(value => ({
          id: value,
          title: value
        })),
        values.mediaType || "TV Series"
      );

      html += selectField(
        "status",
        "Watching Status",
        D.statuses.map(value => ({
          id: value,
          title: value
        })),
        values.status || "Planned"
      );

      html += `
        <label class="field-checkbox">
          <input
            id="field-watchlist"
            type="checkbox"
            ${values.watchlist ? "checked" : ""}
          >
          Add to Watchlist
        </label>
      `;
    }

    if (type === "season") {
      html += selectField(
        "productionId",
        "Production",
        options("production"),
        values.productionId || parentID || ""
      );

      html += selectField(
        "status",
        "Watching Status",
        D.statuses.map(value => ({
          id: value,
          title: value
        })),
        values.status || "Planned"
      );
    }

    if (type === "episode") {
      html += selectField(
        "seasonId",
        "Season",
        options("season"),
        values.seasonId || parentID || ""
      );

      html += inputField(
        "duration",
        "Duration (minutes)",
        values.duration ?? "",
        "number"
      );
    }

    const supportsBanner =
      type === "group" ||
      type === "production";

    if (supportsBanner) {
      html += genreFields(
        "main",
        values.mainGenreIds || []
      );

      html += genreFields(
        "secondary",
        values.secondaryGenreIds || []
      );

      html += bannerForm();
    }

    if (type === "production" || type === "season") {
      html += `
        <div class="form-grid">
          ${inputField(
            "releaseStart",
            "Airing / Release Start",
            values.releaseStart || "",
            "date"
          )}

          ${inputField(
            "releaseEnd",
            "Airing / Release End",
            values.releaseEnd || "",
            "date"
          )}
        </div>
      `;
    }

    if (type === "production" || type === "episode") {
      html += inputField(
        "lastWatched",
        "Last Watched",
        values.lastWatched || values.watchedAt || "",
        "date"
      );
    }

    html += `
        <div class="form-field">
          <label for="field-notes">
            Personal Observations
          </label>

          <textarea
            id="field-notes"
            class="form-textarea"
          ></textarea>
        </div>

        <div class="form-actions">
          <button
            type="button"
            id="cancelForm"
            class="soft-button"
          >
            Cancel
          </button>

          <button
            type="submit"
            id="saveForm"
            class="soft-button primary-button"
          >
            ${item ? "Save Changes" : "Create Entry"}
          </button>
        </div>
      </form>
    `;

    editor(
      html,
      item ? `Edit ${type}` : `Create ${type}`
    );

    editorContext = {
      type,
      recordID,
      parentID
    };

    $("#field-notes").value = values.notes || "";

    $("#cancelForm").onclick = returnFromEditor;

    if (supportsBanner) {
      $("#field-bannerPositionX").value =
        numeric(values.bannerPositionX, 50, 0, 100);

      $("#field-bannerPositionY").value =
        numeric(values.bannerPositionY, 35, 0, 100);

      const token = ++galleryToken;

      showBannerPreview(values, token).catch(
        console.warn
      );

      $("#chooseBanner").onclick = () => {
        $("#bannerFileInput").click();
      };

      $("#removeBanner").onclick = () => {
        revokePendingBanner();

        pendingBanner = { remove: true };

        $("#bannerPreview").innerHTML = `
          <span class="banner-preview-empty">✧</span>
        `;
      };
    }

    $("#archiveForm").onsubmit = async event => {
      event.preventDefault();

      const saveButton = $("#saveForm");
      saveButton.disabled = true;

      const get = key =>
        $("#field-" + key)?.value ?? "";

      const data = {
        title: get("title").trim(),
        notes: $("#field-notes").value
      };

      if (!data.title) {
        notify("Enter a title.");
        saveButton.disabled = false;
        return;
      }

      if (type === "production") {
        data.groupId = get("groupId") || null;
        data.mediaType = get("mediaType");
        data.status = get("status");

        data.watchlist =
          $("#field-watchlist").checked;
      }

      if (type === "season") {
        data.productionId = get("productionId");
        data.status = get("status");
      }

      if (type === "episode") {
        data.seasonId = get("seasonId");

        data.duration = Math.max(
          0,
          Number(get("duration")) || 0
        );

        data.watchedAt = get("lastWatched");
      }

      if (supportsBanner) {
        data.mainGenreIds =
          $$('#archiveForm [data-genre="main"]:checked')
            .map(input => input.value);

        data.secondaryGenreIds =
          $$('#archiveForm [data-genre="secondary"]:checked')
            .map(input => input.value);

        data.bannerPositionX = numeric(
          get("bannerPositionX"),
          50, 0, 100
        );

        data.bannerPositionY = numeric(
          get("bannerPositionY"),
          35, 0, 100
        );
      }

      if (type === "production" || type === "season") {
        data.releaseStart = get("releaseStart");
        data.releaseEnd = get("releaseEnd");
      }

      if (type === "production") {
        data.lastWatched = get("lastWatched");
      }

      let newlyStoredImageID = null;

      try {
        if (supportsBanner && pendingBanner) {
          if (pendingBanner.remove) {
            data.bannerImageId = null;
            data.banner = "";
          } else if (pendingBanner.blob) {
            newlyStoredImageID = "banner-" + newID();

            await putImage(
              newlyStoredImageID,
              pendingBanner.blob
            );

            data.bannerImageId =
              newlyStoredImageID;

            data.banner = "";
          }
        }

        const saved = item
          ? updateRecord(type, item.id, data)
          : createRecord(type, data);

        if (!saved) {
          if (newlyStoredImageID) {
            await removeImage(newlyStoredImageID);
          }

          saveButton.disabled = false;
          return;
        }

        const newRecordID = item?.id || saved.id;

        // Preserve the popup's navigational history.
        const returnPage = editorReturn;

        revokePendingBanner();
        editorContext = null;

        closeOverlay(false);

        if (returnPage) {
          editorReturn = null;

          const sameEntry =
            returnPage.type === type &&
            returnPage.id === newRecordID;

          openPopup(
            sameEntry ? type : returnPage.type,
            sameEntry ? newRecordID : returnPage.id,
            false
          );
        } else {
          openManager();
        }

        // Remove old image blobs only after the
        // record changes have been persisted.
        try {
          await removeOrphanImages();
        } catch (error) {
          console.warn(
            "Deferred image cleanup:",
            error
          );
        }

      } catch (error) {
        console.error(error);
        notify("Could not save this entry.");
        saveButton.disabled = false;
      }
    };
  }

  /* ======================================================
     15. GENRE CREATION PANEL
  ====================================================== */

  function openGenres() {
    detail(`
      <span class="detail-eyebrow">
        PERSONAL CATEGORIES
      </span>

      <h2 id="detailTitle">Genre Creation</h2>

      <p>
        Create all your main genres and
        secondary tags manually.
      </p>

      ${["main", "secondary"].map(type => `
        <h3>
          ${type === "main"
            ? "Main Genres"
            : "Secondary Genres & Tags"}
        </h3>

        <div class="genre-create-row">
          <input
            id="genre-${type}"
            class="form-input"
            placeholder="Enter a name..."
          >

          <button
            type="button"
            class="soft-button"
            data-add-genre="${type}"
          >
            Add
          </button>
        </div>

        <div class="genre-list">
          ${genreRecords(type).map(genre => `
            <span class="genre-chip">
              ${escapeHTML(genre.name)}

              <button
                type="button"
                data-rename-genre="${type}"
                data-genre-id="${escapeHTML(genre.id)}"
                aria-label="Rename genre"
              >✎</button>

              <button
                type="button"
                data-delete-genre="${type}"
                data-genre-id="${escapeHTML(genre.id)}"
                aria-label="Delete genre"
              >×</button>
            </span>
          `).join("")}
        </div>
      `).join("")}
    `);

    $$("[data-add-genre]").forEach(button => {
      button.onclick = () => {
        const type = button.dataset.addGenre;

        createGenre(
          type,
          $("#genre-" + type).value
        );
      };
    });

    for (const type of ["main", "secondary"]) {
      $("#genre-" + type).onkeydown = event => {
        if (event.key === "Enter") {
          event.preventDefault();

          createGenre(
            type,
            event.target.value
          );
        }
      };
    }

    $$("[data-rename-genre]").forEach(button => {
      button.onclick = () => renameGenre(
        button.dataset.renameGenre,
        button.dataset.genreId
      );
    });

    $$("[data-delete-genre]").forEach(button => {
      button.onclick = () => {
        const type = button.dataset.deleteGenre;
        const genreID = button.dataset.genreId;

        confirmDeletion(
          "Delete this genre and remove its assignments?",
          () => deleteGenre(type, genreID)
        );
      };
    });
  }

  /* ======================================================
     16. LIBRARY AND WATCHLIST
  ====================================================== */

  function openLibrary(mode) {
    activeCollection = mode;
    collectionSearch = "";
    collectionSort = "alphabetical";
    collectionGenre = "";
    collectionFormat = "";

    detail(`
      <span class="detail-eyebrow">
        YOUR ARCHIVE
      </span>

      <h2 id="detailTitle">
        ${mode === "library"
          ? "Library"
          : "Watchlist"}
      </h2>

      <p>
        ${mode === "library"
          ? "All your films, series and other productions."
          : "The stories you plan to watch."}
      </p>

      <div class="library-toolbar">
        <div class="library-control">
          <label for="librarySearch">
            Search
          </label>

          <input
            id="librarySearch"
            class="library-input"
            placeholder="Find a title..."
          >
        </div>

        <div class="library-control">
          <label for="librarySort">
            Sort
          </label>

          <select
            id="librarySort"
            class="library-select"
          >
            ${D.sorting.map(item => `
              <option value="${escapeHTML(item.id)}">
                ${escapeHTML(item.title)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="library-control">
          <label for="libraryGenre">
            Genre
          </label>

          <select
            id="libraryGenre"
            class="library-select"
          >
            <option value="">All genres</option>

            ${state.archive.genres.map(item => `
              <option value="${escapeHTML(item.id)}">
                ${escapeHTML(item.name)}
              </option>
            `).join("")}
          </select>
        </div>

        <div class="library-control">
          <label for="libraryFormat">
            Media format
          </label>

          <select
            id="libraryFormat"
            class="library-select"
          >
            <option value="">All formats</option>

            ${D.mediaTypes.map(type => `
              <option value="${escapeHTML(type)}">
                ${escapeHTML(type)}
              </option>
            `).join("")}
          </select>
        </div>
      </div>

      <div
        id="libraryCount"
        class="library-count"
      ></div>

      <div
        id="libraryResults"
        class="library-results"
      ></div>
    `);

    $("#librarySearch").oninput = event => {
      collectionSearch = event.target.value;
      renderLibrary();
    };

    $("#librarySort").onchange = event => {
      collectionSort = event.target.value;
      renderLibrary();
    };

    $("#libraryGenre").onchange = event => {
      collectionGenre = event.target.value;
      renderLibrary();
    };

    $("#libraryFormat").onchange = event => {
      collectionFormat = event.target.value;
      renderLibrary();
    };

    renderLibrary();
  }

  function renderLibrary() {
    let items = [...records("production")];

    if (activeCollection === "watchlist") {
      items = items.filter(item =>
        item.watchlist === true ||
        item.status === "Planned"
      );
    }

    const query = collectionSearch.trim().toLowerCase();

    if (query) {
      items = items.filter(item =>
        titleOf(item).toLowerCase().includes(query)
      );
    }

    if (collectionGenre) {
      items = items.filter(item =>
        (item.mainGenreIds || []).includes(
          collectionGenre
        )
      );
    }

    if (collectionFormat) {
      items = items.filter(item =>
        item.mediaType === collectionFormat
      );
    }

    const rating = item => ratingValue(item);
    const alphabetical = (a, b) =>
      titleOf(a).localeCompare(titleOf(b));

    items.sort((a, b) => {
      switch (collectionSort) {
        case "alphabeticalReverse":
          return -alphabetical(a, b);

        case "highestRated":
          return (rating(b) ?? -1) -
            (rating(a) ?? -1) ||
            alphabetical(a, b);

        case "lowestRated":
          return (rating(a) ?? 999) -
            (rating(b) ?? 999) ||
            alphabetical(a, b);

        case "lastWatched":
          return timeOf(b.lastWatched) -
            timeOf(a.lastWatched) ||
            alphabetical(a, b);

        case "newestAdded":
          return timeOf(b.createdAt) -
            timeOf(a.createdAt) ||
            alphabetical(a, b);

        case "oldestAdded":
          return timeOf(a.createdAt) -
            timeOf(b.createdAt) ||
            alphabetical(a, b);

        case "earliestRelease":
          return (timeOf(a.releaseStart) || Infinity) -
            (timeOf(b.releaseStart) || Infinity) ||
            alphabetical(a, b);

        case "latestRelease":
          return timeOf(b.releaseStart) -
            timeOf(a.releaseStart) ||
            alphabetical(a, b);

        case "custom":
          return (a.order ?? 0) -
            (b.order ?? 0) ||
            alphabetical(a, b);

        default:
          return alphabetical(a, b);
      }
    });

    $("#libraryCount").textContent =
      items.length + " production" +
      (items.length === 1 ? "" : "s");

    $("#libraryResults").innerHTML =
      items.length
        ? items.map(item => `
          <button
            type="button"
            class="library-entry"
            data-library-id="${escapeHTML(item.id)}"
          >
            <span class="library-entry-main">
              <span class="library-entry-title">
                ${escapeHTML(titleOf(item))}
              </span>

              <span class="library-entry-meta">
                ${escapeHTML(item.mediaType || "Production")}
              </span>
            </span>

            <span class="library-entry-rating">
              ${rating(item) === null
                ? "—"
                : rating(item).toFixed(1) + " / 10"}
            </span>
          </button>
        `).join("")
        : `
          <div class="library-empty">
            <h3>Nothing here yet.</h3>

            <p>
              Your productions will appear here
              once you start creating them.
            </p>
          </div>
        `;

    $$("[data-library-id]").forEach(button => {
      button.onclick = () => {
        closeOverlay(false);

        openPopup(
          "production",
          button.dataset.libraryId
        );
      };
    });
  }

  /* ======================================================
     17. GLOBAL SEARCH
  ====================================================== */

  function openSearch() {
    $("#globalSearch").value = "";
    $("#searchResults").innerHTML = "";

    openOverlay(searchOverlay);

    $("#globalSearch").focus();
  }

  function renderSearch() {
    const query = $("#globalSearch")
      .value.trim().toLowerCase();

    const results = [];

    if (query) {
      for (const type of TYPES) {
        for (const item of records(type)) {
          if (titleOf(item).toLowerCase().includes(query)) {
            results.push({ type, item });
          }
        }
      }
    }

    $("#searchResults").innerHTML =
      results.slice(0, 60).map(({ type, item }) => `
        <button
          type="button"
          class="search-result"
          data-search-type="${type}"
          data-search-id="${escapeHTML(item.id)}"
        >
          <span>
            ${escapeHTML(titleOf(item))}
          </span>

          <small>${type}</small>
        </button>
      `).join("");

    $$("[data-search-id]").forEach(button => {
      button.onclick = () => {
        const type = button.dataset.searchType;
        const rid = button.dataset.searchId;

        closeOverlay(false);

        openPopup(type, rid);
      };
    });
  }

  /* ======================================================
     18. SETTINGS
  ====================================================== */

  function openSettings() {
    const ranges = [
      ["starDensity", "Star density", 10],
      ["starBrightness", "Star brightness", 10],
      ["nebulaIntensity", "Nebula intensity", 0],
      ["constellationGlow", "Constellation glow", 0]
    ];

    detail(`
      <span class="detail-eyebrow">
        YOUR UNIVERSE
      </span>

      <h2 id="detailTitle">Settings</h2>

      ${ranges.map(([key, label, min]) => `
        <div class="detail-row">
          <label for="setting-${key}">
            ${label}
          </label>

          <div>
            <input
              id="setting-${key}"
              class="setting-range"
              type="range"
              min="${min}"
              max="100"
              step="5"
              value="${state.settings[key]}"
            >

            <output
              id="value-${key}"
              class="setting-value"
            >
              ${state.settings[key]}
            </output>
          </div>
        </div>
      `).join("")}

      <div class="detail-row">
        <label for="setting-motion">
          Reduce Motion
        </label>

        <input
          id="setting-motion"
          class="motion-checkbox"
          type="checkbox"
          ${state.settings.reduceMotion
            ? "checked" : ""}
        >
      </div>

      <h3>Backups</h3>

      <p>
        Complete backups include your archive
        and locally stored banner images.
      </p>

      <button
        type="button"
        class="detail-action"
        id="exportArchive"
      >
        Export complete archive
      </button>

      <button
        type="button"
        class="detail-action"
        id="importArchive"
      >
        Import archive
      </button>
    `);

    for (const [key] of ranges) {
      $("#setting-" + key).oninput = event => {
        state.settings[key] = Number(
          event.target.value
        );

        $("#value-" + key).textContent =
          event.target.value;

        if (key === "starDensity") {
          buildBackgroundStars();
        }

        saveState();
      };
    }

    $("#setting-motion").onchange = event => {
      state.settings.reduceMotion =
        event.target.checked;

      applyMotion();
      saveState();
    };

    $("#exportArchive").onclick = exportBackup;

    $("#importArchive").onclick = () => {
      $("#importFile").click();
    };
  }

  /* ======================================================
     19. BACKUPS WITH IMAGE BLOBS
  ====================================================== */

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () =>
        resolve(reader.result);

      reader.onerror = () =>
        reject(reader.error);

      reader.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataURL) {
    const parts = dataURL.split(",");

    if (parts.length !== 2) {
      throw new Error("Invalid image data.");
    }

    const mime =
      /^data:([^;,]+)/.exec(parts[0])?.[1] ||
      "image/jpeg";

    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob(
      [bytes],
      { type: mime }
    );
  }

  async function exportBackup() {
    try {
      notify("Preparing complete backup...");

      const imageKeys = new Set();

      for (const type of ["group", "production"]) {
        for (const item of records(type)) {
          if (item.bannerImageId) {
            imageKeys.add(item.bannerImageId);
          }
        }
      }

      const images = {};

      for (const key of imageKeys) {
        const blob = await getImage(key);

        if (!blob) {
          throw new Error(
            "A referenced banner image is missing."
          );
        }

        images[key] = await blobToDataURL(blob);
      }

      const backup = {
        app: D.appName,
        schemaVersion: D.schemaVersion,
        exportedAt: new Date().toISOString(),
        data: state,
        images
      };

      const blob = new Blob(
        [JSON.stringify(backup)],
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
      }, 3000);

      notify("Complete backup prepared.");

    } catch (error) {
      console.error(error);
      notify("Backup export failed.");
    }
  }

  async function importBackup(file) {
    if (!file) return;

    try {
      const backup = JSON.parse(
        await file.text()
      );

      if (
        backup.app !== D.appName ||
        backup.schemaVersion !== D.schemaVersion ||
        !backup.data?.archive ||
        !TYPES.every(type =>
          Array.isArray(
            backup.data.archive[COLLECTION[type]]
          )
        )
      ) {
        throw new Error("Invalid archive format.");
      }

      const imported = normalizeState(backup.data);

      const imageData = backup.images || {};

      // A backup without the image blobs cannot
      // restore the banners it references.
      for (const type of ["group", "production"]) {
        for (const item of imported.archive[COLLECTION[type]]) {
          if (item.bannerImageId) {
            const existing = await getImage(
              item.bannerImageId
            ).catch(() => null);

            if (
              !Object.hasOwn(imageData, item.bannerImageId) &&
              !existing
            ) {
              throw new Error(
                "Backup is missing a required banner."
              );
            }
          }
        }
      }

      if (!confirm(
        "Replace your current archive with this backup? " +
        "Export your current archive first if you want to keep it."
      )) {
        return;
      }

      const previous = state;
      const addedImageKeys = [];

      try {
        for (const [key, value] of Object.entries(imageData)) {
          const original = await getImage(key).catch(() => null);

          if (!original) {
            await putImage(
              key,
              dataURLToBlob(value)
            );

            addedImageKeys.push(key);
          } else {
            // Preserve existing image IDs unless the
            // imported backup explicitly replaces them.
            await putImage(
              key,
              dataURLToBlob(value)
            );
          }

          if (imageURLCache.has(key)) {
            URL.revokeObjectURL(imageURLCache.get(key));
            imageURLCache.delete(key);
          }
        }

        state = imported;

        if (!saveState()) {
          state = previous;
          throw new Error("Unable to save imported archive.");
        }

      } catch (error) {
        state = previous;

        for (const key of addedImageKeys) {
          await removeImage(key).catch(console.warn);
        }

        throw error;
      }

      closeOverlay(false);
      closePopup();

      rebuildUniverse();
      buildBackgroundStars();
      applyMotion();
      goHome();

      notify("Archive restored successfully.");

    } catch (error) {
      console.error("Import failed:", error);

      notify(
        error.message ||
        "Import failed. Check the backup file."
      );

    } finally {
      $("#importFile").value = "";
    }
  }

  /* ======================================================
     20. EVENT WIRING
  ====================================================== */

  function bindControls() {
    $("#homeButton").onclick = goHome;

    $("#focusButton").onclick = () => {
      const node = focusedID
        ? nodeMap.get(focusedID)
        : null;

      if (node) {
        focusNode(node);
      } else {
        goHome();
      }
    };

    $("#searchButton").onclick = openSearch;

    /* Popup controls */

    $("#popupCloseButton").onclick = closePopup;
    $("#popupBackButton").onclick = popupBack;

    $("#popupBackdrop").onclick = closePopup;

    $("#popupEditButton").onclick = () => {
      if (!currentPopup || currentPopup.demo) {
        return;
      }

      editorReturn = { ...currentPopup };

      openForm(
        currentPopup.type,
        currentPopup.id
      );
    };

    $("#popupAddChildButton").onclick = () => {
      if (!currentPopup || currentPopup.demo) {
        return;
      }

      const nextType = NEXT[currentPopup.type];

      if (!nextType) return;

      editorReturn = { ...currentPopup };

      openForm(
        nextType,
        null,
        currentPopup.id
      );
    };

    /* Generic panels */

    $("#closeDetailButton").onclick = () =>
      closeOverlay();

    $("#detailBackdrop").onclick = () =>
      closeOverlay();

    $("#closeSearchButton").onclick = () =>
      closeOverlay();

    $("#searchBackdrop").onclick = () =>
      closeOverlay();

    $("#closeEditorButton").onclick = () => {
      revokePendingBanner();
      editorContext = null;
      editorReturn = null;
      closeOverlay();
    };

    $("#editorBackdrop").onclick = () => {
      revokePendingBanner();
      editorContext = null;
      editorReturn = null;
      closeOverlay();
    };

    $("#globalSearch").oninput = renderSearch;

    /* Delete confirmations */

    $("#cancelConfirmButton").onclick =
      closeConfirmation;

    $("#acceptConfirmButton").onclick = () => {
      const action = confirmationCallback;

      closeConfirmation();

      if (action) {
        Promise.resolve(action()).catch(error => {
          console.error(error);
          notify("Operation failed.");
        });
      }
    };

    /* Phone-gallery banner selection */

    $("#bannerFileInput").onchange = async event => {
      const file = event.target.files?.[0];

      event.target.value = "";

      if (!file || !editorContext) return;

      const token = ++galleryToken;

      try {
        notify("Preparing your banner...");

        const blob = await compressImage(file);

        if (token !== galleryToken) return;

        if (pendingBannerURL) {
          URL.revokeObjectURL(pendingBannerURL);
        }

        pendingBanner = { blob };
        pendingBannerURL = URL.createObjectURL(blob);

        const preview = $("#bannerPreview");

        if (preview) {
          preview.innerHTML = `
            <img
              class="banner-preview-image"
              alt="Selected banner"
            >
          `;

          preview.querySelector("img").src =
            pendingBannerURL;
        }

        notify("Image ready. Save your entry.");

      } catch (error) {
        console.error(error);

        notify(
          error.message ||
          "This image could not be opened."
        );
      }
    };

    $("#importFile").onchange = event => {
      importBackup(event.target.files?.[0]);
    };

    /* Escape / keyboard navigation */

    window.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;

      if (confirmOverlay.classList.contains("open")) {
        closeConfirmation();
        return;
      }

      if (activeOverlay) {
        closeOverlay();
        return;
      }

      if (popupOpen()) {
        popupBack();
      }
    });

    /* Stop touch gestures or wheel zoom from
       accidentally reaching the camera. */

    popup.addEventListener("wheel", event => {
      event.stopPropagation();
    }, { passive: true });

    /* Window resizing */

    let resizeTimer;

    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);

      resizeTimer = setTimeout(() => {
        const oldMobile = width < 650;
        const newMobile = innerWidth < 650;

        resizeGraphics();

        if (oldMobile !== newMobile) {
          rebuildUniverse();
        }
      }, 170);
    });

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          stopLoop();
        } else {
          startLoop();
        }
      }
    );

    reducedMedia.addEventListener(
      "change",
      applyMotion
    );

    window.addEventListener("storage", event => {
      if (event.key !== D.storageKey) return;

      state = loadState();

      rebuildUniverse();
      buildBackgroundStars();

      if (currentPopup) {
        const entry = resolveEntry(
          currentPopup.type,
          currentPopup.id
        );

        if (entry) {
          openPopup(
            currentPopup.type,
            currentPopup.id,
            false
          );
        } else {
          closePopup();
        }
      }

      notify("Archive updated from another tab.");
    });
  }

  /* ======================================================
     21. INITIALIZE
  ====================================================== */

  function initialize() {
    applyMotion();

    resizeGraphics();
    rebuildUniverse();

    bindGestures();
    bindControls();

    const home = homeCamera();

    setCamera(
      home.x,
      home.y,
      home.zoom
    );

    startLoop();

    if (!localStorage.getItem(D.storageKey)) {
      saveState();
    }
  }

  initialize();

})();
