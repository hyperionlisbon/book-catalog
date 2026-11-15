/* Book Catalog — phone web app (Shelf style).
   Talks only to: your Google Apps Script (books, photos, Claude) and the free Google Books / Open Library catalogs.
   No third-party scripts are loaded; the Content-Security-Policy in index.html enforces that. */
(() => {
'use strict';

const GENRES=["Biography","Dystopia","Fantasy","Fiction","Graphic Novel","Historical Fantasy","Historical Fiction","History, Non-Fiction","Literary Fiction","Manga","Manhua","Manwha","Non-Fiction","Romance","Science Books","Science Fiction","Travel Book"];
const SUBGENRES=["AGI","AI","Asian","BL","Children","Classic","Cyberpunk","Dark Academia","Dark Fantasy","Dragons","Faeries","Fantasy Adventure","Gods","Gothic","High Fantasy","Isekai","LitRPG","Medieval","Memoir","Mystery","Nature Powers","Other Civilizations","Other Worlds","Post-Apocalyptic","Romantsy","Shōjo","Shōnen","Soft-horror","Space","Special School","Trials","VRMMORPG","Vampires","Vitorian England","War","Witches","Witty","Wizzards","Xianxia","YA","Zombies"];
const STATUSES=["Reading","TBR","Read","DNF"];
const LANGS={en:"English",pt:"Portuguese",es:"Spanish",fr:"French",de:"German",it:"Italian",ja:"Japanese",ko:"Korean",zh:"Chinese",nl:"Dutch"};
const ADD_STEPS=[["Front cover","Fit the cover inside the frame"],["Back cover","Barcode inside the frame"],["Copyright page","Page with publisher and year, inside the frame"],["Anything else","Optional: spine or flap"]];
const COVER_STEPS=[["Front cover","Fit the cover inside the frame"]];
const MAX_PHOTOS=4;
const SCRIPT_URL_RE=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
const TOKEN_RE=/^[A-Za-z0-9_-]{32,128}$/;

/* ---------- small helpers ---------- */
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s??"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
const pad=n=>String(n).padStart(3,"0");
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}
};
const stars=n=>{n=+n||0;return n?`<span class="stars" aria-label="${n} of 5 stars">${"★".repeat(n)}<span class="off">${"★".repeat(5-n)}</span></span>`:""};
const statusLabel=s=>s==="TBR"?"To read":s;
const isbnDigits=s=>String(s||"").split(/[,;\s]+/).map(x=>x.replace(/[^0-9Xx]/g,"")).filter(x=>x.length===10||x.length===13);
const hash=s=>{let h=7;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)};
// Each book keeps the same spine colour and thickness every time.
const spineOf=b=>{const h=hash((b.title||"")+"|"+(b.author||""));const c=h%8;return {cls:`c${c} h${(h>>4)%4}${c===3?" light":""}`,light:c===3}};
const ICON={
  cam:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  back:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  award:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="M9 13.5 8 21l4-2 4 2-1-7.5"/></svg>`,
  pen:`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`
};
let toastT;
function toast(msg){clearTimeout(toastT);let t=$(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.append(t)}t.textContent=msg;t.hidden=false;toastT=setTimeout(()=>t.hidden=true,Math.max(3000,msg.length*60))}

/* ---------- state ---------- */
let conn=store.get("bc-conn",null);
let books=store.get("bc-books",[]);
let budget=store.get("bc-budget",null);
let hasClaude=store.get("bc-claude",false);
const st={q:"",status:"",genre:"",lang:"",sort:"id-desc",shown:60,...store.get("bc-view",{})};
st.q="";st.shown=60;
const saveView=()=>store.set("bc-view",{status:st.status,genre:st.genre,lang:st.lang,sort:st.sort});
const photoCache=new Map(); // book id -> object URL (this visit only)

/* ---------- backend ---------- */
function parseCode(code){
  code=String(code||"").trim();
  if(!code.startsWith("BC1."))throw new Error("That doesn’t look like a connection code. It starts with BC1.");
  let obj;
  try{const b=code.slice(4).replace(/-/g,"+").replace(/_/g,"/");obj=JSON.parse(decodeURIComponent(escape(atob(b+"===".slice((b.length+3)%4)))))}
  catch(e){throw new Error("The connection code is incomplete. Copy the whole line again.")}
  if(!obj||!SCRIPT_URL_RE.test(obj.u||""))throw new Error("The code doesn’t point to a Google Apps Script web app.");
  if(!TOKEN_RE.test(obj.t||""))throw new Error("The access key in the code is not valid.");
  return {u:obj.u,t:obj.t};
}
async function api(action,payload={},c=conn){
  if(!c)throw Object.assign(new Error("Not connected"),{code:"not_connected"});
  let res;
  try{res=await fetch(c.u,{method:"POST",body:JSON.stringify({...payload,action,token:c.t}),redirect:"follow",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer"})}
  catch(e){throw Object.assign(new Error("No connection. Check your internet and try again."),{code:"network"})}
  let data;
  try{data=await res.json()}catch(e){throw Object.assign(new Error("Unexpected reply from your Google script. Check that it is deployed as a web app."),{code:"bad_reply"})}
  if(!data.ok){
    const msg=data.message||({unauthorized:"Access key not accepted. Reconnect in Settings.",locked:"Too many wrong keys. Wait 15 minutes.",unknown_action:"Your Google script is an older version. In Apps Script: Deploy › Manage deployments › ✏️ › Version: New version › Deploy."}[data.error])||data.error||"Something went wrong.";
    throw Object.assign(new Error(msg),{code:data.error,budget:data.budget});
  }
  return data;
}
function handleApiError(e,fallback){
  if(e.code==="unauthorized"){toast("Access key not accepted. Reconnect in Settings.");openSettings();return}
  toast((fallback?fallback+": ":"")+e.message);
}
function upsertBook(b){b={...b,id:+b.id};books=books.filter(x=>x.id!==b.id).concat(b);store.set("bc-books",books);return b}

/* ---------- list: the shelf ---------- */
function filtered(){
  const q=norm(st.q).trim();
  let r=books.filter(b=>(!st.status||b.status===st.status)&&(!st.genre||b.genre===st.genre)&&(!st.lang||b.language===st.lang));
  if(q){const terms=q.split(/\s+/);r=r.filter(b=>{const hay=norm([b.title,b.author,b.series,b.publisher,b.isbn,b.genre,b.subgenre,b.comments].join(" "));return terms.every(t=>hay.includes(t))})}
  const by=f=>(a,b)=>norm(f(a)).localeCompare(norm(f(b)));
  const sorters={"id-desc":(a,b)=>b.id-a.id,"id-asc":(a,b)=>a.id-b.id,title:by(b=>b.title),author:by(b=>b.author),
    rating:(a,b)=>(+b.rating||0)-(+a.rating||0)||a.id-b.id,
    series:(a,b)=>norm(a.series||"~").localeCompare(norm(b.series||"~"))||(parseFloat(a.seriesNo)||0)-(parseFloat(b.seriesNo)||0)};
  return r.sort(sorters[st.sort]||sorters["id-desc"]);
}
function renderChrome(){
  const counts={};books.forEach(b=>counts[b.status]=(counts[b.status]||0)+1);
  $("#tally").innerHTML=books.length?`<span><b>${books.length}</b>books</span><span class="s-read"><b>${counts.Read||0}</b>read</span><span class="s-tbr"><b>${counts.TBR||0}</b>to read</span>`:"";
  $("#statusChips").innerHTML=[["","All",books.length],...STATUSES.map(s=>[s,statusLabel(s),counts[s]||0])]
    .map(([v,l,n])=>`<button class="chip" data-status="${esc(v)}" aria-pressed="${st.status===v}">${esc(l)}<span class="n">${n}</span></button>`).join("");
  const uniq=k=>[...new Set(books.map(b=>b[k]).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
  const fill=(sel,vals,label,cur)=>{const el=$(sel);el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");el.value=vals.includes(cur)?cur:""};
  fill("#fGenre",uniq("genre"),"All genres",st.genre);
  fill("#fLang",uniq("language"),"All languages",st.lang);
  $("#fSort").value=st.sort;
  $("#addBtn").hidden=!conn;
  $("#statsBtn").hidden=!conn||!books.length;
}
function spineHtml(b){
  const sp=spineOf(b);
  const series=b.series?` · ${esc(b.series)}${b.seriesNo!==""&&b.seriesNo!=null?` #${esc(b.seriesNo)}`:""}`:"";
  const side=b.priority&&b.status!=="Read"?`<span class="tag prio">Priority</span>`
    :(+b.rating?stars(b.rating):(b.status?`<span class="tag">${esc(statusLabel(b.status))}</span>`:""));
  return `<button class="spine ${sp.cls}" data-id="${+b.id}"><span class="no">${pad(+b.id)}</span>
    <span class="txt"><span class="t">${esc(b.title)}</span><span class="a">${esc(b.author)}${series}</span></span>${side}</button>`;
}
function renderList(){
  const list=$("#list");
  if(!conn){
    list.innerHTML=`<div class="notice"><strong>Connect your catalog</strong><span>Paste the connection code from your Google script once, and your books appear here.</span><button class="btn primary" id="connectBtn">Connect</button></div>`;
    $("#connectBtn").onclick=openSettings;$("#moreWrap").hidden=true;return;
  }
  if(!books.length){list.innerHTML=`<div class="notice"><strong>Loading your shelves…</strong><span>Fetching your books from your Google Sheet.</span></div>`;$("#moreWrap").hidden=true;return}
  const r=filtered();
  if(!r.length){list.innerHTML=`<div class="notice"><strong>No books match</strong><span>Try a different search or clear the filters.</span></div>`;$("#moreWrap").hidden=true;return}
  list.innerHTML=`<div class="shelf">${r.slice(0,st.shown).map(spineHtml).join("")}</div>`;
  $("#moreWrap").hidden=r.length<=st.shown;
  $("#moreBtn").textContent=`Show more (${r.length-st.shown} left)`;
}
function render(){renderChrome();renderList();const sv=$(".statsv");if(sv)renderStats(sv)}

$("#q").addEventListener("input",e=>{st.q=e.target.value;st.shown=60;renderList()});
$("#statusChips").addEventListener("click",e=>{const c=e.target.closest(".chip");if(!c)return;st.status=c.dataset.status;st.shown=60;saveView();render()});
$("#fGenre").addEventListener("change",e=>{st.genre=e.target.value;st.shown=60;saveView();renderList()});
$("#fLang").addEventListener("change",e=>{st.lang=e.target.value;st.shown=60;saveView();renderList()});
$("#fSort").addEventListener("change",e=>{st.sort=e.target.value;saveView();renderList()});
$("#moreBtn").addEventListener("click",()=>{st.shown+=60;renderList()});
$("#list").addEventListener("click",e=>{const sp=e.target.closest(".spine");if(sp)openBook(+sp.dataset.id)});
$("#addBtn").addEventListener("click",openAddChoice);
$("#settingsBtn").addEventListener("click",openSettings);
$("#statsBtn").addEventListener("click",()=>openStats());

async function loadBooks(){
  try{const d=await api("list");books=d.books.map(b=>({...b,id:+b.id}));store.set("bc-books",books);render()}
  catch(e){handleApiError(e,"Couldn’t load your books")}
}
async function loadStatus(){
  try{const d=await api("status");budget=d.budget;hasClaude=!!d.claude;store.set("bc-budget",budget);store.set("bc-claude",hasClaude)}catch(e){}
}
function budgetText(){
  if(!hasClaude)return "Photo reading by Claude is off: no Anthropic key in your Google script.";
  if(!budget)return "";
  return `Claude this month: $${(+budget.spentUsd).toFixed(2)} of $${(+budget.budgetUsd).toFixed(2)} · ${budget.reads} of ${budget.maxReads} readings`;
}
const budgetLeft=()=>hasClaude&&budget&&budget.spentUsd+0.03<=budget.budgetUsd&&budget.reads<budget.maxReads;

/* ---------- sheets (settings, add, form) ---------- */
const layer=$("#layer");
function closeSheet(){layer.innerHTML="";syncScroll()}
function syncScroll(){document.body.style.overflow=(layer.innerHTML||$(".book")||$(".cam")||$(".statsv"))?"hidden":""}
function sheet(html){
  layer.innerHTML=`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  syncScroll();
  const scrim=layer.firstElementChild;scrim.addEventListener("click",e=>{if(e.target===scrim)closeSheet()});
  const s=scrim.firstElementChild;$$("[data-close]",s).forEach(x=>x.onclick=closeSheet);return s;
}
document.addEventListener("keydown",e=>{if(e.key!=="Escape"||$(".cam"))return;if(layer.innerHTML)closeSheet();else if($(".book"))closeBook();else if($(".statsv"))closeStats()});

