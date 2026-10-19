
"use strict";

/* WATCH ARCHIVE — STEP 4
   Complete replacement app.js
   No frameworks, server or external dependencies.
*/
(() => {
  const D = window.WATCH_DATA;
  if (!D) return console.error("data.js missing");

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const copy = o => JSON.parse(JSON.stringify(o));
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const mix = (a,b,t) => a+(b-a)*t;
  const ease = t => t*t*(3-2*t);
  const esc = s => String(s??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
  const id = () => crypto.randomUUID?.() ||
    `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const hash = s => {
    let h=2166136261;
    for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
    return h>>>0;
  };
  const rnd = s => {
    let t=s+0x6D2B79F5;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
  const title = e => e?.title||e?.name||"Untitled";
  const dateNumber = x => x ? (Date.parse(x)||0) : 0;
  const types = ["group","production","season","episode"];
  const lists = {group:"groups",production:"productions",season:"seasons",episode:"episodes"};
  const parents = {production:"groupId",season:"productionId",episode:"seasonId"};
  const nextType = {group:"production",production:"season",season:"episode"};

  let state, nodes=[], edges=[], byId=new Map(), selected=null, focused=null;
  let camera={x:0,y:0,z:1}, flight=null, page=null, pageStack=[];
  let overlay=null, previousFocus=null, confirmCallback=null, toastTimeout;
  let editorContext=null, pendingImage=null, previewURL=null, pageImageURL=null;
  let imageCache=new Map(), width=innerWidth,height=innerHeight,ratio=1;
  let dust=[], nebulaTexture=null, running=false, frame=0,lastFrame=0;
  let dirty=true, starsFrame=0;
  const pointers=new Map();
  let gesture=null, suppressUntil=0, hovered=null;
  let collectionType="library", filters={};
  const reducedQuery=matchMedia("(prefers-reduced-motion: reduce)");
  const viewport=$("#viewport"), starLayer=$("#starLayer");
  const cv=$("#constellationCanvas"), ctx=cv.getContext("2d");
  const bg=$("#backgroundStars"), bctx=bg.getContext("2d");
  const nc=$("#nebulaCanvas"), nctx=nc.getContext("2d");
  const pageEl=$("#pageOverlay"), editorEl=$("#editorOverlay");
  const detailEl=$("#detailOverlay"), searchEl=$("#searchOverlay");
  const confirmEl=$("#confirmOverlay");

  function toast(text){
    const el=$("#toast");el.textContent=text;el.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout=setTimeout(()=>el.classList.remove("show"),3000);
  }
  function motion(){return state.settings.reduceMotion||reducedQuery.matches;}
  function updateMotion(){document.body.classList.toggle("reduce-motion",motion());dirty=true;}
  function defaults(){
    const now=new Date().toISOString();
    return {schemaVersion:D.schemaVersion,createdAt:now,updatedAt:now,
      settings:copy(D.defaults.settings),archive:copy(D.defaults.archive)};
  }
  function normalize(v){
    const s=defaults(),a=v?.archive||{};
    return {...s,...v,schemaVersion:D.schemaVersion,
      settings:{...s.settings,...v?.settings},
      archive:{...s.archive,...a,...Object.fromEntries(
        [...Object.values(lists),"genres","secondaryGenres"].map(k=>
          [k,Array.isArray(a[k])?a[k]:[]]))}};
  }
  function load(){
    try{
      const v=JSON.parse(localStorage.getItem(D.storageKey)||"null");
      return v?.schemaVersion===D.schemaVersion?normalize(v):defaults();
    }catch(e){console.error(e);return defaults();}
  }
  function save(){
    state.updatedAt=new Date().toISOString();
    try{localStorage.setItem(D.storageKey,JSON.stringify(state));return true;}
    catch(e){console.error(e);toast("Local storage is full or unavailable.");return false;}
  }
  function commit(message){
    if(!save())return false;
    buildWorld();
    if(page && !page.demo){
      const r=find(page.type,page.id);
      if(r)openPage(page.type,page.id,{replace:true});
      else closePage();
    }
    if(message)toast(message);
    return true;
  }
  function collection(t){return state.archive[lists[t]]||[];}
  function find(t,key){return collection(t).find(x=>String(x.id)===String(key))||null;}
  function children(t,key){
    const child=nextType[t];if(!child)return [];
    const field=parents[child];
    return collection(child).filter(e=>String(e[field]||e.parentId||"")===String(key))
      .sort((a,b)=>(a.order??0)-(b.order??0)||title(a).localeCompare(title(b)));
  }
  function parentName(t,item){
    const p={production:"group",season:"production",episode:"season"}[t];
    return p?title(find(p,item[parents[t]])):"";
  }
  function order(t,parent){
    return collection(t).filter(e=>!parents[t]||
      String(e[parents[t]]||"")===String(parent||""))
      .reduce((m,e)=>Math.max(m,Number(e.order)||0),-1)+1;
  }
  function genreList(t){return state.archive[t==="main"?"genres":"secondaryGenres"];}
  function genreNames(record,kind){
    return (record[kind==="main"?"mainGenreIds":"secondaryGenreIds"]||[])
      .map(key=>genreList(kind).find(g=>g.id===key)?.name).filter(Boolean);
  }

  /* IndexedDB: banner blobs stay on the phone, not in source code. */
  const imageCfg=D.images;
  let dbPromise;
  function imageDB(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
      if(!("indexedDB" in window))return reject(Error("IndexedDB unavailable"));
      const req=indexedDB.open(imageCfg.databaseName,imageCfg.databaseVersion);
      req.onupgradeneeded=()=> {
        if(!req.result.objectStoreNames.contains(imageCfg.objectStore))
          req.result.createObjectStore(imageCfg.objectStore);
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function imageOp(mode,key,value){
    const db=await imageDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(imageCfg.objectStore,mode==="get"?"readonly":"readwrite");
      const store=tx.objectStore(imageCfg.objectStore);
      const req=mode==="get"?store.get(key):
        mode==="put"?store.put(value,key):store.delete(key);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async function imageURL(key){
    if(!key)return null;
    if(imageCache.has(key))return imageCache.get(key);
    const blob=await imageOp("get",key);
    if(!blob)return null;
    const url=URL.createObjectURL(blob);
    imageCache.set(key,url);
    return url;
  }
  function evictImage(key){
    if(imageCache.has(key)){URL.revokeObjectURL(imageCache.get(key));imageCache.delete(key);}
  }
  async function compressImage(file){
    if(!file?.type.startsWith("image/")&&!/\.(heic|heif|avif)$/i.test(file.name))
      throw Error("Choose a photo.");
    if(file.size>imageCfg.maximumInputMB*1048576)throw Error("Image is too large.");
    const url=URL.createObjectURL(file);
    try{
      const photo=new Image();photo.src=url;
      await photo.decode();
      const scale=Math.min(1,imageCfg.maximumWidth/photo.naturalWidth,
        imageCfg.maximumHeight/photo.naturalHeight);
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(photo.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(photo.naturalHeight*scale));
      const c=canvas.getContext("2d");
      c.fillStyle="#080914";c.fillRect(0,0,canvas.width,canvas.height);
      c.drawImage(photo,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>
        canvas.toBlob(resolve,imageCfg.preferredFormat,imageCfg.quality));
      if(!blob)throw Error("Image conversion failed.");
      return blob;
    }finally{URL.revokeObjectURL(url);}
  }
  async function deleteUnusedImage(key){
    if(!key)return;
    const used=collection("group").concat(collection("production"))
      .some(e=>e.bannerImageId===key);
    if(!used){evictImage(key);try{await imageOp("delete",key);}catch(e){console.warn(e);}}
  }

  /* Stable but imperfect star characteristics. */
  function starLook(key,t){
    const h=hash(key),warm=rnd(h+7),palette=
      warm<.12?[255,215,188]:warm<.33?[230,236,255]:
      warm<.77?[178,204,255]:[218,194,251];
    return {color:palette,size:.65+rnd(h+3)*.85,
      glow:.55+rnd(h+5)*1.25,spikes:rnd(h+9)>.61,
      angle:rnd(h+11)*Math.PI,ray:.5+rnd(h+13)*1.3,
      twinkle:rnd(h+17)*6.283,magnitude:1+rnd(h+19)*3};
  }
  function addNode(n){
    const key=String(n.id);
    if(byId.has(key))return;
    n.id=key;n.look=starLook(key,n.type);n.visible=0;
    n.sx=-999;n.sy=-999;
    byId.set(key,n);nodes.push(n);
  }
  function groupPosition(e,i){
    if(Number.isFinite(Number(e.mapX))&&Number.isFinite(Number(e.mapY))&&
      e.mapX!=null&&e.mapY!=null)return {x:+e.mapX,y:+e.mapY};
    if(e.demo&&Number.isFinite(e.x))return {x:e.x,y:e.y};
    const angle=D.groupPlacement.angleOffset+i*2.3999632+
      (rnd(hash(e.id)+4)-.5)*.43;
    const r=D.groupPlacement.initialRadius+Math.sqrt(i)*D.groupPlacement.distanceGrowth;
    return {x:Math.cos(angle)*r,y:Math.sin(angle)*r};
  }
  function childOffset(e,i,total,t){
    const radius={production:215,season:105,episode:44}[t]||120;
    const ring=Math.floor(i/9),k=i%9,n=Math.min(9,total-ring*9);
    const angle=-Math.PI/2+k*6.283/Math.max(2,n)+
      (rnd(hash(e.id)+2)-.5)*.38;
    const r=radius*(1+ring*.95)*(.76+rnd(hash(e.id)+3)*.5);
    return {x:Math.cos(angle)*r,y:Math.sin(angle)*r};
  }
  function appendTree(record,node){
    const t=nextType[node.type];if(!t)return;
    const list=node.demo?(record.children||[]):children(node.type,record.id);
    list.forEach((child,i)=>{
      const offset=childOffset(child,i,list.length,t);
      const custom=child.mapX!=null&&child.mapY!=null&&
        Number.isFinite(+child.mapX)&&Number.isFinite(+child.mapY);
      const n={id:child.id,title:title(child),type:t,
        x:custom?+child.mapX:node.x+offset.x,
        y:custom?+child.mapY:node.y+offset.y,
        parentId:node.id,demo:node.demo,record:child};
      addNode(n);appendTree(child,n);
    });
  }
  function treeEdges(siblings){
    if(siblings.length<2)return;
    const connected=[siblings[0]],rest=siblings.slice(1);
    while(rest.length){
      let best=null;
      for(const a of connected)for(const b of rest){
        const distance=Math.hypot(a.x-b.x,a.y-b.y);
        if(!best||distance<best.distance)best={a,b,distance};
      }
      edges.push({a:best.a.id,b:best.b.id});
      connected.push(best.b);rest.splice(rest.indexOf(best.b),1);
    }
  }
  function buildWorld(){
    nodes=[];edges=[];byId=new Map();
    const scale=width<650?.58:1;
    for(const n of D.navigation.nodes)addNode({
      id:"nav-"+n.id,title:n.title,type:"navigation",
      action:n.action,x:n.x*scale,y:n.y*scale
    });
    for(const [a,b] of D.navigation.connections)
      edges.push({a:"nav-"+a,b:"nav-"+b});
    const saved=collection("group");
    const groups=saved.length?saved:D.demoGroups;
    groups.forEach((e,i)=>{
      const p=groupPosition(e,i);
      const n={id:e.id,title:title(e),type:"group",...p,
        record:e,demo:e.demo===true};
      addNode(n);appendTree(e,n);
    });
    collection("production").filter(e=>!e.groupId).forEach((e,i)=>{
      const a=i*2.399963+1.5,r=1100+Math.sqrt(i)*370;
      const n={id:e.id,title:title(e),type:"production",
        x:e.mapX!=null?+e.mapX:Math.cos(a)*r,
        y:e.mapY!=null?+e.mapY:Math.sin(a)*r,
        record:e,standalone:true};
      addNode(n);appendTree(e,n);
    });
    const parentIDs=new Set(nodes.filter(n=>n.parentId).map(n=>n.parentId));
    for(const pid of parentIDs)treeEdges(nodes.filter(n=>n.parentId===pid));
    makeButtons();dirty=true;
  }
  function makeButtons(){
    starLayer.replaceChildren();
    for(const n of nodes){
      const b=document.createElement("button");
      b.type="button";b.className=`celestial-star ${n.type}-star${n.demo?" demo-star":""}`;
      b.setAttribute("aria-label",n.title);
      const hit=document.createElement("span");hit.className="star-touch-area";
      const label=document.createElement("span");label.className="star-label";
      label.textContent=n.title;
      label.style.setProperty("--label-distance",
        `${n.type==="group"?21:24+Math.round(n.look.size*5)}px`);
      b.append(hit,label);
      b.onclick=e=>{
        e.stopPropagation();
        if(performance.now()<suppressUntil)return;
        selectStar(n);
      };
      b.onpointerenter=()=>{hovered=n.id;dirty=true;};
      b.onpointerleave=()=>{hovered=null;dirty=true;};
      b.onfocus=()=>{hovered=n.id;dirty=true;};
      n.element=b;starLayer.append(b);
    }
  }

  /* Camera: all map objects remain in a single coordinate space. */
  function screen(x,y){return {x:width/2+(x-camera.x)*camera.z,
    y:height/2+(y-camera.y)*camera.z};}
  function world(x,y){return {x:camera.x+(x-width/2)/camera.z,
    y:camera.y+(y-height/2)/camera.z};}
  function setCamera(x,y,z){
    camera.x=x;camera.y=y;camera.z=clamp(z,D.camera.minZoom,D.camera.maxZoom);
    dirty=true;
  }
  function animate(target,duration=900){
    flight=motion()?null:{start:{...camera},end:target,time:performance.now(),duration};
    if(motion())setCamera(target.x,target.y,target.z);
  }
  function homeTarget(){
    const list=nodes.filter(n=>n.type==="navigation");
    const xs=list.map(n=>n.x),ys=list.map(n=>n.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs);
    const minY=Math.min(...ys),maxY=Math.max(...ys);
    return {x:(minX+maxX)/2,y:(minY+maxY)/2,
      z:clamp(Math.min(width*(width<650?.8:.72)/(maxX-minX+115),
        height*.51/(maxY-minY+130),1.1),D.camera.minZoom,1.1)};
  }
  function goHome(){focused=null;selected=null;animate(homeTarget(),850);}
  function focus(n){
    focused=n;selected=n.id;
    const z={navigation:1.35,group:2.1,production:4.5,season:9.4,episode:13}[n.type]||2;
    animate({x:n.x,y:n.y,z:Math.max(z,
      Math.hypot(camera.x-n.x,camera.y-n.y)<12?camera.z*1.24:0)},950);
  }
  function zoomAt(x,y,factor){
    flight=null;const anchor=world(x,y);
    const z=clamp(camera.z*factor,D.camera.minZoom,D.camera.maxZoom);
    setCamera(anchor.x-(x-width/2)/z,anchor.y-(y-height/2)/z,z);
  }
  function nodeVisibility(n){
    if(n.type==="navigation"||n.type==="group"||n.standalone)return 1;
    const rule={production:D.semanticZoom.productions,
      season:D.semanticZoom.seasons,episode:D.semanticZoom.episodes}[n.type];
    if(!rule)return 1;
    let a=ease(clamp((camera.z-rule.start)/(rule.full-rule.start),0,1));
    const parent=byId.get(n.parentId);
    if(parent){
      const distance=Math.hypot(camera.x-parent.x,camera.y-parent.y)*camera.z;
      const limit=Math.max(width,height)*1.5;
      a*=1-ease(clamp((distance-limit*.75)/(limit*.85),0,1));
    }
    return a;
  }
  function placeButtons(){
    for(const n of nodes){
      const p=screen(n.x,n.y);n.sx=p.x;n.sy=p.y;
      n.visible=nodeVisibility(n);
      const visible=n.visible>.025&&p.x>-140&&p.x<width+140&&
        p.y>-140&&p.y<height+140;
      const b=n.element;b.classList.toggle("is-hidden",!visible);
      if(!visible){b.tabIndex=-1;continue;}
      b.style.left=p.x+"px";b.style.top=p.y+"px";
      b.style.setProperty("--visibility",n.visible);
      b.classList.toggle("selected",selected===n.id||hovered===n.id);
      b.disabled=n.visible<.67;b.tabIndex=b.disabled?-1:0;
    }
  }

  /* Variable bright/cool/warm stellar bodies, subdued groups. */
  function drawStars(time){
    ctx.clearRect(0,0,width,height);
    for(const line of edges){
      const a=byId.get(line.a),b=byId.get(line.b);
      if(!a||!b)continue;
      const alpha=Math.min(a.visible,b.visible);
      if(alpha<.03||Math.max(a.sx,b.sx)<-80||
        Math.min(a.sx,b.sx)>width+80||Math.max(a.sy,b.sy)<-80||
        Math.min(a.sy,b.sy)>height+80)continue;
      const active=selected===a.id||selected===b.id;
      ctx.strokeStyle=`rgba(165,184,234,${alpha*(active?.58:.23)})`;
      ctx.lineWidth=active?1:.65;ctx.beginPath();
      ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke();
    }
    for(const n of nodes){
      if(n.visible<.025||n.sx<-90||n.sx>width+90||
        n.sy<-90||n.sy>height+90)continue;
      const style={navigation:D.appearance.navigationStars,
        group:D.appearance.groupStars,
        production:D.appearance.productionStars,
        season:D.appearance.seasonStars,
        episode:D.appearance.episodeStars}[n.type];
      if(!style)continue;
      const v=n.look,[r,g,b]=v.color;
      const active=selected===n.id||hovered===n.id;
      const alpha=n.visible*(.65+rnd(hash(n.id)+9)*.35);
      const pulse=motion()?1:1+Math.sin(time*.0004+v.twinkle)*.045;
      const radius=style.radius*v.size*pulse;
      const glow=style.glow*v.glow*(state.settings.constellationGlow/65)*
        (active?1.4:1);
      const halo=ctx.createRadialGradient(n.sx,n.sy,0,n.sx,n.sy,glow);
      halo.addColorStop(0,`rgba(${r},${g},${b},${alpha*.27})`);
      halo.addColorStop(.22,`rgba(${r},${g},${b},${alpha*.11})`);
      halo.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=halo;ctx.beginPath();
      ctx.arc(n.sx,n.sy,glow,0,6.283);ctx.fill();
      const core=ctx.createRadialGradient(n.sx,n.sy,0,n.sx,n.sy,radius*2.7);
      core.addColorStop(0,`rgba(255,255,255,${alpha})`);
      core.addColorStop(.19,`rgba(${r},${g},${b},${alpha})`);
      core.addColorStop(.52,`rgba(${r},${g},${b},${alpha*.33})`);
      core.addColorStop(1,"rgba(0,0,0,0)");
      ctx.save();ctx.translate(n.sx,n.sy);ctx.rotate(v.angle);
      ctx.scale(1,.78+rnd(hash(n.id)+15)*.44);
      ctx.fillStyle=core;ctx.beginPath();ctx.arc(0,0,radius*2.7,0,6.283);
      ctx.fill();ctx.restore();
      if(v.spikes&&(radius>2.7||active)){
        ctx.save();ctx.translate(n.sx,n.sy);ctx.rotate(v.angle);
        const l=radius*(active?7:4.7)*v.ray;
        ctx.strokeStyle=`rgba(${r},${g},${b},${alpha*.48})`;
        ctx.lineWidth=.55;
        ctx.beginPath();ctx.moveTo(-l,0);ctx.lineTo(l,0);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0,-l*.65);ctx.lineTo(0,l*.65);ctx.stroke();
        ctx.restore();
      }
    }
  }
  function resizeCanvas(c,context,d){
    c.width=Math.round(width*d);c.height=Math.round(height*d);
    context.setTransform(d,0,0,d,0,0);
  }
  function backgroundBuild(){
    dust=[];
    const count=clamp(Math.round(D.graphics.backgroundStarCount*
      width*height/850000*state.settings.starDensity/75),
      100,D.graphics.maximumBackgroundStars);
    for(let i=0;i<count;i++){
      const s=i*173+48192,r=rnd(s+1);
      dust.push({x:rnd(s+2)*width,y:rnd(s+3)*height,
        radius:r<.84?.18+rnd(s+4)*.49:r<.98?.68+rnd(s+5)*.53:
          1.25+rnd(s+6)*1.1,
        alpha:.13+rnd(s+7)*.74,depth:.018+rnd(s+8)*.18,
        phase:rnd(s+10)*6.283,speed:.00014+rnd(s+9)*.00048,
        color:rnd(s+11)<.13?[245,221,209]:
          rnd(s+12)<.6?[216,225,255]:[180,202,250]});
    }
  }
  function paintBackground(time){
    bctx.clearRect(0,0,width,height);
    for(const s of dust){
      const x=((s.x-camera.x*s.depth)%width+width)%width;
      const y=((s.y-camera.y*s.depth)%height+height)%height;
      const alpha=clamp(s.alpha*(.42+state.settings.starBrightness/100)*
        (motion()?1:.88+Math.sin(time*s.speed+s.phase)*.12),0,1);
      bctx.fillStyle=`rgba(${s.color.join(",")},${alpha})`;
      bctx.beginPath();bctx.arc(x,y,s.radius,0,6.283);bctx.fill();
    }
  }
  function nebulaBuild(){
    const t=document.createElement("canvas"),s=D.graphics.nebulaResolution;
    t.width=Math.max(320,Math.round(width*s));
    t.height=Math.max(260,Math.round(height*s));
    const c=t.getContext("2d"),w=t.width,h=t.height;
    const clouds=[[.12,.25,.57,24,68,150,.24],
      [.33,.48,.5,42,88,173,.23],[.51,.4,.43,52,104,192,.2],
      [.78,.61,.58,42,39,111,.17],[.83,.2,.47,26,61,133,.17],
      [.15,.79,.43,20,44,102,.14],[.62,.77,.44,23,49,115,.15]];
    for(const [x,y,r,red,green,blue,a] of clouds){
      const X=x*w,Y=y*h,R=r*Math.max(w,h);
      const g=c.createRadialGradient(X,Y,0,X,Y,R);
      g.addColorStop(0,`rgba(${red},${green},${blue},${a})`);
      g.addColorStop(.38,`rgba(${red},${green},${blue},${a*.52})`);
      g.addColorStop(1,"transparent");
      c.fillStyle=g;c.fillRect(0,0,w,h);
    }
    for(let i=0;i<300;i++){
      const s=i*37+181,p=rnd(s),x=(p*1.3-.14)*w;
      const y=(.65-.37*p+(rnd(s+1)-.5)*.38)*h;
      const r=8+rnd(s+2)*55,a=.012+rnd(s+3)*.044;
      const g=c.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,`rgba(85,122,207,${a})`);
      g.addColorStop(1,"transparent");
      c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,6.283);c.fill();
    }
    nebulaTexture=t;
  }
  function paintNebula(){
    if(!nebulaTexture)return;
    nctx.clearRect(0,0,width,height);
    nctx.globalAlpha=state.settings.nebulaIntensity/100;
    nctx.drawImage(nebulaTexture,-80-clamp(camera.x*.007,-80,80),
      -80-clamp(camera.y*.007,-80,80),width+160,height+160);
    nctx.globalAlpha=1;
  }
  function resize(){
    width=innerWidth;height=innerHeight;
    ratio=Math.min(devicePixelRatio||1,D.graphics.maxPixelRatio);
    resizeCanvas(cv,ctx,ratio);resizeCanvas(bg,bctx,ratio);
    resizeCanvas(nc,nctx,1);backgroundBuild();nebulaBuild();dirty=true;
  }
  function loop(t){
    if(!running)return;
    if(t-lastFrame>=16){
      if(flight){
        const p=clamp((t-flight.time)/flight.duration,0,1),e=ease(p);
        const z=Math.exp(mix(Math.log(flight.start.z),
          Math.log(clamp(flight.end.z,D.camera.minZoom,D.camera.maxZoom)),e));
        setCamera(mix(flight.start.x,flight.end.x,e),
          mix(flight.start.y,flight.end.y,e),z);
        if(p===1)flight=null;
      }
      if(!motion()||dirty||flight){
        placeButtons();paintNebula();paintBackground(t);drawStars(t);dirty=false;
      }
      lastFrame=t;
    }
    frame=requestAnimationFrame(loop);
  }
  function start(){if(running)return;running=true;frame=requestAnimationFrame(loop);}
  function stop(){running=false;cancelAnimationFrame(frame);}

  /* Overlays and page stack. */
  function show(el){
    if(overlay&&overlay!==el){
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden","true");
    }
    previousFocus=document.activeElement;overlay=el;
    el.classList.add("open");el.setAttribute("aria-hidden","false");
    viewport.inert=true;
  }
  function hide(){
    if(!overlay)return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden","true");overlay=null;
    viewport.inert=pageEl.classList.contains("open");
    if(previousFocus?.isConnected)previousFocus.focus();
  }
  function detail(html){
    $("#detailContent").innerHTML=html;$("#detailSheet").scrollTop=0;
    show(detailEl);$("#closeDetailButton").focus();
  }
  function editor(html,heading="Create & Edit"){
    $("#editorTitle").textContent=heading;$("#editorContent").innerHTML=html;
    $("#editorSheet").scrollTop=0;show(editorEl);$("#closeEditorButton").focus();
  }
  function ask(message,callback){
    confirmCallback=callback;confirmEl.classList.add("open");
    confirmEl.setAttribute("aria-hidden","false");
    $("#confirmMessage").textContent=message;
    $("#cancelConfirmButton").focus();
  }
  function dismissConfirm(){
    confirmEl.classList.remove("open");
    confirmEl.setAttribute("aria-hidden","true");
    confirmCallback=null;
  }

  /* Group / Series page; page banner uses a local image object URL. */
  function pageRecord(t,key){
    const saved=find(t,key);
    if(saved)return {record:saved,demo:false};
    const n=byId.get(String(key));
    if(n?.demo&&n.type===t)return {record:n.record,demo:true};
    return null;
  }
  function pageChildren(t,record,demo){
    return demo?(record.children||[]):children(t,record.id);
  }
  function formatDate(raw){
    if(!raw)return "";
    const d=new Date(raw+"T12:00:00");
    return Number.isNaN(d.getTime())?String(raw):
      d.toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"});
  }
  function ratingOf(item){
    const raw=item?.averageRating??item?.calculatedRating??item?.rating;
    if(raw==null||raw==="")return null;
    const n=Number(raw);return Number.isFinite(n)?clamp(n,0,10):null;
  }
  function ratingMarkup(value){
    if(value==null)return `<span class="rating-unrated">Not rated yet</span>`;
    const stars=Array.from({length:10},(_,i)=>{
      const portion=clamp(value-i,0,1);
      return `<span class="rating-star"><svg viewBox="0 0 24 24"
        aria-hidden="true"><defs><linearGradient id="rate-${i}">
        <stop offset="${Math.round(portion*100)}%" stop-color="#d9d0ff"/>
        <stop offset="${Math.round(portion*100)}%" stop-color="#35344c"/>
        </linearGradient></defs><path fill="url(#rate-${i})"
        d="m12 2 3.09 6.26 6.91 1.01-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01z"/>
        </svg></span>`;
    }).join("");
    return `<span class="rating-stars">${stars}</span>
      <span class="rating-value">${value.toFixed(1)} / 10</span>`;
  }
  let pageRenderToken=0;
  async function updatePageBanner(record){
    const token=++pageRenderToken;
    if(pageImageURL){URL.revokeObjectURL(pageImageURL);pageImageURL=null;}
    let url=null;
    try{
      if(record.bannerImageId){
        const blob=await imageOp("get",record.bannerImageId);
        if(blob)url=URL.createObjectURL(blob);
      }
      if(!url&&record.banner)url=record.banner;
    }catch(e){console.warn("Banner unavailable",e);}
    if(token!==pageRenderToken||!pageEl.classList.contains("open")){
      if(url?.startsWith("blob:"))URL.revokeObjectURL(url);
      return;
    }
    if(url?.startsWith("blob:"))pageImageURL=url;
    const banner=$("#pageBanner");
    banner.classList.toggle("is-empty",!url);
    banner.style.backgroundImage=url?`url(${JSON.stringify(url)})`:"";
    banner.style.backgroundPosition=
      `${record.bannerPositionX??50}% ${record.bannerPositionY??35}%`;
    banner.style.opacity=(record.bannerOpacity??D.images.defaultOpacity)/100;
  }
  function openPage(t,key,{replace=false}={}){
    if(!["group","production"].includes(t))return;
    const entry=pageRecord(t,key);
    if(!entry)return toast("Entry not found.");
    if(page&&!replace)pageStack.push({type:page.type,id:page.id});
    page={type:t,id:key,demo:entry.demo};
    const r=entry.record,config=D.detailPages[t];
    pageEl.classList.add("open");
    pageEl.setAttribute("aria-hidden","false");
    viewport.inert=true;
    $("#archivePage").scrollTop=0;
    $("#pageTitle").textContent=title(r);
    $("#pageType").textContent=t==="group"?"COLLECTION":
      (r.mediaType||"PRODUCTION").toUpperCase();
    $("#pageRating").innerHTML=ratingMarkup(ratingOf(r));
    $("#pageMainGenres").textContent=genreNames(r,"main").join(" · ");
    $("#pageSecondaryGenres").textContent=genreNames(r,"secondary").join(" · ");
    $("#pageTaxonomy")?.classList?.toggle("is-empty",false);
    $("#pageNotes").textContent=r.notes||"";
    $("#pageNotes").classList.toggle("is-empty",!r.notes);
    const meta=[];
    if(t==="production"){
      if(r.mediaType)meta.push(r.mediaType);
      if(r.releaseStart||r.releaseEnd)
        meta.push([formatDate(r.releaseStart),formatDate(r.releaseEnd)]
          .filter(Boolean).join(" — "));
    }
    $("#pageQuickMeta").innerHTML=meta.map(m=>
      `<span>${esc(m)}</span>`).join("");
    const clip=$("#statusPaperclip");
    clip.hidden=t!=="production";
    if(t==="production"){
      clip.dataset.status=(D.statusVisuals[r.status]?.key||"planned");
      clip.setAttribute("aria-label",`Status: ${r.status||"Planned"}`);
    }
    $("#pageEditButton").hidden=entry.demo;
    const childType=config.childType,list=pageChildren(t,r,entry.demo);
    $("#pageChildrenCount").textContent=
      `${list.length} ${t==="group"?"PRODUCTIONS":"SEASONS"}`;
    $("#pageAddChildButton").hidden=entry.demo;
    const container=$("#pageChildren");
    container.className=`page-children is-${t}`;
    if(!list.length){
      container.innerHTML=`<div class="page-children-empty">
        No ${t==="group"?"productions":"seasons"} yet.</div>`;
    }else if(t==="group"){
      container.innerHTML=list.map(ch=>`
        <button class="child-production" data-child="${esc(ch.id)}">
          <span class="child-production-image" data-img="${esc(ch.id)}"></span>
          <span class="child-production-shade"></span>
          <span class="child-production-title">${esc(title(ch))}</span>
          <span class="child-production-meta">
            ${esc(ch.mediaType||"Production")}
            ${ch.status?" · "+esc(ch.status):""}
          </span>
        </button>`).join("");
      list.forEach(async ch=>{
        const target=[...container.querySelectorAll("[data-img]")]
          .find(el=>el.dataset.img===String(ch.id));
        if(!target)return;
        try{
          const url=ch.bannerImageId?await imageURL(ch.bannerImageId):ch.banner;
          if(target.isConnected&&url)target.style.backgroundImage=
            `url(${JSON.stringify(url)})`;
        }catch(e){console.warn(e);}
      });
    }else{
      container.innerHTML=list.map(ch=>`
        <button class="child-season" data-child="${esc(ch.id)}">
          <span class="child-season-title">${esc(title(ch))}</span>
          <span class="child-season-right">
            ${ch.releaseStart?esc(formatDate(ch.releaseStart)):""}
            <span>›</span>
          </span>
        </button>`).join("");
    }
    container.querySelectorAll("[data-child]").forEach(b=>{
      b.onclick=()=>{
        const key=b.dataset.child,node=byId.get(key);
        if(node)focus(node);
        if(childType==="production")openPage("production",key);
        else{
          closePage();
          toast("Season pages arrive in Step 5.");
        }
      };
    });
    updatePageBanner(r);
    $("#archivePage").focus({preventScroll:true});
  }
  function closePage(){
    ++pageRenderToken;
    page=null;pageStack=[];
    pageEl.classList.remove("open");
    pageEl.setAttribute("aria-hidden","true");
    if(pageImageURL){URL.revokeObjectURL(pageImageURL);pageImageURL=null;}
    viewport.inert=!!overlay;
  }
  function pageBack(){
    const prior=pageStack.pop();
    if(prior)openPage(prior.type,prior.id,{replace:true});
    else closePage();
  }

  /* Editing */
  function createGenre(t,name){
    const clean=name.trim(),list=genreList(t);
    if(!clean)return false;
    if(list.some(g=>g.name.toLowerCase()===clean.toLowerCase()))
      return toast("That genre already exists."),false;
    list.push({id:id(),name:clean,createdAt:new Date().toISOString()});
    return commit("Genre created.");
  }
  function genreManager(){
    detail(`<span class="detail-eyebrow">PERSONAL CATEGORIES</span>
      <h2 id="detailTitle">Genre Creation</h2>
      <p>Create your own main genres and secondary tags.</p>
      ${["main","secondary"].map(t=>`
        <h3>${t==="main"?"Main Genres":"Secondary Genres & Tags"}</h3>
        <div class="genre-create-row">
          <input id="genre-${t}" class="form-input" placeholder="New name...">
          <button class="soft-button primary-button" data-add-genre="${t}">Add</button>
        </div><div class="genre-list" id="list-${t}"></div>`).join("")}`);
    for(const t of ["main","secondary"]){
      const draw=()=>{
        const el=$("#list-"+t),list=genreList(t);
        el.replaceChildren();
        if(!list.length){el.innerHTML=`<p class="genre-empty">None created yet.</p>`;return;}
        for(const g of list){
          const chip=document.createElement("span");
          chip.className="genre-chip";
          const label=document.createElement("span");label.textContent=g.name;
          const edit=document.createElement("button");edit.textContent="✎";
          const del=document.createElement("button");del.textContent="×";
          edit.onclick=()=>{
            const newName=prompt("Rename genre",g.name)?.trim();
            if(!newName)return;
            if(list.some(x=>x.id!==g.id&&x.name.toLowerCase()===newName.toLowerCase()))
              return toast("Name already in use.");
            g.name=newName;commit("Genre renamed.");draw();
          };
          del.onclick=()=>ask(`Delete "${g.name}" and remove its assignments?`,()=>{
            list.splice(list.indexOf(g),1);
            const field=t==="main"?"mainGenreIds":"secondaryGenreIds";
            for(const kind of ["group","production"])
              for(const r of collection(kind))
                r[field]=(r[field]||[]).filter(x=>x!==g.id);
            commit("Genre deleted.");draw();
          });
          chip.append(label,edit,del);el.append(chip);
        }
      };
      draw();
      const input=$("#genre-"+t);
      const add=()=>{if(createGenre(t,input.value)){input.value="";draw();}};
      $(`[data-add-genre="${t}"]`).onclick=add;
      input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();add();}};
    }
  }
  function removeDeep(t,key){
    for(const ch of children(t,key))removeDeep(nextType[t],ch.id);
    const list=collection(t),index=list.findIndex(e=>String(e.id)===String(key));
    if(index>=0){
      const img=list[index].bannerImageId;
      list.splice(index,1);
      if(img)deleteUnusedImage(img);
    }
  }
  function reorder(t,key,delta){
    const r=find(t,key);if(!r)return;
    const siblings=collection(t).filter(e=>!parents[t]||
      String(e[parents[t]]||"")===String(r[parents[t]]||""))
      .sort((a,b)=>(a.order??0)-(b.order??0));
    const i=siblings.indexOf(r),j=i+delta;
    if(j<0||j>=siblings.length)return;
    [siblings[i],siblings[j]]=[siblings[j],siblings[i]];
    siblings.forEach((e,i)=>e.order=i);
    commit("Order updated.");manager();
  }
  function manager(){
    const panels=types.map(t=>{
      const arr=collection(t).slice().sort((a,b)=>(a.order??0)-(b.order??0));
      return `<section class="manager-section">
        <div class="manager-section-title"><h3>${t[0].toUpperCase()+t.slice(1)}s</h3>
        <span class="manager-count">${arr.length}</span></div>
        <div class="manager-list">${arr.length?arr.map(r=>`
          <div class="manager-item">
            <div class="manager-item-main"><span class="manager-item-title">
              ${esc(title(r))}</span><span class="manager-item-subtitle">
              ${esc(parentName(t,r)|| (t==="production"?"Standalone":""))}</span></div>
            <div class="manager-item-actions">
              <button class="mini-button" data-edit="${t}" data-key="${esc(r.id)}">✎</button>
              <button class="mini-button" data-up="${t}" data-key="${esc(r.id)}">↑</button>
              <button class="mini-button" data-down="${t}" data-key="${esc(r.id)}">↓</button>
              <button class="mini-button" data-del="${t}" data-key="${esc(r.id)}">×</button>
            </div></div>`).join(""):`<p class="manager-empty">No entries yet.</p>`}
          </div></section>`;
    }).join("");
    editor(`<p>Build and organize your personal archive.</p>
      <div class="manager-actions">${types.map(t=>
        `<button class="soft-button ${t==="group"||t==="production"?"primary-button":""}"
          data-new="${t}">+ ${t}</button>`).join("")}</div>${panels}`);
    $$("#editorContent [data-new]").forEach(b=>b.onclick=()=>entityForm(b.dataset.new));
    $$("#editorContent [data-edit]").forEach(b=>b.onclick=()=>entityForm(b.dataset.edit,b.dataset.key));
    $$("#editorContent [data-up]").forEach(b=>b.onclick=()=>reorder(b.dataset.up,b.dataset.key,-1));
    $$("#editorContent [data-down]").forEach(b=>b.onclick=()=>reorder(b.dataset.down,b.dataset.key,1));
    $$("#editorContent [data-del]").forEach(b=>b.onclick=()=>{
      const t=b.dataset.del,k=b.dataset.key;
      ask(`Delete "${title(find(t,k))}" and all its descendants?`,()=>{
        removeDeep(t,k);commit("Entry deleted.");manager();
      });
    });
  }
  function inputField(k,label,v="",type="text"){
    return `<div class="form-field"><label for="field-${k}">${label}</label>
      <input id="field-${k}" class="form-input" type="${type}"
      value="${esc(v)}"></div>`;
  }
  function selectField(k,label,items,chosen){
    return `<div class="form-field"><label for="field-${k}">${label}</label>
      <select id="field-${k}" class="form-select">${items.map(x=>
      `<option value="${esc(x.id)}" ${String(x.id)===String(chosen)?"selected":""}>
      ${esc(x.name)}</option>`).join("")}</select></div>`;
  }
  function genreFields(kind,chosen=[]){
    const arr=genreList(kind);
    return `<div class="form-field"><label>${kind==="main"?"Main Genres":"Secondary Tags"}</label>
      ${arr.length?arr.map(g=>`<label class="field-checkbox">
      <input type="checkbox" data-genre="${kind}" value="${esc(g.id)}"
      ${chosen.includes(g.id)?"checked":""}> ${esc(g.name)}</label>`).join(""):
      `<small>Create genres using the Genre Creation star.</small>`}</div>`;
  }
  async function loadPreview(record){
    const area=$("#bannerPreview");
    if(!area)return;
    let url=null;
    try{
      if(record.bannerImageId)url=await imageURL(record.bannerImageId);
      if(!url)url=record.banner||null;
    }catch(e){console.warn(e);}
    if(!area.isConnected)return;
    area.innerHTML=url?
      `<img class="banner-preview-image" alt="Current banner">`:
      `<span class="banner-preview-empty">✧</span>`;
    if(url)area.querySelector("img").src=url;
  }
  function clearPendingImage(){
    if(previewURL)URL.revokeObjectURL(previewURL);
    previewURL=null;pendingImage=null;$("#bannerFileInput").value="";
  }
  function entityForm(t,key=null,requestedParent=null){
    clearPendingImage();
    const old=key?find(t,key):null;
    if(key&&!old)return toast("Record not found.");
    const r=old||{},editing=!!old;
    editorContext={t,key,removeImage:false};
    let html=`<form id="archiveForm" class="archive-form">
      ${inputField("title","Title",r.title||"")}`;
    if(t==="production"){
      html+=selectField("groupId","Group",[
        {id:"",name:"None — standalone"},...collection("group").map(e=>({id:e.id,name:title(e)}))
      ],r.groupId||requestedParent||"");
      html+=selectField("mediaType","Media Format",D.mediaTypes.map(x=>({id:x,name:x})),
        r.mediaType||"TV Series");
      html+=selectField("status","Watching Status",D.statuses.map(x=>({id:x,name:x})),
        r.status||"Planned");
      html+=`<label class="field-checkbox"><input type="checkbox"
        id="field-watchlist" ${r.watchlist?"checked":""}> Watchlist</label>`;
    }
    if(t==="season"){
      html+=selectField("productionId","Production",
        collection("production").map(e=>({id:e.id,name:title(e)})),
        r.productionId||requestedParent||"");
      html+=selectField("status","Watching Status",
        D.statuses.map(x=>({id:x,name:x})),r.status||"Planned");
    }
    if(t==="episode"){
      html+=selectField("seasonId","Season",
        collection("season").map(e=>({id:e.id,name:title(e)})),
        r.seasonId||requestedParent||"");
      html+=inputField("duration","Duration (minutes)",r.duration??"","number");
    }
    if(t==="group"||t==="production"){
      html+=genreFields("main",r.mainGenreIds||"");
      html+=genreFields("secondary",r.secondaryGenreIds||"");
      html+=`<div class="form-field banner-upload">
        <label>Banner Image</label>
        <div class="banner-upload-preview" id="bannerPreview"></div>
        <div class="banner-upload-actions">
          <button type="button" class="soft-button" id="chooseBanner">
            Choose from Gallery</button>
          <button type="button" class="soft-button" id="removeBanner">
            Remove Image</button>
        </div>
        <span class="banner-upload-note">
          Images are stored privately on this device. Export a backup to transfer them.
        </span></div>
        <div class="form-grid">
          ${inputField("bannerPositionX","Image Position — Horizontal (%)",
            r.bannerPositionX??50,"number")}
          ${inputField("bannerPositionY","Image Position — Vertical (%)",
            r.bannerPositionY??35,"number")}
        </div>`;
    }
    if(t==="production"||t==="season"){
      html+=`<div class="form-grid">
        ${inputField("releaseStart","Airing / Release Start",r.releaseStart||"","date")}
        ${inputField("releaseEnd","Airing / Release End",r.releaseEnd||"","date")}
        </div>`;
    }
    if(t==="production"||t==="episode")
      html+=inputField("lastWatched",t==="episode"?"Date Watched":"Last Watched",
        r.lastWatched||r.watchedAt||"","date");
    html+=`<div class="form-field">
      <label for="field-notes">Personal Observations</label>
      <textarea id="field-notes" class="form-textarea"></textarea></div>
      <div class="form-actions">
        <button type="button" class="soft-button" id="cancelForm">Cancel</button>
        <button type="submit" class="soft-button primary-button" id="saveForm">
          ${editing?"Save Changes":"Create Entry"}</button>
      </div></form>`;
    editor(html,`${editing?"Edit":"Create"} ${t}`);
    $("#field-notes").value=r.notes||"";
    $("#cancelForm").onclick=()=>{clearPendingImage();manager();};
    if(t==="group"||t==="production"){
      loadPreview(r);
      $("#chooseBanner").onclick=()=>$("#bannerFileInput").click();
      $("#removeBanner").onclick=()=>{
        clearPendingImage();editorContext.removeImage=true;
        $("#bannerPreview").innerHTML=`<span class="banner-preview-empty">✧</span>`;
      };
    }
    $("#archiveForm").onsubmit=async e=>{
      e.preventDefault();
      const get=k=>$("#field-"+k)?.value||"";
      const value={title:get("title").trim(),notes:$("#field-notes").value};
      if(!value.title)return toast("Enter a title.");
      if(t==="production"){
        value.groupId=get("groupId")||null;
        value.mediaType=get("mediaType");
        value.status=get("status");
        value.watchlist=$("#field-watchlist").checked;
      }
      if(t==="season"){
        value.productionId=get("productionId");
        value.status=get("status");
      }
      if(t==="episode"){
        value.seasonId=get("seasonId");
        value.duration=Math.max(0,Number(get("duration"))||0);
        value.watchedAt=get("lastWatched");
      }
      if(t==="group"||t==="production"){
        value.mainGenreIds=$$('#archiveForm [data-genre="main"]:checked')
          .map(x=>x.value);
        value.secondaryGenreIds=$$('#archiveForm [data-genre="secondary"]:checked')
          .map(x=>x.value);
        value.bannerPositionX=clamp(+get("bannerPositionX")||50,0,100);
        value.bannerPositionY=clamp(+get("bannerPositionY")||35,0,100);
      }
      if(t==="production"||t==="season"){
        value.releaseStart=get("releaseStart");
        value.releaseEnd=get("releaseEnd");
      }
      if(t==="production")value.lastWatched=get("lastWatched");
      if(t==="season"&&!find("production",value.productionId))
        return toast("Create a production first.");
      if(t==="episode"&&!find("season",value.seasonId))
        return toast("Create a season first.");
      const button=$("#saveForm");button.disabled=true;
      let newKey=null,previousImage=old?.bannerImageId||null;
      try{
        if(pendingImage&&(t==="group"||t==="production")){
          newKey=id();await imageOp("put",newKey,pendingImage);
          value.bannerImageId=newKey;value.banner="";
        }else if(editorContext.removeImage){
          value.bannerImageId=null;value.banner="";
        }
        if(editing){
          const previousParent=old[parents[t]]||null;
          const newParent=value[parents[t]]||null;
          if(previousParent!==newParent){
            value.order=order(t,newParent);
            delete old.mapX;delete old.mapY;
          }
          Object.assign(old,value,{id:old.id,
            createdAt:old.createdAt,updatedAt:new Date().toISOString()});
        }else{
          const time=new Date().toISOString();
          collection(t).push({id:id(),createdAt:time,updatedAt:time,
            order:order(t,value[parents[t]]),...value});
        }
        if(!save())throw Error("Archive storage failed.");
        buildWorld();
        clearPendingImage();
        if(previousImage&&previousImage!==value.bannerImageId)
          await deleteUnusedImage(previousImage);
        if(page && page.type===t && page.id===key)
          openPage(t,key,{replace:true});
        toast(editing?"Changes saved.":"Entry created.");
        manager();
      }catch(error){
        console.error(error);
        if(newKey)await deleteUnusedImage(newKey);
        toast("Could not save. Check available storage.");
      }finally{if(button.isConnected)button.disabled=false;}
    };
  }

  /* Library and Search */
  function openCollection(t){
    collectionType=t;filters={q:"",sort:"alphabetical"};
    detail(`<span class="detail-eyebrow">YOUR ARCHIVE</span>
      <h2 id="detailTitle">${t==="library"?"Library":"Watchlist"}</h2>
      <div class="library-toolbar">
        <div class="library-control"><label>Search</label>
          <input class="library-input" id="libSearch" placeholder="Title..."></div>
        <div class="library-control"><label>Sort</label>
          <select class="library-select" id="libSort">${D.sorting.map(s=>
            `<option value="${s.id}">${esc(s.title)}</option>`).join("")}</select></div>
      </div><div class="library-count" id="libCount"></div>
      <div class="library-results" id="libResults"></div>`);
    $("#libSearch").oninput=e=>{filters.q=e.target.value;renderCollection();};
    $("#libSort").onchange=e=>{filters.sort=e.target.value;renderCollection();};
    renderCollection();
  }
  function renderCollection(){
    let arr=collection("production").filter(e=>collectionType!=="watchlist"||
      e.watchlist||e.status==="Planned");
    const q=filters.q.toLowerCase();
    arr=arr.filter(e=>title(e).toLowerCase().includes(q));
    const rating=e=>ratingOf(e);
    arr.sort((a,b)=>{
      const alpha=title(a).localeCompare(title(b));
      switch(filters.sort){
        case "alphabeticalReverse":return -alpha;
        case "highestRated":return (rating(b)??-1)-(rating(a)??-1)||alpha;
        case "lowestRated":return (rating(a)??999)-(rating(b)??999)||alpha;
        case "newestAdded":return dateNumber(b.createdAt)-dateNumber(a.createdAt)||alpha;
        case "oldestAdded":return dateNumber(a.createdAt)-dateNumber(b.createdAt)||alpha;
        case "lastWatched":return dateNumber(b.lastWatched)-dateNumber(a.lastWatched)||alpha;
        case "earliestRelease":return dateNumber(a.releaseStart)-dateNumber(b.releaseStart)||alpha;
        case "latestRelease":return dateNumber(b.releaseStart)-dateNumber(a.releaseStart)||alpha;
        case "custom":return (a.order??0)-(b.order??0)||alpha;
        default:return alpha;
      }
    });
    $("#libCount").textContent=`${arr.length} productions`;
    $("#libResults").innerHTML=arr.length?arr.map(e=>
      `<button class="library-entry" data-production="${esc(e.id)}">
        <span class="library-entry-main">
        <span class="library-entry-title">${esc(title(e))}</span>
        <span class="library-entry-meta">${esc(e.mediaType||"Production")}</span>
        </span><span class="library-entry-rating">
        ${rating(e)==null?"—":rating(e).toFixed(1)+" / 10"}</span>
        </button>`).join(""):`<div class="library-empty">
        <h3>Nothing here yet.</h3><p>Add productions using Create & Edit.</p></div>`;
    $$("#libResults [data-production]").forEach(b=>b.onclick=()=>{
      const n=byId.get(b.dataset.production);hide();
      if(n){focus(n);openPage("production",n.id);}
    });
  }
  function search(){
    $("#globalSearch").value="";$("#searchResults").replaceChildren();
    show(searchEl);$("#globalSearch").focus();
  }
  function renderSearch(){
    const q=$("#globalSearch").value.trim().toLowerCase();
    const results=[];
    if(q)for(const t of types)for(const e of collection(t))
      if(title(e).toLowerCase().includes(q))results.push({t,e});
    $("#searchResults").innerHTML=results.slice(0,60).map(({t,e})=>
      `<button class="search-result" data-result="${esc(e.id)}">
       <span>${esc(title(e))}</span><small>${t}</small></button>`).join("");
    $$("#searchResults [data-result]").forEach(b=>b.onclick=()=>{
      const n=byId.get(b.dataset.result);hide();
      if(n){focus(n);if(["group","production"].includes(n.type))
        openPage(n.type,n.id);}
    });
  }
  function selectStar(n){
    if(n.type==="navigation"){
      switch(n.action){
        case "create":return manager();
        case "genres":return genreManager();
        case "settings":return settings();
        case "library":case "watchlist":return openCollection(n.action);
      }
    }
    focus(n);
    if(["group","production"].includes(n.type))openPage(n.type,n.id);
    else if(n.type==="episode")
      detail(`<span class="detail-eyebrow">EPISODE</span>
        <h2 id="detailTitle">${esc(n.title)}</h2>
        <p>${esc(n.record?.notes||"Episode page arrives in Step 5.")}</p>`);
  }
  function settings(){
    const fields=["starDensity","starBrightness","nebulaIntensity","constellationGlow"];
    detail(`<span class="detail-eyebrow">YOUR UNIVERSE</span>
      <h2 id="detailTitle">Settings</h2>${fields.map(k=>
        `<div class="detail-row"><label>${esc(k)}</label>
         <input type="range" class="setting-range" data-setting="${k}"
         min="0" max="100" step="5" value="${state.settings[k]}">
         <output class="setting-value">${state.settings[k]}</output></div>`).join("")}
      <div class="detail-row"><label>Reduce Motion</label>
        <input type="checkbox" class="motion-checkbox" id="reduceMotion"
        ${state.settings.reduceMotion?"checked":""}></div>
      <h3>Backups</h3><p>Include uploaded banners when exporting your archive.</p>
      <button class="detail-action" id="exportBackup">Export archive</button>
      <button class="detail-action" id="importBackup">Import archive</button>`);
    $$("[data-setting]").forEach(el=>el.oninput=()=>{
      state.settings[el.dataset.setting]=+el.value;
      el.parentElement.querySelector("output").textContent=el.value;
      if(el.dataset.setting==="starDensity")backgroundBuild();
      dirty=true;save();
    });
    $("#reduceMotion").onchange=e=>{state.settings.reduceMotion=e.target.checked;updateMotion();save();};
    $("#exportBackup").onclick=exportBackup;
    $("#importBackup").onclick=()=>$("#importFile").click();
  }

  /* Portable JSON with base64 images; no ZIP required. */
  const blobBase64=blob=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
  function base64Blob(base64,type){
    const raw=atob(base64),parts=[];
    for(let i=0;i<raw.length;i+=32768){
      const piece=raw.slice(i,i+32768),bytes=new Uint8Array(piece.length);
      for(let j=0;j<piece.length;j++)bytes[j]=piece.charCodeAt(j);
      parts.push(bytes);
    }
    return new Blob(parts,{type});
  }
  async function exportBackup(){
    try{
      toast("Preparing archive and images...");
      const images={};
      const keys=new Set(collection("group").concat(collection("production"))
        .map(r=>r.bannerImageId).filter(Boolean));
      for(const key of keys){
        const blob=await imageOp("get",key);
        if(blob)images[key]={type:blob.type,data:await blobBase64(blob)};
      }
      const backup={app:D.appName,schemaVersion:D.schemaVersion,
        exportedAt:new Date().toISOString(),data:state,images};
      const blob=new Blob([JSON.stringify(backup)],{type:"application/json"});
      const url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download=`watch-archive-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      toast("Backup ready, including banners.");
    }catch(e){console.error(e);toast("Export failed. Check image storage.");}
  }
  async function importBackup(file){
    if(!file)return;
    try{
      const backup=JSON.parse(await file.text());
      if(backup.app!==D.appName||backup.schemaVersion!==D.schemaVersion||
        !backup.data?.archive||!types.every(t=>Array.isArray(
          backup.data.archive[lists[t]])))throw Error("Invalid backup");
      if(!confirm("Replace this browser's archive with the imported backup?"))return;
      const candidate=normalize(backup.data);
      const old=state;
      const written=[];
      try{
        for(const [key,item] of Object.entries(backup.images||{})){
          if(!item?.data)continue;
          await imageOp("put",key,base64Blob(item.data,item.type||"image/jpeg"));
          written.push(key);
        }
        state=candidate;
        if(!save())throw Error("Unable to store archive.");
      }catch(e){
        state=old;
        for(const key of written)if(!(old.archive.groups.concat(old.archive.productions))
          .some(r=>r.bannerImageId===key))await deleteUnusedImage(key);
        throw e;
      }
      hide();closePage();buildWorld();backgroundBuild();goHome();
      toast("Archive and images imported.");
    }catch(e){console.error(e);toast("Import failed.");}
    finally{$("#importFile").value="";}
  }

  /* Free pan / pinch. */
  const point=e=>({x:e.clientX,y:e.clientY});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  function startPinch(){
    const [a,b]=[...pointers.values()],center=mid(a,b);
    gesture={type:"pinch",distance:Math.max(1,distance(a,b)),
      zoom:camera.z,anchor:world(center.x,center.y),moved:true};
    suppressUntil=performance.now()+500;
  }
  function bindPan(){
    viewport.onpointerdown=e=>{
      if(e.pointerType==="mouse"&&e.button!==0)return;
      flight=null;pointers.set(e.pointerId,point(e));
      if(pointers.size===1)gesture={type:"drag",travel:0,moved:false};
      else startPinch();
    };
    viewport.onpointermove=e=>{
      if(!pointers.has(e.pointerId))return;
      const before=pointers.get(e.pointerId),now=point(e);
      pointers.set(e.pointerId,now);
      if(pointers.size>=2){
        if(gesture?.type!=="pinch")startPinch();
        const [a,b]=[...pointers.values()],center=mid(a,b);
        const z=clamp(gesture.zoom*distance(a,b)/gesture.distance,
          D.camera.minZoom,D.camera.maxZoom);
        setCamera(gesture.anchor.x-(center.x-width/2)/z,
          gesture.anchor.y-(center.y-height/2)/z,z);
        gesture.moved=true;suppressUntil=performance.now()+450;
        return;
      }
      const dx=now.x-before.x,dy=now.y-before.y;
      gesture.travel+=Math.hypot(dx,dy);
      if(gesture.travel>D.camera.tapThreshold){
        gesture.moved=true;suppressUntil=performance.now()+350;
        viewport.classList.add("dragging");
        if(!viewport.hasPointerCapture(e.pointerId))
          viewport.setPointerCapture(e.pointerId);
      }
      setCamera(camera.x-dx/camera.z,camera.y-dy/camera.z,camera.z);
    };
    const end=e=>{
      if(!pointers.has(e.pointerId))return;
      pointers.delete(e.pointerId);
      if(viewport.hasPointerCapture(e.pointerId))
        viewport.releasePointerCapture(e.pointerId);
      if(gesture?.moved)suppressUntil=performance.now()+350;
      if(!pointers.size){gesture=null;viewport.classList.remove("dragging");}
      else if(pointers.size===1)gesture={type:"drag",travel:0,moved:true};
    };
    viewport.addEventListener("pointerup",end);
    viewport.addEventListener("pointercancel",end);
    viewport.addEventListener("click",e=>{
      if(performance.now()<suppressUntil){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
    viewport.addEventListener("wheel",e=>{
      e.preventDefault();
      zoomAt(e.clientX,e.clientY,
        Math.exp(-e.deltaY*D.camera.wheelSensitivity));
    },{passive:false});
  }
  function bindControls(){
    $("#homeButton").onclick=goHome;
    $("#focusButton").onclick=()=>focused?focus(focused):goHome();
    $("#searchButton").onclick=search;
    $("#closeDetailButton").onclick=hide;
    $("#detailBackdrop").onclick=hide;
    $("#closeEditorButton").onclick=()=>{clearPendingImage();hide();};
    $("#editorBackdrop").onclick=()=>{clearPendingImage();hide();};
    $("#closeSearchButton").onclick=hide;
    $("#searchBackdrop").onclick=hide;
    $("#globalSearch").oninput=renderSearch;
    $("#pageCloseButton").onclick=closePage;
    $("#pageBackButton").onclick=pageBack;
    $("#pageEditButton").onclick=()=>{
      if(!page?.demo)entityForm(page.type,page.id);
    };
    $("#pageAddChildButton").onclick=()=>{
      if(page&&!page.demo)entityForm(nextType[page.type],null,page.id);
    };
    $("#cancelConfirmButton").onclick=dismissConfirm;
    $("#acceptConfirmButton").onclick=()=>{
      const cb=confirmCallback;dismissConfirm();cb?.();
    };
    $("#bannerFileInput").onchange=async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{
        pendingImage=await compressImage(file);
        editorContext.removeImage=false;
        if(previewURL)URL.revokeObjectURL(previewURL);
        previewURL=URL.createObjectURL(pendingImage);
        const preview=$("#bannerPreview");
        if(preview)preview.innerHTML=`<img class="banner-preview-image" alt="Selected banner">`;
        preview?.querySelector("img")?.setAttribute("src",previewURL);
      }catch(error){console.error(error);toast(error.message||"Unable to read image.");}
    };
    $("#importFile").onchange=e=>importBackup(e.target.files?.[0]);
    window.addEventListener("keydown",e=>{
      if(e.key==="Escape"){
        if(confirmEl.classList.contains("open"))dismissConfirm();
        else if(overlay)hide();
        else if(page)pageBack();
      }
    });
    let resizeTimer;
    window.addEventListener("resize",()=>{
      clearTimeout(resizeTimer);
      resizeTimer=setTimeout(()=>{
        const mobile=width<650;
        resize();if(mobile!==(width<650))buildWorld();
      },150);
    });
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden)stop();else start();
    });
    reducedQuery.addEventListener?.("change",updateMotion);
    window.addEventListener("storage",e=>{
      if(e.key!==D.storageKey)return;
      state=load();buildWorld();backgroundBuild();updateMotion();
      toast("Archive refreshed.");
    });
  }
  function init(){
    state=load();updateMotion();resize();buildWorld();bindPan();bindControls();
    const h=homeTarget();setCamera(h.x,h.y,h.z);
    start();
    try{if(!localStorage.getItem(D.storageKey))save();}catch(e){console.warn(e);}
  }
  init();
})();
