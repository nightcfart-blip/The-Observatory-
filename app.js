
"use strict";

/*
  WATCH ARCHIVE — STEP 5
  Complete replacement app.js
*/

(() => {
  const D = window.WATCH_DATA;
  if (!D) return;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const esc = v => String(v ?? "").replace(/[&<>"']/g,c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",
    '"':"&quot;","'":"&#39;"
  })[c]);
  const clone = x => JSON.parse(JSON.stringify(x));
  const id = () => crypto.randomUUID?.() ||
    "wa-"+Date.now().toString(36)+Math.random().toString(36).slice(2);
  const title = r => r?.title || r?.name || "Untitled";
  const types = ["group","production","season","episode"];
  const keys = {
    group:"groups",production:"productions",
    season:"seasons",episode:"episodes"
  };
  const parentKeys = {
    production:"groupId",
    season:"productionId",
    episode:"seasonId"
  };
  const previous = {
    production:"group",
    season:"production",
    episode:"season"
  };
  const next = {
    group:"production",
    production:"season",
    season:"episode"
  };

  function defaults() {
    return {
      schemaVersion:D.schemaVersion,
      settings:clone(D.defaults.settings),
      archive:clone(D.defaults.archive)
    };
  }

  function normalize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== "object") return base;
    base.settings = {...base.settings,...raw.settings};
    for (const key of [
      "groups","productions","seasons","episodes",
      "genres","secondaryGenres"
    ]) {
      base.archive[key] = Array.isArray(raw.archive?.[key])
        ? raw.archive[key] : [];
    }
    return base;
  }

  function load() {
    try {
      return normalize(JSON.parse(
        localStorage.getItem(D.storageKey) || "null"
      ));
    } catch(e) {
      console.error(e);
      return defaults();
    }
  }

  let state = load();
  let toastTimer;

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"),3000);
  }

  function save() {
    try {
      localStorage.setItem(D.storageKey,JSON.stringify(state));
      return true;
    } catch(e) {
      console.error(e);
      toast("Save failed. Check browser storage.");
      return false;
    }
  }

  const rows = type => state.archive[keys[type]];
  const find = (type,rid) =>
    rows(type).find(r => String(r.id) === String(rid));
  const pid = (type,r) =>
    type === "group" ? null :
    (r[parentKeys[type]] ?? r.parentId ?? null);

  function children(type,rid) {
    const childType = next[type];
    if (!childType) return [];
    return rows(childType).filter(r =>
      String(pid(childType,r) ?? "") === String(rid)
    ).sort((a,b) => (a.order??0)-(b.order??0));
  }

  function demoFind(type,rid) {
    function visit(r,t) {
      if (t === type && String(r.id) === String(rid)) return r;
      for (const c of r.children || []) {
        const result = visit(c,next[t]);
        if (result) return result;
      }
      return null;
    }
    for (const g of D.demoGroups || []) {
      const r = visit(g,"group");
      if (r) return r;
    }
    return null;
  }

  function resolve(type,rid) {
    const real = find(type,rid);
    if (real) return {item:real,demo:false};
    const demo = demoFind(type,rid);
    return demo ? {item:demo,demo:true} : null;
  }

  function childList(type,item,demo) {
    return demo ? (item.children || []) : children(type,item.id);
  }

  function genres(kind) {
    return state.archive[kind==="main"?"genres":"secondaryGenres"];
  }

  function genreNames(ids,kind) {
    return (ids||[]).map(id =>
      genres(kind).find(g => g.id === id)?.name
    ).filter(Boolean);
  }

  function changed(message) {
    if (!save()) return false;
    buildWorld();
    if (message) toast(message);
    return true;
  }

  /* IMAGE STORAGE */

  let databasePromise;
  const imageURLs = new Map();

  function database() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve,reject) => {
        const request = indexedDB.open(
          D.images.databaseName,D.images.databaseVersion
        );
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(
            D.images.objectStore
          )) request.result.createObjectStore(D.images.objectStore);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return databasePromise;
  }

  async function imageGet(key) {
    const db = await database();
    return new Promise((resolve,reject) => {
      const req = db.transaction(
        D.images.objectStore,"readonly"
      ).objectStore(D.images.objectStore).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function imagePut(key,blob) {
    const db = await database();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(D.images.objectStore,"readwrite");
      tx.objectStore(D.images.objectStore).put(blob,key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function imageURL(key) {
    if (!key) return "";
    if (imageURLs.has(key)) return imageURLs.get(key);
    const blob = await imageGet(key);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    imageURLs.set(key,url);
    return url;
  }

  async function bannerURL(item) {
    if (item.bannerImageId) {
      try {
        const url = await imageURL(item.bannerImageId);
        if (url) return url;
      } catch(e) { console.warn(e); }
    }
    return item.banner || "";
  }

  async function compress(file) {
    if (file.size > D.images.maximumInputMB*1048576)
      throw Error("Image is too large.");

    let source;
    let tempURL;

    try {
      if (window.createImageBitmap) {
        try { source = await createImageBitmap(file); }
        catch(e) {}
      }
      if (!source) {
        tempURL = URL.createObjectURL(file);
        source = await new Promise((resolve,reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(Error("Unsupported image."));
          img.src = tempURL;
        });
      }

      const scale = Math.min(
        1,
        D.images.maximumWidth/source.width,
        D.images.maximumHeight/source.height
      );

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(source.width*scale);
      canvas.height = Math.round(source.height*scale);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(source,0,0,canvas.width,canvas.height);

      return await new Promise((resolve,reject) => {
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(Error("Image failed.")),
          "image/jpeg",D.images.quality
        );
      });
    } finally {
      source?.close?.();
      if (tempURL) URL.revokeObjectURL(tempURL);
    }
  }

  /* UNIVERSE RENDERER */

  const viewport = $("#viewport");
  const skyCanvas = $("#backgroundStars");
  const nebCanvas = $("#nebulaCanvas");
  const mapCanvas = $("#constellationCanvas");

  const sky = skyCanvas.getContext("2d");
  const neb = nebCanvas.getContext("2d");
  const map = mapCanvas.getContext("2d");

  let W = innerWidth,H = innerHeight;
  let backgroundStars = [];
  let worldNodes = [];
  let lines = [];
  let lookup = new Map();
  let focused = null;
  let animation = null;

  const camera = {x:0,y:0,z:1};

  function hash(text) {
    let h = 2166136261;
    for (const c of String(text)) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function rand(seed) {
    let x = seed+0x6d2b79f5;
    x = Math.imul(x^(x>>>15),x|1);
    x ^= x+Math.imul(x^(x>>>7),x|61);
    return ((x^(x>>>14))>>>0)/4294967296;
  }

  const screen = (x,y) => ({
    x:W/2+(x-camera.x)*camera.z,
    y:H/2+(y-camera.y)*camera.z
  });

  const world = (x,y) => ({
    x:camera.x+(x-W/2)/camera.z,
    y:camera.y+(y-H/2)/camera.z
  });

  function resize() {
    W = innerWidth;
    H = innerHeight;
    const d = Math.min(devicePixelRatio||1,1.5);

    for (const [canvas,ctx,ratio] of [
      [skyCanvas,sky,d],
      [mapCanvas,map,d],
      [nebCanvas,neb,1]
    ]) {
      canvas.width = Math.round(W*ratio);
      canvas.height = Math.round(H*ratio);
      ctx.setTransform(ratio,0,0,ratio,0,0);
    }

    backgroundStars = Array.from({length:Math.min(
      D.graphics.maximumBackgroundStars,
      Math.round(D.graphics.backgroundStarCount*
        W*H/850000*state.settings.starDensity/75)
    )},(_,i) => {
      const s = i*113+49;
      return {
        x:rand(s)*W,y:rand(s+1)*H,
        r:.2+Math.pow(rand(s+2),5)*1.7,
        a:.2+rand(s+3)*.7,
        depth:.03+rand(s+4)*.15,
        phase:rand(s+5)*6.283
      };
    });
  }

  function node(item,type,x,y,parentID=null,demo=false,action=null) {
    if (lookup.has(String(item.id))) return;
    const s = hash(item.id);
    const n = {
      id:String(item.id),item,type,x,y,
      parentID,demo,action,
      size:.68+rand(s+1)*.85,
      glow:.7+rand(s+2)*1.2,
      phase:rand(s+3)*6.28,
      color:rand(s+4)<.3?"220,206,255":"204,221,255",
      sx:0,sy:0,alpha:1
    };
    worldNodes.push(n);
    lookup.set(n.id,n);
  }

  function grow(item,type,x,y,demo) {
    const t = next[type];
    if (!t) return;

    const list = childList(type,item,demo);
    list.forEach((r,i) => {
      const seed = hash(r.id);
      const ring = Math.floor(i/8);
      const a = i*.785-Math.PI/2+
        (rand(seed+4)-.5)*.45;
      const radius = (
        {production:235,season:110,episode:53}[t] || 150
      )*(1+ring*.85)*(.8+rand(seed+5)*.45);

      const px = r.mapX ?? x+Math.cos(a)*radius;
      const py = r.mapY ?? y+Math.sin(a)*radius;
      node(r,t,px,py,item.id,demo);
      grow(r,t,px,py,demo);
    });
  }

  function buildWorld() {
    worldNodes = [];
    lines = [];
    lookup = new Map();

    const scale = W<650?.58:1;
    for (const n of D.navigation.nodes) {
      node(
        {id:"nav-"+n.id,title:n.title},
        "navigation",n.x*scale,n.y*scale,null,false,n.action
      );
    }
    for (const [a,b] of D.navigation.connections)
      lines.push(["nav-"+a,"nav-"+b]);

    const realGroups = rows("group");
    const groups = realGroups.length ? realGroups : D.demoGroups;

    groups.forEach((g,i) => {
      const a = D.groupPlacement.angleOffset+i*2.4;
      const distance = D.groupPlacement.initialRadius+
        Math.sqrt(i)*D.groupPlacement.distanceGrowth;
      const x = g.mapX ?? g.x ?? Math.cos(a)*distance;
      const y = g.mapY ?? g.y ?? Math.sin(a)*distance;
      node(g,"group",x,y,null,!!g.demo);
      grow(g,"group",x,y,!!g.demo);
    });

    rows("production").filter(r => !pid("production",r))
      .forEach((r,i) => {
        const a = i*2.4+1.6;
        const distance = 1150+Math.sqrt(i)*350;
        const x = r.mapX ?? Math.cos(a)*distance;
        const y = r.mapY ?? Math.sin(a)*distance;
        node(r,"production",x,y,null,false);
        grow(r,"production",x,y,false);
      });

    for (const parentID of new Set(
      worldNodes.filter(n => n.parentID).map(n => n.parentID)
    )) {
      const kids = worldNodes.filter(n => n.parentID === parentID);
      for (let i=1;i<kids.length;i++)
        lines.push([kids[i-1].id,kids[i].id]);
    }

    const layer = $("#starLayer");
    layer.replaceChildren();

    for (const n of worldNodes) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "celestial-star "+n.type+"-star";
      b.setAttribute("aria-label","Open "+title(n.item));
      b.innerHTML = '<span class="star-touch-area"></span>';
      const label = document.createElement("span");
      label.className = "star-label";
      label.textContent = title(n.item);
      b.append(label);
      b.onclick = e => {
        e.stopPropagation();
        if (Date.now()<ignoreTapUntil) return;
        if (n.action) {
          ({
            library:()=>openLibrary("library"),
            watchlist:()=>openLibrary("watchlist"),
            genres:openGenres,
            create:openManager,
            settings:openSettings
          })[n.action]?.();
        } else {
          focused = n.id;
          openPopup(n.type,n.id);
        }
      };
      n.button = b;
      layer.append(b);
    }
  }

  function home() {
    focused = null;
    cameraTarget = {
      x:0,y:-40,
      z:W<650?Math.min(W/760,H/600):Math.min(W/1350,H/700)
    };
  }

  let cameraTarget = null;

  function focusNode(n) {
    focused = n.id;
    cameraTarget = {
      x:n.x,y:n.y,
      z:{navigation:1.3,group:2.1,production:4.3,
        season:8,episode:12}[n.type]
    };
  }

  function zoomAt(x,y,multiplier) {
    const p = world(x,y);
    const z = clamp(
      camera.z*multiplier,D.camera.minZoom,D.camera.maxZoom
    );
    camera.x = p.x-(x-W/2)/z;
    camera.y = p.y-(y-H/2)/z;
    camera.z = z;
    cameraTarget = null;
  }

  function visibility(n) {
    if (n.type==="navigation"||n.type==="group"||
      (n.type==="production"&&!n.parentID)) return 1;

    const limits = {
      production:[1.1,2],season:[2.7,4.5],
      episode:[6,9]
    }[n.type];
    if (!limits) return 1;
    const v = clamp(
      (camera.z-limits[0])/(limits[1]-limits[0]),0,1
    );
    const parentNode = lookup.get(n.parentID);
    if (!parentNode) return v;
    const dist = Math.hypot(
      camera.x-parentNode.x,camera.y-parentNode.y
    )*camera.z;
    return v*(1-clamp(
      (dist-Math.max(W,H)) / Math.max(W,H),0,1
    ));
  }

  function render(t) {
    if (cameraTarget) {
      const f = state.settings.reduceMotion?1:.13;
      camera.x += (cameraTarget.x-camera.x)*f;
      camera.y += (cameraTarget.y-camera.y)*f;
      camera.z *= Math.pow(cameraTarget.z/camera.z,f);
      if (Math.abs(cameraTarget.z-camera.z)<.001 &&
          Math.hypot(cameraTarget.x-camera.x,
            cameraTarget.y-camera.y)<.2)
        cameraTarget = null;
    }

    sky.clearRect(0,0,W,H);
    neb.clearRect(0,0,W,H);

    const glow = state.settings.nebulaIntensity/100;
    const gradient = neb.createRadialGradient(
      W*.45,H*.4,0,W*.45,H*.4,Math.max(W,H)*.8
    );
    gradient.addColorStop(0,
      `rgba(45,76,160,${glow*.15})`);
    gradient.addColorStop(.6,
      `rgba(28,34,103,${glow*.08})`);
    gradient.addColorStop(1,"transparent");
    neb.fillStyle = gradient;
    neb.fillRect(0,0,W,H);

    for (const s of backgroundStars) {
      const x = ((s.x-camera.x*s.depth)%W+W)%W;
      const y = ((s.y-camera.y*s.depth)%H+H)%H;
      const pulse = state.settings.reduceMotion?1:
        .9+.1*Math.sin(t*.0004+s.phase);
      sky.fillStyle = `rgba(215,225,255,${
        s.a*pulse*(.5+state.settings.starBrightness/100)
      })`;
      sky.beginPath();
      sky.arc(x,y,s.r,0,6.283);
      sky.fill();
    }

    map.clearRect(0,0,W,H);

    for (const n of worldNodes) {
      const p = screen(n.x,n.y);
      n.sx = p.x;
      n.sy = p.y;
      n.alpha = visibility(n);
      const visible = n.alpha>.08 &&
        p.x>-120&&p.x<W+120&&p.y>-120&&p.y<H+120;
      n.button.classList.toggle("is-hidden",!visible);
      if (visible) {
        n.button.style.left = p.x+"px";
        n.button.style.top = p.y+"px";
        n.button.style.opacity = n.alpha;
        n.button.disabled = n.alpha<.65;
      }
    }

    for (const [a,b] of lines) {
      const x = lookup.get(a),y = lookup.get(b);
      if (!x||!y) continue;
      const opacity = Math.min(x.alpha,y.alpha)*.23;
      if (opacity<.02) continue;
      map.strokeStyle = `rgba(179,190,240,${opacity})`;
      map.lineWidth = .7;
      map.beginPath();
      map.moveTo(x.sx,x.sy);
      map.lineTo(y.sx,y.sy);
      map.stroke();
    }

    for (const n of worldNodes) {
      if (n.alpha<.05||n.sx<-70||n.sx>W+70||
          n.sy<-70||n.sy>H+70) continue;

      const style = {
        navigation:D.appearance.navigationStars,
        group:D.appearance.groupStars,
        production:D.appearance.productionStars,
        season:D.appearance.seasonStars,
        episode:D.appearance.episodeStars
      }[n.type];

      const radius = style.radius*n.size;
      const halo = style.glow*n.glow*
        state.settings.constellationGlow/68;
      const brightness = n.type==="group"?.65:1;

      const g = map.createRadialGradient(
        n.sx,n.sy,0,n.sx,n.sy,halo
      );
      g.addColorStop(0,
        `rgba(${n.color},${n.alpha*.38*brightness})`);
      g.addColorStop(.3,
        `rgba(${n.color},${n.alpha*.14*brightness})`);
      g.addColorStop(1,"transparent");
      map.fillStyle = g;
      map.beginPath();
      map.arc(n.sx,n.sy,halo,0,6.283);
      map.fill();

      const core = map.createRadialGradient(
        n.sx,n.sy,0,n.sx,n.sy,radius*2.5
      );
      core.addColorStop(0,`rgba(255,255,255,${n.alpha*brightness})`);
      core.addColorStop(.35,
        `rgba(${n.color},${n.alpha*brightness})`);
      core.addColorStop(1,"transparent");
      map.fillStyle = core;
      map.beginPath();
      map.arc(n.sx,n.sy,radius*2.5,0,6.283);
      map.fill();
    }

    requestAnimationFrame(render);
  }

  /* TOUCH CONTROLS */

  let ignoreTapUntil = 0;
  const pointers = new Map();
  let pinch = null;
  let dragging = false;
  let moved = 0;

  viewport.addEventListener("pointerdown",e => {
    if (e.pointerType==="mouse"&&e.button!==0) return;
    cameraTarget = null;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if (pointers.size===1) {
      moved = 0;
      dragging = false;
    }
    if (pointers.size===2) {
      const [a,b] = [...pointers.values()];
      const center = {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      pinch = {
        distance:Math.hypot(a.x-b.x,a.y-b.y),
        anchor:world(center.x,center.y)
      };
    }
  });

  viewport.addEventListener("pointermove",e => {
    const old = pointers.get(e.pointerId);
    if (!old) return;
    const now = {x:e.clientX,y:e.clientY};
    pointers.set(e.pointerId,now);

    if (pointers.size===2) {
      const [a,b] = [...pointers.values()];
      const mid = {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const dist = Math.hypot(a.x-b.x,a.y-b.y);
      if (!pinch) return;
      const z = clamp(camera.z*dist/
        Math.max(1,pinch.distance),
        D.camera.minZoom,D.camera.maxZoom);
      camera.x = pinch.anchor.x-(mid.x-W/2)/z;
      camera.y = pinch.anchor.y-(mid.y-H/2)/z;
      camera.z = z;
      pinch.distance = dist;
      pinch.anchor = world(mid.x,mid.y);
      ignoreTapUntil = Date.now()+350;
      return;
    }

    const dx = now.x-old.x,dy = now.y-old.y;
    moved += Math.hypot(dx,dy);
    if (moved>10) {
      dragging = true;
      ignoreTapUntil = Date.now()+350;
      if (!viewport.hasPointerCapture(e.pointerId))
        viewport.setPointerCapture(e.pointerId);
    }
    if (dragging) {
      camera.x -= dx/camera.z;
      camera.y -= dy/camera.z;
    }
  });

  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    if (viewport.hasPointerCapture(e.pointerId))
      viewport.releasePointerCapture(e.pointerId);
    if (dragging||pinch) ignoreTapUntil = Date.now()+350;
    if (!pointers.size) {
      dragging = false;
      pinch = null;
    }
  }
  viewport.addEventListener("pointerup",pointerEnd);
  viewport.addEventListener("pointercancel",pointerEnd);

  viewport.addEventListener("wheel",e => {
    e.preventDefault();
    zoomAt(e.clientX,e.clientY,
      Math.exp(-e.deltaY*D.camera.wheelSensitivity));
  },{passive:false});

  /* POPUP MANAGEMENT */

  let current = null;
  let history = [];
  let popupToken = 0;
  let activePanel = null;
  let editorReturn = null;

  function closePanel() {
    if (!activePanel) return;
    activePanel.classList.remove("open");
    activePanel.setAttribute("aria-hidden","true");
    activePanel = null;
    if (!current) viewport.inert = false;
  }

  function panel(el) {
    if (activePanel) closePanel();
    activePanel = el;
    el.classList.add("open");
    el.setAttribute("aria-hidden","false");
    viewport.inert = true;
  }

  function detail(html) {
    $("#detailContent").innerHTML = html;
    panel($("#detailOverlay"));
  }

  function editor(html,heading) {
    $("#editorTitle").textContent = heading;
    $("#editorContent").innerHTML = html;
    panel($("#editorOverlay"));
  }

  function closePopup() {
    popupToken++;
    current = null;
    history = [];
    $("#popupOverlay").classList.remove("open");
    $("#popupOverlay").setAttribute("aria-hidden","true");
    if (!activePanel) viewport.inert = false;
  }

  function back() {
    if (!history.length) return closePopup();
    const p = history.pop();
    openPopup(p.type,p.id,false);
  }

  function rating(r) {
    const value = r?.averageRating ??
      r?.calculatedRating ?? r?.rating;
    if (value===null||value===undefined||value==="") return null;
    return clamp(Number(value)||0,0,10);
  }

  function ratingHTML(r) {
    const value = rating(r);
    if (value===null)
      return '<span class="rating-unrated">Not rated yet</span>';
    const symbols = Array.from({length:10},(_,i) => {
      const amount = clamp(value-i,0,1);
      return `<span class="rating-star"><svg viewBox="0 0 24 24">
        <path d="M12 2L15 8.5L22 9.5L17 14.5L18 22L12 18.5L6 22L7 14.5L2 9.5L9 8.5Z"
        fill="${amount>=.75?"#d9d0ff":amount>=.25?"#9f92d9":"transparent"}"
        stroke="#a69fc8" stroke-width="1"/></svg></span>`;
    }).join("");
    return `<span class="rating-stars">${symbols}</span>
      <span class="rating-value">${value.toFixed(1)} / 10</span>`;
  }

  function formatDate(s) {
    if (!s) return "";
    const d = new Date(s+"T12:00:00");
    return isNaN(d.getTime())?s:d.toLocaleDateString(
      undefined,{year:"numeric",month:"short",day:"numeric"}
    );
  }

  function metadata(type,r) {
    const main = genreNames(r.mainGenreIds,"main");
    const secondary = genreNames(r.secondaryGenreIds,"secondary");
    const set = (id,value) => $(id).textContent = value;

    set("#popupSubMeta","");
    set("#popupMetaPrimary","");
    set("#popupMetaSecondary","");

    if (type==="group"||type==="production") {
      set("#popupMetaPrimary",main.join(" · ") ||
        (type==="production"?r.mediaType||"":""));
      set("#popupMetaSecondary",secondary.join(" · "));
    }
    if (type==="production") {
      set("#popupSubMeta",[
        formatDate(r.releaseStart),formatDate(r.releaseEnd)
      ].filter(Boolean).join(" — "));
    }
    if (type==="season") {
      set("#popupSubMeta",[
        formatDate(r.releaseStart),formatDate(r.releaseEnd)
      ].filter(Boolean).join(" — "));
      set("#popupMetaPrimary",r.status||"Planned");
    }
    if (type==="episode") {
      set("#popupMetaPrimary",
        r.duration?`${r.duration} min`:"");
      set("#popupMetaSecondary",
        r.status||"Planned");
    }

    const strip = $("#popupDetailStrip");
    strip.replaceChildren();
    if (type==="season"||type==="episode") {
      const values = [];
      if (r.status) values.push(r.status);
      if (type==="episode"&&r.duration)
        values.push(`${r.duration} minutes`);
      if (type==="episode"&&r.releaseStart)
        values.push("Aired "+formatDate(r.releaseStart));
      if (type==="episode"&&r.watchedAt)
        values.push("Watched "+formatDate(r.watchedAt));
      strip.innerHTML = values.map(v =>
        `<span>${esc(v)}</span>`).join("");
      strip.hidden = !values.length;
    } else strip.hidden = true;
  }

  function openPopup(type,rid,push=true) {
    const resolved = resolve(type,rid);
    if (!resolved) {
      toast("Entry not found.");
      return;
    }

    if (push&&current&&
       (current.type!==type||current.id!==rid))
      history.push({...current});

    const {item:r,demo} = resolved;
    current = {type,id:rid,demo};
    const token = ++popupToken;

    closePanel();
    const overlay = $("#popupOverlay");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden","false");
    viewport.inert = true;

    $("#archivePopup").dataset.entryType = type;
    $("#popupType").textContent =
      type==="group"?"COLLECTION":
      type==="production"?(r.mediaType||"PRODUCTION").toUpperCase():
      type.toUpperCase();
    $("#popupTitle").textContent = title(r);
    $("#popupRating").innerHTML = ratingHTML(r);
    metadata(type,r);

    const notes = $("#popupNotes");
    notes.textContent = r.notes||"";
    notes.classList.toggle("is-empty",!r.notes);

    const clip = $("#popupPaperclip");
    clip.hidden = type==="group";
    clip.dataset.status =
      D.statusVisuals[r.status]?.key || "planned";

    $("#popupEditButton").hidden = demo;
    $("#popupBackButton").hidden = !history.length;
    $("#popupEpisodeActions").hidden = type!=="episode";
    $("#popupEpisodeEditButton").hidden = demo;

    const bannerBox = $("#popupBanner");
    bannerBox.style.backgroundImage = "";
    bannerBox.classList.add("is-empty");
    bannerBox.style.backgroundPosition =
      `${r.bannerPositionX??50}% ${r.bannerPositionY??35}%`;

    bannerURL(r).then(url => {
      if (token!==popupToken) return;
      if (url) {
        bannerBox.style.backgroundImage =
          `url(${JSON.stringify(url)})`;
        bannerBox.classList.remove("is-empty");
      }
    }).catch(console.warn);

    const section = $("#popupChildrenSection");
    const area = $("#popupChildren");
    const childType = next[type];
    section.hidden = !childType;

    if (childType) {
      const list = childList(type,r,demo);
      $("#popupChildrenLabel").textContent =
        `${list.length} ${
          type==="group"?"PRODUCTIONS":
          type==="production"?"SEASONS":"EPISODES"
        }`;
      $("#popupAddChildButton").hidden = demo||
        (type==="production"&&
         ["Movie","Short Film","Special"].includes(r.mediaType));

      area.className = "popup-children is-"+type;
      area.innerHTML = list.length?list.map((child,i) => {
        if (type==="group") return `
          <button type="button" class="child-production-card"
            data-child="${esc(child.id)}">
            <span class="child-production-title">${esc(title(child))}</span>
            <span class="child-production-sub">${
              esc(child.mediaType||"Production")
            }</span>
          </button>`;
        if (type==="production") return `
          <button type="button" class="child-season-card"
            data-child="${esc(child.id)}">
            <span class="child-season-title">${esc(title(child))}</span>
            <span class="child-season-meta">↗</span>
          </button>`;
        return `
          <button type="button" class="child-episode-card"
            data-child="${esc(child.id)}">
            <span class="child-episode-number">EPISODE ${i+1}</span>
            <span class="child-episode-title">${esc(title(child))}</span>
            <span class="child-episode-meta">
              ${child.duration?esc(child.duration)+" min":""}
              <span class="child-episode-status"
                data-status="${
                  D.statusVisuals[child.status]?.key||"planned"
                }"></span>
            </span>
          </button>`;
      }).join("") :
      '<p class="popup-children-empty">Nothing added yet.</p>';

      area.querySelectorAll("[data-child]").forEach(b => {
        b.onclick = () => openPopup(childType,b.dataset.child);
      });
    }
    $("#archivePopup").focus();
  }

  /* EDITOR */

  function options(type) {
    return rows(type).map(r => ({
      value:r.id,label:title(r)
    }));
  }

  function input(key,label,value="",kind="text") {
    return `<div class="form-field"><label for="f-${key}">${
      esc(label)}</label><input class="form-input"
      id="f-${key}" type="${kind}" value="${esc(value)}"></div>`;
  }

  function select(key,label,choices,value="") {
    return `<div class="form-field"><label for="f-${key}">${
      esc(label)}</label><select class="form-select" id="f-${key}">${
      choices.map(c => `<option value="${esc(c.value)}"
      ${String(c.value)===String(value)?"selected":""}>${
        esc(c.label)}</option>`).join("")
    }</select></div>`;
  }

  function genreFields(kind,selected=[]) {
    return `<div class="form-field"><label>${
      kind==="main"?"Main Genres":"Secondary Genres"
    }</label>${genres(kind).map(g => `
      <label class="field-checkbox">
      <input type="checkbox" data-genre="${kind}"
      value="${esc(g.id)}" ${selected.includes(g.id)?"checked":""}>
      ${esc(g.name)}</label>`).join("")}</div>`;
  }

  let pendingImage = null;
  let pendingURL = null;
  let uploadToken = 0;

  function clearPending() {
    uploadToken++;
    if (pendingURL) URL.revokeObjectURL(pendingURL);
    pendingURL = null;
    pendingImage = null;
  }

  async function previewBanner(item,token) {
    const url = await bannerURL(item);
    if (token!==uploadToken||!$("#bannerPreview")) return;
    $("#bannerPreview").innerHTML = url?
      '<img class="banner-preview-image" alt="Banner preview">':
      '<span class="banner-preview-empty">✧</span>';
    if (url) $("#bannerPreview img").src = url;
  }

  function openForm(type,rid=null,parentID=null) {
    clearPending();
    const item = rid?find(type,rid):null;
    const r = item||{};
    if (rid&&!item) return toast("Entry not found.");

    let html = `<form id="archiveForm" class="archive-form">
      ${input("title","Title",r.title||"")}`;

    if (type==="production") {
      html += select("groupId","Parent Group",[
        {value:"",label:"None — standalone"},...options("group")
      ],r.groupId??parentID??"");
      html += select("mediaType","Media Format",
        D.mediaTypes.map(v => ({value:v,label:v})),
        r.mediaType||"TV Series");
    }

    if (type==="season") html += select(
      "productionId","Production",options("production"),
      r.productionId??parentID??""
    );

    if (type==="episode") html += select(
      "seasonId","Season",options("season"),
      r.seasonId??parentID??""
    );

    if (type!=="group") {
      html += select("status","Watching Status",
        D.statuses.map(v => ({value:v,label:v})),
        r.status||"Planned");
    }

    if (type==="production") html += `
      <label class="field-checkbox"><input type="checkbox"
      id="f-watchlist" ${r.watchlist?"checked":""}>Watchlist</label>`;

    if (type==="group"||type==="production") {
      html += genreFields("main",r.mainGenreIds||[]);
      html += genreFields("secondary",r.secondaryGenreIds||[]);
    }

    html += `<div class="form-field banner-upload">
      <label>Banner Image</label>
      <div id="bannerPreview" class="banner-upload-preview"></div>
      <div class="banner-upload-actions">
        <button type="button" class="soft-button"
          id="chooseBanner">Choose from Gallery</button>
        <button type="button" class="soft-button"
          id="removeBanner">Remove</button>
      </div>
      <div class="form-grid">
        ${input("bannerPositionX","Horizontal Focus (%)",
          r.bannerPositionX??50,"number")}
        ${input("bannerPositionY","Vertical Focus (%)",
          r.bannerPositionY??35,"number")}
      </div>
    </div>`;

    if (type==="production"||type==="season") html += `
      <div class="form-grid">
        ${input("releaseStart","Airing Start",
          r.releaseStart||"","date")}
        ${input("releaseEnd","Airing End",
          r.releaseEnd||"","date")}
      </div>`;

    if (type==="episode") html += `
      ${input("duration","Duration (minutes)",
        r.duration??"","number")}
      ${input("releaseStart","Air Date",
        r.releaseStart||"","date")}
      ${input("watchedAt","Date Watched",
        r.watchedAt||"","date")}`;

    if (type==="production") html +=
      input("lastWatched","Last Watched",
        r.lastWatched||"","date");

    html += `<div class="form-field">
      <label for="f-notes">Personal Observations</label>
      <textarea id="f-notes" class="form-textarea"></textarea>
    </div>
    <div class="form-actions">
      <button type="button" id="cancelForm"
        class="soft-button">Cancel</button>
      <button type="submit" id="saveForm"
        class="soft-button primary-button">Save</button>
    </div></form>`;

    editor(html,item?"Edit "+type:"Create "+type);
    $("#f-notes").value = r.notes||"";

    const token = ++uploadToken;
    previewBanner(r,token);

    $("#chooseBanner").onclick = () =>
      $("#bannerFileInput").click();

    $("#removeBanner").onclick = () => {
      clearPending();
      pendingImage = {remove:true};
      $("#bannerPreview").innerHTML =
        '<span class="banner-preview-empty">✧</span>';
    };

    $("#cancelForm").onclick = () => {
      clearPending();
      closePanel();
      if (editorReturn) {
        const p = editorReturn;
        editorReturn = null;
        openPopup(p.type,p.id,false);
      } else openManager();
    };

    $("#archiveForm").onsubmit = async e => {
      e.preventDefault();
      const button = $("#saveForm");
      button.disabled = true;
      const get = key => $("#f-"+key)?.value??"";
      const data = {
        title:get("title").trim(),
        notes:$("#f-notes").value,
        bannerPositionX:Number(get("bannerPositionX"))||50,
        bannerPositionY:Number(get("bannerPositionY"))||35
      };

      if (!data.title) {
        toast("Title required.");
        button.disabled = false;
        return;
      }

      if (type==="production") {
        data.groupId = get("groupId")||null;
        data.mediaType = get("mediaType");
        data.watchlist = $("#f-watchlist").checked;
        data.lastWatched = get("lastWatched");
      }
      if (type==="season") data.productionId = get("productionId");
      if (type==="episode") {
        data.seasonId = get("seasonId");
        data.duration = Math.max(0,Number(get("duration"))||0);
        data.releaseStart = get("releaseStart");
        data.watchedAt = get("watchedAt");
      }
      if (type!=="group") data.status = get("status");
      if (type==="production"||type==="season") {
        data.releaseStart = get("releaseStart");
        data.releaseEnd = get("releaseEnd");
      }
      if (type==="group"||type==="production") {
        data.mainGenreIds =
          $$('#archiveForm [data-genre="main"]:checked')
          .map(x => x.value);
        data.secondaryGenreIds =
          $$('#archiveForm [data-genre="secondary"]:checked')
          .map(x => x.value);
      }

      const parentKey = parentKeys[type];
      if (parentKey&&
         (type!=="production"||data.groupId)&&
         !find(previous[type],data[parentKey])) {
        toast("Select a valid parent.");
        button.disabled = false;
        return;
      }

      let newImage = null;

      try {
        if (pendingImage?.remove) {
          data.bannerImageId = null;
          data.banner = "";
        } else if (pendingImage?.blob) {
          newImage = "banner-"+id();
          await imagePut(newImage,pendingImage.blob);
          data.bannerImageId = newImage;
          data.banner = "";
        }

        const before = item?clone(item):null;
        const now = new Date().toISOString();
        let saved;

        if (item) {
          Object.assign(item,data,{updatedAt:now});
          saved = item;
        } else {
          saved = {
            id:id(),...data,
            order:rows(type).length,
            createdAt:now,updatedAt:now
          };
          rows(type).push(saved);
        }

        if (!changed("Entry saved.")) {
          if (item) Object.assign(item,before);
          else rows(type).pop();
          if (newImage) {
            const db = await database();
            const tx = db.transaction(D.images.objectStore,"readwrite");
            tx.objectStore(D.images.objectStore).delete(newImage);
          }
          button.disabled = false;
          return;
        }

        clearPending();
        closePanel();

        if (editorReturn) {
          const p = editorReturn;
          editorReturn = null;
          openPopup(p.type,p.id,false);
        } else openManager();
      } catch(error) {
        console.error(error);
        toast("Could not save entry.");
        button.disabled = false;
      }
    };
  }

  function deleteTree(type,rid) {
    for (const c of children(type,rid))
      deleteTree(next[type],c.id);
    const list = rows(type);
    const i = list.findIndex(r => r.id===rid);
    if (i>=0) list.splice(i,1);
  }

  let confirmAction = null;

  function ask(message,action) {
    confirmAction = action;
    $("#confirmMessage").textContent = message;
    $("#confirmOverlay").classList.add("open");
    $("#confirmOverlay").setAttribute("aria-hidden","false");
  }

  function closeConfirm() {
    $("#confirmOverlay").classList.remove("open");
    $("#confirmOverlay").setAttribute("aria-hidden","true");
  }

  function openManager() {
    editorReturn = null;
    clearPending();
    editor(`
      <p>Create, edit and rearrange your archive.</p>
      <div class="manager-actions">
        ${types.map(t => `<button class="soft-button"
          data-create="${t}" type="button">+ ${t}</button>`).join("")}
      </div>
      ${types.map(t => `<section class="manager-section">
        <div class="manager-section-title"><h3>${t}s</h3>
          <span class="manager-count">${rows(t).length}</span></div>
        <div class="manager-list">
        ${rows(t).map(r => `<div class="manager-item">
          <div class="manager-item-main">
            <span class="manager-item-title">${esc(title(r))}</span>
          </div>
          <div class="manager-item-actions">
            <button class="mini-button" data-edit="${t}"
              data-rid="${esc(r.id)}">✎</button>
            <button class="mini-button" data-delete="${t}"
              data-rid="${esc(r.id)}">×</button>
          </div>
        </div>`).join("")}
        </div></section>`).join("")}
    `,"Create & Edit");

    $$("[data-create]").forEach(b =>
      b.onclick = () => openForm(b.dataset.create));
    $$("[data-edit]").forEach(b =>
      b.onclick = () => openForm(b.dataset.edit,b.dataset.rid));
    $$("[data-delete]").forEach(b => b.onclick = () => {
      const t = b.dataset.delete,rid = b.dataset.rid;
      ask(`Delete "${title(find(t,rid))}" and its children?`,() => {
        deleteTree(t,rid);
        changed("Deleted.");
        if (current&&!resolve(current.type,current.id)) closePopup();
        openManager();
      });
    });
  }

  function openGenres() {
    detail(`<span class="detail-eyebrow">PERSONAL CATEGORIES</span>
      <h2 id="detailTitle">Genre Creation</h2>
      ${["main","secondary"].map(kind => `
      <h3>${kind==="main"?"Main Genres":"Secondary Tags"}</h3>
      <div class="genre-create-row">
        <input class="form-input" id="genre-${kind}"
          placeholder="New genre...">
        <button class="soft-button" data-add="${kind}">Add</button>
      </div>
      <div class="genre-list">
        ${genres(kind).map(g => `<span class="genre-chip">
          ${esc(g.name)}
          <button data-remove="${kind}"
            data-id="${esc(g.id)}">×</button>
        </span>`).join("")}
      </div>`).join("")}`);

    $$("[data-add]").forEach(b => b.onclick = () => {
      const kind = b.dataset.add;
      const value = $("#genre-"+kind).value.trim();
      if (!value) return;
      if (genres(kind).some(g =>
        g.name.toLowerCase()===value.toLowerCase()))
        return toast("Genre exists.");
      genres(kind).push({id:id(),name:value});
      changed("Genre created.");
      openGenres();
    });

    $$("[data-remove]").forEach(b => b.onclick = () => {
      const kind = b.dataset.remove,rid = b.dataset.id;
      ask("Delete this genre?",() => {
        const list = genres(kind);
        list.splice(list.findIndex(g => g.id===rid),1);
        const key = kind==="main"?"mainGenreIds":"secondaryGenreIds";
        for (const t of ["group","production"])
          for (const r of rows(t))
            r[key] = (r[key]||[]).filter(x => x!==rid);
        changed("Genre deleted.");
        openGenres();
      });
    });
  }

  /* LIBRARY / SEARCH */

  function openLibrary(mode) {
    detail(`<span class="detail-eyebrow">YOUR ARCHIVE</span>
      <h2 id="detailTitle">${mode==="library"?"Library":"Watchlist"}</h2>
      <div class="library-toolbar">
        <div class="library-control">
          <label>Search</label>
          <input class="library-input" id="librarySearch">
        </div>
        <div class="library-control">
          <label>Sort</label>
          <select id="librarySort" class="library-select">
          ${D.sorting.map(s => `<option value="${s.id}">${
            esc(s.title)}</option>`).join("")}</select>
        </div>
      </div>
      <div id="libraryResults" class="library-results"></div>`);

    const draw = () => {
      let list = [...rows("production")];
      if (mode==="watchlist")
        list = list.filter(r => r.watchlist||r.status==="Planned");
      const query = $("#librarySearch").value.toLowerCase();
      list = list.filter(r => title(r).toLowerCase().includes(query));
      const sort = $("#librarySort").value;
      list.sort((a,b) => {
        if (sort==="alphabeticalReverse")
          return title(b).localeCompare(title(a));
        if (sort==="highestRated")
          return (rating(b)??-1)-(rating(a)??-1);
        if (sort==="lowestRated")
          return (rating(a)??999)-(rating(b)??999);
        if (sort==="lastWatched")
          return Date.parse(b.lastWatched||0)-
            Date.parse(a.lastWatched||0);
        return title(a).localeCompare(title(b));
      });
      $("#libraryResults").innerHTML = list.map(r => `
        <button class="library-entry" data-open="${esc(r.id)}">
          <span class="library-entry-title">${esc(title(r))}</span>
          <span class="library-entry-meta">${esc(r.mediaType||"")}</span>
        </button>`).join("")||
        '<p class="library-empty">Nothing here yet.</p>';

      $$("[data-open]").forEach(b =>
        b.onclick = () => openPopup("production",b.dataset.open));
    };
    $("#librarySearch").oninput = draw;
    $("#librarySort").onchange = draw;
    draw();
  }

  function search() {
    panel($("#searchOverlay"));
    $("#globalSearch").value = "";
    $("#searchResults").replaceChildren();
    $("#globalSearch").focus();
  }

  $("#globalSearch").oninput = e => {
    const query = e.target.value.trim().toLowerCase();
    const matches = query ? types.flatMap(t =>
      rows(t).filter(r => title(r).toLowerCase().includes(query))
        .map(r => ({type:t,r}))) : [];
    $("#searchResults").innerHTML = matches.map(({type,r}) => `
      <button class="search-result" data-type="${type}"
        data-id="${esc(r.id)}">${esc(title(r))}
        <small>${type}</small></button>`).join("");
    $$("#searchResults button").forEach(b =>
      b.onclick = () => openPopup(b.dataset.type,b.dataset.id));
  };

  /* BACKUPS */

  function asDataURL(blob) {
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function fromDataURL(url) {
    const [header,body] = url.split(",");
    if (!body) throw Error("Invalid image data.");
    const bytes = Uint8Array.from(atob(body),c => c.charCodeAt(0));
    return new Blob([bytes],{
      type:/data:([^;,]+)/.exec(header)?.[1]||"image/jpeg"
    });
  }

  async function exportBackup() {
    try {
      const images = {};
      for (const key of new Set(types.flatMap(t =>
        rows(t).map(r => r.bannerImageId).filter(Boolean)))) {
        const blob = await imageGet(key);
        if (!blob) throw Error("Missing banner: "+key);
        images[key] = await asDataURL(blob);
      }
      const blob = new Blob([JSON.stringify({
        app:D.appName,schemaVersion:D.schemaVersion,
        data:state,images
      })],{type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "watch-archive-backup.json";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url),4000);
      toast("Backup prepared.");
    } catch(e) {
      console.error(e);
      toast("Backup failed.");
    }
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app!==D.appName||!data.data?.archive)
        throw Error("Not a valid archive.");
      if (!confirm("Replace your archive? Export a backup first.")) return;

      for (const [key,value] of Object.entries(data.images||{}))
        await imagePut(key,fromDataURL(value));

      state = normalize(data.data);
      save();
      buildWorld();
      closePopup();
      closePanel();
      home();
      toast("Archive imported.");
    } catch(e) {
      console.error(e);
      toast("Import failed.");
    }
    $("#importFile").value = "";
  }

  function openSettings() {
    detail(`<span class="detail-eyebrow">UNIVERSE</span>
      <h2 id="detailTitle">Settings</h2>
      ${["starDensity","starBrightness","nebulaIntensity",
        "constellationGlow"].map(key => `
        <div class="detail-row">
          <label>${key}</label>
          <input class="setting-range" type="range"
            min="0" max="100" id="setting-${key}"
            value="${state.settings[key]}">
        </div>`).join("")}
      <div class="detail-row"><label>Reduce Motion</label>
        <input id="setting-motion" type="checkbox"
        ${state.settings.reduceMotion?"checked":""}></div>
      <h3>Backups</h3>
      <button class="detail-action" id="exportArchive">
        Export Complete Archive</button>
      <button class="detail-action" id="importArchive">
        Import Archive</button>`);

    for (const key of ["starDensity","starBrightness",
      "nebulaIntensity","constellationGlow"]) {
      $("#setting-"+key).oninput = e => {
        state.settings[key] = Number(e.target.value);
        save();
        if (key==="starDensity") resize();
      };
    }
    $("#setting-motion").onchange = e => {
      state.settings.reduceMotion = e.target.checked;
      document.body.classList.toggle("reduce-motion",e.target.checked);
      save();
    };
    $("#exportArchive").onclick = exportBackup;
    $("#importArchive").onclick = () => $("#importFile").click();
  }

  /* BUTTONS */

  $("#homeButton").onclick = home;
  $("#focusButton").onclick = () =>
    focused&&lookup.has(focused)?
    focusNode(lookup.get(focused)):home();
  $("#searchButton").onclick = search;

  $("#popupCloseButton").onclick = closePopup;
  $("#popupBackButton").onclick = back;
  $("#popupBackdrop").onclick = closePopup;

  function editCurrent() {
    if (!current||current.demo) return;
    editorReturn = {...current};
    openForm(current.type,current.id);
  }
  $("#popupEditButton").onclick = editCurrent;
  $("#popupEpisodeEditButton").onclick = editCurrent;

  $("#popupAddChildButton").onclick = () => {
    if (!current||current.demo||!next[current.type]) return;
    editorReturn = {...current};
    openForm(next[current.type],null,current.id);
  };

  for (const [overlay,backdrop,close] of [
    ["detailOverlay","detailBackdrop","closeDetailButton"],
    ["editorOverlay","editorBackdrop","closeEditorButton"],
    ["searchOverlay","searchBackdrop","closeSearchButton"]
  ]) {
    $("#"+backdrop).onclick = () => {
      if (overlay==="editorOverlay") clearPending();
      closePanel();
    };
    $("#"+close).onclick = () => {
      if (overlay==="editorOverlay") clearPending();
      closePanel();
    };
  }

  $("#bannerFileInput").onchange = async e => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file||!$("#archiveForm")) return;
    const token = ++uploadToken;
    try {
      toast("Preparing banner...");
      const blob = await compress(file);
      if (token!==uploadToken) return;
      if (pendingURL) URL.revokeObjectURL(pendingURL);
      pendingImage = {blob};
      pendingURL = URL.createObjectURL(blob);
      $("#bannerPreview").innerHTML =
        '<img class="banner-preview-image" alt="New banner">';
      $("#bannerPreview img").src = pendingURL;
      toast("Banner ready. Save your entry.");
    } catch(error) {
      console.error(error);
      toast("Could not open image.");
    }
  };

  $("#importFile").onchange = e => importBackup(e.target.files?.[0]);

  $("#cancelConfirmButton").onclick = closeConfirm;
  $("#acceptConfirmButton").onclick = () => {
    const action = confirmAction;
    closeConfirm();
    action?.();
  };

  document.addEventListener("keydown",e => {
    if (e.key!=="Escape") return;
    if ($("#confirmOverlay").classList.contains("open"))
      closeConfirm();
    else if (activePanel) closePanel();
    else if (current) back();
  });

  let resizeTimer;
  window.addEventListener("resize",() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      buildWorld();
    },180);
  });

  window.addEventListener("storage",e => {
    if (e.key!==D.storageKey) return;
    state = load();
    buildWorld();
  });

  /* START */

  document.body.classList.toggle(
    "reduce-motion",state.settings.reduceMotion
  );
  resize();
  buildWorld();
  home();
  requestAnimationFrame(render);
  if (!localStorage.getItem(D.storageKey)) save();

})();