function openSettings(){
  const s=sheet(`
   <div class="sheet-head"><div><h2>Settings</h2><div class="sub">${conn?"This phone is connected to your Google Sheet.":"Connect this phone to your Google Sheet."}</div></div><button class="x" data-close aria-label="Close">×</button></div>
   ${conn?`<div class="card stack"><p class="okline small">Connected. ${books.length} books loaded.</p><p class="budgetline">${esc(budgetText())}</p></div>`:""}
   <div class="stack">
     <label class="sectlabel" for="codeIn">${conn?"Replace connection code":"Connection code"}</label>
     <textarea id="codeIn" class="codebox" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="BC1.…"></textarea>
     <p class="small muted">Find it in your Google script: run <span class="mono">showConnectionCode</span> and copy the line that starts with BC1. Treat it like a password.</p>
     <p class="small" id="codeMsg"></p>
     <div class="actions" id="setActs">${conn?`<button class="btn danger left" id="forgetBtn">Disconnect this phone</button>`:""}<button class="btn primary" id="connectGo">Connect</button></div>
   </div>
   ${conn?`<div class="actions"><button class="btn" id="reloadBtn">Reload books</button></div>`:""}`);
  const msg=$("#codeMsg",s);
  $("#connectGo",s).onclick=async()=>{
    msg.className="small";
    let c;try{c=parseCode($("#codeIn",s).value)}catch(e){msg.className="small err";msg.textContent=e.message;return}
    msg.textContent="Checking…";
    try{const d=await api("status",{},c);conn=c;store.set("bc-conn",conn);budget=d.budget;hasClaude=!!d.claude;store.set("bc-budget",budget);store.set("bc-claude",hasClaude);
      closeSheet();toast("Connected");books=[];render();loadBooks();}
    catch(e){msg.className="small err";msg.textContent=e.message}
  };
  if(conn){
    $("#forgetBtn",s).onclick=()=>{
      $("#setActs",s).innerHTML=`<div class="confirm"><span>Remove the connection and the saved book list from this phone? Your Google Sheet is not touched.</span><button class="btn" id="fNo">Keep</button><button class="btn dangerfill" id="fYes">Disconnect</button></div>`;
      $("#fNo",s).onclick=()=>{closeSheet();openSettings()};
      $("#fYes",s).onclick=()=>{["bc-conn","bc-books","bc-budget","bc-claude"].forEach(store.del);conn=null;books=[];budget=null;hasClaude=false;photoCache.forEach(u=>URL.revokeObjectURL(u));photoCache.clear();closeSheet();closeBook();render();toast("Disconnected")};
    };
    $("#reloadBtn",s).onclick=()=>{closeSheet();loadBooks();loadStatus()};
  }
}

