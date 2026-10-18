
"use strict";

/* ==========================================================
   WATCH ARCHIVE — STEP 3
   GROUPS, HIERARCHY & MANUAL GENRES

   Four-level editable archive
   Stable IDs and parent relationships
   Genre creation and assignment
   Natural constellation stars
   Continuous free-moving camera
   Local autosaving and JSON backups
========================================================== */

(() => {
  const DATA = window.WATCH_DATA;
  if (!DATA) {
    console.error("Missing data.js");
    return;
  }

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clone = x => JSON.parse(JSON.stringify(x));
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const lerp = (a,b,t) => a+(b-a)*t;
  const smooth = (a,b,x) => {
    const t = clamp((x-a)/(b-a),0,1);
    return t*t*(3-2*t);
  };

  const viewport = $("#viewport");
  const starLayer = $("#starLayer");
  const detailOverlay = $("#detailOverlay");
  const editorOverlay = $("#editorOverlay");
  const searchOverlay = $("#searchOverlay");
  const confirmOverlay = $("#confirmOverlay");

  const reduceMedia = matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  const TYPES = ["group","production","season","episode"];

  const COLLECTIONS = {
    group: "groups",
    production: "productions",
    season: "seasons",
    episode: "episodes"
  };

  const PARENT_KEYS = {
    production: "groupId",
    season: "productionId",
    episode: "seasonId"
  };

  let state = loadState();
  let nodes = [];
  let edges = [];
  let nodeMap = new Map();

  let width = innerWidth;
  let height = innerHeight;
  let dpr = 1;

  let selectedNode = null;
  let focusedNode = null;
  let currentOverlay = null;
  let oldFocus = null;
  let confirmCallback = null;
  let toastTimer = 0;

  let dirty = true;
  let running = false;
  let frameHandle = 0;
  let lastFrame = 0;
  let quality = 1;

  const camera = {x:0,y:0,zoom:1};
  let travel = null;

  const pointers = new Map();
  let gesture = null;
  let blockClickUntil = 0;

  let managerView = {type:null,id:null};
  let activeCollection = "library";
  let filters = {};

  const canvas = $("#constellationCanvas");
  const ctx = canvas.getContext("2d");

  const bgCanvas = $("#backgroundStars");
  const bgCtx = bgCanvas.getContext("2d");

  const nebulaCanvas = $("#nebulaCanvas");
  const nebulaCtx = nebulaCanvas.getContext("2d");

  let backgroundStars = [];
  let nebulaTexture = null;

  /* ======================================================
     UTILITIES
  ====================================================== */

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();

    return "wa-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2,11);
  }

  function hash(value) {
    let h = 2166136261;
    for (const char of String(value)) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h,16777619);
    }
    return h >>> 0;
  }

  function random(seed) {
    let t = seed + 0x6D2B79F5;
    t = Math.imul(t^(t>>>15),t|1);
    t ^= t + Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      c => ({
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#39;"
      })[c]
    );
  }

  function dateValue(value) {
    if (!value) return 0;
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : 0;
  }

  function safeNumber(value, fallback, min, max) {
    if (value === "" || value == null) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? clamp(n,min,max) : fallback;
  }

  function titleOf(item) {
    return String(item?.title || item?.name || "Untitled");
  }

  function notify(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"),3100);
  }

  function reduced() {
    return state.settings.reduceMotion || reduceMedia.matches;
  }

  function applyMotion() {
    document.body.classList.toggle("reduce-motion",reduced());
    dirty = true;
  }

  /* ======================================================
     STORAGE
  ====================================================== */

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
    const base = initialState();
    const a = input?.archive || {};
    const s = input?.settings || {};

    const archive = {...a};

    for (const type of TYPES) {
      const key = COLLECTIONS[type];
      archive[key] = Array.isArray(a[key]) ? a[key] : [];
    }

    archive.genres = Array.isArray(a.genres) ? a.genres : [];
    archive.secondaryGenres = Array.isArray(a.secondaryGenres)
      ? a.secondaryGenres : [];

    return {
      ...base,
      ...(input || {}),
      schemaVersion: DATA.schemaVersion,
      settings: {
        ...base.settings,
        ...s,
        starDensity: safeNumber(s.starDensity,75,10,100),
        starBrightness: safeNumber(s.starBrightness,60,10,100),
        nebulaIntensity: safeNumber(s.nebulaIntensity,65,0,100),
        constellationGlow: safeNumber(s.constellationGlow,65,0,100),
        reduceMotion: s.reduceMotion === true
      },
      archive
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(DATA.storageKey);
      if (!raw) return initialState();
      const data = JSON.parse(raw);

      if (data.schemaVersion !== DATA.schemaVersion) {
        console.warn("Storage schema mismatch. Original data retained.");
        return initialState();
      }

      return normalizeState(data);
    } catch(e) {
      console.error("Storage read failed",e);
      return initialState();
    }
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();

    try {
      localStorage.setItem(DATA.storageKey,JSON.stringify(state));
      return true;
    } catch(e) {
      console.error("Storage write failed",e);
      notify("Saving failed. Export or free browser storage.");
      return false;
    }
  }

  function commitChange(message) {
    if (!saveState()) return false;
    rebuildUniverse();
    dirty = true;
    if (message) notify(message);
    return true;
  }

  /* ======================================================
     ENTITY RELATIONSHIPS
  ====================================================== */

  function collection(type) {
    return state.archive[COLLECTIONS[type]] || [];
  }

  function getEntity(type,id) {
    return collection(type).find(
      item => String(item.id) === String(id)
    ) || null;
  }

  function childrenOf(type,id) {
    const next = {
      group:"production",
      production:"season",
      season:"episode"
    }[type];

    if (!next) return [];

    const key = PARENT_KEYS[next];

    return collection(next).filter(
      item => String(item[key] || item.parentId || "") === String(id)
    );
  }

  function parentOf(type,item) {
    if (type === "group") return null;

    const key = PARENT_KEYS[type];
    const parentId = item[key] || item.parentId;
    if (!parentId) return null;

    const parentType = {
      production:"group",
      season:"production",
      episode:"season"
    }[type];

    const parent = getEntity(parentType,parentId);
    return parent ? {type:parentType,item:parent} : null;
  }

  function nextOrder(type,parentId = null) {
    let siblings = collection(type);

    if (type !== "group") {
      const key = PARENT_KEYS[type];
      siblings = siblings.filter(
        item => String(item[key] || "") === String(parentId || "")
      );
    }

    return siblings.reduce(
      (max,item) => Math.max(max,Number(item.order) || 0),
      -1
    )+1;
  }

  function sortedChildren(type,parentId) {
    return childrenOf(type,parentId).sort(
      (a,b) => (a.order ?? 0)-(b.order ?? 0) ||
        titleOf(a).localeCompare(titleOf(b))
    );
  }

  function isFilm(item) {
    return [
      "Movie","Short Film","Special","Documentary"
    ].includes(item.mediaType);
  }

  /* ======================================================
     CUSTOM GENRES
  ====================================================== */

  function genreCollection(type) {
    return state.archive[
      type === "secondary" ? "secondaryGenres" : "genres"
    ];
  }

  function genreName(id,type) {
    return genreCollection(type).find(
      g => g.id === id
    )?.name || "";
  }

  function createGenre(type,name) {
    const list = genreCollection(type);
    const clean = name.trim();

    if (!clean) return false;

    if (list.some(g =>
      g.name.toLowerCase() === clean.toLowerCase()
    )) {
      notify("That genre already exists.");
      return false;
    }

    list.push({
      id:uid(),
      name:clean,
      createdAt:new Date().toISOString()
    });

    return commitChange("Genre created.");
  }

  function renameGenre(type,id,name) {
    const g = genreCollection(type).find(g => g.id === id);
    const clean = name.trim();

    if (!g || !clean) return;

    if (genreCollection(type).some(other =>
      other.id !== id &&
      other.name.toLowerCase() === clean.toLowerCase()
    )) {
      notify("That genre name already exists.");
      return;
    }

    g.name = clean;
    commitChange("Genre renamed.");
  }

  function deleteGenre(type,id) {
    const key = type === "secondary"
      ? "secondaryGenreIds" : "mainGenreIds";

    for (const recordType of ["group","production"]) {
      for (const item of collection(recordType)) {
        if (Array.isArray(item[key])) {
          item[key] = item[key].filter(x => x !== id);
        }
      }
    }

    const list = genreCollection(type);
    const index = list.findIndex(g => g.id === id);
    if (index !== -1) list.splice(index,1);

    commitChange("Genre deleted.");
  }

  /* ======================================================
     ENTITY CREATION / UPDATING
  ====================================================== */

  function createEntity(type,values) {
    const now = new Date().toISOString();

    const item = {
      id:uid(),
      title:String(values.title || "").trim(),
      createdAt:now,
      updatedAt:now,
      order:nextOrder(type,values[PARENT_KEYS[type]]),
      notes:values.notes || ""
    };

    if (!item.title) {
      notify("Please enter a title.");
      return null;
    }

    Object.assign(item,values);

    if (type === "group" || type === "production") {
      item.mainGenreIds = values.mainGenreIds || [];
      item.secondaryGenreIds = values.secondaryGenreIds || [];
      item.banner = values.banner || "";
    }

    if (type === "production") {
      item.groupId = values.groupId || null;
      item.watchlist = values.watchlist === true;
      item.mediaType = values.mediaType || "TV Series";
      item.status = values.status || "Planned";
    }

    if (type === "season") {
      if (!getEntity("production",values.productionId)) {
        notify("Choose a valid production.");
        return null;
      }
    }

    if (type === "episode") {
      if (!getEntity("season",values.seasonId)) {
        notify("Choose a valid season.");
        return null;
      }

      item.duration = Math.max(0,Number(values.duration) || 0);
    }

    if (type === "production" &&
        item.groupId &&
        !getEntity("group",item.groupId)) {
      notify("Choose an existing group.");
      return null;
    }

    collection(type).push(item);

    if (!commitChange(`${type[0].toUpperCase()+type.slice(1)} created.`)) {
      collection(type).pop();
      return null;
    }

    return item;
  }

  function updateEntity(type,id,values) {
    const item = getEntity(type,id);
    if (!item) return false;

    const clean = String(values.title || "").trim();
    if (!clean) {
      notify("Title cannot be empty.");
      return false;
    }

    if (type === "production" && values.groupId &&
        !getEntity("group",values.groupId)) {
      notify("Invalid group selected.");
      return false;
    }

    if (type === "season" &&
        !getEntity("production",values.productionId)) {
      notify("Invalid production selected.");
      return false;
    }

    if (type === "episode" &&
        !getEntity("season",values.seasonId)) {
      notify("Invalid season selected.");
      return false;
    }

    const oldParent = type === "group" ? null :
      item[PARENT_KEYS[type]] || null;

    const newParent = type === "group" ? null :
      values[PARENT_KEYS[type]] || null;

    if (oldParent !== newParent) {
      values.order = nextOrder(type,newParent);
      // Child coordinates are regenerated relative to the new parent.
      delete item.mapX;
      delete item.mapY;
    }

    Object.assign(item,values,{
      id:item.id,
      createdAt:item.createdAt,
      updatedAt:new Date().toISOString()
    });

    return commitChange("Changes saved.");
  }

  function deleteEntity(type,id) {
    const item = getEntity(type,id);
    if (!item) return;

    // Delete descendants from the bottom upwards.
    for (const child of childrenOf(type,id)) {
      const next = {
        group:"production",
        production:"season",
        season:"episode"
      }[type];

      deleteEntitySilently(next,child.id);
    }

    const list = collection(type);
    const index = list.findIndex(x => x.id === id);
    if (index !== -1) list.splice(index,1);

    commitChange("Entry deleted.");
  }

  function deleteEntitySilently(type,id) {
    const next = {
      group:"production",
      production:"season",
      season:"episode"
    }[type];

    if (next) {
      for (const child of childrenOf(type,id)) {
        deleteEntitySilently(next,child.id);
      }
    }

    const list = collection(type);
    const index = list.findIndex(x => x.id === id);
    if (index !== -1) list.splice(index,1);
  }

  function moveOrder(type,id,direction) {
    const item = getEntity(type,id);
    if (!item) return;

    const key = PARENT_KEYS[type];

    const parentId = key ? item[key] || null : null;

    const siblings = collection(type)
      .filter(other =>
        !key ||
        String(other[key] || "") === String(parentId || "")
      )
      .sort((a,b) => (a.order ?? 0)-(b.order ?? 0));

    const index = siblings.findIndex(x => x.id === id);
    const otherIndex = index + direction;

    if (otherIndex < 0 || otherIndex >= siblings.length) return;

    [siblings[index],siblings[otherIndex]] =
      [siblings[otherIndex],siblings[index]];

    siblings.forEach((s,i) => {s.order = i;});

    commitChange("Order updated.");
  }

  /* ======================================================
     CONSTELLATION LAYOUT
  ====================================================== */

  function starProperties(id,type,magnitude=2.4) {
    const seed = hash(id);

    const warmer = random(seed+18);
    const hue = warmer < .13
      ? [255,219,199]
      : warmer < .37
        ? [226,235,255]
        : warmer < .82
          ? [188,207,255]
          : [220,200,255];

    return {
      color:hue,
      size:.72+random(seed+7)*.85,
      halo:.6+random(seed+8)*1.35,
      opacity:.68+random(seed+9)*.32,
      spikes:random(seed+10) > .51,
      spikeAngle:random(seed+11)*Math.PI,
      spikeRatio:.55+random(seed+12)*1.1,
      twinkleSpeed:.00022+random(seed+13)*.00055,
      phase:random(seed+14)*Math.PI*2,
      eccentricity:.82+random(seed+15)*.38,
      magnitude
    };
  }

  function makeNode(obj) {
    return {
      ...obj,
      id:String(obj.id),
      title:String(obj.title || "Untitled"),
      visible:0,
      element:null,
      sx:-9999,
      sy:-9999,
      appearance:starProperties(
        obj.id,obj.type,obj.magnitude
      )
    };
  }

  function pushNode(node) {
    if (nodeMap.has(node.id)) return;
    nodes.push(node);
    nodeMap.set(node.id,node);
  }

  function groupPosition(item,index) {
    const x = Number(item.mapX ?? item.x);
    const y = Number(item.mapY ?? item.y);

    if ((item.mapX != null || item.x != null) &&
        (item.mapY != null || item.y != null) &&
        Number.isFinite(x) && Number.isFinite(y)) {
      return {x,y};
    }

    const seed = hash(item.id);
    const radius =
      DATA.groupPlacement.initialRadius +
      Math.sqrt(index)*DATA.groupPlacement.distanceGrowth;

    const angle =
      DATA.groupPlacement.angleOffset +
      index*2.39996323 +
      (random(seed+5)-.5)*.4;

    return {
      x:Math.cos(angle)*radius,
      y:Math.sin(angle)*radius
    };
  }

  function offsetPosition(item,index,count,type) {
    const radii = {
      production:215,
      season:101,
      episode:43
    };

    const seed = hash(item.id);
    const base = radii[type] || 150;

    const ring = Math.floor(index/9);
    const ringIndex = index%9;
    const ringCount = Math.min(9,count-ring*9);

    const angle =
      -Math.PI/2 +
      ringIndex*Math.PI*2/Math.max(ringCount,2) +
      (random(seed+2)-.5)*.27;

    const radius = base*(1+ring*.9)*
      (.75+random(seed+3)*.52);

    return {
      x:Math.cos(angle)*radius,
      y:Math.sin(angle)*radius
    };
  }

  function addTree(parentRecord,parentNode) {
    const nextType = {
      group:"production",
      production:"season",
      season:"episode"
    }[parentNode.type];

    if (!nextType) return;

    const children = sortedChildren(
      parentNode.type,parentRecord.id
    );

    if (parentNode.demo) {
      const demoChildren = parentRecord.children || [];
      children.length = 0;
      children.push(...demoChildren);
    }

    children.forEach((child,index) => {
      const offset = offsetPosition(
        child,index,children.length,nextType
      );

      const customX = child.mapX != null
        ? Number(child.mapX) : NaN;
      const customY = child.mapY != null
        ? Number(child.mapY) : NaN;

      const node = makeNode({
        id:child.id,
        title:titleOf(child),
        type:nextType,
        parentId:parentNode.id,
        depth:parentNode.depth+1,
        demo:parentNode.demo,
        record:child,
        x:Number.isFinite(customX)
          ? customX : parentNode.x+offset.x,
        y:Number.isFinite(customY)
          ? customY : parentNode.y+offset.y,
        magnitude:1.5+random(hash(child.id)+31)*3
      });

      pushNode(node);
      addTree(child,node);
    });
  }

  function naturalEdges(siblings) {
    if (siblings.length < 2) return [];

    const linked = [siblings[0]];
    const unlinked = siblings.slice(1);
    const results = [];

    while (unlinked.length) {
      let candidate = null;

      for (const a of linked) {
        for (const b of unlinked) {
          const d = Math.hypot(a.x-b.x,a.y-b.y);

          if (!candidate || d < candidate.d) {
            candidate = {a,b,d};
          }
        }
      }

      if (!candidate) break;

      results.push({
        from:candidate.a.id,
        to:candidate.b.id
      });

      linked.push(candidate.b);
      unlinked.splice(unlinked.indexOf(candidate.b),1);
    }

    return results;
  }

  function rebuildUniverse() {
    nodes = [];
    edges = [];
    nodeMap = new Map();

    const scale = width < 650 ? .58 : 1;

    for (const entry of DATA.navigation.nodes) {
      pushNode(makeNode({
        id:"nav-"+entry.id,
        title:entry.title,
        type:"navigation",
        action:entry.action,
        x:entry.x*scale,
        y:entry.y*scale,
        depth:0,
        parentId:null,
        magnitude:entry.magnitude
      }));
    }

    for (const [a,b] of DATA.navigation.connections) {
      edges.push({
        from:"nav-"+a,
        to:"nav-"+b,
        navigation:true
      });
    }

    const actualGroups = [...collection("group")];

    const allGroups = actualGroups.length
      ? actualGroups
      : [...DATA.demoGroups];

    allGroups.forEach((group,i) => {
      const p = groupPosition(group,i);

      const n = makeNode({
        id:group.id,
        title:titleOf(group),
        type:"group",
        x:p.x,
        y:p.y,
        parentId:null,
        depth:0,
        demo:group.demo === true,
        record:group,
        magnitude:1.4+random(hash(group.id)+22)*1.9
      });

      pushNode(n);
      addTree(group,n);
    });

    // Standalone productions are independent map stars.
    const standalone = collection("production")
      .filter(p => !p.groupId && !p.parentId);

    standalone.forEach((p,i) => {
      const angle = i*2.39996323+1.6;
      const radius = 1120+Math.sqrt(i)*360;

      const x = Number.isFinite(Number(p.mapX))
        && p.mapX != null
          ? Number(p.mapX)
          : Math.cos(angle)*radius;

      const y = Number.isFinite(Number(p.mapY))
        && p.mapY != null
          ? Number(p.mapY)
          : Math.sin(angle)*radius;

      const n = makeNode({
        id:p.id,
        title:titleOf(p),
        type:"production",
        x,y,
        standalone:true,
        depth:0,
        parentId:null,
        record:p,
        magnitude:1.5+random(hash(p.id))*2.5
      });

      pushNode(n);
      addTree(p,n);
    });

    const parents = new Set(
      nodes.filter(n => n.parentId).map(n => n.parentId)
    );

    for (const parentId of parents) {
      const siblings = nodes.filter(n => n.parentId === parentId);
      edges.push(...naturalEdges(siblings));
    }

    buildStarButtons();
    dirty = true;
  }

  /* ======================================================
     CAMERA
  ====================================================== */

  function worldToScreen(x,y) {
    return {
      x:width/2+(x-camera.x)*camera.zoom,
      y:height/2+(y-camera.y)*camera.zoom
    };
  }

  function screenToWorld(x,y) {
    return {
      x:camera.x+(x-width/2)/camera.zoom,
      y:camera.y+(y-height/2)/camera.zoom
    };
  }

  function stopTravel() {travel=null;}

  function setCamera(x,y,zoom) {
    camera.x=x;
    camera.y=y;
    camera.zoom=clamp(zoom,DATA.camera.minZoom,DATA.camera.maxZoom);
    dirty=true;
  }

  function animateTo(target,duration=850) {
    stopTravel();

    if (reduced()) {
      setCamera(target.x,target.y,target.zoom);
      return;
    }

    travel = {
      start:{...camera},
      end:target,
      startTime:performance.now(),
      duration
    };
  }

  function updateTravel(time) {
    if (!travel) return;

    const t=clamp(
      (time-travel.startTime)/travel.duration,0,1
    );

    const e=t*t*(3-2*t);

    const z=Math.exp(lerp(
      Math.log(travel.start.zoom),
      Math.log(clamp(
        travel.end.zoom,
        DATA.camera.minZoom,
        DATA.camera.maxZoom
      )),
      e
    ));

    setCamera(
      lerp(travel.start.x,travel.end.x,e),
      lerp(travel.start.y,travel.end.y,e),
      z
    );

    if (t>=1) travel=null;
  }

  function zoomAt(x,y,factor) {
    stopTravel();

    const anchor=screenToWorld(x,y);
    const zoom=clamp(
      camera.zoom*factor,
      DATA.camera.minZoom,
      DATA.camera.maxZoom
    );

    setCamera(
      anchor.x-(x-width/2)/zoom,
      anchor.y-(y-height/2)/zoom,
      zoom
    );
  }

  function homeCamera() {
    const nav = nodes.filter(n => n.type === "navigation");

    if (!nav.length) return {x:0,y:0,zoom:1};

    const xs=nav.map(n=>n.x);
    const ys=nav.map(n=>n.y);

    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys),maxY=Math.max(...ys);

    const zoom=clamp(Math.min(
      width*(width<650?.80:.72)/(maxX-minX+110),
      height*.51/(maxY-minY+130),
      1.1
    ),DATA.camera.minZoom,1.1);

    return {
      x:(minX+maxX)/2,
      y:(minY+maxY)/2,
      zoom
    };
  }

  function goHome() {
    focusedNode=null;
    selectedNode=null;
    animateTo(homeCamera(),800);
  }

  function focusNode(node) {
    focusedNode=node;
    selectedNode=node.id;

    const targets={
      navigation:1.35,
      group:2.1,
      production:4.5,
      season:9.4,
      episode:13
    };

    let zoom=targets[node.type] || 2;

    if (
      Math.hypot(camera.x-node.x,camera.y-node.y)<12 &&
      camera.zoom>=zoom*.90
    ) {
      zoom=Math.min(DATA.camera.maxZoom,camera.zoom*1.3);
    }

    animateTo({
      x:node.x,
      y:node.y,
      zoom
    },950);
  }

  /* ======================================================
     SCREEN SPACE STAR LABELS
  ====================================================== */

  function buildStarButtons() {
    starLayer.replaceChildren();

    for (const node of nodes) {
      const el=document.createElement("button");

      el.type="button";
      el.className=
        `celestial-star ${node.type}-star`+
        (node.demo?" demo-star":"");

      el.setAttribute("aria-label","Explore "+node.title);

      const hit=document.createElement("span");
      hit.className="star-touch-area";

      const label=document.createElement("span");
      label.className="star-label";
      label.textContent=node.title;

      const variation=node.appearance;

      label.style.setProperty(
        "--label-distance",
        `${23+Math.round(variation.size*5)}px`
      );

      el.append(hit,label);

      el.addEventListener("click",event=>{
        event.stopPropagation();
        if (performance.now()<blockClickUntil) return;
        selectStar(node);
      });

      el.addEventListener("pointerenter",()=>{
        selectedNode=node.id;
        dirty=true;
      });

      el.addEventListener("pointerleave",()=>{
        selectedNode=focusedNode?.id || null;
        dirty=true;
      });

      el.addEventListener("focus",()=>{
        selectedNode=node.id;
        dirty=true;
      });

      node.element=el;
      starLayer.appendChild(el);
    }
  }

  function visibility(node) {
    if (node.type==="navigation" ||
        node.type==="group" ||
        node.standalone) return 1;

    const config={
      production:DATA.semanticZoom.productions,
      season:DATA.semanticZoom.seasons,
      episode:DATA.semanticZoom.episodes
    }[node.type];

    if (!config) return 1;

    let alpha=smooth(
      config.start,
      config.full,
      camera.zoom
    );

    const parent=nodeMap.get(node.parentId);

    if (parent) {
      const d=Math.hypot(
        camera.x-parent.x,
        camera.y-parent.y
      )*camera.zoom;

      const range=Math.max(width,height)*1.5;
      alpha*=1-smooth(range*.75,range*1.6,d);
    }

    return clamp(alpha,0,1);
  }

  function positionButtons() {
    for (const n of nodes) {
      const p=worldToScreen(n.x,n.y);
      n.sx=p.x;
      n.sy=p.y;
      n.visible=visibility(n);

      const onScreen=
        p.x>-130 && p.x<width+130 &&
        p.y>-130 && p.y<height+130;

      const shown=onScreen && n.visible>.025;

      n.element.classList.toggle("is-hidden",!shown);

      if (!shown) {
        n.element.tabIndex=-1;
        continue;
      }

      n.element.style.left=p.x+"px";
      n.element.style.top=p.y+"px";
      n.element.style.setProperty(
        "--visibility",
        n.visible.toFixed(3)
      );

      n.element.disabled=n.visible<.67;
      n.element.tabIndex=n.visible>=.67?0:-1;

      n.element.classList.toggle(
        "selected",selectedNode===n.id
      );
    }
  }

  /* ======================================================
     REALISTIC STAR RENDERING
  ====================================================== */

  function drawStar(n,time) {
    if (n.visible<.015) return;

    const x=n.sx,y=n.sy;
    if (x<-100||x>width+100||y<-100||y>height+100) return;

    const styles={
      navigation:DATA.appearance.navigationStars,
      group:DATA.appearance.groupStars,
      production:DATA.appearance.productionStars,
      season:DATA.appearance.seasonStars,
      episode:DATA.appearance.episodeStars
    };

    const style=styles[n.type];
    if (!style) return;

    const v=n.appearance;
    const [r,g,b]=v.color;

    const selected=selectedNode===n.id;

    const alpha=n.visible*v.opacity;

    const pulse=reduced()?1:
      1+Math.sin(time*v.twinkleSpeed+v.phase)*.055;

    const radius=style.radius*v.size*pulse;
    const glow=style.glow*v.halo*
      (state.settings.constellationGlow/65)*
      (selected?1.5:1);

    const outer=ctx.createRadialGradient(
      x,y,0,x,y,glow
    );

    outer.addColorStop(
      0,`rgba(${r},${g},${b},${alpha*.24})`
    );
    outer.addColorStop(
      .2,`rgba(${r},${g},${b},${alpha*.14})`
    );
    outer.addColorStop(
      .6,`rgba(${r},${g},${b},${alpha*.025})`
    );
    outer.addColorStop(1,"rgba(0,0,0,0)");

    ctx.save();

    // Slight elliptical imperfection.
    ctx.translate(x,y);
    ctx.rotate(v.spikeAngle*.15);
    ctx.scale(1,v.eccentricity);

    ctx.fillStyle=outer;
    ctx.beginPath();
    // Gradient is already in screen coordinates,
    // so draw glow in untransformed space below.
    ctx.restore();

    ctx.fillStyle=outer;
    ctx.beginPath();
    ctx.arc(x,y,glow,0,Math.PI*2);
    ctx.fill();

    const core=ctx.createRadialGradient(
      x,y,0,x,y,radius*2.8
    );

    core.addColorStop(
      0,`rgba(255,255,255,${alpha})`
    );
    core.addColorStop(
      .16,`rgba(${r},${g},${b},${alpha})`
    );
    core.addColorStop(
      .5,`rgba(${r},${g},${b},${alpha*.35})`
    );
    core.addColorStop(1,"rgba(0,0,0,0)");

    ctx.fillStyle=core;
    ctx.beginPath();
    ctx.ellipse(
      x,y,radius*2.8,
      radius*2.8*v.eccentricity,
      v.spikeAngle,0,Math.PI*2
    );
    ctx.fill();

    // Only some stars have diffraction spikes.
    if (v.spikes && (radius>2.1 || selected)) {
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(v.spikeAngle);

      const length=radius*(
        selected?7.5:4.5
      )*v.spikeRatio;

      ctx.globalAlpha=alpha*.5;

      let grad=ctx.createLinearGradient(-length,0,length,0);
      grad.addColorStop(0,"transparent");
      grad.addColorStop(.5,`rgba(${r},${g},${b},.75)`);
      grad.addColorStop(1,"transparent");

      ctx.strokeStyle=grad;
      ctx.lineWidth=.55;
      ctx.beginPath();
      ctx.moveTo(-length,0);
      ctx.lineTo(length,0);
      ctx.stroke();

      const vertical=length*(.4+v.eccentricity*.5);

      grad=ctx.createLinearGradient(0,-vertical,0,vertical);
      grad.addColorStop(0,"transparent");
      grad.addColorStop(.5,`rgba(${r},${g},${b},.68)`);
      grad.addColorStop(1,"transparent");

      ctx.strokeStyle=grad;
      ctx.beginPath();
      ctx.moveTo(0,-vertical);
      ctx.lineTo(0,vertical);
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawConstellations(time) {
    ctx.clearRect(0,0,width,height);

    for (const e of edges) {
      const a=nodeMap.get(e.from);
      const b=nodeMap.get(e.to);

      if (!a||!b) continue;

      const alpha=Math.min(a.visible,b.visible);
      if (alpha<.02) continue;

      if (
        Math.max(a.sx,b.sx)<-70 ||
        Math.min(a.sx,b.sx)>width+70 ||
        Math.max(a.sy,b.sy)<-70 ||
        Math.min(a.sy,b.sy)>height+70
      ) continue;

      const highlighted=
        selectedNode===a.id || selectedNode===b.id;

      ctx.beginPath();
      ctx.moveTo(a.sx,a.sy);
      ctx.lineTo(b.sx,b.sy);

      ctx.strokeStyle=highlighted
        ? `rgba(205,207,255,${alpha*.6})`
        : `rgba(160,179,227,${alpha*.24})`;

      ctx.lineWidth=highlighted?1:.65;
      ctx.stroke();
    }

    for (const n of nodes) drawStar(n,time);
  }

  /* ======================================================
     BACKGROUND & NEBULA
  ====================================================== */

  function resizeCanvas(element,context,ratio) {
    element.width=Math.round(width*ratio);
    element.height=Math.round(height*ratio);
    context.setTransform(ratio,0,0,ratio,0,0);
  }

  function rebuildBackgroundStars() {
    backgroundStars=[];

    const count=clamp(
      Math.round(
        DATA.graphics.backgroundStarCount*
        width*height/850000*
        state.settings.starDensity/75
      ),100,DATA.graphics.maximumBackgroundStars
    );

    for (let i=0;i<count;i++) {
      const s=i*173+48192;
      const r=random(s+1);

      backgroundStars.push({
        x:random(s+2)*width,
        y:random(s+3)*height,
        radius:r<.84
          ? .18+random(s+4)*.49
          : r<.98
            ? .68+random(s+5)*.53
            : 1.25+random(s+6)*1.1,
        alpha:.13+random(s+7)*.74,
        depth:.018+random(s+8)*.18,
        speed:.00014+random(s+9)*.00048,
        phase:random(s+10)*Math.PI*2,
        color:random(s+11)<.13
          ? [245,221,209]
          : random(s+12)<.6
            ? [216,225,255]
            : [180,202,250]
      });
    }
  }

  function drawBackground(time) {
    bgCtx.clearRect(0,0,width,height);
    const brightness=state.settings.starBrightness/100;

    for (const star of backgroundStars) {
      const x=((star.x-camera.x*star.depth)%width+width)%width;
      const y=((star.y-camera.y*star.depth)%height+height)%height;

      const twinkle=reduced()?1:
        .88+Math.sin(time*star.speed+star.phase)*.12;

      const a=clamp(
        star.alpha*twinkle*(.42+brightness),0,1
      );

      const [r,g,b]=star.color;

      bgCtx.fillStyle=`rgba(${r},${g},${b},${a})`;
      bgCtx.beginPath();
      bgCtx.arc(x,y,star.radius,0,Math.PI*2);
      bgCtx.fill();
    }
  }

  function buildNebula() {
    const texture=document.createElement("canvas");
    const ratio=DATA.graphics.nebulaResolution;

    texture.width=Math.max(320,Math.round(width*ratio));
    texture.height=Math.max(260,Math.round(height*ratio));

    const t=texture.getContext("2d");
    const w=texture.width,h=texture.height;

    const clouds=[
      [.12,.25,.57,24,68,150,.24],
      [.33,.48,.50,42,88,173,.23],
      [.51,.40,.43,52,104,192,.20],
      [.78,.61,.58,42,39,111,.17],
      [.83,.20,.47,26,61,133,.17],
      [.15,.79,.43,20,44,102,.14],
      [.62,.77,.44,23,49,115,.15]
    ];

    for (const [cx,cy,rad,r,g,b,alpha] of clouds) {
      const x=cx*w,y=cy*h;
      const radius=rad*Math.max(w,h);
      const grad=t.createRadialGradient(x,y,0,x,y,radius);

      grad.addColorStop(0,`rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(.38,`rgba(${r},${g},${b},${alpha*.52})`);
      grad.addColorStop(1,"transparent");

      t.fillStyle=grad;
      t.fillRect(0,0,w,h);
    }

    for (let i=0;i<300;i++) {
      const s=i*37+181;
      const progress=random(s);
      const x=(progress*1.3-.14)*w;
      const y=(.65-.37*progress+(random(s+1)-.5)*.38)*h;
      const radius=8+random(s+2)*55;
      const a=.012+random(s+3)*.044;

      const grad=t.createRadialGradient(x,y,0,x,y,radius);
      grad.addColorStop(0,`rgba(85,122,207,${a})`);
      grad.addColorStop(1,"transparent");

      t.fillStyle=grad;
      t.beginPath();
      t.arc(x,y,radius,0,Math.PI*2);
      t.fill();
    }

    nebulaTexture=texture;
  }

  function drawNebula() {
    if (!nebulaTexture) return;

    nebulaCtx.clearRect(0,0,width,height);

    const x=clamp(camera.x*.007,-80,80);
    const y=clamp(camera.y*.007,-80,80);

    nebulaCtx.globalAlpha=
      state.settings.nebulaIntensity/100;

    nebulaCtx.drawImage(
      nebulaTexture,
      -80-x,-80-y,
      width+160,height+160
    );

    nebulaCtx.globalAlpha=1;
  }

  function resizeGraphics() {
    width=innerWidth;
    height=innerHeight;

    dpr=Math.min(
      devicePixelRatio||1,
      DATA.graphics.maxPixelRatio
    );

    resizeCanvas(canvas,ctx,dpr);
    resizeCanvas(bgCanvas,bgCtx,dpr);
    resizeCanvas(nebulaCanvas,nebulaCtx,1);

    rebuildBackgroundStars();
    buildNebula();
    dirty=true;
  }

  /* ======================================================
     RENDER LOOP
  ====================================================== */

  function frame(time) {
    if (!running) return;

    if (time-lastFrame>=16) {
      updateTravel(time);
      positionButtons();
      drawNebula();
      drawBackground(time);
      drawConstellations(time);
      lastFrame=time;
      dirty=false;
    }

    frameHandle=requestAnimationFrame(frame);
  }

  function startLoop() {
    if (running) return;
    running=true;
    frameHandle=requestAnimationFrame(frame);
  }

  function stopLoop() {
    running=false;
    cancelAnimationFrame(frameHandle);
  }

  /* ======================================================
     OVERLAYS
  ====================================================== */

  function showOverlay(overlay) {
    if (currentOverlay && currentOverlay!==overlay) {
      currentOverlay.classList.remove("open");
      currentOverlay.setAttribute("aria-hidden","true");
    }

    oldFocus=document.activeElement;
    currentOverlay=overlay;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden","false");
    viewport.inert=true;
  }

  function closeOverlay() {
    if (!currentOverlay) return;

    currentOverlay.classList.remove("open");
    currentOverlay.setAttribute("aria-hidden","true");
    currentOverlay=null;
    viewport.inert=false;

    if (oldFocus?.isConnected) oldFocus.focus();
    else viewport.focus();
  }

  function openDetail(html) {
    $("#detailContent").innerHTML=html;
    $("#detailSheet").scrollTop=0;
    showOverlay(detailOverlay);
    $("#closeDetailButton").focus();
  }

  function openEditor(html,title="Create & Edit",eyebrow="YOUR ARCHIVE") {
    $("#editorTitle").textContent=title;
    $("#editorEyebrow").textContent=eyebrow;
    $("#editorContent").innerHTML=html;
    $("#editorSheet").scrollTop=0;
    showOverlay(editorOverlay);
    $("#closeEditorButton").focus();
  }

  function confirmAction(message,callback) {
    confirmCallback=callback;
    $("#confirmMessage").textContent=message;
    confirmOverlay.classList.add("open");
    confirmOverlay.setAttribute("aria-hidden","false");
    $("#cancelConfirmButton").focus();
  }

  function closeConfirm() {
    confirmOverlay.classList.remove("open");
    confirmOverlay.setAttribute("aria-hidden","true");
    confirmCallback=null;
  }

  /* ======================================================
     GENRE EDITOR
  ====================================================== */

  function openGenreManager() {
    openDetail(`
      <span class="detail-eyebrow">PERSONAL CATEGORIES</span>
      <h2 id="detailTitle">Genre Creation</h2>
      <p>Create your own genres and secondary tags.
      There are no preset categories.</p>

      <h3>Main Genres</h3>
      <div class="genre-create-row">
        <input id="newMainGenre" class="form-input"
          placeholder="New main genre...">
        <button class="soft-button primary-button"
          id="addMainGenre">Add</button>
      </div>
      <div class="genre-list" id="mainGenreList"></div>

      <h3>Secondary Genres & Tags</h3>
      <div class="genre-create-row">
        <input id="newSecondaryGenre" class="form-input"
          placeholder="New tag...">
        <button class="soft-button primary-button"
          id="addSecondaryGenre">Add</button>
      </div>
      <div class="genre-list" id="secondaryGenreList"></div>
    `);

    $("#addMainGenre").onclick=()=>{
      if (createGenre("main",$("#newMainGenre").value)) {
        openGenreManager();
      }
    };

    $("#addSecondaryGenre").onclick=()=>{
      if (createGenre("secondary",$("#newSecondaryGenre").value)) {
        openGenreManager();
      }
    };

    for (const [input,type] of [
      ["newMainGenre","main"],
      ["newSecondaryGenre","secondary"]
    ]) {
      $("#"+input).addEventListener("keydown",e=>{
        if (e.key==="Enter") {
          e.preventDefault();
          const val=e.target.value;
          if (createGenre(type,val)) openGenreManager();
        }
      });
    }

    renderGenreList("main");
    renderGenreList("secondary");
  }

  function renderGenreList(type) {
    const target=$("#"+(type==="main"
      ?"mainGenreList":"secondaryGenreList"));

    const list=genreCollection(type);

    if (!list.length) {
      target.innerHTML=`<p class="genre-empty">
        No ${type==="main"?"main genres":"secondary tags"} created yet.
      </p>`;
      return;
    }

    target.innerHTML="";

    for (const genre of list) {
      const chip=document.createElement("div");
      chip.className="genre-chip";

      const name=document.createElement("span");
      name.textContent=genre.name;

      const rename=document.createElement("button");
      rename.textContent="✎";
      rename.title="Rename";

      const remove=document.createElement("button");
      remove.textContent="×";
      remove.title="Delete";

      rename.onclick=()=>{
        const result=prompt("Rename genre:",genre.name);
        if (result===null) return;
        renameGenre(type,genre.id,result);
        openGenreManager();
      };

      remove.onclick=()=>{
        confirmAction(
          `Delete "${genre.name}"? Its assignments will be removed from entries.`,
          ()=>{
            deleteGenre(type,genre.id);
            openGenreManager();
          }
        );
      };

      chip.append(name,rename,remove);
      target.appendChild(chip);
    }
  }

  /* ======================================================
     MANAGER OVERVIEW
  ====================================================== */

  function openManager() {
    managerView={type:null,id:null};

    const sections=TYPES.map(type=>{
      const list=collection(type)
        .slice()
        .sort((a,b)=>(a.order??0)-(b.order??0));

      return `
        <section class="manager-section">
          <div class="manager-section-title">
            <h3>${type[0].toUpperCase()+type.slice(1)}s</h3>
            <span class="manager-count">${list.length}</span>
          </div>

          <div class="manager-list">
            ${list.length?list.map(item=>`
              <div class="manager-item">
                <div class="manager-item-main">
                  <span class="manager-item-title">
                    ${escapeHTML(titleOf(item))}
                  </span>
                  <span class="manager-item-subtitle">
                    ${escapeHTML(parentOf(type,item)?.item.title ||
                      (type==="production"?"Standalone":""))}
                  </span>
                </div>
                <div class="manager-item-actions">
                  <button class="mini-button" data-edit="${type}"
                    data-id="${escapeHTML(item.id)}" title="Edit">✎</button>
                  <button class="mini-button" data-up="${type}"
                    data-id="${escapeHTML(item.id)}" title="Move up">↑</button>
                  <button class="mini-button" data-down="${type}"
                    data-id="${escapeHTML(item.id)}" title="Move down">↓</button>
                  <button class="mini-button" data-delete="${type}"
                    data-id="${escapeHTML(item.id)}" title="Delete">×</button>
                </div>
              </div>
            `).join(""):`<p class="manager-empty">
              No ${type}s added yet.
            </p>`}
          </div>
        </section>
      `;
    }).join("");

    openEditor(`
      <p>Create the structure of your archive.
      All changes are saved automatically.</p>

      <div class="manager-actions">
        <button class="soft-button primary-button"
          data-new="group">+ Group</button>
        <button class="soft-button primary-button"
          data-new="production">+ Production</button>
        <button class="soft-button"
          data-new="season">+ Season</button>
        <button class="soft-button"
          data-new="episode">+ Episode</button>
      </div>

      ${sections}
    `);

    $$("#editorContent [data-new]").forEach(el=>{
      el.onclick=()=>openEntityForm(el.dataset.new);
    });

    $$("#editorContent [data-edit]").forEach(el=>{
      el.onclick=()=>openEntityForm(
        el.dataset.edit,el.dataset.id
      );
    });

    $$("#editorContent [data-up]").forEach(el=>{
      el.onclick=()=>{
        moveOrder(el.dataset.up,el.dataset.id,-1);
        openManager();
      };
    });

    $$("#editorContent [data-down]").forEach(el=>{
      el.onclick=()=>{
        moveOrder(el.dataset.down,el.dataset.id,1);
        openManager();
      };
    });

    $$("#editorContent [data-delete]").forEach(el=>{
      el.onclick=()=>{
        const type=el.dataset.delete;
        const item=getEntity(type,el.dataset.id);

        confirmAction(
          `Delete "${titleOf(item)}" and all its descendants? This cannot be undone.`,
          ()=>{
            deleteEntity(type,el.dataset.id);
            openManager();
          }
        );
      };
    });
  }

  /* ======================================================
     EDITING FORMS
  ====================================================== */

  function optionList(items,selected) {
    return items.map(item=>`
      <option value="${escapeHTML(item.id)}"
        ${String(item.id)===String(selected)?"selected":""}>
        ${escapeHTML(item.title || item.name)}
      </option>
    `).join("");
  }

  function genreCheckboxes(type,ids=[]) {
    return genreCollection(type).map(g=>`
      <label class="field-checkbox">
        <input type="checkbox"
          data-genre="${type}"
          value="${escapeHTML(g.id)}"
          ${ids.includes(g.id)?"checked":""}>
        ${escapeHTML(g.name)}
      </label>
    `).join("") || `<small>No genres created yet.</small>`;
  }

  function formField(id,label,value="",type="text") {
    return `
      <div class="form-field">
        <label for="field-${id}">${label}</label>
        <input id="field-${id}" class="form-input"
          type="${type}" value="${escapeHTML(value ?? "")}">
      </div>
    `;
  }

  function selectField(id,label,options,value) {
    return `
      <div class="form-field">
        <label for="field-${id}">${label}</label>
        <select id="field-${id}" class="form-select">
          ${options.map(opt=>`
            <option value="${escapeHTML(opt.value)}"
              ${String(opt.value)===String(value)?"selected":""}>
              ${escapeHTML(opt.label)}
            </option>
          `).join("")}
        </select>
      </div>
    `;
  }

  function openEntityForm(type,id=null,parentId=null) {
    const existing=id?getEntity(type,id):null;
    const data=existing || {};

    if (id&&!existing) {
      notify("Entry not found.");
      openManager();
      return;
    }

    const title=existing
      ? `Edit ${type}`
      : `Create ${type}`;

    let html=`<form id="archiveForm" class="archive-form">
      ${formField("title","Title",data.title || "")}
    `;

    if (type==="production") {
      html+=selectField(
        "groupId","Parent Group",
        [
          {value:"",label:"None — standalone production"},
          ...collection("group").map(g=>({
            value:g.id,label:g.title
          }))
        ],
        data.groupId || parentId || ""
      );

      html+=selectField(
        "mediaType","Form of Media",
        DATA.mediaTypes.map(v=>({value:v,label:v})),
        data.mediaType || "TV Series"
      );

      html+=selectField(
        "status","Watching Status",
        DATA.statuses.map(v=>({value:v,label:v})),
        data.status || "Planned"
      );

      html+=`
        <label class="field-checkbox">
          <input type="checkbox" id="field-watchlist"
            ${data.watchlist?"checked":""}>
          Add to Watchlist
        </label>
      `;
    }

    if (type==="season") {
      html+=selectField(
        "productionId","Production",
        collection("production").map(p=>({
          value:p.id,label:p.title
        })),
        data.productionId || parentId || ""
      );

      html+=selectField(
        "status","Watching Status",
        DATA.statuses.map(v=>({value:v,label:v})),
        data.status || "Planned"
      );
    }

    if (type==="episode") {
      html+=selectField(
        "seasonId","Season",
        collection("season").map(s=>({
          value:s.id,label:s.title
        })),
        data.seasonId || parentId || ""
      );

      html+=formField(
        "duration","Duration (minutes)",
        data.duration ?? "", "number"
      );
    }

    if (type==="group" || type==="production") {
      html+=`
        <div class="form-field">
          <label>Main Genres</label>
          ${genreCheckboxes("main",data.mainGenreIds || [])}
        </div>
        <div class="form-field">
          <label>Secondary Genres & Tags</label>
          ${genreCheckboxes("secondary",data.secondaryGenreIds || [])}
        </div>
      `;

      html+=formField(
        "banner","Banner Image URL (optional)",
        data.banner || "","url"
      );
    }

    if (type==="production" || type==="season") {
      html+=`<div class="form-grid">
        ${formField("releaseStart","Airing / Release Start",
          data.releaseStart || "","date")}
        ${formField("releaseEnd","Airing / Release End",
          data.releaseEnd || "","date")}
      </div>`;
    }

    if (type==="production" || type==="episode") {
      html+=formField(
        "lastWatched",
        type==="episode"?"Date Watched":"Last Watched",
        data.lastWatched || data.watchedAt || "",
        "date"
      );
    }

    html+=`
      <div class="form-field">
        <label for="field-notes">Personal Observations</label>
        <textarea id="field-notes"
          class="form-textarea"></textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="soft-button"
          id="cancelForm">Cancel</button>
        <button type="submit"
          class="soft-button primary-button">
          ${existing?"Save Changes":"Create Entry"}
        </button>
      </div>
    </form>`;

    openEditor(html,title.toUpperCase(),"ARCHIVE EDITOR");

    $("#field-notes").value=data.notes || "";

    $("#cancelForm").onclick=openManager;

    $("#archiveForm").addEventListener("submit",event=>{
      event.preventDefault();

      const get=name =>
        $("#field-"+name)?.value || "";

      const values={
        title:get("title").trim(),
        notes:$("#field-notes").value
      };

      if (type==="production") {
        values.groupId=get("groupId") || null;
        values.mediaType=get("mediaType");
        values.status=get("status");
        values.watchlist=$("#field-watchlist").checked;
      }

      if (type==="season") {
        values.productionId=get("productionId");
        values.status=get("status");
      }

      if (type==="episode") {
        values.seasonId=get("seasonId");
        values.duration=Math.max(0,Number(get("duration"))||0);
        values.watchedAt=get("lastWatched");
      }

      if (type==="group" || type==="production") {
        values.banner=get("banner");

        values.mainGenreIds=
          $$('#archiveForm [data-genre="main"]:checked')
            .map(input=>input.value);

        values.secondaryGenreIds=
          $$('#archiveForm [data-genre="secondary"]:checked')
            .map(input=>input.value);
      }

      if (type==="production" || type==="season") {
        values.releaseStart=get("releaseStart");
        values.releaseEnd=get("releaseEnd");
      }

      if (type==="production") {
        values.lastWatched=get("lastWatched");
      }

      const success=existing
        ? updateEntity(type,id,values)
        : createEntity(type,values);

      if (success) openManager();
    });
  }

  /* ======================================================
     DETAILS & NAVIGATION
  ====================================================== */

  function selectStar(node) {
    if (node.type==="navigation") {
      switch(node.action) {
        case "create":
          openManager();
          return;
        case "genres":
          openGenreManager();
          return;
        case "settings":
          openSettings();
          return;
        case "library":
        case "watchlist":
          openCollection(node.action);
          return;
      }
    }

    focusNode(node);

    if (node.type==="episode") {
      openRecordDetails(node);
    }
  }

  function openRecordDetails(node) {
    const record=node.record || {};

    const type=node.type;

    const genres=[
      ...(record.mainGenreIds || []).map(id=>genreName(id,"main")),
      ...(record.secondaryGenreIds || []).map(id=>genreName(id,"secondary"))
    ].filter(Boolean);

    openDetail(`
      <span class="detail-eyebrow">${escapeHTML(type)}</span>
      <h2 id="detailTitle">${escapeHTML(node.title)}</h2>

      ${genres.length?`<p>${escapeHTML(genres.join(" · "))}</p>`:""}

      <p>${escapeHTML(record.notes || "")}</p>

      ${!node.demo?`
        <button class="detail-action" id="editRecordButton">
          Edit Entry
        </button>
      `:"<p>Demonstration record</p>"}
    `);

    if (!node.demo) {
      $("#editRecordButton").onclick=()=>{
        openEntityForm(type,node.id);
      };
    }
  }

  function openCollection(type) {
    activeCollection=type;
    filters={query:"",sort:"alphabetical",status:""};

    openDetail(`
      <span class="detail-eyebrow">YOUR ARCHIVE</span>
      <h2 id="detailTitle">
        ${type==="library"?"Library":"Watchlist"}
      </h2>

      <div class="library-toolbar">
        <div class="library-control">
          <label for="librarySearch">Search</label>
          <input class="library-input" id="librarySearch"
            placeholder="Title...">
        </div>

        <div class="library-control">
          <label for="librarySort">Sort</label>
          <select class="library-select" id="librarySort">
            ${DATA.sorting.map(s=>`
              <option value="${s.id}">${s.title}</option>
            `).join("")}
          </select>
        </div>
      </div>

      <div class="library-count" id="libraryCount"></div>
      <div class="library-results" id="libraryResults"></div>
    `);

    $("#librarySearch").oninput=e=>{
      filters.query=e.target.value;
      renderLibrary();
    };

    $("#librarySort").onchange=e=>{
      filters.sort=e.target.value;
      renderLibrary();
    };

    renderLibrary();
  }

  function renderLibrary() {
    let items=collection("production").slice();

    if (activeCollection==="watchlist") {
      items=items.filter(i=>
        i.watchlist || i.status==="Planned"
      );
    }

    if (filters.query) {
      const q=filters.query.toLowerCase();
      items=items.filter(i=>titleOf(i).toLowerCase().includes(q));
    }

    const sort=filters.sort;

    const rating=i=>{
      const n=Number(i.averageRating ?? i.rating);
      return Number.isFinite(n)?n:null;
    };

    items.sort((a,b)=>{
      switch(sort) {
        case "alphabeticalReverse":
          return titleOf(b).localeCompare(titleOf(a));
        case "highestRated":
          return (rating(b)??-1)-(rating(a)??-1);
        case "lowestRated":
          return (rating(a)??999)-(rating(b)??999);
        case "newestAdded":
          return dateValue(b.createdAt)-dateValue(a.createdAt);
        case "oldestAdded":
          return dateValue(a.createdAt)-dateValue(b.createdAt);
        case "lastWatched":
          return dateValue(b.lastWatched)-dateValue(a.lastWatched);
        case "earliestRelease":
          return dateValue(a.releaseStart)-dateValue(b.releaseStart);
        case "latestRelease":
          return dateValue(b.releaseStart)-dateValue(a.releaseStart);
        case "custom":
          return (a.order??0)-(b.order??0);
        default:
          return titleOf(a).localeCompare(titleOf(b));
      }
    });

    $("#libraryCount").textContent=
      `${items.length} production${items.length===1?"":"s"}`;

    $("#libraryResults").innerHTML=items.length
      ? items.map(item=>`
          <button class="library-entry"
            data-library-id="${escapeHTML(item.id)}">
            <span class="library-entry-main">
              <span class="library-entry-title">
                ${escapeHTML(titleOf(item))}
              </span>
              <span class="library-entry-meta">
                ${escapeHTML(item.mediaType || "Production")}
              </span>
            </span>
          </button>
        `).join("")
      : `<div class="library-empty">
          <h3>Nothing here yet.</h3>
          <p>Create your first production through
          the Create & Edit constellation star.</p>
        </div>`;

    $$("[data-library-id]").forEach(el=>{
      el.onclick=()=>{
        const node=nodeMap.get(el.dataset.libraryId);
        closeOverlay();
        if (node) focusNode(node);
      };
    });
  }

  /* ======================================================
     GLOBAL SEARCH
  ====================================================== */

  function openSearch() {
    $("#globalSearch").value="";
    $("#searchResults").innerHTML="";
    showOverlay(searchOverlay);
    $("#globalSearch").focus();
  }

  function renderSearch() {
    const q=$("#globalSearch").value.trim().toLowerCase();
    const results=[];

    if (q) {
      for (const type of TYPES) {
        for (const item of collection(type)) {
          if (titleOf(item).toLowerCase().includes(q)) {
            results.push({type,item});
          }
        }
      }
    }

    $("#searchResults").innerHTML=results.slice(0,60)
      .map(({type,item})=>`
        <button class="search-result"
          data-search-id="${escapeHTML(item.id)}">
          <span>${escapeHTML(titleOf(item))}</span>
          <small>${type}</small>
        </button>
      `).join("");

    $$("[data-search-id]").forEach(el=>{
      el.onclick=()=>{
        const node=nodeMap.get(el.dataset.searchId);
        closeOverlay();
        if (node) focusNode(node);
      };
    });
  }

  /* ======================================================
     SETTINGS
  ====================================================== */

  function openSettings() {
    const settings=[
      ["starDensity","Star Density",10],
      ["starBrightness","Star Brightness",10],
      ["nebulaIntensity","Nebula Intensity",0],
      ["constellationGlow","Constellation Glow",0]
    ];

    openDetail(`
      <span class="detail-eyebrow">YOUR UNIVERSE</span>
      <h2 id="detailTitle">Settings</h2>

      ${settings.map(([key,label,min])=>`
        <div class="detail-row">
          <label for="setting-${key}">${label}</label>
          <div>
            <input id="setting-${key}"
              class="setting-range" type="range"
              min="${min}" max="100" step="5"
              value="${state.settings[key]}">
            <output class="setting-value"
              id="value-${key}">${state.settings[key]}</output>
          </div>
        </div>
      `).join("")}

      <div class="detail-row">
        <label for="setting-motion">Reduce Motion</label>
        <input type="checkbox" id="setting-motion"
          class="motion-checkbox"
          ${state.settings.reduceMotion?"checked":""}>
      </div>

      <h3>Backups</h3>
      <p>Your records are saved in this browser.
      Export backups regularly.</p>

      <button class="detail-action" id="exportArchive">
        Export Archive
      </button>
      <button class="detail-action" id="importArchive">
        Import Archive
      </button>
    `);

    for (const [key] of settings) {
      $("#setting-"+key).oninput=e=>{
        state.settings[key]=Number(e.target.value);
        $("#value-"+key).textContent=e.target.value;

        if (key==="starDensity") rebuildBackgroundStars();

        dirty=true;
        saveState();
      };
    }

    $("#setting-motion").onchange=e=>{
      state.settings.reduceMotion=e.target.checked;
      applyMotion();
      saveState();
    };

    $("#exportArchive").onclick=exportBackup;
    $("#importArchive").onclick=()=>$("#importFile").click();
  }

  /* ======================================================
     BACKUPS
  ====================================================== */

  function exportBackup() {
    const backup={
      app:DATA.appName,
      schemaVersion:DATA.schemaVersion,
      exportedAt:new Date().toISOString(),
      data:state
    };

    const blob=new Blob(
      [JSON.stringify(backup,null,2)],
      {type:"application/json"}
    );

    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download="watch-archive-"+
      new Date().toISOString().slice(0,10)+".json";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify("Backup prepared.");
  }

  async function importBackup(file) {
    if (!file) return;

    try {
      const backup=JSON.parse(await file.text());

      if (
        backup.app!==DATA.appName ||
        backup.schemaVersion!==DATA.schemaVersion ||
        !backup.data?.archive ||
        !TYPES.every(t=>
          Array.isArray(backup.data.archive[COLLECTIONS[t]])
        )
      ) throw new Error("Invalid backup");

      if (!confirm(
        "Replace your existing local archive with this backup? "+
        "Export your current data first if needed."
      )) return;

      const previous=state;
      state=normalizeState(backup.data);

      if (!saveState()) {
        state=previous;
        return;
      }

      closeOverlay();
      rebuildUniverse();
      rebuildBackgroundStars();
      goHome();
      notify("Archive imported.");

    } catch(e) {
      console.error(e);
      notify("Import failed.");
    } finally {
      $("#importFile").value="";
    }
  }

  /* ======================================================
     TOUCH, PINCH & PAN
  ====================================================== */

  function point(e) {
    return {x:e.clientX,y:e.clientY};
  }

  function dist(a,b) {
    return Math.hypot(a.x-b.x,a.y-b.y);
  }

  function center(a,b) {
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  }

  function startPinch() {
    if (pointers.size<2) return;

    const [a,b]=[...pointers.values()];
    const c=center(a,b);

    gesture={
      kind:"pinch",
      distance:Math.max(1,dist(a,b)),
      zoom:camera.zoom,
      anchor:screenToWorld(c.x,c.y),
      moved:true
    };

    blockClickUntil=performance.now()+450;
  }

  function bindGestures() {
    viewport.addEventListener("pointerdown",e=>{
      if (e.pointerType==="mouse"&&e.button!==0) return;

      stopTravel();
      pointers.set(e.pointerId,point(e));

      if (pointers.size===1) {
        gesture={kind:"drag",distance:0,moved:false};
      } else if (pointers.size>=2) {
        startPinch();
      }
    });

    viewport.addEventListener("pointermove",e=>{
      if (!pointers.has(e.pointerId)) return;

      const old=pointers.get(e.pointerId);
      const now=point(e);

      pointers.set(e.pointerId,now);

      if (pointers.size>=2) {
        const [a,b]=[...pointers.values()];
        if (gesture?.kind!=="pinch") startPinch();

        const c=center(a,b);
        const zoom=clamp(
          gesture.zoom*
          Math.max(1,dist(a,b))/gesture.distance,
          DATA.camera.minZoom,
          DATA.camera.maxZoom
        );

        setCamera(
          gesture.anchor.x-(c.x-width/2)/zoom,
          gesture.anchor.y-(c.y-height/2)/zoom,
          zoom
        );

        gesture.moved=true;
        blockClickUntil=performance.now()+400;
        return;
      }

      const dx=now.x-old.x;
      const dy=now.y-old.y;

      gesture.distance+=Math.hypot(dx,dy);

      if (gesture.distance>DATA.camera.tapThreshold) {
        gesture.moved=true;
        blockClickUntil=performance.now()+350;
        viewport.classList.add("dragging");

        if (!viewport.hasPointerCapture(e.pointerId)) {
          viewport.setPointerCapture(e.pointerId);
        }
      }

      setCamera(
        camera.x-dx/camera.zoom,
        camera.y-dy/camera.zoom,
        camera.zoom
      );
    });

    const end=e=>{
      if (!pointers.has(e.pointerId)) return;

      pointers.delete(e.pointerId);

      if (viewport.hasPointerCapture(e.pointerId)) {
        viewport.releasePointerCapture(e.pointerId);
      }

      if (gesture?.moved) {
        blockClickUntil=performance.now()+350;
      }

      if (!pointers.size) {
        gesture=null;
        viewport.classList.remove("dragging");
      } else if (pointers.size===1) {
        gesture={kind:"drag",distance:0,moved:true};
      }
    };

    viewport.addEventListener("pointerup",end);
    viewport.addEventListener("pointercancel",end);

    viewport.addEventListener("click",e=>{
      if (performance.now()<blockClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },true);

    viewport.addEventListener("wheel",e=>{
      e.preventDefault();
      zoomAt(
        e.clientX,e.clientY,
        Math.exp(-e.deltaY*DATA.camera.wheelSensitivity)
      );
    },{passive:false});
  }

  /* ======================================================
     GLOBAL CONTROLS
  ====================================================== */

  function bindControls() {
    $("#homeButton").onclick=goHome;

    $("#focusButton").onclick=()=>{
      if (focusedNode) focusNode(focusedNode);
      else goHome();
    };

    $("#searchButton").onclick=openSearch;

    $("#closeDetailButton").onclick=closeOverlay;
    $("#detailBackdrop").onclick=closeOverlay;

    $("#closeEditorButton").onclick=closeOverlay;
    $("#editorBackdrop").onclick=closeOverlay;

    $("#closeSearchButton").onclick=closeOverlay;
    $("#searchBackdrop").onclick=closeOverlay;

    $("#globalSearch").oninput=renderSearch;

    $("#cancelConfirmButton").onclick=closeConfirm;

    $("#acceptConfirmButton").onclick=()=>{
      const action=confirmCallback;
      closeConfirm();
      if (action) action();
    };

    $("#importFile").onchange=e=>
      importBackup(e.target.files?.[0]);

    window.addEventListener("keydown",e=>{
      if (e.key==="Escape") {
        if (confirmOverlay.classList.contains("open")) {
          closeConfirm();
        } else {
          closeOverlay();
        }
      }
    });

    let resizeTimer;

    window.addEventListener("resize",()=>{
      clearTimeout(resizeTimer);

      resizeTimer=setTimeout(()=>{
        const oldMobile=width<650;
        const newMobile=innerWidth<650;

        resizeGraphics();

        if (oldMobile!==newMobile) {
          rebuildUniverse();
        }
      },160);
    });

    document.addEventListener("visibilitychange",()=>{
      if (document.hidden) stopLoop();
      else startLoop();
    });

    reduceMedia.addEventListener("change",applyMotion);

    window.addEventListener("storage",e=>{
      if (e.key!==DATA.storageKey) return;

      state=loadState();
      rebuildUniverse();
      rebuildBackgroundStars();
      notify("Archive updated from another tab.");
    });
  }

  /* ======================================================
     INITIALIZATION
  ====================================================== */

  function initialize() {
    applyMotion();
    resizeGraphics();
    rebuildUniverse();

    bindGestures();
    bindControls();

    const start=homeCamera();
    setCamera(start.x,start.y,start.zoom);

    startLoop();

    if (!localStorage.getItem(DATA.storageKey)) {
      saveState();
    }
  }

  initialize();

})();
