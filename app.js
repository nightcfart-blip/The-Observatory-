
"use strict";

/* =====================================================
   WATCH ARCHIVE — STEP 4
   GROUP & PRODUCTION PAGES
   GitHub Pages / Vanilla JS / Local-first
===================================================== */

(() => {
  const D = window.WATCH_DATA;
  if (!D) return;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const copy = x => JSON.parse(JSON.stringify(x));
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const mix = (a,b,t) => a+(b-a)*t;
  const fade = (a,b,x) => {
    const t=clamp((x-a)/(b-a),0,1);
    return t*t*(3-2*t);
  };
  const esc = v => String(v??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",
    '"':"&quot;","'":"&#39;"
  })[c]);

  const TYPES=["group","production","season","episode"];
  const KEYS={
    group:"groups",production:"productions",
    season:"seasons",episode:"episodes"
  };
  const PARENTS={
    production:"groupId",
    season:"productionId",
    episode:"seasonId"
  };
  const NEXT={
    group:"production",
    production:"season",
    season:"episode"
  };

  const viewport=$("#viewport");
  const mapCanvas=$("#constellationCanvas");
  const bgCanvas=$("#backgroundStars");
  const nebCanvas=$("#nebulaCanvas");
  const ctx=mapCanvas.getContext("2d");
  const bg=bgCanvas.getContext("2d");
  const neb=nebCanvas.getContext("2d");

  const overlays=[
    $("#detailOverlay"),
    $("#editorOverlay"),
    $("#searchOverlay")
  ];
  const pageOverlay=$("#pageOverlay");
  const confirmation=$("#confirmOverlay");

  const prefersReduced=matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let state=load();
  let nodes=[],edges=[],nodeMap=new Map();
  let W=innerWidth,H=innerHeight;
  let starField=[],nebulaTexture=null;
  let running=false,raf=0,lastFrame=0;
  let selected=null,focused=null;
  let travel=null,toastTimer=0;
  let activeOverlay=null,restoreFocus=null;
  let confirmWork=null,confirmReturn=null;

  let currentPage=null;
  let pageStack=[];
  let pageToken=0;
  let editorReturn=null;
  let pendingBanner=null;
  let pendingPreviewURL=null;
  let bannerPickToken=0;

  const imageURLs=new Map();
  let imageDBPromise=null;

  let collectionMode="library";
  let collectionFilters={};
  let starHover=null;

  const camera={x:0,y:0,z:1};
  const pointers=new Map();
  let gesture=null,ignoreClickUntil=0;

  /* =====================================================
     HELPERS & STORAGE
  ===================================================== */

  function id() {
    return crypto.randomUUID?.() ||
      "wa-"+Date.now().toString(36)+"-"+
      Math.random().toString(36).slice(2);
  }

  function hash(s) {
    let h=2166136261;
    for(const c of String(s)) {
      h^=c.charCodeAt(0);
      h=Math.imul(h,16777619);
    }
    return h>>>0;
  }

  function rnd(s) {
    let t=s+0x6d2b79f5;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  }

  function title(x) {
    return String(x?.title||x?.name||"Untitled");
  }

  function numeric(x,def,min,max) {
    if(x===null||x===undefined||x==="") return def;
    const n=Number(x);
    return Number.isFinite(n)?clamp(n,min,max):def;
  }

  function initial() {
    const now=new Date().toISOString();
    return {
      schemaVersion:D.schemaVersion,
      createdAt:now,updatedAt:now,
      settings:copy(D.defaults.settings),
      archive:copy(D.defaults.archive)
    };
  }

  function normalize(value) {
    const base=initial();
    const input=value&&typeof value==="object"?value:{};
    const a=input.archive||{},s=input.settings||{};
    const archive={...a};

    for(const type of TYPES)
      archive[KEYS[type]]=Array.isArray(a[KEYS[type]])
        ?a[KEYS[type]]:[];

    archive.genres=Array.isArray(a.genres)?a.genres:[];
    archive.secondaryGenres=Array.isArray(a.secondaryGenres)
      ?a.secondaryGenres:[];

    return {
      ...base,...input,schemaVersion:D.schemaVersion,
      archive,
      settings:{
        ...base.settings,...s,
        starDensity:numeric(s.starDensity,75,10,100),
        starBrightness:numeric(s.starBrightness,60,10,100),
        nebulaIntensity:numeric(s.nebulaIntensity,65,0,100),
        constellationGlow:numeric(s.constellationGlow,65,0,100),
        reduceMotion:s.reduceMotion===true
      }
    };
  }

  function load() {
    try {
      const raw=localStorage.getItem(D.storageKey);
      if(!raw) return initial();
      const parsed=JSON.parse(raw);
      if(parsed.schemaVersion!==D.schemaVersion)
        throw Error("Unsupported archive version");
      return normalize(parsed);
    } catch(e) {
      console.warn("Archive could not be read:",e);
      return initial();
    }
  }

  function save() {
    state.updatedAt=new Date().toISOString();
    try {
      localStorage.setItem(D.storageKey,JSON.stringify(state));
      return true;
    } catch(e) {
      console.error(e);
      toast("Local save failed. Export a backup.");
      return false;
    }
  }

  function motionOff() {
    return state.settings.reduceMotion||prefersReduced.matches;
  }

  function applyMotion() {
    document.body.classList.toggle("reduce-motion",motionOff());
  }

  function toast(message) {
    const el=$("#toast");
    el.textContent=message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove("show"),3000);
  }

  function records(type) {
    return state.archive[KEYS[type]];
  }

  function record(type,recordId) {
    return records(type).find(x=>String(x.id)===String(recordId))
      ||null;
  }

  function parentId(type,item) {
    return type==="group"?null:
      item[PARENTS[type]]??item.parentId??null;
  }

  function children(type,recordId) {
    const next=NEXT[type];
    return next?records(next).filter(x=>
      String(parentId(next,x)??"")===String(recordId)
    ).sort((a,b)=>
      (a.order??0)-(b.order??0)||
      title(a).localeCompare(title(b))
    ):[];
  }

  function nextOrder(type,pid=null) {
    const siblings=records(type).filter(x=>
      String(parentId(type,x)??"")===String(pid??"")
    );
    return Math.max(-1,...siblings.map(x=>Number(x.order)||0))+1;
  }

  function commit(message) {
    if(!save()) return false;
    rebuildUniverse();
    if(message) toast(message);
    return true;
  }

  function allGenre(type) {
    return state.archive[
      type==="secondary"?"secondaryGenres":"genres"
    ];
  }

  function genreName(gid,type) {
    return allGenre(type).find(g=>g.id===gid)?.name||"";
  }

  function genreNames(ids,type) {
    return (Array.isArray(ids)?ids:[])
      .map(gid=>genreName(gid,type)).filter(Boolean);
  }

  /* =====================================================
     INDEXEDDB GALLERY IMAGE STORAGE
  ===================================================== */

  function imageDatabase() {
    if(!imageDBPromise) {
      imageDBPromise=new Promise((resolve,reject)=>{
        if(!window.indexedDB) {
          reject(Error("IndexedDB unavailable"));
          return;
        }
        const request=indexedDB.open(
          D.images.databaseName,
          D.images.databaseVersion
        );
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains(D.images.objectStore))
            db.createObjectStore(D.images.objectStore);
        };
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
      }).catch(e=>{
        imageDBPromise=null;
        throw e;
      });
    }
    return imageDBPromise;
  }

  async function imageGet(key) {
    if(!key) return null;
    const db=await imageDatabase();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(D.images.objectStore,"readonly");
      const req=tx.objectStore(D.images.objectStore).get(key);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }

  async function imagePut(key,blob) {
    const db=await imageDatabase();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(D.images.objectStore,"readwrite");
      tx.objectStore(D.images.objectStore).put(blob,key);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }

  async function imageDelete(key) {
    if(!key) return;
    const db=await imageDatabase();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(D.images.objectStore,"readwrite");
      tx.objectStore(D.images.objectStore).delete(key);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
    const url=imageURLs.get(key);
    if(url) URL.revokeObjectURL(url);
    imageURLs.delete(key);
  }

  async function imageURL(key) {
    if(!key) return "";
    if(imageURLs.has(key)) return imageURLs.get(key);
    const blob=await imageGet(key);
    if(!blob) return "";
    const url=URL.createObjectURL(blob);
    imageURLs.set(key,url);
    return url;
  }

  async function bannerURL(item) {
    if(item?.bannerImageId) {
      try {
        const url=await imageURL(item.bannerImageId);
        if(url) return url;
      } catch(e) {
        console.warn("Banner unavailable:",e);
      }
    }
    return item?.banner||"";
  }

  async function compressImage(file) {
    if(file.size>D.images.maximumInputMB*1024*1024)
      throw Error("Image exceeds the size limit.");

    if(!file.type.startsWith("image/") &&
       !/\.(heic|heif|avif)$/i.test(file.name))
      throw Error("Please select an image.");

    let bitmap=null,source=null,sourceURL=null;

    try {
      if("createImageBitmap" in window) {
        try { bitmap=await createImageBitmap(file); }
        catch(e) { /* use img fallback */ }
      }

      if(bitmap) {
        source=bitmap;
      } else {
        sourceURL=URL.createObjectURL(file);
        source=await new Promise((resolve,reject)=>{
          const img=new Image();
          img.onload=()=>resolve(img);
          img.onerror=()=>reject(
            Error("This image format cannot be opened here.")
          );
          img.src=sourceURL;
        });
      }

      const ratio=Math.min(
        1,
        D.images.maximumWidth/source.width,
        D.images.maximumHeight/source.height
      );

      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(source.width*ratio));
      canvas.height=Math.max(1,Math.round(source.height*ratio));

      const c=canvas.getContext("2d");
      if(!c) throw Error("Canvas unavailable.");

      c.imageSmoothingEnabled=true;
      c.imageSmoothingQuality="high";
      c.fillStyle="#02040b";
      c.fillRect(0,0,canvas.width,canvas.height);
      c.drawImage(source,0,0,canvas.width,canvas.height);

      return await new Promise((resolve,reject)=>
        canvas.toBlob(
          b=>b?resolve(b):reject(Error("Image conversion failed.")),
          D.images.preferredFormat,
          D.images.quality
        )
      );
    } finally {
      bitmap?.close?.();
      if(sourceURL) URL.revokeObjectURL(sourceURL);
    }
  }

  function fileAsDataURL(blob) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataURLAsBlob(url) {
    const parts=url.split(",");
    if(parts.length!==2) throw Error("Invalid embedded image.");
    const mime=/^data:([^;,]+)/.exec(parts[0])?.[1]||
      "image/jpeg";
    const binary=atob(parts[1]);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)
      bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:mime});
  }

  function revokePending() {
    if(pendingPreviewURL)
      URL.revokeObjectURL(pendingPreviewURL);
    pendingPreviewURL=null;
    pendingBanner=null;
  }

  async function cleanupUnreferencedImages() {
    const referenced=new Set();
    for(const type of ["group","production"])
      for(const r of records(type))
        if(r.bannerImageId) referenced.add(r.bannerImageId);

    const db=await imageDatabase();
    const keys=await new Promise((resolve,reject)=>{
      const tx=db.transaction(D.images.objectStore,"readonly");
      const req=tx.objectStore(D.images.objectStore).getAllKeys();
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });

    for(const key of keys)
      if(!referenced.has(key)) await imageDelete(key);
  }

  /* =====================================================
     HIERARCHY CRUD
  ===================================================== */

  function create(type,data) {
    const name=String(data.title||"").trim();
    if(!name) return toast("A title is required."),null;

    const pkey=PARENTS[type];
    if(pkey&&type!=="production"&&!record(
      type==="season"?"production":"season",data[pkey]
    )) {
      toast("Select a valid parent.");
      return null;
    }
    if(type==="production"&&data.groupId&&
       !record("group",data.groupId)) {
      toast("Select a valid group.");
      return null;
    }

    const now=new Date().toISOString();
    const item={
      id:id(),title:name,notes:"",
      createdAt:now,updatedAt:now,
      ...data,
      title:name,
      order:nextOrder(type,data[pkey]||null)
    };
    if(type==="group"||type==="production") {
      item.mainGenreIds=data.mainGenreIds||[];
      item.secondaryGenreIds=data.secondaryGenreIds||[];
    }
    records(type).push(item);
    if(!commit("Entry created.")) {
      records(type).pop();
      return null;
    }
    return item;
  }

  function update(type,rid,data) {
    const original=record(type,rid);
    if(!original) return false;
    if(!String(data.title||"").trim())
      return toast("A title is required."),false;

    const pkey=PARENTS[type];
    if(pkey&&type!=="production"&&!record(
      type==="season"?"production":"season",data[pkey]
    )) return toast("Invalid parent."),false;

    if(type==="production"&&data.groupId&&
       !record("group",data.groupId))
      return toast("Invalid group."),false;

    const previous=copy(original);
    if(pkey&&String(original[pkey]||"")!==
       String(data[pkey]||"")) {
      data.order=nextOrder(type,data[pkey]||null);
      delete original.mapX;
      delete original.mapY;
    }

    Object.assign(original,data,{
      id:previous.id,
      createdAt:previous.createdAt,
      updatedAt:new Date().toISOString()
    });

    if(!commit("Changes saved.")) {
      Object.keys(original).forEach(k=>delete original[k]);
      Object.assign(original,previous);
      return false;
    }
    return true;
  }

  function removeTree(type,rid) {
    for(const c of children(type,rid))
      removeTree(NEXT[type],c.id);
    const list=records(type);
    const index=list.findIndex(x=>x.id===rid);
    if(index>=0) list.splice(index,1);
  }

  async function deleteEntry(type,rid) {
    removeTree(type,rid);
    if(currentPage?.id===rid) closePage();
    commit("Entry deleted.");
    try { await cleanupUnreferencedImages(); }
    catch(e) { console.warn(e); }
  }

  function reorder(type,rid,direction) {
    const item=record(type,rid);
    if(!item) return;
    const pid=parentId(type,item);
    const list=records(type).filter(x=>
      String(parentId(type,x)||"")===String(pid||"")
    ).sort((a,b)=>(a.order??0)-(b.order??0));

    const i=list.findIndex(x=>x.id===rid);
    const j=i+direction;
    if(j<0||j>=list.length) return;

    [list[i],list[j]]=[list[j],list[i]];
    list.forEach((x,k)=>x.order=k);
    commit("Order updated.");
  }

  /* =====================================================
     GENRE MANAGEMENT
  ===================================================== */

  function createGenre(type,name) {
    const clean=name.trim();
    const list=allGenre(type);
    if(!clean) return;
    if(list.some(g=>g.name.toLowerCase()===
       clean.toLowerCase()))
      return toast("That genre already exists.");

    list.push({id:id(),name:clean});
    commit("Genre created.");
    openGenres();
  }

  function renameGenre(type,gid) {
    const item=allGenre(type).find(g=>g.id===gid);
    if(!item) return;
    const name=prompt("Rename genre:",item.name);
    if(name===null||!name.trim()) return;
    if(allGenre(type).some(g=>g.id!==gid&&
       g.name.toLowerCase()===name.trim().toLowerCase()))
      return toast("That name already exists.");
    item.name=name.trim();
    commit("Genre renamed.");
    openGenres();
  }

  function deleteGenre(type,gid) {
    const key=type==="main"?"mainGenreIds":"secondaryGenreIds";
    const list=allGenre(type);
    const i=list.findIndex(g=>g.id===gid);
    if(i<0) return;
    list.splice(i,1);
    for(const t of ["group","production"])
      for(const item of records(t))
        item[key]=(item[key]||[]).filter(x=>x!==gid);
    commit("Genre deleted.");
    openGenres();
  }

  /* =====================================================
     CAMERA & STAR MAP
  ===================================================== */

  function w2s(x,y) {
    return {
      x:W/2+(x-camera.x)*camera.z,
      y:H/2+(y-camera.y)*camera.z
    };
  }

  function s2w(x,y) {
    return {
      x:camera.x+(x-W/2)/camera.z,
      y:camera.y+(y-H/2)/camera.z
    };
  }

  function setCamera(x,y,z) {
    camera.x=x;camera.y=y;
    camera.z=clamp(z,D.camera.minZoom,D.camera.maxZoom);
  }

  function animateCamera(dest,duration=900) {
    travel=motionOff()?null:{
      start:{...camera},end:dest,
      time:performance.now(),duration
    };
    if(motionOff()) setCamera(dest.x,dest.y,dest.z);
  }

  function stepCamera(now) {
    if(!travel) return;
    const t=clamp((now-travel.time)/travel.duration,0,1);
    const e=t*t*(3-2*t);
    setCamera(
      mix(travel.start.x,travel.end.x,e),
      mix(travel.start.y,travel.end.y,e),
      Math.exp(mix(
        Math.log(travel.start.z),
        Math.log(travel.end.z),e
      ))
    );
    if(t>=1) travel=null;
  }

  function zoomAt(x,y,factor) {
    travel=null;
    const p=s2w(x,y);
    const z=clamp(camera.z*factor,
      D.camera.minZoom,D.camera.maxZoom);
    setCamera(
      p.x-(x-W/2)/z,
      p.y-(y-H/2)/z,z
    );
  }

  function homePosition() {
    const nav=nodes.filter(n=>n.type==="navigation");
    if(!nav.length) return {x:0,y:0,z:1};
    const xs=nav.map(n=>n.x),ys=nav.map(n=>n.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys),maxY=Math.max(...ys);
    return {
      x:(minX+maxX)/2,y:(minY+maxY)/2,
      z:clamp(Math.min(
        W*(W<650?.79:.72)/(maxX-minX+110),
        H*.52/(maxY-minY+130),1.1
      ),D.camera.minZoom,1.1)
    };
  }

  function goHome() {
    focused=null;selected=null;
    animateCamera(homePosition(),800);
  }

  function focusNode(n) {
    focused=n;
    selected=n.id;
    const z={
      navigation:1.35,group:2.15,
      production:4.5,season:9.2,episode:13
    }[n.type]||2;
    animateCamera({x:n.x,y:n.y,z},920);
  }

  function groupPosition(r,i) {
    if(r.mapX!=null&&r.mapY!=null)
      return {x:Number(r.mapX),y:Number(r.mapY)};
    if(r.x!=null&&r.y!=null)
      return {x:Number(r.x),y:Number(r.y)};
    const angle=D.groupPlacement.angleOffset+
      i*2.39996323+(rnd(hash(r.id)+5)-.5)*.4;
    const radius=D.groupPlacement.initialRadius+
      Math.sqrt(i)*D.groupPlacement.distanceGrowth;
    return {
      x:Math.cos(angle)*radius,
      y:Math.sin(angle)*radius
    };
  }

  function childOffset(r,i,count,type) {
    const base={production:215,season:101,episode:43}[type];
    const ring=Math.floor(i/9);
    const index=i%9;
    const size=Math.min(9,count-ring*9);
    const angle=-Math.PI/2+index*Math.PI*2/
      Math.max(size,2)+(rnd(hash(r.id)+2)-.5)*.3;
    const radius=base*(1+ring*.9)*
      (.75+rnd(hash(r.id)+3)*.5);
    return {x:Math.cos(angle)*radius,
      y:Math.sin(angle)*radius};
  }

  function starAppearance(rid) {
    const h=hash(rid);
    const warm=rnd(h+18);
    return {
      color:warm<.14?[255,224,211]:
        warm<.38?[230,237,255]:
        warm<.83?[186,208,255]:[226,203,255],
      size:.72+rnd(h+7)*.86,
      halo:.62+rnd(h+8)*1.3,
      alpha:.67+rnd(h+9)*.33,
      spikes:rnd(h+10)>.56,
      angle:rnd(h+11)*Math.PI,
      ray:.6+rnd(h+12)*1.1,
      speed:.0002+rnd(h+13)*.0005,
      phase:rnd(h+14)*Math.PI*2,
      oval:.84+rnd(h+15)*.34
    };
  }

  function makeNode(r,type,x,y,parent=null,demo=false,action=null) {
    return {
      id:String(r.id),title:title(r),type,x,y,
      parentId:parent,record:r,demo,action,
      appearance:starAppearance(r.id),
      sx:-9999,sy:-9999,alpha:0,button:null
    };
  }

  function addNode(n) {
    if(nodeMap.has(n.id)) return;
    nodes.push(n);nodeMap.set(n.id,n);
  }

  function addTree(parent,parentNode) {
    const next=NEXT[parentNode.type];
    if(!next) return;
    const list=parentNode.demo
      ?(parent.children||[]):children(parentNode.type,parent.id);

    list.forEach((r,i)=>{
      const p=childOffset(r,i,list.length,next);
      const x=r.mapX!=null?Number(r.mapX):parentNode.x+p.x;
      const y=r.mapY!=null?Number(r.mapY):parentNode.y+p.y;
      const n=makeNode(r,next,x,y,parentNode.id,parentNode.demo);
      addNode(n);
      addTree(r,n);
    });
  }

  function connectSiblings(list) {
    if(list.length<2) return;
    const linked=[list[0]];
    const waiting=list.slice(1);
    while(waiting.length) {
      let best=null;
      for(const a of linked)
        for(const b of waiting) {
          const distance=Math.hypot(a.x-b.x,a.y-b.y);
          if(!best||distance<best.distance)
            best={a,b,distance};
        }
      edges.push([best.a.id,best.b.id]);
      linked.push(best.b);
      waiting.splice(waiting.indexOf(best.b),1);
    }
  }

  function rebuildUniverse() {
    nodes=[];edges=[];nodeMap=new Map();

    const scale=W<650?.58:1;
    for(const r of D.navigation.nodes) {
      const n=makeNode(
        {id:"nav-"+r.id,title:r.title},
        "navigation",r.x*scale,r.y*scale,null,false,r.action
      );
      addNode(n);
    }
    for(const [a,b] of D.navigation.connections)
      edges.push(["nav-"+a,"nav-"+b]);

    const own=records("group");
    const groups=own.length?own:D.demoGroups;

    groups.forEach((r,i)=>{
      const p=groupPosition(r,i);
      const n=makeNode(r,"group",p.x,p.y,null,!!r.demo);
      addNode(n);addTree(r,n);
    });

    records("production").filter(r=>!r.groupId&&!r.parentId)
      .forEach((r,i)=>{
        const angle=i*2.39996323+1.6;
        const radius=1120+Math.sqrt(i)*360;
        const x=r.mapX!=null?Number(r.mapX):
          Math.cos(angle)*radius;
        const y=r.mapY!=null?Number(r.mapY):
          Math.sin(angle)*radius;
        const n=makeNode(r,"production",x,y);
        n.standalone=true;
        addNode(n);addTree(r,n);
      });

    const parents=new Set(nodes.filter(n=>n.parentId)
      .map(n=>n.parentId));
    for(const pid of parents)
      connectSiblings(nodes.filter(n=>n.parentId===pid));

    $("#starLayer").replaceChildren();

    for(const n of nodes) {
      const button=document.createElement("button");
      button.type="button";
      button.className=`celestial-star ${n.type}-star`+
        (n.demo?" demo-star":"");
      button.setAttribute("aria-label","Explore "+n.title);

      const hit=document.createElement("span");
      hit.className="star-touch-area";
      const label=document.createElement("span");
      label.className="star-label";
      label.textContent=n.title;
      label.style.setProperty(
        "--label-distance",
        `${n.type==="group"?22:
          22+Math.round(n.appearance.size*5)}px`
      );

      button.append(hit,label);
      button.onclick=e=>{
        e.stopPropagation();
        if(performance.now()<ignoreClickUntil) return;
        selectStar(n);
      };
      button.onpointerenter=()=>{
        starHover=n.id;
        selected=n.id;
      };
      button.onpointerleave=()=>{
        starHover=null;
        selected=focused?.id||null;
      };
      button.onfocus=()=>selected=n.id;

      n.button=button;
      $("#starLayer").append(button);
    }
  }

  function nodeVisibility(n) {
    if(n.type==="navigation"||n.type==="group"||
       n.standalone) return 1;

    const rule={
      production:D.semanticZoom.productions,
      season:D.semanticZoom.seasons,
      episode:D.semanticZoom.episodes
    }[n.type];
    if(!rule) return 1;

    let a=fade(rule.start,rule.full,camera.z);
    const parent=nodeMap.get(n.parentId);
    if(parent) {
      const dist=Math.hypot(camera.x-parent.x,
        camera.y-parent.y)*camera.z;
      const range=Math.max(W,H)*1.5;
      a*=1-fade(range*.75,range*1.6,dist);
    }
    return clamp(a,0,1);
  }

  function positionStars() {
    for(const n of nodes) {
      const p=w2s(n.x,n.y);
      n.sx=p.x;n.sy=p.y;n.alpha=nodeVisibility(n);
      const seen=p.x>-130&&p.x<W+130&&
        p.y>-130&&p.y<H+130&&n.alpha>.025;

      n.button.classList.toggle("is-hidden",!seen);
      if(!seen) {
        n.button.tabIndex=-1;
        continue;
      }
      n.button.style.left=p.x+"px";
      n.button.style.top=p.y+"px";
      n.button.style.setProperty(
        "--visibility",n.alpha.toFixed(3)
      );
      n.button.disabled=n.alpha<.67;
      n.button.tabIndex=n.alpha>=.67?0:-1;
      n.button.classList.toggle("selected",selected===n.id);
    }
  }

  function drawStar(n,time) {
    if(n.alpha<.02||n.sx<-90||n.sx>W+90||
       n.sy<-90||n.sy>H+90) return;

    const appearance={
      navigation:D.appearance.navigationStars,
      group:D.appearance.groupStars,
      production:D.appearance.productionStars,
      season:D.appearance.seasonStars,
      episode:D.appearance.episodeStars
    }[n.type];

    const v=n.appearance;
    const [r,g,b]=v.color;
    const active=selected===n.id;
    const pulse=motionOff()?1:
      1+Math.sin(time*v.speed+v.phase)*.045;
    const radius=appearance.radius*v.size*pulse;
    const glow=appearance.glow*v.halo*
      state.settings.constellationGlow/65*
      (active?1.45:1);
    const opacity=n.alpha*v.alpha;
    const x=n.sx,y=n.sy;

    const halo=ctx.createRadialGradient(x,y,0,x,y,glow);
    halo.addColorStop(0,
      `rgba(${r},${g},${b},${opacity*.25})`);
    halo.addColorStop(.2,
      `rgba(${r},${g},${b},${opacity*.12})`);
    halo.addColorStop(1,"transparent");
    ctx.fillStyle=halo;
    ctx.beginPath();
    ctx.arc(x,y,glow,0,Math.PI*2);
    ctx.fill();

    const core=ctx.createRadialGradient(
      x,y,0,x,y,radius*2.7
    );
    core.addColorStop(0,`rgba(255,255,255,${opacity})`);
    core.addColorStop(.18,
      `rgba(${r},${g},${b},${opacity})`);
    core.addColorStop(.55,
      `rgba(${r},${g},${b},${opacity*.31})`);
    core.addColorStop(1,"transparent");
    ctx.fillStyle=core;
    ctx.beginPath();
    ctx.ellipse(x,y,radius*2.7,
      radius*2.7*v.oval,v.angle,0,Math.PI*2);
    ctx.fill();

    if(v.spikes&&(radius>2.2||active)) {
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(v.angle);
      ctx.globalAlpha=opacity*.48;
      const len=radius*(active?7:4.4)*v.ray;
      for(let axis=0;axis<2;axis++) {
        const dist=axis?len*.68:len;
        const grad=ctx.createLinearGradient(
          -dist,0,dist,0
        );
        grad.addColorStop(0,"transparent");
        grad.addColorStop(.5,`rgba(${r},${g},${b},.8)`);
        grad.addColorStop(1,"transparent");
        ctx.strokeStyle=grad;ctx.lineWidth=.6;
        ctx.beginPath();ctx.moveTo(-dist,0);
        ctx.lineTo(dist,0);ctx.stroke();
        ctx.rotate(Math.PI/2);
      }
      ctx.restore();
    }
  }

  function drawMap(time) {
    ctx.clearRect(0,0,W,H);
    for(const [aId,bId] of edges) {
      const a=nodeMap.get(aId),b=nodeMap.get(bId);
      if(!a||!b) continue;
      const alpha=Math.min(a.alpha,b.alpha);
      if(alpha<.02) continue;
      if(Math.max(a.sx,b.sx)<-70||
         Math.min(a.sx,b.sx)>W+70||
         Math.max(a.sy,b.sy)<-70||
         Math.min(a.sy,b.sy)>H+70) continue;

      const bright=selected===aId||selected===bId;
      ctx.beginPath();ctx.moveTo(a.sx,a.sy);
      ctx.lineTo(b.sx,b.sy);
      ctx.strokeStyle=bright
        ?`rgba(209,207,255,${alpha*.58})`
        :`rgba(159,173,224,${alpha*.23})`;
      ctx.lineWidth=bright?1:.65;
      ctx.stroke();
    }
    for(const n of nodes) drawStar(n,time);
  }

  /* =====================================================
     SPACE BACKGROUND
  ===================================================== */

  function resizeCanvas(canvas,context,dpr) {
    canvas.width=Math.round(W*dpr);
    canvas.height=Math.round(H*dpr);
    context.setTransform(dpr,0,0,dpr,0,0);
  }

  function generateStarfield() {
    starField=[];
    const count=clamp(Math.round(
      D.graphics.backgroundStarCount*W*H/850000*
      state.settings.starDensity/75
    ),100,D.graphics.maximumBackgroundStars);

    for(let i=0;i<count;i++) {
      const seed=i*173+48192;
      const rarity=rnd(seed+1);
      starField.push({
        x:rnd(seed+2)*W,y:rnd(seed+3)*H,
        r:rarity<.84?.18+rnd(seed+4)*.49:
          rarity<.98?.68+rnd(seed+5)*.53:
          1.25+rnd(seed+6)*1.1,
        a:.13+rnd(seed+7)*.74,
        depth:.018+rnd(seed+8)*.18,
        speed:.00014+rnd(seed+9)*.00048,
        phase:rnd(seed+10)*Math.PI*2,
        color:rnd(seed+11)<.13?[245,221,209]:
          rnd(seed+12)<.6?[216,225,255]:[180,202,250]
      });
    }
  }

  function drawBackground(time) {
    bg.clearRect(0,0,W,H);
    const brightness=state.settings.starBrightness/100;
    for(const s of starField) {
      const x=((s.x-camera.x*s.depth)%W+W)%W;
      const y=((s.y-camera.y*s.depth)%H+H)%H;
      const pulse=motionOff()?1:
        .88+Math.sin(time*s.speed+s.phase)*.12;
      const a=clamp(s.a*pulse*(.42+brightness),0,1);
      const [r,g,b]=s.color;
      bg.fillStyle=`rgba(${r},${g},${b},${a})`;
      bg.beginPath();bg.arc(x,y,s.r,0,Math.PI*2);
      bg.fill();
    }
  }

  function buildNebula() {
    const texture=document.createElement("canvas");
    const ratio=D.graphics.nebulaResolution;
    texture.width=Math.max(320,Math.round(W*ratio));
    texture.height=Math.max(260,Math.round(H*ratio));
    const c=texture.getContext("2d");
    const w=texture.width,h=texture.height;

    for(const [px,py,rad,r,g,b,a] of [
      [.12,.25,.57,24,68,150,.24],
      [.33,.48,.50,42,88,173,.23],
      [.51,.40,.43,52,104,192,.20],
      [.78,.61,.58,42,39,111,.17],
      [.83,.20,.47,26,61,133,.17],
      [.15,.79,.43,20,44,102,.14]
    ]) {
      const x=px*w,y=py*h,radius=rad*Math.max(w,h);
      const gradient=c.createRadialGradient(x,y,0,x,y,radius);
      gradient.addColorStop(0,`rgba(${r},${g},${b},${a})`);
      gradient.addColorStop(.38,
        `rgba(${r},${g},${b},${a*.52})`);
      gradient.addColorStop(1,"transparent");
      c.fillStyle=gradient;c.fillRect(0,0,w,h);
    }

    for(let i=0;i<300;i++) {
      const s=i*37+181,progress=rnd(s);
      const x=(progress*1.3-.14)*w;
      const y=(.65-.37*progress+
        (rnd(s+1)-.5)*.38)*h;
      const radius=8+rnd(s+2)*55;
      const a=.012+rnd(s+3)*.044;
      const grad=c.createRadialGradient(x,y,0,x,y,radius);
      grad.addColorStop(0,`rgba(85,122,207,${a})`);
      grad.addColorStop(1,"transparent");
      c.fillStyle=grad;c.beginPath();
      c.arc(x,y,radius,0,Math.PI*2);c.fill();
    }
    nebulaTexture=texture;
  }

  function drawNebula() {
    if(!nebulaTexture) return;
    neb.clearRect(0,0,W,H);
    neb.globalAlpha=state.settings.nebulaIntensity/100;
    const x=clamp(camera.x*.007,-80,80);
    const y=clamp(camera.y*.007,-80,80);
    neb.drawImage(nebulaTexture,-80-x,-80-y,W+160,H+160);
    neb.globalAlpha=1;
  }

  function resizeGraphics() {
    W=innerWidth;H=innerHeight;
    const dpr=Math.min(devicePixelRatio||1,
      D.graphics.maxPixelRatio);
    resizeCanvas(mapCanvas,ctx,dpr);
    resizeCanvas(bgCanvas,bg,dpr);
    resizeCanvas(nebCanvas,neb,1);
    generateStarfield();
    buildNebula();
  }

  function drawFrame(time) {
    if(!running) return;
    if(time-lastFrame>=16) {
      stepCamera(time);
      positionStars();
      drawNebula();
      drawBackground(time);
      drawMap(time);
      lastFrame=time;
    }
    raf=requestAnimationFrame(drawFrame);
  }

  function startLoop() {
    if(running) return;
    running=true;
    raf=requestAnimationFrame(drawFrame);
  }

  function stopLoop() {
    running=false;
    cancelAnimationFrame(raf);
  }

  /* =====================================================
     PAN / PINCH / WHEEL
  ===================================================== */

  function point(e) {return {x:e.clientX,y:e.clientY};}
  function distance(a,b) {
    return Math.hypot(a.x-b.x,a.y-b.y);
  }
  function center(a,b) {
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  }

  function startPinch() {
    if(pointers.size<2) return;
    const [a,b]=[...pointers.values()];
    const c=center(a,b);
    gesture={
      kind:"pinch",
      distance:Math.max(1,distance(a,b)),
      zoom:camera.z,anchor:s2w(c.x,c.y),
      moved:true
    };
    ignoreClickUntil=performance.now()+450;
  }

  function bindGestures() {
    viewport.addEventListener("pointerdown",e=>{
      if(e.pointerType==="mouse"&&e.button!==0) return;
      travel=null;
      pointers.set(e.pointerId,point(e));
      if(pointers.size===1)
        gesture={kind:"drag",distance:0,moved:false};
      else startPinch();
    });

    viewport.addEventListener("pointermove",e=>{
      if(!pointers.has(e.pointerId)) return;
      const old=pointers.get(e.pointerId);
      const now=point(e);
      pointers.set(e.pointerId,now);

      if(pointers.size>=2) {
        if(gesture?.kind!=="pinch") startPinch();
        const [a,b]=[...pointers.values()];
        const c=center(a,b);
        const z=clamp(gesture.zoom*
          Math.max(1,distance(a,b))/gesture.distance,
          D.camera.minZoom,D.camera.maxZoom);
        setCamera(
          gesture.anchor.x-(c.x-W/2)/z,
          gesture.anchor.y-(c.y-H/2)/z,z
        );
        gesture.moved=true;
        ignoreClickUntil=performance.now()+400;
        return;
      }

      if(!gesture||gesture.kind!=="drag")
        gesture={kind:"drag",distance:0,moved:false};

      const dx=now.x-old.x,dy=now.y-old.y;
      gesture.distance+=Math.hypot(dx,dy);
      if(gesture.distance>D.camera.tapThreshold) {
        gesture.moved=true;
        ignoreClickUntil=performance.now()+350;
        viewport.classList.add("dragging");
        if(!viewport.hasPointerCapture(e.pointerId))
          viewport.setPointerCapture(e.pointerId);
      }

      setCamera(camera.x-dx/camera.z,
        camera.y-dy/camera.z,camera.z);
    });

    const end=e=>{
      if(!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if(viewport.hasPointerCapture(e.pointerId))
        viewport.releasePointerCapture(e.pointerId);
      if(gesture?.moved)
        ignoreClickUntil=performance.now()+350;
      if(!pointers.size) {
        gesture=null;
        viewport.classList.remove("dragging");
      } else if(pointers.size===1) {
        gesture={kind:"drag",distance:0,moved:true};
      }
    };
    viewport.addEventListener("pointerup",end);
    viewport.addEventListener("pointercancel",end);

    viewport.addEventListener("click",e=>{
      if(performance.now()<ignoreClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },true);

    viewport.addEventListener("wheel",e=>{
      e.preventDefault();
      zoomAt(e.clientX,e.clientY,
        Math.exp(-e.deltaY*D.camera.wheelSensitivity));
    },{passive:false});

    viewport.addEventListener("keydown",e=>{
      if(e.target!==viewport) return;
      const shift=85/camera.z;
      if(e.key==="ArrowLeft") camera.x-=shift;
      else if(e.key==="ArrowRight") camera.x+=shift;
      else if(e.key==="ArrowUp") camera.y-=shift;
      else if(e.key==="ArrowDown") camera.y+=shift;
      else if(e.key==="+") zoomAt(W/2,H/2,1.25);
      else if(e.key==="-") zoomAt(W/2,H/2,.8);
      else return;
      e.preventDefault();
    });
  }

  /* =====================================================
     OVERLAY UTILITIES
  ===================================================== */

  function showOverlay(el) {
    if(activeOverlay&&activeOverlay!==el) {
      activeOverlay.classList.remove("open");
      activeOverlay.setAttribute("aria-hidden","true");
    }
    if(!activeOverlay) restoreFocus=document.activeElement;
    activeOverlay=el;
    el.classList.add("open");
    el.setAttribute("aria-hidden","false");
    viewport.inert=true;
  }

  function closeOverlay() {
    if(!activeOverlay) return;
    activeOverlay.classList.remove("open");
    activeOverlay.setAttribute("aria-hidden","true");
    activeOverlay=null;
    if(!pageOverlay.classList.contains("open"))
      viewport.inert=false;
    if(restoreFocus?.isConnected&&!currentPage)
      restoreFocus.focus();
  }

  function detail(html) {
    $("#detailContent").innerHTML=html;
    $("#detailSheet").scrollTop=0;
    showOverlay($("#detailOverlay"));
    $("#closeDetailButton").focus();
  }

  function editor(html,heading="Create & Edit") {
    $("#editorTitle").textContent=heading;
    $("#editorEyebrow").textContent="ARCHIVE EDITOR";
    $("#editorContent").innerHTML=html;
    $("#editorSheet").scrollTop=0;
    showOverlay($("#editorOverlay"));
    $("#closeEditorButton").focus();
  }

  function askDelete(message,work) {
    confirmWork=work;
    confirmReturn=document.activeElement;
    confirmation.classList.add("open");
    confirmation.setAttribute("aria-hidden","false");
    $("#confirmMessage").textContent=message;
    $("#acceptConfirmButton").textContent="Delete";
    $("#cancelConfirmButton").focus();
  }

  function closeConfirm() {
    confirmation.classList.remove("open");
    confirmation.setAttribute("aria-hidden","true");
    confirmWork=null;
    confirmReturn?.focus?.();
  }

  /* =====================================================
     GROUP & SERIES PAGES
  ===================================================== */

  function entryForPage(type,rid) {
    return record(type,rid)||
      nodes.find(n=>n.id===rid&&n.type===type)?.record||
      null;
  }

  async function openPage(type,rid,push=true) {
    if(!["group","production"].includes(type)) return;
    const item=entryForPage(type,rid);
    if(!item) return;

    if(push&&currentPage)
      pageStack.push({...currentPage});

    currentPage={type,id:rid,demo:!!item.demo||
      rid.startsWith("demo-")};
    const token=++pageToken;

    pageOverlay.classList.add("open");
    pageOverlay.setAttribute("aria-hidden","false");
    $("#viewport").inert=true;
    $("#archivePage").scrollTop=0;

    $("#pageType").textContent=type==="group"
      ?"COLLECTION":(item.mediaType||"PRODUCTION").toUpperCase();
    $("#pageTitle").textContent=title(item);

    const banner=$("#pageBanner");
    banner.style.backgroundImage="";
    banner.classList.add("is-empty");

    const url=await bannerURL(item);
    if(token!==pageToken) return;

    if(url) {
      banner.style.backgroundImage=`url(${JSON.stringify(url)})`;
      banner.classList.remove("is-empty");
    }
    banner.style.backgroundPosition=
      `${numeric(item.bannerPositionX,50,0,100)}% `+
      `${numeric(item.bannerPositionY,35,0,100)}%`;

    const paperclip=$("#statusPaperclip");
    paperclip.hidden=type==="group";
    if(type==="production") {
      const visual=D.statusVisuals[item.status]||
        D.statusVisuals.Planned;
      paperclip.dataset.status=visual.key;
      paperclip.setAttribute("aria-label",
        `Status: ${item.status||"Planned"}`);
    }

    renderPageRating(item);
    renderPageMetadata(type,item);
    renderPageGenres(item);

    const notes=$("#pageNotes");
    notes.textContent=item.notes||"";
    notes.classList.toggle("is-empty",!item.notes);
    if(!item.notes)
      notes.textContent=currentPage.demo?"":"";

    $("#pageEditButton").hidden=currentPage.demo;
    $("#pageBackButton").hidden=pageStack.length===0;

    renderPageChildren(type,item);

    $("#archivePage").focus();
  }

  function closePage() {
    ++pageToken;
    currentPage=null;
    pageStack=[];
    pageOverlay.classList.remove("open");
    pageOverlay.setAttribute("aria-hidden","true");
    if(!activeOverlay) viewport.inert=false;
  }

  function pageBack() {
    if(!pageStack.length) {
      closePage();
      return;
    }
    const previous=pageStack.pop();
    openPage(previous.type,previous.id,false);
  }

  function ratingValue(item) {
    const raw=item.averageRating??item.calculatedRating??
      item.rating;
    if(raw===null||raw===undefined||raw==="")
      return null;
    const n=Number(raw);
    return Number.isFinite(n)?clamp(n,0,10):null;
  }

  function starSVG(amount) {
    const fill=clamp(amount,0,1)*100;
    const identifier="fill-"+id().replace(/[^a-z0-9]/gi,"");
    return `<span class="rating-star">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="${identifier}">
            <stop offset="${fill}%" stop-color="#d8d1ff"/>
            <stop offset="${fill}%" stop-color="transparent"/>
          </linearGradient>
        </defs>
        <path d="M12 2.5L14.9 8.5 21.5 9.4
          16.75 14.1 17.9 20.8 12 17.65
          6.1 20.8 7.25 14.1 2.5 9.4
          9.1 8.5Z"
          fill="url(#${identifier})"
          stroke="#817baf" stroke-width=".8"/>
      </svg>
    </span>`;
  }

  function renderPageRating(item) {
    const target=$("#pageRating");
    const value=ratingValue(item);

    if(value===null) {
      target.innerHTML=`<span class="rating-unrated">
        Not rated yet
      </span>`;
      return;
    }

    target.innerHTML=`
      <span class="rating-stars">
        ${Array.from({length:10},(_,i)=>
          starSVG(value-i)).join("")}
      </span>
      <span class="rating-value">
        ${value.toFixed(2)} / 10
      </span>
    `;
  }

  function dateLabel(input) {
    if(!input) return "";
    const date=new Date(input+"T12:00:00");
    return Number.isNaN(date.getTime())?String(input):
      date.toLocaleDateString(undefined,{
        year:"numeric",month:"short",day:"numeric"
      });
  }

  function renderPageMetadata(type,item) {
    const meta=$("#pageQuickMeta");
    if(type==="group") {
      meta.replaceChildren();
      return;
    }
    const fragments=[];
    if(item.mediaType)
      fragments.push(`
        <span><span class="quick-meta-label">FORMAT</span>
        ${esc(item.mediaType)}</span>`);
    if(item.releaseStart||item.releaseEnd)
      fragments.push(`
        <span><span class="quick-meta-label">AIRING</span>
        ${esc(dateLabel(item.releaseStart)||"—")}
        ${item.releaseEnd?" — "+esc(dateLabel(item.releaseEnd)):""}
        </span>`);
    if(item.status)
      fragments.push(`
        <span><span class="quick-meta-label">STATUS</span>
        ${esc(item.status)}</span>`);
    meta.innerHTML=fragments.join("");
  }

  function renderPageGenres(item) {
    $("#pageMainGenres").textContent=
      genreNames(item.mainGenreIds,"main").join(" · ");
    $("#pageSecondaryGenres").textContent=
      genreNames(item.secondaryGenreIds,"secondary").join(" · ");
  }

  async function renderPageChildren(type,item) {
    const token=pageToken;
    const demo=currentPage?.demo;
    const childType=NEXT[type];

    const list=demo
      ?(item.children||[])
      :children(type,item.id);

    const holder=$("#pageChildren");
    const group=type==="group";

    holder.className="page-children "+
      (group?"is-group":"is-production");

    $("#pageChildrenCount").textContent=
      `${list.length} ${group?
        (list.length===1?"PRODUCTION":"PRODUCTIONS"):
        (list.length===1?"SEASON":"SEASONS")}`;

    $("#pageAddChildButton").hidden=demo||
      (type==="production"&&
       ["Movie","Short Film","Special"].includes(item.mediaType));

    if(!list.length) {
      holder.innerHTML=`<p class="page-children-empty">
        ${group?"No productions added yet.":"No seasons added yet."}
      </p>`;
      return;
    }

    if(group) {
      holder.innerHTML=list.map(child=>`
        <button type="button" class="child-production"
          data-page-child="${esc(child.id)}">
          <span class="child-production-image"
            data-banner-for="${esc(child.id)}"></span>
          <span class="child-production-shade"></span>
          <span class="child-production-title">
            ${esc(title(child))}
          </span>
          <span class="child-production-meta">
            ${esc(child.mediaType||"Production")}
          </span>
        </button>
      `).join("");

      for(const child of list) {
        const url=await bannerURL(child);
        if(token!==pageToken) return;
        const el=[...holder.querySelectorAll("[data-banner-for]")]
          .find(x=>x.dataset.bannerFor===child.id);
        if(el&&url) el.style.backgroundImage=
          `url(${JSON.stringify(url)})`;
      }
    } else {
      holder.innerHTML=list.map(child=>`
        <button type="button" class="child-season"
          data-page-child="${esc(child.id)}">
          <span class="child-season-title">
            ${esc(title(child))}
          </span>
          <span class="child-season-right">
            <span class="child-season-rating">
              ${ratingValue(child)===null?"":ratingValue(child).toFixed(1)+" / 10"}
            </span>
            <span>↗</span>
          </span>
        </button>
      `).join("");
    }

    holder.querySelectorAll("[data-page-child]").forEach(button=>{
      button.onclick=()=>{
        const rid=button.dataset.pageChild;
        if(childType==="production") {
          openPage("production",rid);
        } else {
          const child=list.find(x=>x.id===rid);
          detail(`<span class="detail-eyebrow">SEASON</span>
            <h2 id="detailTitle">${esc(title(child))}</h2>
            <p>Season details and episode browsing arrive
            in Step 5.</p>
            ${!demo?`<button class="detail-action"
              id="editSeasonFromPage">Edit Season</button>`:""}`);
          if(!demo)
            $("#editSeasonFromPage").onclick=()=>{
              closeOverlay();
              openForm("season",rid);
            };
        }
      };
    });
  }

  /* =====================================================
     STAR SELECTION
  ===================================================== */

  function selectStar(n) {
    if(n.type==="navigation") {
      switch(n.action) {
        case "create":openManager();return;
        case "genres":openGenres();return;
        case "library":openLibrary("library");return;
        case "watchlist":openLibrary("watchlist");return;
        case "settings":openSettings();return;
      }
    }

    const near=Math.hypot(camera.x-n.x,camera.y-n.y)<75;
    const required=n.type==="group"?1.65:3.4;

    if((n.type==="group"||n.type==="production")&&
       near&&camera.z>=required) {
      openPage(n.type,n.id);
      return;
    }

    if(n.type==="episode") {
      focusNode(n);
      detail(`<span class="detail-eyebrow">EPISODE</span>
        <h2 id="detailTitle">${esc(n.title)}</h2>
        <p>${esc(n.record.notes||"")}</p>`);
      return;
    }

    focusNode(n);
  }

  /* =====================================================
     CREATE & EDIT OVERVIEW
  ===================================================== */

  function managerRows(type) {
    const items=[...records(type)].sort((a,b)=>
      (a.order??0)-(b.order??0));

    return `<section class="manager-section">
      <div class="manager-section-title">
        <h3>${type[0].toUpperCase()+type.slice(1)}s</h3>
        <span class="manager-count">${items.length}</span>
      </div>
      <div class="manager-list">
        ${items.length?items.map(item=>`
          <div class="manager-item">
            <div class="manager-item-main">
              <span class="manager-item-title">${esc(title(item))}</span>
              <span class="manager-item-subtitle">
                ${esc(parentId(type,item)||"")}
              </span>
            </div>
            <div class="manager-item-actions">
              <button type="button" class="mini-button"
                data-edit="${type}" data-id="${esc(item.id)}">✎</button>
              <button type="button" class="mini-button"
                data-up="${type}" data-id="${esc(item.id)}">↑</button>
              <button type="button" class="mini-button"
                data-down="${type}" data-id="${esc(item.id)}">↓</button>
              <button type="button" class="mini-button"
                data-delete="${type}" data-id="${esc(item.id)}">×</button>
            </div>
          </div>
        `).join(""):`<p class="manager-empty">No entries yet.</p>`}
      </div>
    </section>`;
  }

  function openManager() {
    editorReturn=null;
    revokePending();
    editor(`
      <p>Create and rearrange your personal archive.</p>
      <div class="manager-actions">
        ${TYPES.map(t=>`
          <button type="button" class="soft-button"
            data-new="${t}">+ ${t}</button>
        `).join("")}
      </div>
      ${TYPES.map(managerRows).join("")}
    `);

    $$("#editorContent [data-new]").forEach(b=>
      b.onclick=()=>openForm(b.dataset.new));

    $$("#editorContent [data-edit]").forEach(b=>
      b.onclick=()=>openForm(b.dataset.edit,b.dataset.id));

    for(const action of ["up","down"])
      $$(`#editorContent [data-${action}]`).forEach(b=>
        b.onclick=()=>{
          reorder(b.dataset[action],b.dataset.id,
            action==="up"?-1:1);
          openManager();
        });

    $$("#editorContent [data-delete]").forEach(b=>
      b.onclick=()=>{
        const type=b.dataset.delete,rid=b.dataset.id;
        askDelete(
          `Delete "${title(record(type,rid))}" and all its children?`,
          async()=>{await deleteEntry(type,rid);openManager();}
        );
      });
  }

  function formField(key,label,value="",type="text") {
    return `<div class="form-field">
      <label for="f-${key}">${esc(label)}</label>
      <input id="f-${key}" class="form-input"
        type="${type}" value="${esc(value)}">
    </div>`;
  }

  function selectField(key,label,options,value) {
    return `<div class="form-field">
      <label for="f-${key}">${esc(label)}</label>
      <select id="f-${key}" class="form-select">
        ${options.map(o=>`
          <option value="${esc(o.id)}"
            ${String(o.id)===String(value||"")?"selected":""}>
            ${esc(o.title)}
          </option>`).join("")}
      </select>
    </div>`;
  }

  function genreFields(type,selected=[]) {
    const list=allGenre(type);
    return `<div class="form-field">
      <label>${type==="main"?"Main Genres":"Secondary Genres & Tags"}</label>
      ${list.length?list.map(g=>`
        <label class="field-checkbox">
          <input type="checkbox" data-genre="${type}"
            value="${esc(g.id)}"
            ${selected.includes(g.id)?"checked":""}>
          ${esc(g.name)}
        </label>
      `).join(""):`<small>No genres created yet.</small>`}
    </div>`;
  }

  function bannerForm() {
    return `<div class="form-field banner-upload">
      <label>Banner image</label>
      <div id="bannerPreview" class="banner-upload-preview">
        <span class="banner-preview-empty">✧</span>
      </div>
      <div class="banner-upload-actions">
        <button type="button" id="chooseBanner"
          class="soft-button">Choose from gallery</button>
        <button type="button" id="removeBanner"
          class="soft-button">Remove image</button>
      </div>
      <span class="banner-upload-note">
        Photos are compressed and stored on this device.
      </span>
      <div class="form-grid">
        ${formField("bannerPositionX","Horizontal focus (%)",50,"number")}
        ${formField("bannerPositionY","Vertical focus (%)",35,"number")}
      </div>
    </div>`;
  }

  async function previewBanner(item,token) {
    const url=await bannerURL(item);
    if(token!==bannerPickToken) return;
    const box=$("#bannerPreview");
    if(!box) return;
    box.innerHTML=url?
      `<img class="banner-preview-image" alt="Banner preview">`:
      `<span class="banner-preview-empty">✧</span>`;
    if(url) box.querySelector("img").src=url;
  }

  function openForm(type,rid=null,pid=null) {
    revokePending();
    const item=rid?record(type,rid):null;
    if(rid&&!item) return toast("Entry not found.");

    const r=item||{};
    const isMedia=type==="group"||type==="production";
    const returnPage=editorReturn;

    const opts=(t)=>records(t).map(x=>({
      id:x.id,title:title(x)
    }));

    let html=`<form id="archiveForm" class="archive-form">
      ${formField("title","Title",r.title||"")}`;

    if(type==="production") {
      html+=selectField("groupId","Parent Group",[
        {id:"",title:"None — standalone"},
        ...opts("group")
      ],r.groupId||pid||"");
      html+=selectField("mediaType","Media Format",
        D.mediaTypes.map(x=>({id:x,title:x})),
        r.mediaType||"TV Series");
      html+=selectField("status","Watching Status",
        D.statuses.map(x=>({id:x,title:x})),
        r.status||"Planned");
      html+=`<label class="field-checkbox">
        <input id="f-watchlist" type="checkbox"
          ${r.watchlist?"checked":""}> Watchlist
      </label>`;
    }

    if(type==="season") {
      html+=selectField("productionId","Production",
        opts("production"),r.productionId||pid||"");
      html+=selectField("status","Watching Status",
        D.statuses.map(x=>({id:x,title:x})),
        r.status||"Planned");
    }

    if(type==="episode") {
      html+=selectField("seasonId","Season",
        opts("season"),r.seasonId||pid||"");
      html+=formField("duration","Duration (minutes)",
        r.duration??"","number");
    }

    if(isMedia) {
      html+=genreFields("main",r.mainGenreIds||[]);
      html+=genreFields("secondary",r.secondaryGenreIds||[]);
      html+=bannerForm();
    }

    if(type==="production"||type==="season") {
      html+=`<div class="form-grid">
        ${formField("releaseStart","Airing / Release Start",
          r.releaseStart||"","date")}
        ${formField("releaseEnd","Airing / Release End",
          r.releaseEnd||"","date")}
      </div>`;
    }

    if(type==="production"||type==="episode") {
      html+=formField("lastWatched","Last Watched",
        r.lastWatched||r.watchedAt||"","date");
    }

    html+=`<div class="form-field">
      <label for="f-notes">Personal Observations</label>
      <textarea id="f-notes" class="form-textarea"></textarea>
    </div>
    <div class="form-actions">
      <button type="button" id="cancelForm"
        class="soft-button">Cancel</button>
      <button type="submit" id="saveForm"
        class="soft-button primary-button">
        ${item?"Save Changes":"Create Entry"}
      </button>
    </div></form>`;

    editor(html,item?"Edit "+type:"Create "+type);
    $("#f-notes").value=r.notes||"";
    $("#cancelForm").onclick=()=>{
      revokePending();
      closeOverlay();
      if(returnPage) {
        editorReturn=null;
        openPage(returnPage.type,returnPage.id,false);
      } else openManager();
    };

    const token=++bannerPickToken;
    if(isMedia) {
      previewBanner(r,token);
      $("#chooseBanner").onclick=()=>
        $("#bannerFileInput").click();
      $("#removeBanner").onclick=()=>{
        revokePending();
        pendingBanner={remove:true};
        $("#bannerPreview").innerHTML=
          `<span class="banner-preview-empty">✧</span>`;
      };
    }

    $("#archiveForm").onsubmit=async e=>{
      e.preventDefault();
      const button=$("#saveForm");
      button.disabled=true;
      const value=k=>$("#f-"+k)?.value??"";
      const values={
        title:value("title").trim(),
        notes:$("#f-notes").value
      };

      if(type==="production") {
        values.groupId=value("groupId")||null;
        values.mediaType=value("mediaType");
        values.status=value("status");
        values.watchlist=$("#f-watchlist").checked;
      }
      if(type==="season") {
        values.productionId=value("productionId");
        values.status=value("status");
      }
      if(type==="episode") {
        values.seasonId=value("seasonId");
        values.duration=Math.max(0,Number(value("duration"))||0);
        values.watchedAt=value("lastWatched");
      }
      if(isMedia) {
        values.mainGenreIds=
          $$('#archiveForm [data-genre="main"]:checked')
            .map(x=>x.value);
        values.secondaryGenreIds=
          $$('#archiveForm [data-genre="secondary"]:checked')
            .map(x=>x.value);
        values.bannerPositionX=numeric(
          value("bannerPositionX"),50,0,100);
        values.bannerPositionY=numeric(
          value("bannerPositionY"),35,0,100);
      }
      if(type==="production"||type==="season") {
        values.releaseStart=value("releaseStart");
        values.releaseEnd=value("releaseEnd");
      }
      if(type==="production")
        values.lastWatched=value("lastWatched");

      if(!values.title) {
        toast("Enter a title.");
        button.disabled=false;
        return;
      }

      let newImageId=null;
      try {
        if(isMedia&&pendingBanner) {
          if(pendingBanner.remove) {
            values.bannerImageId=null;
            values.banner="";
          } else if(pendingBanner.blob) {
            newImageId="banner-"+id();
            await imagePut(newImageId,pendingBanner.blob);
            values.bannerImageId=newImageId;
            values.banner="";
          }
        }

        const result=item?
          update(type,item.id,values):
          create(type,values);

        if(!result) {
          if(newImageId) await imageDelete(newImageId);
          button.disabled=false;
          return;
        }

        const savedId=item?.id||result.id;
        revokePending();

        if(returnPage) {
          editorReturn=null;
          closeOverlay();
          await openPage(
            returnPage.type,
            returnPage.id,false
          );
        } else {
          openManager();
        }

        // Clean up replaced images, but never before
        // the updated archive has been saved.
        try {await cleanupUnreferencedImages();}
        catch(e) {console.warn(e);}

        if(returnPage&&returnPage.type===type&&
           returnPage.id===savedId)
          await openPage(type,savedId,false);

      } catch(error) {
        console.error(error);
        toast("Could not save image or changes.");
        button.disabled=false;
      }
    };
  }

  /* =====================================================
     GENRE MANAGER
  ===================================================== */

  function openGenres() {
    detail(`
      <span class="detail-eyebrow">PERSONAL CATEGORIES</span>
      <h2 id="detailTitle">Genre Creation</h2>
      <p>Create all genres and secondary tags manually.</p>
      ${["main","secondary"].map(t=>`
        <h3>${t==="main"?"Main Genres":"Secondary Tags"}</h3>
        <div class="genre-create-row">
          <input class="form-input" id="genre-${t}"
            placeholder="Enter a name...">
          <button type="button" class="soft-button"
            data-add-genre="${t}">Add</button>
        </div>
        <div class="genre-list">
          ${allGenre(t).map(g=>`
            <span class="genre-chip">
              ${esc(g.name)}
              <button type="button" data-rename-genre="${t}"
                data-gid="${esc(g.id)}">✎</button>
              <button type="button" data-remove-genre="${t}"
                data-gid="${esc(g.id)}">×</button>
            </span>`).join("")}
        </div>
      `).join("")}
    `);

    $$("[data-add-genre]").forEach(b=>
      b.onclick=()=>createGenre(b.dataset.addGenre,
        $("#genre-"+b.dataset.addGenre).value));
    $$("[data-rename-genre]").forEach(b=>
      b.onclick=()=>renameGenre(b.dataset.renameGenre,
        b.dataset.gid));
    $$("[data-remove-genre]").forEach(b=>
      b.onclick=()=>{
        const type=b.dataset.removeGenre,gid=b.dataset.gid;
        askDelete("Delete this genre and its assignments?",
          ()=>deleteGenre(type,gid));
      });
  }

  /* =====================================================
     LIBRARY / WATCHLIST
  ===================================================== */

  function openLibrary(mode) {
    collectionMode=mode;
    collectionFilters={query:"",sort:"alphabetical"};
    detail(`
      <span class="detail-eyebrow">YOUR ARCHIVE</span>
      <h2 id="detailTitle">
        ${mode==="library"?"Library":"Watchlist"}
      </h2>
      <div class="library-toolbar">
        <div class="library-control">
          <label for="librarySearch">Search</label>
          <input id="librarySearch" class="library-input">
        </div>
        <div class="library-control">
          <label for="librarySort">Sort</label>
          <select id="librarySort" class="library-select">
            ${D.sorting.map(s=>`
              <option value="${s.id}">${esc(s.title)}</option>
            `).join("")}
          </select>
        </div>
      </div>
      <div id="libraryCount" class="library-count"></div>
      <div id="libraryResults" class="library-results"></div>
    `);
    $("#librarySearch").oninput=e=>{
      collectionFilters.query=e.target.value;renderLibrary();
    };
    $("#librarySort").onchange=e=>{
      collectionFilters.sort=e.target.value;renderLibrary();
    };
    renderLibrary();
  }

  function renderLibrary() {
    let list=[...records("production")];
    if(collectionMode==="watchlist")
      list=list.filter(x=>x.watchlist||x.status==="Planned");
    const q=collectionFilters.query.trim().toLowerCase();
    if(q) list=list.filter(x=>title(x).toLowerCase().includes(q));

    const rating=x=>ratingValue(x);
    const date=x=>Date.parse(x||"")||0;
    list.sort((a,b)=>{
      const name=title(a).localeCompare(title(b));
      switch(collectionFilters.sort) {
        case "alphabeticalReverse":return -name;
        case "highestRated":
          return (rating(b)??-1)-(rating(a)??-1)||name;
        case "lowestRated":
          return (rating(a)??999)-(rating(b)??999)||name;
        case "lastWatched":
          return date(b.lastWatched)-date(a.lastWatched)||name;
        case "newestAdded":
          return date(b.createdAt)-date(a.createdAt)||name;
        case "oldestAdded":
          return date(a.createdAt)-date(b.createdAt)||name;
        case "earliestRelease":
          return date(a.releaseStart)-date(b.releaseStart)||name;
        case "latestRelease":
          return date(b.releaseStart)-date(a.releaseStart)||name;
        case "custom":
          return (a.order??0)-(b.order??0)||name;
        default:return name;
      }
    });

    $("#libraryCount").textContent=
      list.length+" production"+(list.length===1?"":"s");

    $("#libraryResults").innerHTML=list.length?
      list.map(x=>`
        <button type="button" class="library-entry"
          data-library-id="${esc(x.id)}">
          <span class="library-entry-main">
            <span class="library-entry-title">
              ${esc(title(x))}
            </span>
            <span class="library-entry-meta">
              ${esc(x.mediaType||"Production")}
            </span>
          </span>
          <span class="library-entry-rating">
            ${rating(x)===null?"—":
              rating(x).toFixed(1)+" / 10"}
          </span>
        </button>`).join(""):
      `<div class="library-empty">
        <h3>Nothing here yet.</h3>
        <p>Create a production from Create & Edit.</p>
      </div>`;

    $$("[data-library-id]").forEach(b=>b.onclick=()=>{
      const rid=b.dataset.libraryId;
      closeOverlay();
      openPage("production",rid);
    });
  }

  /* =====================================================
     SEARCH
  ===================================================== */

  function openSearch() {
    $("#globalSearch").value="";
    $("#searchResults").innerHTML="";
    showOverlay($("#searchOverlay"));
    $("#globalSearch").focus();
  }

  function renderSearch() {
    const q=$("#globalSearch").value.trim().toLowerCase();
    const results=[];
    if(q) for(const type of TYPES)
      for(const r of records(type))
        if(title(r).toLowerCase().includes(q))
          results.push({type,r});

    $("#searchResults").innerHTML=results.slice(0,60)
      .map(({type,r})=>`
        <button type="button" class="search-result"
          data-search-type="${type}"
          data-search-id="${esc(r.id)}">
          <span>${esc(title(r))}</span>
          <small>${type}</small>
        </button>
      `).join("");

    $$("[data-search-id]").forEach(b=>b.onclick=()=>{
      const type=b.dataset.searchType,rid=b.dataset.searchId;
      closeOverlay();
      if(type==="group"||type==="production")
        openPage(type,rid);
      else {
        const n=nodeMap.get(rid);
        if(n) focusNode(n);
      }
    });
  }

  /* =====================================================
     SETTINGS
  ===================================================== */

  function openSettings() {
    const options=[
      ["starDensity","Star density",10],
      ["starBrightness","Star brightness",10],
      ["nebulaIntensity","Nebula intensity",0],
      ["constellationGlow","Constellation glow",0]
    ];
    detail(`
      <span class="detail-eyebrow">YOUR UNIVERSE</span>
      <h2 id="detailTitle">Settings</h2>
      ${options.map(([key,label,min])=>`
        <div class="detail-row">
          <label for="setting-${key}">${label}</label>
          <div>
            <input type="range" class="setting-range"
              id="setting-${key}" min="${min}" max="100"
              step="5" value="${state.settings[key]}">
            <output class="setting-value"
              id="value-${key}">${state.settings[key]}</output>
          </div>
        </div>
      `).join("")}
      <div class="detail-row">
        <label for="setting-motion">Reduce Motion</label>
        <input type="checkbox" class="motion-checkbox"
          id="setting-motion"
          ${state.settings.reduceMotion?"checked":""}>
      </div>
      <h3>Backups</h3>
      <p>Backups include archive records and stored banner images.</p>
      <button class="detail-action" id="exportArchive">
        Export complete archive
      </button>
      <button class="detail-action" id="importArchive">
        Import archive
      </button>
    `);
    for(const [key] of options)
      $("#setting-"+key).oninput=e=>{
        state.settings[key]=Number(e.target.value);
        $("#value-"+key).textContent=e.target.value;
        if(key==="starDensity") generateStarfield();
        save();
      };
    $("#setting-motion").onchange=e=>{
      state.settings.reduceMotion=e.target.checked;
      applyMotion();save();
    };
    $("#exportArchive").onclick=exportBackup;
    $("#importArchive").onclick=()=>$("#importFile").click();
  }

  /* =====================================================
     PORTABLE JSON BACKUPS WITH IMAGES
  ===================================================== */

  async function exportBackup() {
    try {
      toast("Preparing archive and images...");
      const images={};
      const keys=new Set();

      for(const type of ["group","production"])
        for(const item of records(type))
          if(item.bannerImageId) keys.add(item.bannerImageId);

      for(const key of keys) {
        const blob=await imageGet(key);
        if(!blob) throw Error("Missing image: "+key);
        images[key]=await fileAsDataURL(blob);
      }

      const backup={
        app:D.appName,
        schemaVersion:D.schemaVersion,
        exportedAt:new Date().toISOString(),
        data:state,
        images
      };

      const blob=new Blob(
        [JSON.stringify(backup)],
        {type:"application/json"}
      );
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      a.download="watch-archive-"+
        new Date().toISOString().slice(0,10)+".json";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      toast("Complete backup prepared.");
    } catch(e) {
      console.error(e);
      toast("Export failed. Check image storage.");
    }
  }

  async function importBackup(file) {
    if(!file) return;
    try {
      const backup=JSON.parse(await file.text());
      if(backup.app!==D.appName||
         backup.schemaVersion!==D.schemaVersion||
         !backup.data?.archive||
         !TYPES.every(t=>
           Array.isArray(backup.data.archive[KEYS[t]])))
        throw Error("Invalid archive.");

      const imported=normalize(backup.data);
      const pictures=backup.images||{};

      if(!confirm(
        "Replace your archive with this backup? "+
        "Export your current archive first to keep a copy."
      )) return;

      // Store accompanying images before switching records.
      for(const [key,data] of Object.entries(pictures))
        await imagePut(key,dataURLAsBlob(data));

      const previous=state;
      state=imported;

      if(!save()) {
        state=previous;
        throw Error("Archive storage is full.");
      }

      closeOverlay();closePage();
      rebuildUniverse();generateStarfield();
      goHome();
      toast("Archive and images imported.");

    } catch(e) {
      console.error(e);
      toast("Import failed. Previous archive may still be intact.");
    } finally {
      $("#importFile").value="";
    }
  }

  /* =====================================================
     EVENT CONTROLS
  ===================================================== */

  function bindControls() {
    $("#homeButton").onclick=goHome;
    $("#focusButton").onclick=()=>{
      if(focused) focusNode(focused);
      else goHome();
    };
    $("#searchButton").onclick=openSearch;

    $("#pageCloseButton").onclick=closePage;
    $("#pageBackButton").onclick=pageBack;
    $("#pageEditButton").onclick=()=>{
      if(!currentPage||currentPage.demo) return;
      editorReturn={...currentPage};
      openForm(currentPage.type,currentPage.id);
    };
    $("#pageAddChildButton").onclick=()=>{
      if(!currentPage||currentPage.demo) return;
      const next=NEXT[currentPage.type];
      if(!next) return;
      editorReturn={...currentPage};
      openForm(next,null,currentPage.id);
    };
    $("#pageBackdrop").onclick=closePage;

    $("#closeDetailButton").onclick=closeOverlay;
    $("#detailBackdrop").onclick=closeOverlay;
    $("#closeEditorButton").onclick=()=>{
      revokePending();editorReturn=null;closeOverlay();
    };
    $("#editorBackdrop").onclick=()=>{
      revokePending();editorReturn=null;closeOverlay();
    };
    $("#closeSearchButton").onclick=closeOverlay;
    $("#searchBackdrop").onclick=closeOverlay;
    $("#globalSearch").oninput=renderSearch;

    $("#cancelConfirmButton").onclick=closeConfirm;
    $("#acceptConfirmButton").onclick=()=>{
      const work=confirmWork;
      closeConfirm();
      if(work) Promise.resolve(work()).catch(console.error);
    };

    $("#bannerFileInput").onchange=async e=>{
      const file=e.target.files?.[0];
      e.target.value="";
      if(!file) return;
      const token=++bannerPickToken;
      try {
        toast("Preparing banner...");
        const blob=await compressImage(file);
        if(token!==bannerPickToken) return;
        revokePending();
        pendingBanner={blob};
        pendingPreviewURL=URL.createObjectURL(blob);
        const box=$("#bannerPreview");
        if(box) {
          box.innerHTML=
            `<img class="banner-preview-image" alt="New banner">`;
          box.querySelector("img").src=pendingPreviewURL;
        }
        toast("Banner ready. Save the entry to keep it.");
      } catch(error) {
        console.error(error);
        toast(error.message||"Image could not be opened.");
      }
    };

    $("#importFile").onchange=e=>
      importBackup(e.target.files?.[0]);

    window.addEventListener("keydown",e=>{
      if(e.key!=="Escape") return;
      if(confirmation.classList.contains("open"))
        closeConfirm();
      else if(activeOverlay) closeOverlay();
      else if(pageOverlay.classList.contains("open"))
        pageBack();
    });

    let resizeTimer;
    window.addEventListener("resize",()=>{
      clearTimeout(resizeTimer);
      resizeTimer=setTimeout(()=>{
        const oldMobile=W<650,newMobile=innerWidth<650;
        resizeGraphics();
        if(oldMobile!==newMobile) rebuildUniverse();
      },170);
    });

    document.addEventListener("visibilitychange",()=>{
      if(document.hidden) stopLoop();
      else startLoop();
    });

    prefersReduced.addEventListener("change",applyMotion);

    window.addEventListener("storage",e=>{
      if(e.key!==D.storageKey) return;
      state=load();
      rebuildUniverse();
      generateStarfield();
      if(currentPage)
        openPage(currentPage.type,currentPage.id,false);
      toast("Archive refreshed.");
    });
  }

  /* =====================================================
     START
  ===================================================== */

  function start() {
    applyMotion();
    resizeGraphics();
    rebuildUniverse();
    bindGestures();
    bindControls();
    const home=homePosition();
    setCamera(home.x,home.y,home.z);
    startLoop();
    if(!localStorage.getItem(D.storageKey)) save();
  }

  start();

})();