/* ---------- book page: large photo, spine band, details ---------- */
function closeBook(){const v=$(".book");if(v)v.remove();syncScroll()}
async function photoUrl(b){
  if(!b.hasPhoto)return null;
  if(photoCache.has(b.id))return photoCache.get(b.id);
  const d=await api("photo_get",{id:b.id});
  if(!d.image)return null;
  const bin=atob(d.image);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  const url=URL.createObjectURL(new Blob([arr],{type:"image/jpeg"}));photoCache.set(b.id,url);return url;
}
function setCachedPhoto(id,blob){if(photoCache.has(id))URL.revokeObjectURL(photoCache.get(id));photoCache.set(id,URL.createObjectURL(blob))}

function openBook(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  closeBook();
  const sp=spineOf(b);
  const fact=(k,v,s)=>v?`<div class="fact"><div class="k">${k}</div><div class="v">${esc(v)}</div>${s?`<div class="s">${esc(s)}</div>`:""}</div>`:"";
  const v=document.createElement("div");v.className="book";v.setAttribute("role","dialog");v.setAttribute("aria-label",b.title);
  v.innerHTML=`<div class="book-inner ${sp.cls}">
    <div class="hero" id="hero">
      <div class="loading" id="heroInner">${b.hasPhoto?"Loading photo…":""}</div>
      <button class="over back" id="bkBack" aria-label="Back to shelves">${ICON.back}</button>
      <button class="over retake" id="bkPhoto">${ICON.cam}${b.hasPhoto?"Retake photo":"Add photo"}</button>
    </div>
    <div class="band ${sp.light?"light":""}">
      <div class="row"><span class="no">No. ${pad(b.id)}</span>${stars(b.rating)}</div>
      <h1>${esc(b.title)}</h1>
      <div class="by">${esc(b.author)}${b.series?` · ${esc(b.series)}${b.seriesNo!==""?` #${esc(b.seriesNo)}`:""}`:""}</div>
      <div class="row start"><span class="pill">${esc(statusLabel(b.status||"TBR"))}</span>${b.priority?`<span class="pill prio">High priority</span>`:""}${b.dateRead&&b.dateRead!=="Not registered"?`<span class="by">Read ${esc(b.dateRead)}</span>`:""}</div>
    </div>
    <div class="book-body">
      ${b.comments?`<p class="quote">“${esc(b.comments)}”</p>`:""}
      <div class="facts">
        ${fact("Genre",b.genre,b.subgenre)}
        ${fact("Edition",[b.publisher,b.editionYear].filter(Boolean).join(", "),[b.cover,b.special].filter(Boolean).join(" · "))}
        ${fact("First published",b.firstYear?String(b.firstYear):"",b.firstPublisher)}
        ${fact("Language",b.language,b.isbn?"ISBN "+b.isbn:"")}
      </div>
      ${b.awards?`<div class="award">${ICON.award}<span>${esc(b.awards)}</span></div>`:""}
      <div id="delArea"></div>
      <div class="actions"><button class="btn danger" id="bkDel">Delete</button><button class="btn primary" id="bkEdit">Edit book</button></div>
    </div></div>`;
  document.body.append(v);syncScroll();
  $("#bkBack",v).onclick=closeBook;
  $("#bkEdit",v).onclick=()=>openForm(b);
  $("#bkPhoto",v).onclick=()=>openCamera({steps:COVER_STEPS,max:1},async r=>{
    if(!r.photos.length)return;
    const btn=$("#bkPhoto",v);btn.disabled=true;btn.innerHTML=`${ICON.cam}<span>Saving photo…</span>`;
    try{
      const img=await blobToB64(r.photos[0].blob);
      const d=await api("photo_set",{id:b.id,image:img});
      setCachedPhoto(b.id,r.photos[0].blob);upsertBook(d.book);toast("Photo saved");openBook(b.id);
    }catch(e){btn.disabled=false;handleApiError(e,"Couldn’t save the photo");openBook(b.id)}
  });
  $("#bkDel",v).onclick=()=>{
    const area=$("#delArea",v);
    area.innerHTML=`<div class="confirm"><span>Delete “${esc(b.title)}”? Its row in the Google Sheet${b.hasPhoto?" and its photo":""} will be removed.</span><button class="btn" id="dNo">Keep</button><button class="btn dangerfill" id="dYes">Delete</button></div>`;
    $("#dNo",v).onclick=()=>area.innerHTML="";
    $("#dYes",v).onclick=async e=>{e.target.disabled=true;
      try{await api("delete",{id:b.id});books=books.filter(x=>x.id!==b.id);store.set("bc-books",books);if(photoCache.has(b.id)){URL.revokeObjectURL(photoCache.get(b.id));photoCache.delete(b.id)}closeBook();render();toast("Deleted")}
      catch(err){e.target.disabled=false;handleApiError(err,"Couldn’t delete")}};
  };
  const inner=$("#heroInner",v);
  if(!b.hasPhoto){inner.className="empty";inner.innerHTML=`<div class="ghost">${esc(b.title)}</div><span class="small">No photo yet. Tap “Add photo” to photograph your copy.</span>`;return}
  photoUrl(b).then(url=>{
    if(!v.isConnected)return;
    if(url){const img=new Image();img.alt=`Photo of your copy of ${b.title}`;img.src=url;inner.replaceWith(img)}
    else{inner.className="empty";inner.innerHTML=`<div class="ghost">${esc(b.title)}</div><span class="small">The photo couldn’t be found. Tap “Retake photo”.</span>`}
  }).catch(e=>{if(v.isConnected){inner.textContent="Couldn’t load the photo.";if(e.code==="unauthorized")handleApiError(e)}});
}

/* ---------- add: choose how ---------- */
function openAddChoice(){
  const s=sheet(`
   <div class="sheet-head"><div><h2>Add a book</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   <div class="choice">
     <button class="btn primary" id="chCam">${ICON.cam.replace('width="18" height="18"','width="26" height="26"')}<span>Take photos<small>The camera opens here. Claude and the barcode fill in the details; the cover becomes the book’s photo.</small></span></button>
     <button class="btn" id="chType">${ICON.pen}<span>Type it in<small>Fill in the form yourself.</small></span></button>
   </div>
   <p class="budgetline">${esc(budgetText())}</p>`);
  $("#chCam",s).onclick=()=>{closeSheet();openCamera({steps:ADD_STEPS,max:MAX_PHOTOS},r=>openForm(null,r))};
  $("#chType",s).onclick=()=>openForm(null);
}

/* ---------- camera ---------- */
// crop (optional): the part of the source to keep, {sx,sy,sw,sh} in source pixels
async function shrink(source,w,h,crop){
  const r=crop||{sx:0,sy:0,sw:w,sh:h};
  const max=1568, sc=Math.min(1,max/Math.max(r.sw,r.sh));
  const c=document.createElement("canvas");c.width=Math.round(r.sw*sc);c.height=Math.round(r.sh*sc);
  c.getContext("2d").drawImage(source,r.sx,r.sy,r.sw,r.sh,0,0,c.width,c.height);
  let q=.85, blob;
  for(let i=0;i<3;i++){blob=await new Promise(r=>c.toBlob(r,"image/jpeg",q));if(blob&&blob.size<1000000)break;q-=.15}
  return {blob,canvas:c};
}
// The camera preview fills the screen ("cover"), so the saved photo must be cut to match:
// keep exactly what is inside the white guide frame on screen.
function frameCrop(video,frameEl){
  const vw=video.videoWidth,vh=video.videoHeight;
  const vr=video.getBoundingClientRect(),fr=frameEl.getBoundingClientRect();
  if(!vw||!vh||!vr.width||!fr.width)return null;
  const scale=Math.max(vr.width/vw,vr.height/vh);
  const offX=(vw*scale-vr.width)/2,offY=(vh*scale-vr.height)/2;
  let sx=(fr.left-vr.left+offX)/scale,sy=(fr.top-vr.top+offY)/scale,sw=fr.width/scale,sh=fr.height/scale;
  sx=Math.max(0,sx);sy=Math.max(0,sy);sw=Math.min(sw,vw-sx);sh=Math.min(sh,vh-sy);
  return sw>20&&sh>20?{sx,sy,sw,sh}:null;
}
function blobToB64(blob){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(",")[1]);fr.onerror=rej;fr.readAsDataURL(blob)})}
let detector=null;
async function getDetector(){
  if(detector!==null)return detector;
  try{if("BarcodeDetector" in window){const f=await window.BarcodeDetector.getSupportedFormats();if(f.includes("ean_13")){detector=new window.BarcodeDetector({formats:["ean_13"]});return detector}}}catch(e){}
  detector=false;return detector;
}
async function findIsbn(src){
  const d=await getDetector();if(!d)return "";
  try{const codes=await d.detect(src);return codes.map(c=>c.rawValue).find(v=>/^97[89]\d{10}$/.test(v))||""}catch(e){return ""}
}

function openCamera(opts,onDone){
  const steps=opts.steps, max=opts.max;
  const photos=[];let isbn="";let stream=null;let scanTimer=null;let closed=false;
  const root=document.createElement("div");root.className="cam";root.setAttribute("role","dialog");root.setAttribute("aria-label","Camera");
  root.innerHTML=`
   <div class="cam-top"><button class="x" id="camClose" aria-label="Close camera">×</button><div class="cam-step" id="camStep"></div><span class="x" aria-hidden="true"></span></div>
   <div class="cam-view"><video id="camVideo" playsinline muted autoplay></video><div class="cam-frame" id="camFrame" hidden></div><div class="cam-chip" id="camChip" hidden></div><div class="flash" id="camFlash"></div><div class="cam-msg" id="camMsg"></div></div>
   <div class="cam-bottom"><div class="cam-thumbs" id="camThumbs"></div><button class="shutter" id="shutter" aria-label="Take photo" disabled></button><button class="cam-done" id="camDone" disabled>Done</button></div>`;
  document.body.append(root);syncScroll();
  const video=$("#camVideo",root), msg=$("#camMsg",root), shutter=$("#shutter",root), done=$("#camDone",root), stepEl=$("#camStep",root);
  const paintStep=()=>{const i=Math.min(photos.length,steps.length-1);
    stepEl.innerHTML=photos.length>=max?`All set<small>Tap Done</small>`:`${steps.length>1?(photos.length+1)+". ":""}${esc(steps[i][0])}<small>${esc(steps[i][1])}</small>`;
    $("#camThumbs",root).innerHTML=photos.map((p,i)=>`<img src="${p.url}" alt="Photo ${i+1}">`).join("");
    done.disabled=!photos.length;shutter.disabled=!stream||photos.length>=max};
  const showIsbn=()=>{const chip=$("#camChip",root);chip.textContent=`Barcode read: ${isbn}`;chip.hidden=!isbn};
  const stop=()=>{clearInterval(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null};
  const close=()=>{if(closed)return;closed=true;stop();root.remove();syncScroll()};
  $("#camClose",root).onclick=()=>{photos.forEach(p=>URL.revokeObjectURL(p.url));close()};
  done.onclick=()=>{close();onDone({photos,isbn})};
  const addBlob=blob=>{photos.push({blob,url:URL.createObjectURL(blob)});paintStep()};
  const fallbackHtml=`<label class="btn">Use the phone’s camera app instead<input type="file" accept="image/*" capture="environment" id="camFile" hidden></label>`;
  const wireFallback=()=>{const f=$("#camFile",root);if(!f)return;f.onchange=async()=>{const file=f.files[0];f.value="";if(!file||photos.length>=max)return;
    try{const bmp=await createImageBitmap(file);const {blob,canvas}=await shrink(bmp,bmp.width,bmp.height);if(!isbn&&max>1){isbn=await findIsbn(canvas);showIsbn()}addBlob(blob)}catch(e){toast("That photo couldn’t be used.")}}};

  async function start(){
    msg.innerHTML=`<div class="stack"><p>Starting the camera…</p></div>`;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
      if(closed){stop();return}
      store.set("bc-cam-ok",true); // allowed once: next time open straight away
      video.srcObject=stream;await video.play().catch(()=>{});
      msg.innerHTML="";msg.hidden=true;$("#camFrame",root).hidden=false;paintStep();
      if(max>1&&await getDetector()){scanTimer=setInterval(async()=>{if(isbn||!video.videoWidth)return;const v=await findIsbn(video);if(v){isbn=v;showIsbn();if(navigator.vibrate)navigator.vibrate(60)}},450)}
    }catch(e){
      stream=null;paintStep();msg.hidden=false;
      if(e&&(e.name==="NotAllowedError"||e.name==="SecurityError")){
        store.del("bc-cam-ok");
        msg.innerHTML=`<div class="stack"><p><strong>Camera access is blocked.</strong></p><p class="small">To allow it: iPhone → Settings › Safari › Camera › Allow (or tap “aA” in the address bar › Website Settings). Android → tap the icon left of the address › Permissions › Camera › Allow. Then close and reopen the camera.</p>${fallbackHtml}</div>`;
      }else if(e&&e.name==="NotFoundError"){
        msg.innerHTML=`<div class="stack"><p>No camera was found on this device.</p>${fallbackHtml}</div>`;
      }else{
        msg.innerHTML=`<div class="stack"><p>The camera couldn’t start${e&&e.name?" ("+esc(e.name)+")":""}.</p>${fallbackHtml}</div>`;
      }
      wireFallback();
    }
  }
  shutter.onclick=async()=>{
    if(!stream||!video.videoWidth||photos.length>=max)return;
    shutter.disabled=true;
    const fl=$("#camFlash",root);fl.classList.remove("on");void fl.offsetWidth;fl.classList.add("on");
    try{if(!isbn&&max>1){const v=await findIsbn(video);if(v){isbn=v;showIsbn()}}const {blob}=await shrink(video,video.videoWidth,video.videoHeight,frameCrop(video,$("#camFrame",root)));addBlob(blob)}
    catch(e){toast("Couldn’t take the photo. Try again.")}
    paintStep();
  };
  paintStep();
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    msg.innerHTML=`<div class="stack"><p>This browser can’t show the camera inside the app${window.isSecureContext?"":" (the page must be opened over https)"}.</p>${fallbackHtml}</div>`;wireFallback();return;
  }
  (async()=>{
    let state="prompt";
    try{if(navigator.permissions&&navigator.permissions.query){state=(await navigator.permissions.query({name:"camera"})).state}}catch(e){}
    if(state==="granted"||(state!=="denied"&&store.get("bc-cam-ok",false))){start();return}
    msg.innerHTML=`<div class="stack"><p><strong>Allow the camera</strong></p><p class="small">Book Catalog uses your camera only to photograph the book. Your phone will ask for permission now; photos go only to your own Google script and Drive.</p><button class="btn primary big" id="camAllow">Allow camera</button>${fallbackHtml}</div>`;
    $("#camAllow",root).onclick=start;wireFallback();
  })();
}

/* ---------- catalog lookup (free) ---------- */
async function lookupIsbn(isbn){
  const d=String(isbn||"").replace(/[^0-9Xx]/g,"");if(!(d.length===10||d.length===13))return null;
  const year=s=>{const m=String(s||"").match(/\d{4}/);return m?m[0]:""};
  try{
    const r=await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${d}`,{credentials:"omit",referrerPolicy:"no-referrer"});
    const j=await r.json();const v=j&&j.items&&j.items[0]&&j.items[0].volumeInfo;
    if(v){const ids=v.industryIdentifiers||[];const i13=(ids.find(x=>x.type==="ISBN_13")||{}).identifier,i10=(ids.find(x=>x.type==="ISBN_10")||{}).identifier;
      return {title:v.title||"",author:(v.authors||[]).join(", "),publisher:v.publisher||"",editionYear:year(v.publishedDate),language:LANGS[v.language]||"",isbn:[i13,i10].filter(Boolean).join(", ")||d};}
  }catch(e){}
  try{
    const r=await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${d}&format=json&jscmd=data`,{credentials:"omit",referrerPolicy:"no-referrer"});
    const j=await r.json();const v=j&&j["ISBN:"+d];
    if(v){const ids=v.identifiers||{};
      return {title:v.title||"",author:(v.authors||[]).map(a=>a.name).join(", "),publisher:((v.publishers||[])[0]||{}).name||"",editionYear:year(v.publish_date),isbn:[(ids.isbn_13||[])[0],(ids.isbn_10||[])[0]].filter(Boolean).join(", ")||d};}
  }catch(e){}
  return null;
}

/* ---------- form ---------- */
const RANK={photo:3,catalog:2,knowledge:1};
const BADGE={photo:"photo",catalog:"catalog",knowledge:"check"};
function findDupe(r,selfId){
  const mine=isbnDigits(r.isbn);
  return books.find(b=>b.id!==selfId&&((mine.length&&isbnDigits(b.isbn).some(x=>mine.includes(x)))||(norm(b.title)&&norm(b.title)===norm(r.title)&&norm(b.author)===norm(r.author)&&norm(b.language)===norm(r.language))));
}
function datalist(id,vals){return `<datalist id="${id}">${vals.map(v=>`<option value="${esc(v)}"></option>`).join("")}</datalist>`}

function openForm(b,capture){
  const isNew=!b;const v=b?{...b}:{status:"TBR",rating:0};
  const uniq=k=>[...new Set(books.map(x=>x[k]).filter(Boolean).map(String))].sort();
  const inp=(k,label,cls="",extra="")=>`<div class="f ${cls}" data-f="${k}"><label for="i-${k}">${label}<span class="src"></span></label><input id="i-${k}" name="${k}" type="text" value="${esc(v[k]??"")}" autocomplete="off" ${extra}></div>`;
  const photos=capture?capture.photos:[];let coverIdx=photos.length?0:-1;
  const s=sheet(`
   <div class="sheet-head"><div><div class="eyebrow">${isNew?"New entry":"Editing No. "+pad(b.id)}</div><h2>${isNew?"Add a book":esc(b.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   ${photos.length?`<section class="photo">
     <div class="sectlabel">Your photos · tap one to make it the book’s photo</div>
     <div class="thumbs" id="thumbs">${photos.map((p,i)=>`<button type="button" class="thumb" data-i="${i}" aria-pressed="${i===0}" aria-label="Use photo ${i+1} as the book’s photo"><img src="${p.url}" alt=""><span class="lbl" ${i===0?"":"hidden"}>Cover</span></button>`).join("")}</div>
     <div class="progress" id="prog"></div>
     <div class="legend"><span><span class="badge photo">photo</span> read from your photos</span><span><span class="badge catalog">catalog</span> from the ISBN</span><span><span class="badge knowledge">check</span> Claude’s suggestion</span></div>
     <p class="budgetline" id="budgetLine">${esc(budgetText())}</p>
   </section>`:""}
   <form id="bookForm" novalidate>
    <fieldset class="fs"><legend>From the book</legend><div class="grid">
     ${inp("title","Title *","",'required')}
     ${inp("author","Author","h full-sm",'list="dl-author"')}
     <div class="f h full-sm" data-f="isbn"><label for="i-isbn">ISBN<span class="src"></span></label><div class="inrow"><input id="i-isbn" name="isbn" type="text" inputmode="numeric" value="${esc(v.isbn||"")}" autocomplete="off" placeholder="978…"><button type="button" class="btn" id="lookupBtn">Look up</button></div></div>
     ${inp("series","Series","h full-sm",'list="dl-series"')}
     ${inp("seriesNo","Series #","t",'inputmode="numeric"')}
     <div class="f t" data-f="cover"><label for="i-cover">Cover<span class="src"></span></label><select id="i-cover" name="cover"><option value=""></option><option>Paperback</option><option>Hardcover</option></select></div>
     ${inp("publisher","Publisher (this edition)","h full-sm",'list="dl-publisher"')}
     ${inp("editionYear","Edition year","t",'inputmode="numeric"')}
     ${inp("language","Language","t",'list="dl-language"')}
     ${inp("special","Special edition details","",'list="dl-special" placeholder="Sprayed edges, dust jacket, folded cover…"')}
    </div></fieldset>
    <fieldset class="fs"><legend>About the work</legend><div class="grid">
     ${inp("firstPublisher","First edition publisher","h full-sm",'list="dl-publisher"')}
     ${inp("firstYear","First edition year","t",'inputmode="numeric"')}
     ${inp("genre","Genre","t",'list="dl-genre"')}
     ${inp("subgenre","Subgenres","",'list="dl-sub" placeholder="Comma-separated, e.g. High Fantasy, Dragons"')}
     ${inp("awards","Awards","",'placeholder="Hugo 1990; Locus 1990"')}
    </div></fieldset>
    <fieldset class="fs"><legend>My reading</legend><div class="grid">
     <div class="f"><span class="lbl">Status</span><div class="seg" id="segStatus">${["TBR","Reading","Read","DNF"].map(x=>`<button type="button" data-v="${x}" aria-pressed="${v.status===x}">${statusLabel(x)}</button>`).join("")}</div></div>
     <div class="f h full-sm"><span class="lbl">Rating</span><div class="rate" id="rate">${[1,2,3,4,5].map(n=>`<button type="button" data-n="${n}" aria-label="${n} star${n>1?"s":""}" class="${n<=(+v.rating||0)?"":"off"}">★</button>`).join("")}</div></div>
     ${inp("dateRead","Date read","h full-sm",'placeholder="YYYY-MM"')}
     <div class="f h full-sm"><label for="i-priority">Priority to read</label><select id="i-priority" name="priority"><option value="">Normal</option><option value="High">High</option></select></div>
     <div class="f"><label for="i-comments">Comments</label><textarea id="i-comments" name="comments">${esc(v.comments||"")}</textarea></div>
    </div></fieldset>
    ${datalist("dl-author",uniq("author"))}${datalist("dl-series",uniq("series"))}${datalist("dl-publisher",[...new Set([...uniq("publisher"),...uniq("firstPublisher")])].sort())}
    ${datalist("dl-language",[...new Set(["English","Portuguese",...uniq("language")])])}${datalist("dl-genre",[...new Set([...GENRES,...uniq("genre")])].sort())}${datalist("dl-sub",SUBGENRES)}${datalist("dl-special",uniq("special"))}
   </form>
   <div id="dupArea"></div>
   <div class="actions"><span class="small left" id="formStatus"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="saveBtn">${isNew?"Add to shelf":"Save changes"}</button></div>`);
  $("#i-cover",s).value=v.cover||"";
  $("#i-priority",s).value=v.priority==="High"?"High":"";
  let status=v.status||"TBR", rating=+v.rating||0;
  $("#segStatus",s).onclick=e=>{const btn=e.target.closest("button");if(!btn)return;status=btn.dataset.v;$$("#segStatus button",s).forEach(x=>x.setAttribute("aria-pressed",String(x===btn)))};
  $("#rate",s).onclick=e=>{const btn=e.target.closest("button");if(!btn)return;const n=+btn.dataset.n;rating=rating===n?0:n;$$("#rate button",s).forEach(x=>x.classList.toggle("off",+x.dataset.n>rating))};
  const thumbs=$("#thumbs",s);
  if(thumbs)thumbs.onclick=e=>{const t=e.target.closest(".thumb");if(!t)return;const i=+t.dataset.i;coverIdx=coverIdx===i?-1:i;
    $$(".thumb",thumbs).forEach(x=>{const on=+x.dataset.i===coverIdx;x.setAttribute("aria-pressed",String(on));$(".lbl",x).hidden=!on})};

  const dirty=new Set(), rank={};
  $$(".f[data-f] input,.f[data-f] select",s).forEach(el=>el.addEventListener("input",()=>{const f=el.closest(".f");dirty.add(f.dataset.f);f.classList.remove("src-photo","src-catalog","src-knowledge");$(".src",f).innerHTML=""}));
  const apply=(k,val,src)=>{
    if(val==null||val==="")return;val=String(val).trim();if(!val)return;
    const f=$(`.f[data-f="${k}"]`,s);if(!f||dirty.has(k))return;
    if((rank[k]||0)>=RANK[src])return;
    const el=$("input,select",f);
    if(el.tagName==="SELECT"&&![...el.options].some(o=>o.value===val))return;
    el.value=val;rank[k]=RANK[src];
    f.classList.remove("src-photo","src-catalog","src-knowledge");f.classList.add("src-"+src);
    $(".src",f).innerHTML=`<span class="badge ${src}">${BADGE[src]}</span>`;
  };
  const prog=$("#prog",s);
  const setProg=(key,state,text)=>{if(!prog)return;let row=$(`[data-p="${key}"]`,prog);if(!row){row=document.createElement("div");row.className="row";row.dataset.p=key;row.innerHTML=`<span class="dot"></span><span></span>`;prog.append(row)}
    $(".dot",row).className="dot "+state;row.lastElementChild.textContent=text};
  let lookedUp="";
  const runLookup=async isbn=>{
    const d=String(isbn||"").replace(/[^0-9Xx]/g,"");if(!d||d===lookedUp)return;lookedUp=d;
    setProg("cat","busy",`Looking up ISBN ${d}…`);
    const c=await lookupIsbn(d);
    if(c){["title","author","publisher","editionYear","language","isbn"].forEach(k=>apply(k,c[k],"catalog"));setProg("cat","ok",`Found in the free book catalogs (ISBN ${d})`)}
    else setProg("cat","err",`ISBN ${d} isn’t in the free catalogs`);
  };
  $("#lookupBtn",s).onclick=async e=>{
    const d=isbnDigits($("#i-isbn",s).value)[0];const fs=$("#formStatus",s);
    if(!d){fs.textContent="Type a 10- or 13-digit ISBN first.";return}
    e.target.disabled=true;fs.textContent="Looking up…";
    const c=await lookupIsbn(d);e.target.disabled=false;
    if(!c){fs.textContent="Not found in the free catalogs.";return}
    ["title","author","publisher","editionYear","language"].forEach(k=>{const el=$(`#i-${k}`,s);if(el&&!el.value.trim())apply(k,c[k],"catalog")});
    fs.textContent="Filled what the catalog knows.";
  };

  if(photos.length){
    (async()=>{
      if(capture.isbn){apply("isbn",capture.isbn,"photo");runLookup(capture.isbn)}
      if(!hasClaude){setProg("ai","err","Claude photo reading is off (no Anthropic key in your Google script).");return}
      if(!budgetLeft()){setProg("ai","err","Monthly Claude limit reached. Fill in the rest by hand, or raise the limit in your Google script.");return}
      setProg("ai","busy","Claude is reading your photos… (about 10–30 seconds)");
      try{
        const images=await Promise.all(photos.map(p=>blobToB64(p.blob)));
        const d=await api("read",{images});
        const r=d.result||{};const from=r.from||{};
        Object.keys(r).forEach(k=>{if(k!=="from")apply(k,r[k],from[k]==="photo"?"photo":"knowledge")});
        if(d.budget){budget=d.budget;store.set("bc-budget",budget);const bl=$("#budgetLine",s);if(bl)bl.textContent=budgetText()}
        setProg("ai","ok",`Claude read the photos${d.costUsd?` (cost about $${(+d.costUsd).toFixed(3)})`:""}. Check the highlighted fields.`);
        if(r.isbn&&!lookedUp)runLookup(isbnDigits(r.isbn)[0]);
      }catch(e){
        if(e.budget){budget=e.budget;store.set("bc-budget",budget)}
        setProg("ai","err",e.code==="unauthorized"?"Access key not accepted. Reconnect in Settings.":(e.message||"Claude couldn’t read the photos."));
      }
    })();
  }

  let force=false;
  $("#saveBtn",s).onclick=async()=>{
    const fd=Object.fromEntries(new FormData($("#bookForm",s)).entries());
    for(const k in fd)fd[k]=String(fd[k]).trim();
    const fs=$("#formStatus",s);fs.classList.remove("err");
    if(!fd.title){fs.textContent="Add a title before saving.";fs.classList.add("err");$("#i-title",s).focus();return}
    const rec={...(b||{}),...fd,status,rating,id:b?b.id:0};delete rec.hasPhoto;
    if(!force){
      const dupe=findDupe(rec,b?b.id:null);
      if(dupe){$("#dupArea",s).innerHTML=`<div class="warn"><span>This looks like a book you already have: <strong>No. ${pad(dupe.id)} · ${esc(dupe.title)}</strong> (${esc([dupe.publisher,dupe.editionYear,dupe.cover].filter(Boolean).join(", "))}).</span><div class="actions"><button class="btn" id="dupOpen">Open it</button><button class="btn primary" id="dupSave">Save anyway</button></div></div>`;
        $("#dupOpen",s).onclick=()=>{closeSheet();openBook(dupe.id)};$("#dupSave",s).onclick=()=>{force=true;$("#saveBtn",s).click()};return}
    }
    const btn=$("#saveBtn",s);btn.disabled=true;fs.textContent="Saving to your Google Sheet…";
    try{
      const d=await api("save",{book:rec});let saved=upsertBook(d.book);
      if(coverIdx>=0&&photos[coverIdx]){
        fs.textContent="Saving the photo to your Drive…";
        try{const pd=await api("photo_set",{id:saved.id,image:await blobToB64(photos[coverIdx].blob)});saved=upsertBook(pd.book);setCachedPhoto(saved.id,photos[coverIdx].blob)}
        catch(e){toast("Book saved, but the photo wasn’t: "+e.message)}
      }
      photos.forEach(p=>URL.revokeObjectURL(p.url));
      closeSheet();render();
      if(isNew){toast(`Added as No. ${pad(saved.id)}`)}else{toast("Saved");if($(".book"))openBook(saved.id)}
    }catch(e){btn.disabled=false;fs.textContent="";handleApiError(e,"Couldn’t save")}
  };
}


/* ---------- stats dashboard ---------- */
const sf={language:"",genre:"",cover:""};
function closeStats(){const v=$(".statsv");if(v)v.remove();syncScroll()}
function openStats(){
  closeStats();
  const v=document.createElement("div");v.className="statsv";v.setAttribute("role","dialog");v.setAttribute("aria-label","Stats");
  document.body.append(v);syncScroll();renderStats(v);
  v.addEventListener("click",e=>{
    if(e.target.closest("#stBack")){closeStats();return}
    const col=e.target.closest(".col");
    if(col){const box=col.closest(".vcard");$$(".col",box).forEach(c=>c.setAttribute("aria-pressed",String(c===col)));
      const info=$(".colinfo",box);const d=v._drills[+col.dataset.d];
      info.innerHTML=`<span><b>${esc(d.label)}</b>: ${d.list.length} book${d.list.length===1?"":"s"}</span>${d.list.length?`<button class="btn" data-d="${col.dataset.d}">Show books</button>`:""}`;return}
    const t=e.target.closest("[data-d]");if(!t)return;
    const d=v._drills[+t.dataset.d];if(d)openDrill(d.title,d.list);
  });
  v.addEventListener("change",e=>{const el=e.target.closest("[data-sf]");if(!el)return;sf[el.dataset.sf]=el.value;renderStats(v)});
}
function openDrill(title,list){
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${list.length} book${list.length===1?"":"s"}</div><h2>${esc(title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   <div class="drill">${list.length?`<div class="shelf">${list.map(spineHtml).join("")}</div>`:`<p class="muted">No books here.</p>`}</div>`);
  $(".drill",s).onclick=e=>{const sp=e.target.closest(".spine");if(sp){closeSheet();openBook(+sp.dataset.id)}};
}
function renderStats(v){
  const base=books.filter(b=>(!sf.language||b.language===sf.language)&&(!sf.genre||b.genre===sf.genre)&&(!sf.cover||b.cover===sf.cover));
  const S=window.BCStats.compute(base);
  const drills=[];const reg=(title,list,label)=>{drills.push({title,list,label:label||title});return drills.length-1};
  const scope=[sf.language,sf.genre,sf.cover].filter(Boolean).join(" · ");
  const T=x=>scope?`${x} · ${scope}`:x;
  const pct=(a,b)=>b?Math.round(100*a/b):0;
  const uniq=k=>[...new Set(books.map(b=>b[k]).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
  const sel=(k,label,vals)=>`<select class="sel" data-sf="${k}" aria-label="${label}"><option value="">${label}: all</option>${vals.map(x=>`<option value="${esc(x)}" ${sf[k]===x?"selected":""}>${esc(x)}</option>`).join("")}</select>`;
  const segbar=(items,title,keyFn,labelFn)=>{const tot=items.reduce((s,x)=>s+x.value,0);const shown=items.filter(x=>x.value>0);
    const ids=shown.map(x=>reg(T(`${title}: ${labelFn(x)}`),base.filter(b=>keyFn(b)===x.key),labelFn(x)));
    return `<div class="segbar" role="img" aria-label="${esc(title)}">${shown.map((x,i)=>`<button class="sw${items.indexOf(x)+1}" data-grow="${x.value}" data-d="${ids[i]}" aria-label="${esc(labelFn(x))}: ${x.value}"></button>`).join("")}</div>
      <div class="vlegend">${shown.map((x,i)=>`<button data-d="${ids[i]}"><span class="dot sw${items.indexOf(x)+1}"></span>${esc(labelFn(x))} <b>${x.value}</b><span class="pct">${pct(x.value,tot)}%</span></button>`).join("")}</div>`};
  const hbars=(items,title,matchFn,opts={})=>{const max=Math.max(1,...items.map(x=>x.value));
    return `<div class="hbars">${items.map(x=>{const lab=x.label||String(x.key);const id=reg(T(`${title}: ${opts.dlabel?opts.dlabel(x):lab}`),base.filter(b=>matchFn(b,x)));
      return `<button class="hrow ${opts.cls||""}" data-d="${id}"><span class="lab">${esc(lab)}</span><span class="trk"><span class="fill" data-w="${(100*x.value/max).toFixed(1)}"></span></span><span class="num">${x.value}</span></button>`}).join("")}</div>`};
  const cols=(items,title,matchFn,hint)=>{const max=Math.max(1,...items.map(x=>x.value));
    return `<div class="cols">${items.map(x=>{const id=reg(T(`${title}: ${x.label}`),base.filter(b=>matchFn(b,x)),x.label);
      return `<button class="col ${x.value?"":"zero"}" data-d="${id}" aria-pressed="false" aria-label="${esc(x.label)}: ${x.value}"><span class="b" data-h="${(100*x.value/max).toFixed(1)}"></span></button>`}).join("")}</div>
      <div class="collabels" aria-hidden="true">${items.map(x=>`<span>${esc(x.label)}</span>`).join("")}</div>
      <div class="colinfo"><span class="muted">${hint}</span></div>`};
  const Y=window.BCStats.yearOf, firstShown=S.perYear.find(x=>x.key!=="earlier")?.key;
  const statusLbl=x=>statusLabel(x.key);
  const readCount=S.status[0].value, tbrCount=S.status[1].value;
  const idRead=reg(T("Read"),base.filter(b=>b.status==="Read")), idTbr=reg(T("To read"),base.filter(b=>b.status==="TBR")),
        idRated=reg(T("Rated books"),base.filter(b=>+b.rating>0).sort((a,b)=>b.rating-a.rating)), idAll=reg(T("All books"),base);
  const idUndated=reg(T("Read, no date recorded"),base.filter(b=>b.status==="Read"&&!Y(b.dateRead)));
  const idUp=reg(T("Up next: high priority"),S.upNext);

  v.innerHTML=`<div class="statsv-inner">
   <div class="statsv-head"><button class="roundbtn" id="stBack" aria-label="Back to shelves">${ICON.back}</button><div><div class="eyebrow">My shelves</div><h1>Stats</h1></div></div>
   <div class="vfilters">${sel("language","Language",uniq("language"))}${sel("genre","Genre",uniq("genre"))}${sel("cover","Format",uniq("cover"))}</div>
   ${!base.length?`<div class="notice"><strong>No books match</strong><span>Change the filters above.</span></div>`:`
   <div class="tiles">
     <button class="tile" data-d="${idAll}"><span class="k">Books</span><span class="v">${S.total}</span><span class="s">${S.readPct}% read</span></button>
     <button class="tile" data-d="${idRead}"><span class="k">Read</span><span class="v">${readCount}</span><span class="s">${S.status[2].value} reading now</span></button>
     <button class="tile" data-d="${idTbr}"><span class="k">To read</span><span class="v">${tbrCount}</span><span class="s">${S.upNext.length} high priority</span></button>
     <button class="tile" data-d="${idRated}"><span class="k">Average rating</span><span class="v">${S.ratedCount?S.avgRating.toFixed(1)+" ★":"–"}</span><span class="s">from ${S.ratedCount} rated book${S.ratedCount===1?"":"s"}</span></button>
   </div>
   <section class="vcard"><h2>Reading status</h2>${segbar(S.status,"Status",b=>b.status,statusLbl)}</section>
   <section class="vcard"><h2>Books read per year</h2><p class="sub">From the “Date read” field</p>
     ${cols(S.perYear,"Read in",(b,x)=>b.status==="Read"&&(x.key==="earlier"?(Y(b.dateRead)&&Y(b.dateRead)<firstShown):Y(b.dateRead)===x.key),"Tap a bar to see its books.")}
     ${S.undatedRead?`<button class="btn" data-d="${idUndated}">${S.undatedRead} read book${S.undatedRead===1?" has":"s have"} no date: add them</button>`:""}</section>
   <section class="vcard"><h2>Genres</h2>${hbars(S.genres,"Genre",(b,x)=>x.key==="__other"?x.keys.includes(b.genre):b.genre===x.key)}</section>
   <section class="vcard"><h2>My ratings</h2>${S.ratedCount?hbars(S.ratings,"Rated",(b,x)=>+b.rating===x.key,{cls:"stars",dlabel:x=>x.key+" stars"}):`<p class="vnote">No ratings yet.</p>`}</section>
   ${S.series.length?`<section class="vcard"><h2>Series progress</h2><p class="sub">Series with 3 or more of your books: read so far</p><div class="hbars">${S.series.map(x=>{const id=reg(T(x.key),base.filter(b=>b.series===x.key).sort((a,b)=>(parseFloat(a.seriesNo)||0)-(parseFloat(b.seriesNo)||0)));
       return `<button class="prow ${x.read===x.owned?"done":""}" data-d="${id}"><span class="top"><span>${esc(x.key)}</span><span>${x.read} of ${x.owned} read</span></span><span class="trk"><span class="fill" data-w="${(100*x.read/x.owned).toFixed(1)}"></span></span></button>`}).join("")}</div></section>`:""}
   <section class="vcard"><h2>Top authors</h2><p class="sub">By books you own</p>${hbars(S.authors,"Author",(b,x)=>b.author===x.key)}</section>
   <section class="vcard"><h2>The collection</h2><div class="twocol">
     <div class="mini"><h3>Language</h3>${segbar(S.languages.slice(0,4),"Language",b=>b.language,x=>String(x.key))}</div>
     <div class="mini"><h3>Format</h3>${segbar(S.covers.slice(0,4),"Format",b=>b.cover,x=>String(x.key))}</div>
   </div>${S.publishers.length?`<div class="mini"><h3>Top publishers</h3>${hbars(S.publishers,"Publisher",(b,x)=>b.publisher===x.key)}</div>`:""}</section>
   <section class="vcard"><h2>When they were first published</h2>${cols(S.decades,"First published",(b,x)=>window.BCStats.decadeKey(b.firstYear)===x.key,"Tap a bar to see its books.")}</section>
   <section class="vcard"><h2>Up next</h2><p class="sub">To read, marked high priority</p>
     ${S.upNext.length?`<div class="shelf upnext">${S.upNext.slice(0,5).map(spineHtml).join("")}</div>${S.upNext.length>5?`<button class="btn" data-d="${idUp}">Show all ${S.upNext.length}</button>`:""}`:`<p class="vnote">Nothing marked high priority.</p>`}</section>
   `}</div>`;
  v._drills=drills;
  $$("[data-w]",v).forEach(el=>el.style.width=el.dataset.w+"%");
  $$("[data-h]",v).forEach(el=>el.style.height=el.dataset.h+"%");
  $$("[data-grow]",v).forEach(el=>el.style.flexGrow=el.dataset.grow);
  $$(".upnext",v).forEach(sh=>sh.onclick=e=>{const sp=e.target.closest(".spine");if(sp){e.stopPropagation();openBook(+sp.dataset.id)}});
}

/* ---------- boot ---------- */
render();
if(conn){loadBooks();loadStatus()}
})();
