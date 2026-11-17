/* Book Catalog — phone web app (Shelf style).
   Talks only to: your Google Apps Script (books, photos, Claude) and the free Google Books / Open Library catalogs.
   No third-party scripts are loaded; the Content-Security-Policy in index.html enforces that. */
(() => {
'use strict';

const GENRES=["Biography","Dystopia","Fantasy","Fiction","Graphic Novel","Historical Fantasy","Historical Fiction","History, Non-Fiction","Literary Fiction","Manga","Manhua","Manwha","Non-Fiction","Romance","Science Books","Science Fiction","Travel Book"];
const SUBGENRES=["AGI","AI","Asian","BL","Children","Classic","Cyberpunk","Dark Academia","Dark Fantasy","Dragons","Faeries","Fantasy Adventure","Gods","Gothic","High Fantasy","Isekai","LitRPG","Medieval","Memoir","Mystery","Nature Powers","Other Civilizations","Other Worlds","Post-Apocalyptic","Romantsy","Shōjo","Shōnen","Soft-horror","Space","Special School","Trials","VRMMORPG","Vampires","Vitorian England","War","Witches","Witty","Wizzards","Xianxia","YA","Zombies"];
const STATUSES=["Reading","TBR","Read","DNF","Wishlist"];
const owned=b=>b.status!=="Wishlist";
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
const statusLabel=s=>s==="TBR"?"To read":s==="Wishlist"?"Wishlist":s;
const isbnDigits=s=>String(s||"").split(/[,;\s]+/).map(x=>x.replace(/[^0-9Xx]/g,"")).filter(x=>x.length===10||x.length===13);
const hash=s=>{let h=7;for(const c of String(s))h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)};
// Each book keeps the same spine colour and thickness every time.
const spineOf=b=>{const h=hash((b.title||"")+"|"+(b.author||""));const c=h%8;return {cls:`c${c} h${(h>>4)%4}${c===3?" light":""}`,light:c===3}};
const ICON={
  cam:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  back:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  award:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="9" r="5"/><path d="M9 13.5 8 21l4-2 4 2-1-7.5"/></svg>`,
  scan:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>`,
  sig:`<svg width="22" height="14" viewBox="0 0 30 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 14c3-1 5-9 7-9s-1 9 1 9 3-6 5-6-1 5 1 5 3-3 5-3 2 2 7 1"/></svg>`,
  star:`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`,
  pen:`<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`
};
let toastT;
function toast(msg){clearTimeout(toastT);let t=$(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.append(t)}t.textContent=msg;t.hidden=false;toastT=setTimeout(()=>t.hidden=true,Math.max(3000,msg.length*60))}

/* ---------- state ---------- */
let conn=store.get("bc-conn",null);
let books=store.get("bc-books",[]);
let budget=store.get("bc-budget",null);
let hasClaude=store.get("bc-claude",false);
const st={q:"",status:"",mark:"",genre:"",lang:"",sort:"id-desc",shown:60,...store.get("bc-view",{})};
st.q="";st.shown=60;
const saveView=()=>store.set("bc-view",{status:st.status,mark:st.mark,genre:st.genre,lang:st.lang,sort:st.sort});
const marksOf=b=>window.BCStats.marksOf(b.special);
const MARKS={special:{label:"Special",test:m=>m.special},signed:{label:"Signed",test:m=>!!m.signed}};
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
/* Search: little words are ignored, words match from their start, comments are not searched,
   and the best matches (the exact title first) come first. A short number matches a volume or catalogue number. */
const STOPWORDS=new Set(["a","an","the","of","and","or","to","in","on","for","o","os","as","e","de","do","da","dos","das","um","uma","em","no","na","nos","nas","com","por","el","la","los","las","y"]);
const wordsOf=s=>norm(s).split(/[^a-z0-9]+/).filter(Boolean);
function searchScore(b,q){
  let terms=q.split(/\s+/).filter(Boolean);
  const content=terms.filter(t=>!STOPWORDS.has(t));if(content.length)terms=content;
  const title=norm(b.title), tw=wordsOf(b.title);
  const pw=wordsOf([b.title,b.author,b.series,b.publisher,b.location].join(" "));
  const mk=marksOf(b);
  const ew=wordsOf([b.genre,b.subgenre,b.special,mk.special?"special edition":"",mk.signed].join(" "));
  const vols=String(b.seriesNo??"").split(/[,;&]/).map(x=>parseInt(x,10)).filter(n=>n>0);
  const isbns=String(b.isbn||"").replace(/[^0-9Xx,; ]/g,"").split(/[,;\s]+/).filter(Boolean);
  const qWords=q.replace(/[^a-z0-9 ]/g," ").trim().replace(/\s+/g," ");
  let inExtra=false, numHit=false;
  for(const t of terms){
    if(/^\d+$/.test(t)){
      if(t.length<=4){if(+b.id===+t||vols.includes(+t)){numHit=true;continue}return 0}
      if(isbns.some(x=>x.includes(t))){numHit=true;continue}return 0;
    }
    if(pw.some(w=>w.startsWith(t)))continue;
    if(ew.some(w=>w.startsWith(t))){inExtra=true;continue}
    return 0;
  }
  const textTerms=terms.filter(t=>!/^\d+$/.test(t));
  let score=inExtra?20:50;
  if(textTerms.length&&textTerms.every(t=>tw.some(w=>w.startsWith(t))))score=80;
  if(qWords&&title.replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").includes(qWords))score=100;
  if(numHit)score+=5;
  return score;
}
function filtered(){
  const q=norm(st.q).trim();
  let r=books.filter(b=>(st.status?b.status===st.status:owned(b))&&(!st.mark||!MARKS[st.mark]||MARKS[st.mark].test(marksOf(b)))&&(!st.genre||b.genre===st.genre)&&(!st.lang||b.language===st.lang));
  const by=f=>(a,b)=>norm(f(a)).localeCompare(norm(f(b)));
  const sorters={"id-desc":(a,b)=>b.id-a.id,"id-asc":(a,b)=>a.id-b.id,title:by(b=>b.title),author:by(b=>b.author),
    rating:(a,b)=>(+b.rating||0)-(+a.rating||0)||a.id-b.id,
    series:(a,b)=>norm(a.series||"~").localeCompare(norm(b.series||"~"))||(parseFloat(a.seriesNo)||0)-(parseFloat(b.seriesNo)||0)};
  const sorter=sorters[st.sort]||sorters["id-desc"];
  if(!q)return r.sort(sorter);
  const scored=r.map(b=>[b,searchScore(b,q)]).filter(x=>x[1]>0);
  return scored.sort((x,y)=>y[1]-x[1]||sorter(x[0],y[0])).map(x=>x[0]);
}
function renderChrome(){
  const counts={};books.forEach(b=>counts[b.status]=(counts[b.status]||0)+1);
  const nOwned=books.filter(owned).length;
  $("#tally").innerHTML=books.length?`<span><b>${nOwned}</b>books</span><span class="s-read"><b>${counts.Read||0}</b>read</span><span class="s-tbr"><b>${counts.TBR||0}</b>to read</span>`:"";
  $("#statusChips").innerHTML=[["","All",nOwned],...STATUSES.map(s=>[s,statusLabel(s),counts[s]||0])]
    .map(([v,l,n])=>`<button class="chip" data-status="${esc(v)}" aria-pressed="${st.status===v}">${esc(l)}<span class="n">${n}</span></button>`).join("")
    +`<span class="chipsep" aria-hidden="true"></span>`+Object.entries(MARKS).map(([k,m])=>{const n=books.filter(b=>owned(b)&&m.test(marksOf(b))).length;
      return `<button class="chip mark" data-mark="${k}" aria-pressed="${st.mark===k}">${k==="special"?ICON.star:ICON.sig}${m.label}<span class="n">${n}</span></button>`}).join("");
  const uniq=k=>[...new Set(books.map(b=>b[k]).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
  const fill=(sel,vals,label,cur)=>{const el=$(sel);el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");el.value=vals.includes(cur)?cur:""};
  fill("#fGenre",uniq("genre"),"All genres",st.genre);
  fill("#fLang",uniq("language"),"All languages",st.lang);
  $("#fSort").value=st.sort;
  $("#addBtn").hidden=!conn;
  $("#checkBtn").hidden=!conn;
  $("#statsBtn").hidden=!conn||!books.length;
  $("#twinBtn").hidden=!conn||!books.length;
}
let workCount=new Map();
function refreshWorkCount(){workCount=new Map();books.forEach(b=>{if(b.workId)workCount.set(b.workId,(workCount.get(b.workId)||0)+1)})}
const copiesOf=b=>b.workId?books.filter(x=>x.workId===b.workId).sort((a,c)=>a.id-c.id):[b];
function spineHtml(b){
  const sp=spineOf(b);
  const nCopies=b.workId?(workCount.get(b.workId)||0):0;
  const series=b.series?` · ${esc(b.series)}${b.seriesNo!==""&&b.seriesNo!=null?` #${esc(b.seriesNo)}`:""}`:"";
  const side=b.status==="Wishlist"?`<span class="tag wish">Wishlist</span>`:b.priority&&b.status!=="Read"?`<span class="tag prio">Priority</span>`
    :(+b.rating?stars(b.rating):(b.status?`<span class="tag">${esc(statusLabel(b.status))}</span>`:""));
  const mk=marksOf(b);
  const label=[mk.special?"special edition":"",mk.signed?mk.signed.toLowerCase():""].filter(Boolean).join(", ");
  return `<button class="spine ${sp.cls}${mk.special?" special":""}${mk.sprayed?" sprayed":""}" data-id="${+b.id}"${label?` aria-label="${esc(b.title)}, ${esc(label)}"`:""}>${mk.special?`<span class="foil" aria-hidden="true"></span>`:""}<span class="no">${pad(+b.id)}</span>
    <span class="txt"><span class="t">${esc(b.title)}${mk.signed?`<span class="sig" title="${esc(mk.signed)}">${ICON.sig}</span>`:""}</span><span class="a">${esc(b.author)}${series}${nCopies>1?` · ${nCopies} copies`:""}</span></span>${side}</button>`;
}
function renderList(){
  const list=$("#list");
  if(!conn){
    list.innerHTML=`<div class="notice"><strong>Connect your catalog</strong><span>Paste the connection code from your Google script once, and your books appear here.</span><button class="btn primary" id="connectBtn">Connect</button></div>`;
    $("#connectBtn").onclick=openSettings;$("#moreWrap").hidden=true;return;
  }
  if(!books.length){list.innerHTML=`<div class="notice"><strong>Loading your shelves…</strong><span>Fetching your books from your Google Sheet.</span></div>`;$("#moreWrap").hidden=true;return}
  const r=filtered();
  // A search inside one list (e.g. "Read") can hide the book you're looking for: say so, with a way out.
  let hidden=0;
  if(st.q.trim()&&(st.status||st.mark||st.genre||st.lang)){const keep={...st};Object.assign(st,{status:"",mark:"",genre:"",lang:""});
    const all=filtered().filter(b=>owned(b)||keep.status==="Wishlist"||b.status==="Wishlist");Object.assign(st,{status:keep.status,mark:keep.mark,genre:keep.genre,lang:keep.lang});
    hidden=all.filter(b=>!r.includes(b)).length}
  const hint=hidden?`<div class="hiddenhint"><span>${hidden} more match${hidden===1?"es":""} outside your filters</span><button class="btn" id="showAll">Search all books</button></div>`:"";
  const wire=()=>{const x=$("#showAll");if(x)x.onclick=()=>{st.status="";st.mark="";st.genre="";st.lang="";saveView();render()}};
  if(!r.length){list.innerHTML=`<div class="notice"><strong>No books match</strong><span>${hidden?"":"Try a different search or clear the filters."}</span>${hint}</div>`;$("#moreWrap").hidden=true;wire();return}
  list.innerHTML=`${hint}<div class="shelf">${r.slice(0,st.shown).map(spineHtml).join("")}</div>`;wire();
  $("#moreWrap").hidden=r.length<=st.shown;
  $("#moreBtn").textContent=`Show more (${r.length-st.shown} left)`;
}
function render(){refreshWorkCount();renderChrome();renderList();const sv=$(".statsv");if(sv)renderStats(sv)}

// While there is text in the search box, the header shrinks to the search row, so results stay visible above the phone keyboard.
$("#q").addEventListener("input",e=>{st.q=e.target.value;st.shown=60;document.body.classList.toggle("searching",!!st.q.trim());renderList();window.scrollTo(0,0)});
$("#statusChips").addEventListener("click",e=>{const c=e.target.closest(".chip");if(!c)return;
  if(c.dataset.mark)st.mark=st.mark===c.dataset.mark?"":c.dataset.mark;else st.status=c.dataset.status;st.shown=60;saveView();render()});
$("#fGenre").addEventListener("change",e=>{st.genre=e.target.value;st.shown=60;saveView();renderList()});
$("#fLang").addEventListener("change",e=>{st.lang=e.target.value;st.shown=60;saveView();renderList()});
$("#fSort").addEventListener("change",e=>{st.sort=e.target.value;saveView();renderList()});
$("#moreBtn").addEventListener("click",()=>{st.shown+=60;renderList()});
$("#list").addEventListener("click",e=>{const sp=e.target.closest(".spine");if(sp)openBook(+sp.dataset.id)});
$("#addBtn").addEventListener("click",openAddChoice);
$("#settingsBtn").addEventListener("click",openSettings);
$("#checkBtn").addEventListener("click",openCheck);
$("#statsBtn").addEventListener("click",()=>openStats());
$("#twinBtn").addEventListener("click",()=>openTwin());

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
function syncScroll(){document.body.style.overflow=(layer.innerHTML||$(".book")||$(".cam")||$(".statsv")||$(".twinv"))?"hidden":""}
function sheet(html){
  layer.innerHTML=`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  syncScroll();
  const scrim=layer.firstElementChild;scrim.addEventListener("click",e=>{if(e.target===scrim)closeSheet()});
  const s=scrim.firstElementChild;$$("[data-close]",s).forEach(x=>x.onclick=closeSheet);return s;
}
document.addEventListener("keydown",e=>{if(e.key!=="Escape"||$(".cam"))return;if(layer.innerHTML)closeSheet();else if($(".book"))closeBook();else if($(".statsv"))closeStats();else if($(".twinv"))closeTwin()});

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
      closeSheet();toast("Connected");books=[];render();loadBooks();loadTwin();}
    catch(e){msg.className="small err";msg.textContent=e.message}
  };
  if(conn){
    $("#forgetBtn",s).onclick=()=>{
      $("#setActs",s).innerHTML=`<div class="confirm"><span>Remove the connection and the saved book list from this phone? Your Google Sheet is not touched.</span><button class="btn" id="fNo">Keep</button><button class="btn dangerfill" id="fYes">Disconnect</button></div>`;
      $("#fNo",s).onclick=()=>{closeSheet();openSettings()};
      $("#fYes",s).onclick=()=>{["bc-conn","bc-books","bc-budget","bc-claude","bc-twin"].forEach(store.del);twin=null;conn=null;books=[];budget=null;hasClaude=false;photoCache.forEach(u=>URL.revokeObjectURL(u));photoCache.clear();closeSheet();closeBook();render();toast("Disconnected")};
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

function ribbonsHtml(b){
  const mk=marksOf(b);if(!mk.special&&!mk.signed)return "";
  const sp=mk.special?(/edition/i.test(mk.specialSeg)&&mk.specialSeg.length<=34?mk.specialSeg:"Special edition"):"";
  return `<div class="ribbons">${sp?`<span class="ribbon">${ICON.star}${esc(sp)}</span>`:""}${mk.signed?`<span class="ribbon">${ICON.sig}${esc(mk.signed)}</span>`:""}</div>`;
}
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
      ${ribbonsHtml(b)}
      <button class="over retake" id="bkPhoto">${ICON.cam}${b.hasPhoto?"Retake photo":"Add photo"}</button>
    </div>
    <div class="band ${sp.light?"light":""}">
      <div class="row"><span class="no">No. ${pad(b.id)}</span>${stars(b.rating)}</div>
      <h1>${esc(b.title)}</h1>
      <div class="by">${esc(b.author)}${b.series?` · ${esc(b.series)}${b.seriesNo!==""?` #${esc(b.seriesNo)}`:""}`:""}</div>
      ${readBarHtml(b)}
      <div class="row start"><span class="pill">${esc(statusLabel(b.status||"TBR"))}</span>${b.priority?`<span class="pill prio">High priority</span>`:""}${marksOf(b).sprayed?`<span class="pill edge">Sprayed edges</span>`:""}${b.dateRead&&b.dateRead!=="Not registered"?`<span class="by">Read ${esc(b.dateRead)}</span>`:""}</div>
    </div>
    <div class="book-body">
      ${b.comments?`<p class="quote">“${esc(b.comments)}”</p>`:""}
      <div class="facts">
        ${fact("Genre",b.genre,b.subgenre)}
        ${fact("Edition",[b.publisher,b.editionYear].filter(Boolean).join(", "),[b.cover,b.special].filter(Boolean).join(" · "))}
        ${fact("First published",b.firstYear?String(b.firstYear):"",b.firstPublisher)}
        ${fact("Language",b.language,b.isbn?"ISBN "+b.isbn:"")}
        ${isPlaced(b)?"":fact("Where it is",b.location,"")}
      </div>
      ${b.awards?`<div class="award">${ICON.award}<span>${esc(b.awards)}</span></div>`:""}
      ${whereHtml(b)}
      ${copiesHtml(b)}
      <div id="delArea"></div>
      <div class="actions"><button class="btn danger" id="bkDel">Delete</button><button class="btn primary" id="bkEdit">Edit book</button></div>
    </div></div>`;
  document.body.append(v);syncScroll();
  $("#bkBack",v).onclick=closeBook;
  $("#bkEdit",v).onclick=()=>openForm(b);
  wireWhere(v,b);
  const rb=$(".readbar",v);if(rb)rb.onclick=e=>{const x=e.target.closest("[data-act]");if(x)readAction(b,x.dataset.act,x)};
  const cp=$(".copies",v);
  if(cp)cp.onclick=e=>{
    const row=e.target.closest(".copyrow");if(row&&+row.dataset.id!==b.id){openBook(+row.dataset.id);return}
    if(e.target.closest("#cpLink"))openLinkPicker(b);
    if(e.target.closest("#cpUnlink"))unlinkCopy(b,e.target.closest("#cpUnlink"));
  };
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



/* ---------- one-tap reading ---------- */
const thisMonth=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")};
function readBarHtml(b){
  const btn=(act,label,cls="")=>`<button class="rbtn ${cls}" data-act="${act}">${label}</button>`;
  const s=b.status||"TBR";
  const html=s==="Wishlist"?btn("bought","I bought it","main")
    :s==="Reading"?btn("finish","Finished","main")+btn("dnf","Stopped reading")
    :(s==="TBR"||s==="DNF")?btn("start","Start reading","main")+(s==="TBR"?"":btn("finish","Finished")):"";
  return html?`<div class="readbar">${html}</div>`:"";
}
async function quickSave(b,changes){
  const rec={...b,...changes};delete rec.hasPhoto;
  const d=await api("save",{book:rec});return upsertBook(d.book);
}
async function readAction(b,act,btn){
  btn.disabled=true;
  try{
    if(act==="start"){await quickSave(b,{status:"Reading"});toast("Enjoy! Marked as reading");render();openBook(b.id)}
    else if(act==="dnf"){await quickSave(b,{status:"DNF"});toast("Marked as stopped (DNF)");render();openBook(b.id)}
    else if(act==="bought"){await quickSave(b,{status:"TBR"});render();toast("Moved to your shelves");openBook(b.id);openForm(books.find(x=>x.id===b.id))}
    else if(act==="finish"){const saved=await quickSave(b,{status:"Read",dateRead:thisMonth()});render();openBook(b.id);askRating(saved)}
  }catch(e){btn.disabled=false;handleApiError(e,"Couldn’t update")}
}
function askRating(b){
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">Finished · ${esc(thisMonth())}</div><h2>${esc(b.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <p>How was it?</p><div class="rate big" id="qRate">${[1,2,3,4,5].map(n=>`<button type="button" data-n="${n}" aria-label="${n} star${n>1?"s":""}" class="${n<=(+b.rating||0)?"":"off"}">★</button>`).join("")}</div>
    <div class="actions"><button class="btn" data-close>Skip</button></div>`);
  $("#qRate",s).onclick=async e=>{const x=e.target.closest("button");if(!x)return;const n=+x.dataset.n;
    $$("#qRate button",s).forEach(y=>y.classList.toggle("off",+y.dataset.n>n));
    try{await quickSave(books.find(y=>y.id===b.id)||b,{rating:n});closeSheet();render();toast(`Rated ${n} star${n>1?"s":""}`);openBook(b.id)}catch(err){handleApiError(err,"Couldn’t save the rating")}};
}

/* ---------- do I own this? ---------- */
const isbn13=d=>{d=String(d||"").replace(/[^0-9Xx]/g,"");if(d.length===13)return d;if(d.length!==10)return "";const c="978"+d.slice(0,9);let s=0;for(let i=0;i<12;i++)s+=(+c[i])*(i%2?3:1);return c+((10-s%10)%10)};
function sameIsbn(b,isbn){const want=isbn13(isbn);return want&&isbnDigits(b.isbn).some(x=>isbn13(x)===want)}
function openCheck(){
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">In a bookshop?</div><h2>Do I own this?</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <button class="btn primary big" id="ckScan">${ICON.scan}Scan the barcode</button>
    <div class="inrow"><input id="ckQ" class="field" type="search" autocomplete="off" placeholder="…or type an ISBN, title or author"><button class="btn" id="ckGo">Check</button></div>
    <div id="ckOut"></div>`);
  const out=$("#ckOut",s), q=$("#ckQ",s);
  const go=()=>runCheck(q.value,out);
  $("#ckGo",s).onclick=go;q.onkeydown=e=>{if(e.key==="Enter")go()};
  $("#ckScan",s).onclick=()=>openCamera({steps:[["Barcode","Fit it in the frame: it scans by itself"]],max:1,autoIsbn:true},async r=>{
    openCheck();const o=$("#ckOut");
    const fail=why=>{o.innerHTML=`<section class="card verdict no"><div class="vd">Couldn’t read the barcode</div><p class="small">${why}</p><div class="actions"><button class="btn" id="ckAgain">${ICON.scan}Try again</button></div></section>`;
      $("#ckAgain",o).onclick=()=>$("#ckScan").click();$("#ckQ").focus()};
    if(r.isbn){$("#ckQ").value=r.isbn;runCheck(r.isbn,o);return}
    if(!r.photos.length)return;
    if(!hasClaude||!budgetLeft()){fail("Hold the phone closer so the barcode fills the frame, in good light. Or type the ISBN (the number under the barcode) above.");return}
    o.innerHTML=`<p class="small muted">Reading the barcode from your photo… (about 10 seconds)</p>`;
    try{const d=await api("read",{images:[await blobToB64(r.photos[0].blob)]});const x=d.result||{};if(d.budget){budget=d.budget;store.set("bc-budget",budget)}
      const isbn=isbnDigits(x.isbn)[0];const qq=isbn||[x.title,x.author].filter(Boolean).join(" ");
      if(!qq){fail("The photo didn’t show a readable barcode or title. Hold the phone closer, in good light, or type the ISBN above.");return}
      $("#ckQ").value=qq;runCheck(qq,o)}
    catch(e){fail(esc(e.message)+" You can type the ISBN above instead.")}
  });
}
async function runCheck(raw,out){
  raw=String(raw||"").trim();if(!raw){out.innerHTML="";return}
  const S=window.BCStats;const digits=raw.replace(/[^0-9Xx]/g,"");
  const card=(cls,title,body)=>`<section class="card verdict ${cls}"><div class="vd">${title}</div>${body}</section>`;
  const shelf=list=>`<div class="shelf drill">${list.map(spineHtml).join("")}</div>`;
  const wire=()=>{$$(".drill",out).forEach(d=>d.onclick=e=>{const sp=e.target.closest(".spine");if(sp){closeSheet();openBook(+sp.dataset.id)}});
    const w=$("#ckWish",out);if(w)w.onclick=async()=>{w.disabled=true;try{const d=await api("save",{book:{...w._info,status:"Wishlist"}});upsertBook(d.book);render();toast("Added to your wishlist");runCheck(raw,out)}catch(e){w.disabled=false;handleApiError(e,"Couldn’t add")}};
    const a=$("#ckAdd",out);if(a)a.onclick=()=>openForm(null,null,a._info);};
  if(digits.length===10||digits.length===13){
    const exact=books.filter(b=>sameIsbn(b,digits));
    const own=exact.filter(owned), wish=exact.filter(b=>!owned(b));
    if(own.length){const all=[...new Map(own.flatMap(copiesOf).map(x=>[x.id,x])).values()];
      out.innerHTML=card("yes","✓ Yes, you own this edition",`<p class="small">${all.length>1?`You have ${all.length} copies of this book.`:"One copy, on your shelves."}</p>${shelf(all)}`);wire();return}
    if(wish.length){out.innerHTML=card("wish","♡ It’s on your wishlist",`${shelf(wish)}<p class="small muted">Open it and tap “I bought it” when you buy it.</p>`);wire();return}
    out.innerHTML=`<p class="small muted">Not found by ISBN in your catalog. Looking it up…</p>`;
    const info=await lookupIsbn(digits);
    if(info){const key=S.normT(S.workTitle(info.title)), au=S.normT(info.author);
      const other=books.filter(b=>owned(b)&&S.normT(S.workTitle(b.title))===key&&(!au||S.normT(b.author).includes(au.split(" ").pop())));
      const desc=`<p><b>${esc(info.title)}</b><br><span class="small muted">${esc([info.author,info.publisher,info.editionYear,info.language].filter(Boolean).join(" · "))}</span></p>`;
      if(other.length){out.innerHTML=card("maybe","≈ You own another edition",`${desc}${shelf(other)}<div class="actions"><button class="btn" id="ckWish">Add this edition to wishlist</button></div>`)}
      else out.innerHTML=card("no","✗ Not in your catalog",`${desc}<div class="actions"><button class="btn" id="ckWish">Add to wishlist</button><button class="btn primary" id="ckAdd">I’m buying it: add</button></div>`);
      const pre={title:info.title,author:info.author,publisher:info.publisher,editionYear:info.editionYear,language:info.language,isbn:[...new Set([digits,...isbnDigits(info.isbn)])].join(", ")};
      if($("#ckWish",out))$("#ckWish",out)._info=pre;if($("#ckAdd",out))$("#ckAdd",out)._info=pre;wire();return}
    out.innerHTML=card("no","✗ Not in your catalog",`<p class="small muted">ISBN ${esc(digits)} isn’t in the free book catalogs either.</p><div class="actions"><button class="btn primary" id="ckAdd">Add it by hand</button></div>`);
    $("#ckAdd",out)._info={isbn:digits,status:"Wishlist"};wire();return;
  }
  const t=norm(raw).split(/\s+/).filter(Boolean);
  const hits=books.filter(b=>{const h=norm([b.title,b.author,b.series].join(" "));return t.every(w=>h.includes(w))});
  if(hits.length){const own=hits.filter(owned);
    out.innerHTML=card(own.length?"yes":"wish",own.length?`✓ ${own.length} matching book${own.length>1?"s":""} on your shelves`:"♡ Only on your wishlist",shelf(hits.slice(0,30)));wire();return}
  out.innerHTML=card("no","✗ Nothing matches in your catalog",`<div class="actions"><button class="btn" id="ckAdd">Add to wishlist</button></div>`);
  $("#ckAdd",out)._info={title:raw,status:"Wishlist"};wire();
}

/* ---------- copies of the same book ---------- */
function copyLine(x){return [x.language,x.cover,x.publisher,x.editionYear,x.special].filter(Boolean).map(String).join(" · ")}
function copiesHtml(b){
  const g=copiesOf(b);
  const rows=g.length>1?g.map(x=>`<button class="copyrow ${x.id===b.id?"me":""}" data-id="${x.id}"><span class="no">${pad(x.id)}</span><span class="cl"><span class="ct">${esc(x.title)}</span><span class="cd">${esc(copyLine(x))}</span></span>${x.id===b.id?`<span class="tag">This copy</span>`:""}</button>`).join(""):"";
  return `<section class="card copies"><div class="sectlabel">${g.length>1?`${g.length} copies of this book`:"Copies"}</div>
    ${rows||`<p class="small muted">Only this copy is in your catalog.</p>`}
    <div class="actions"><button class="btn" id="cpLink">Link another copy</button>${g.length>1?`<button class="btn danger" id="cpUnlink">Unlink this copy</button>`:""}</div></section>`;
}
async function setWork(ids,workId){
  const d=await api("set_work",{ids,workId});
  d.books.forEach(upsertBook);render();return d.books;
}
async function linkCopies(a,b){
  const ga=copiesOf(a),gb=copiesOf(b);
  const all=[...new Map([...ga,...gb].map(x=>[x.id,x])).values()];
  const wid=a.workId||b.workId||("W"+Math.min(...all.map(x=>x.id)));
  const ids=all.filter(x=>x.workId!==wid).map(x=>x.id);
  if(ids.length)await setWork(ids,wid);
  return wid;
}
async function unlinkCopy(b,btn){
  const rest=copiesOf(b).filter(x=>x.id!==b.id);
  if(btn)btn.disabled=true;
  try{await setWork(rest.length===1?[b.id,rest[0].id]:[b.id],"");toast("Unlinked");openBook(b.id)}
  catch(e){if(btn)btn.disabled=false;handleApiError(e,"Couldn’t unlink")}
}
function openLinkPicker(b){
  const S=window.BCStats, mine=new Set(copiesOf(b).map(x=>x.id)), key=S.workKey(b);
  const cand=books.filter(x=>!mine.has(x.id));
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">Link a copy of</div><h2>${esc(S.workTitle(b.title))}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <label class="search" for="lkQ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="lkQ" type="search" autocomplete="off" placeholder="Search your books"></label>
    <p class="small muted" id="lkHint"></p><div class="drill" id="lkList"></div>`);
  const q=$("#lkQ",s);q.value=S.workTitle(b.title);
  const paint=()=>{const t=norm(q.value).trim().split(/\s+/).filter(Boolean);
    const likely=cand.filter(x=>S.workKey(x)===key);
    let list=t.length?cand.filter(x=>{const h=norm([x.title,x.author,x.isbn,x.publisher].join(" "));return t.every(w=>h.includes(w))}):cand;
    list=[...likely.filter(x=>list.includes(x)),...list.filter(x=>!likely.includes(x))].slice(0,40);
    $("#lkHint",s).textContent=likely.length?"Likely copies are listed first. Tap the copy to link.":"Tap the copy to link.";
    $("#lkList",s).innerHTML=list.length?`<div class="shelf">${list.map(spineHtml).join("")}</div>`:`<p class="muted small">No matching books.</p>`};
  q.oninput=paint;paint();
  $("#lkList",s).onclick=async e=>{const sp=e.target.closest(".spine");if(!sp)return;const other=books.find(x=>x.id===+sp.dataset.id);
    $("#lkHint",s).textContent="Linking…";
    try{await linkCopies(b,other);closeSheet();toast("Linked as copies of the same book");openBook(b.id)}catch(err){handleApiError(err,"Couldn’t link")}};
}
function openCopySuggestions(){
  const groups=window.BCStats.suggestCopies(books.filter(owned));
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${groups.length} possible group${groups.length===1?"":"s"}</div><h2>Link copies</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <p class="small muted">These books share the same original title, author and volume number. Untick any that aren’t copies of the same book (for example, a book split into two parts).</p>
    ${groups.map((g,i)=>`<label class="card sugg" for="sg${i}"><span class="sg-top"><input type="checkbox" id="sg${i}" data-i="${i}" checked><b>${esc(window.BCStats.workTitle(g[0].title))}</b><span class="muted small">${g.length} copies</span></span>
      ${g.map(x=>`<span class="sg-row"><span class="mono">${pad(x.id)}</span> ${esc(copyLine(x))}</span>`).join("")}</label>`).join("")||`<p class="muted">No unlinked copies found.</p>`}
    <div class="actions"><span class="small left" id="sgMsg"></span><button class="btn" data-close>Cancel</button>${groups.length?`<button class="btn primary" id="sgGo">Link selected</button>`:""}</div>`);
  const go=$("#sgGo",s);if(!go)return;
  go.onclick=async()=>{
    const pick=$$("input[data-i]",s).filter(x=>x.checked).map(x=>groups[+x.dataset.i]);
    if(!pick.length){$("#sgMsg",s).textContent="Tick at least one group.";return}
    go.disabled=true;let done=0;
    try{for(const g of pick){$("#sgMsg",s).textContent=`Linking ${done+1} of ${pick.length}…`;
        const wid=(g.find(x=>x.workId)||{}).workId||("W"+g[0].id);const ids=g.filter(x=>x.workId!==wid).map(x=>x.id);if(ids.length)await setWork(ids,wid);done++}
      closeSheet();toast(`Linked ${done} group${done===1?"":"s"} of copies`)}
    catch(e){go.disabled=false;handleApiError(e,`Linked ${done} of ${pick.length}, then stopped`)}
  };
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
  const steps=opts.steps||[["",""]], max=opts.max||1, ses=opts.session||null;
  const scanIsbn=(max>1||!!opts.autoIsbn)&&!opts.noIsbn;
  const photos=[];let isbn="";let stream=null;let scanTimer=null;let closed=false;let busyScan=false;
  const root=document.createElement("div");root.className="cam";root.setAttribute("role","dialog");root.setAttribute("aria-label","Camera");
  root.innerHTML=`
   <div class="cam-top"><button class="x" id="camClose" aria-label="Close camera">×</button><div class="cam-step" id="camStep"></div><button class="x camswitch" id="camSwitch" aria-label="Switch camera" tabindex="-1"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><path d="M9.5 12.5a2.5 2.5 0 0 1 4.6-1.4M14.5 13.5a2.5 2.5 0 0 1-4.6 1.4"/><path d="M14 10v1.5h-1.5M10 16v-1.5h1.5"/></svg></button></div>
   <div class="cam-view"><video id="camVideo" playsinline muted autoplay></video><div class="cam-frame ${opts.autoIsbn?"barcode":opts.frame==="full"?"full":""}" id="camFrame" hidden></div><div class="cam-chip" id="camChip" hidden></div><div class="flash" id="camFlash"></div><div class="focusring" id="camRing" hidden></div><div class="cam-msg" id="camMsg"></div></div>
   <div class="cam-bottom"><div class="cam-thumbs" id="camThumbs"></div><button class="shutter" id="shutter" aria-label="Take photo" disabled></button><button class="cam-done" id="camDone" disabled>Done</button></div>`;
  document.body.append(root);syncScroll();
  const video=$("#camVideo",root), msg=$("#camMsg",root), shutter=$("#shutter",root), done=$("#camDone",root), stepEl=$("#camStep",root);
  const paintStep=()=>{if(ses){const b=ses.current();
      stepEl.innerHTML=b?`No. ${pad(b.id)} · ${esc(b.title)}<small>${esc([b.author,b.location].filter(Boolean).join(" · "))} · ${ses.left()} left</small>`:`All done<small>Tap Finish</small>`;
      $("#camThumbs",root).innerHTML=`<button class="cam-skip" id="camSkip" ${b?"":"disabled"}>Skip</button><span class="cam-count">${esc(ses.status())}</span>`;
      const sk=$("#camSkip",root);if(sk)sk.onclick=()=>{ses.skip();paintStep()};
      done.disabled=false;done.textContent="Finish";shutter.disabled=!stream||!b;return}
    const i=Math.min(photos.length,steps.length-1);
    stepEl.innerHTML=photos.length>=max?`All set<small>Tap Done</small>`:`${steps.length>1?(photos.length+1)+". ":""}${esc(steps[i][0])}<small>${esc(steps[i][1])}</small>`;
    $("#camThumbs",root).innerHTML=photos.map((p,i)=>`<img src="${p.url}" alt="Photo ${i+1}">`).join("");
    done.disabled=!photos.length;done.hidden=!!opts.autoIsbn;shutter.disabled=!stream||photos.length>=max};
  const showIsbn=()=>{const chip=$("#camChip",root);chip.textContent=`Barcode read: ${isbn}`;chip.hidden=!isbn};
  const stop=()=>{clearInterval(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null};
  const close=()=>{if(closed)return;closed=true;stop();root.remove();syncScroll()};
  $("#camClose",root).onclick=()=>{photos.forEach(p=>URL.revokeObjectURL(p.url));close();if(ses)onDone({photos:[],isbn:""})};
  done.onclick=()=>{close();onDone({photos,isbn})};
  if(ses)ses.repaint=()=>{if(!closed)paintStep()};
  const addBlob=blob=>{photos.push({blob,url:URL.createObjectURL(blob)});paintStep()};
  // what is inside the white frame, as a small canvas (barcodes read better zoomed in)
  const frameCanvas=()=>{const r=frameCrop(video,$("#camFrame",root));if(!r)return video;const c=document.createElement("canvas");const sc=Math.min(1,1280/r.sw);
    c.width=Math.round(r.sw*sc);c.height=Math.round(r.sh*sc);c.getContext("2d").drawImage(video,r.sx,r.sy,r.sw,r.sh,0,0,c.width,c.height);return c};
  const fallbackHtml=`<label class="btn">Use the phone’s camera app instead<input type="file" accept="image/*" capture="environment" id="camFile" hidden></label>`;
  const wireFallback=()=>{const f=$("#camFile",root);if(!f)return;f.onchange=async()=>{const file=f.files[0];f.value="";if(!file||photos.length>=max)return;
    try{const bmp=await createImageBitmap(file);const {blob,canvas}=await shrink(bmp,bmp.width,bmp.height);if(!isbn&&scanIsbn){isbn=await findIsbn(canvas);showIsbn();if(isbn&&opts.autoIsbn){done.onclick();return}}addBlob(blob)}catch(e){toast("That photo couldn’t be used.")}}};


  // ----- choosing the lens and keeping it focused -----
  // Phones with several back cameras often give web pages the ultra-wide lens, which can't focus up close.
  // Prefer the main back camera, remember the choice, and let the person switch.
  const SIZE={width:{ideal:1920},height:{ideal:1080}};
  let backCams=[];
  const track=()=>stream&&stream.getVideoTracks()[0];
  async function listBack(){
    try{const all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput");
      const back=all.filter(d=>/back|rear|environment|traseira|trás/i.test(d.label));return back.length?back:all}catch(e){return []}
  }
  async function getStream(id){return navigator.mediaDevices.getUserMedia({audio:false,video:id?{deviceId:{exact:id},...SIZE}:{facingMode:{ideal:"environment"},...SIZE}})}
  async function keepFocus(){
    const t=track();if(!t||!t.getCapabilities)return;
    try{const c=t.getCapabilities();if(c.focusMode&&c.focusMode.includes("continuous"))await t.applyConstraints({advanced:[{focusMode:"continuous"}]})}catch(e){}
  }
  async function openStream(){
    const saved=store.get("bc-cam-id",null);
    let s0;
    try{s0=await getStream(saved)}catch(e){if(!saved)throw e;store.del("bc-cam-id");s0=await getStream(null)}
    stream=s0;
    backCams=await listBack();
    if(!saved&&backCams.length>1){
      // Android names lenses "camera2 0, facing back", "camera2 2, facing back"…: number 0 is the main one
      const main=backCams.find(d=>/\b0\b/.test(d.label))||backCams[0];
      const cur=track()&&track().getSettings?track().getSettings().deviceId:"";
      if(main&&main.deviceId&&main.deviceId!==cur){s0.getTracks().forEach(t=>t.stop());try{s0=await getStream(main.deviceId)}catch(e){s0=await getStream(null)}stream=s0}
    }
    const sw=$("#camSwitch",root);sw.classList.toggle("show",backCams.length>1);sw.tabIndex=backCams.length>1?0:-1;
    await keepFocus();
    return s0;
  }
  $("#camSwitch",root).onclick=async()=>{
    if(backCams.length<2||!stream)return;
    const cur=track().getSettings?track().getSettings().deviceId:"";
    const i=backCams.findIndex(d=>d.deviceId===cur);const next=backCams[(i+1)%backCams.length];
    stream.getTracks().forEach(t=>t.stop());
    try{stream=await getStream(next.deviceId);store.set("bc-cam-id",next.deviceId);video.srcObject=stream;await video.play().catch(()=>{});await keepFocus();
      toast(`Camera ${((i+1)%backCams.length)+1} of ${backCams.length}`)}
    catch(e){toast("That camera couldn’t start");stream=await getStream(null);video.srcObject=stream;await video.play().catch(()=>{})}
  };
  // tap the picture to focus there (where the phone supports it)
  video.addEventListener("click",async e=>{
    const t=track();if(!t)return;const r=video.getBoundingClientRect();
    const ring=$("#camRing",root);ring.hidden=false;ring.style.left=(e.clientX-r.left)+"px";ring.style.top=(e.clientY-r.top)+"px";
    ring.classList.remove("on");void ring.offsetWidth;ring.classList.add("on");setTimeout(()=>ring.hidden=true,900);
    try{const c=t.getCapabilities?t.getCapabilities():{};
      if(c.focusMode&&c.focusMode.includes("single-shot")){
        const x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
        await t.applyConstraints({advanced:[{pointsOfInterest:[{x,y}],focusMode:"single-shot"}]});setTimeout(keepFocus,1500)}
      else await keepFocus();
    }catch(err){}
  });

  async function start(){
    msg.innerHTML=`<div class="stack"><p>Starting the camera…</p></div>`;
    try{
      stream=await openStream();
      if(closed){stop();return}
      store.set("bc-cam-ok",true); // allowed once: next time open straight away
      video.srcObject=stream;await video.play().catch(()=>{});
      msg.innerHTML="";msg.hidden=true;$("#camFrame",root).hidden=false;paintStep();
      if(scanIsbn&&await getDetector()){let tick=0;scanTimer=setInterval(async()=>{if(isbn||!video.videoWidth||busyScan)return;busyScan=true;tick++;const v=await findIsbn(tick%2?frameCanvas():video);busyScan=false;if(v){isbn=v;showIsbn();if(navigator.vibrate)navigator.vibrate(60);if(opts.autoIsbn)setTimeout(()=>done.onclick(),400)}},450)}
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
    try{if(!isbn&&scanIsbn&&!ses){const v=await findIsbn(video);if(v){isbn=v;showIsbn()}}const {blob,canvas}=await shrink(video,video.videoWidth,video.videoHeight,frameCrop(video,$("#camFrame",root)));if(ses){ses.shot(blob);shutter.disabled=false;paintStep();return}if(!isbn&&scanIsbn){const v=await findIsbn(canvas);if(v){isbn=v;showIsbn()}}addBlob(blob);if(opts.autoIsbn){done.onclick();return}}
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

/* ---------- first edition, from the internet (free: Wikidata + Open Library) ---------- */
async function getJson(url,ms=9000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(url,{credentials:"omit",referrerPolicy:"no-referrer",signal:c.signal});return r.ok?await r.json():null}catch(e){return null}finally{clearTimeout(t)}
}
const yearIn=s=>{const m=String(s??"").match(/\b(1[0-9]{3}|20[0-9]{2})\b/);return m?+m[1]:0};
const nameWords=s=>norm(s).split(/[^a-z0-9]+/).filter(w=>w.length>=3);
const sameAuthor=(label,author)=>{const a=nameWords(author);if(!a.length)return true;const l=nameWords(label);return a.some(w=>l.includes(w))};
// "Os Pilares da Terra (The Pillars of the Earth)" → try the original title first, then the title as written.
function titleVariants(t){
  t=String(t||"").trim();const inner=(t.match(/\(([^()]{3,})\)?\s*$/)||[])[1];const main=t.replace(/\s*\(.*$/,"").trim();
  return [...new Set([inner&&inner.trim(),main].filter(Boolean))].slice(0,2);
}
async function wikidataFirst(title,author){
  for(const q of titleVariants(title)){
    const lit=q.replace(/[\\"]/g,"\\$&").replace(/\s+/g," ").slice(0,150);
    const sparql=`SELECT ?item ?date ?pubLabel ?authorLabel WHERE {
      SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search "${lit}"; mwapi:language "en". ?item wikibase:apiOutputItem mwapi:item. }
      ?item wdt:P50 ?author.
      FILTER NOT EXISTS { ?item wdt:P31 wd:Q3331189 }
      OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P123 ?pub }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,pt,mul". }
    } LIMIT 60`;
    const j=await getJson("https://query.wikidata.org/sparql?format=json&query="+encodeURIComponent(sparql));
    const rows=(j&&j.results&&j.results.bindings)||[];
    const items=new Map();
    for(const r of rows){
      const v=k=>r[k]&&r[k].value||"";
      if(!sameAuthor(v("authorLabel"),author))continue;
      const it=items.get(v("item"))||{year:0,pubs:new Set()};
      const y=yearIn(v("date"));if(y&&(!it.year||y<it.year))it.year=y;
      const pub=v("pubLabel");if(pub&&!/^Q\d+$/.test(pub))it.pubs.add(pub);
      items.set(v("item"),it);
    }
    const best=[...items.values()].filter(x=>x.year||x.pubs.size).sort((a,b)=>(a.year||9999)-(b.year||9999))[0];
    if(best)return {year:best.year||0,publisher:[...best.pubs].slice(0,2).join(" and "),source:"Wikidata"};
  }
  return null;
}
async function openLibraryFirst(isbn,title,author){
  const F="fields=key,title,first_publish_year,author_name&limit=5";
  let doc=null;
  if(isbn){const j=await getJson(`https://openlibrary.org/search.json?q=isbn:${isbn}&${F}`);doc=j&&j.docs&&j.docs[0]||null}
  if(!doc)for(const t of titleVariants(title)){
    const j=await getJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(t)}${author?`&author=${encodeURIComponent(author)}`:""}&${F}`);
    doc=(j&&j.docs||[]).find(d=>sameAuthor((d.author_name||[]).join(" "),author)&&d.first_publish_year)||null;if(doc)break;
  }
  if(!doc||!/^\/works\/OL\d+W$/.test(doc.key||""))return null;
  const year=+doc.first_publish_year||0;let publisher="";
  const e=await getJson(`https://openlibrary.org${doc.key}/editions.json?limit=100`);
  const eds=((e&&e.entries)||[]).map(x=>({y:yearIn(x.publish_date),p:(x.publishers||[])[0]||""})).filter(x=>x.y&&x.p);
  if(eds.length){
    const target=year&&eds.some(x=>x.y===year)?year:Math.min(...eds.map(x=>x.y));
    const n=new Map();eds.filter(x=>x.y===target).forEach(x=>n.set(x.p,(n.get(x.p)||0)+1));
    if(!year||target===year)publisher=[...n.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  }
  return (year||publisher)?{year,publisher,source:"Open Library"}:null;
}
// Wikidata knows the original publisher of well-known books; Open Library covers far more titles. Wikidata wins when both answer.
async function findFirstEdition({title,author,isbn}){
  const [wd,ol]=await Promise.all([wikidataFirst(title,author).catch(()=>null),openLibraryFirst(isbn,title,author).catch(()=>null)]);
  const year=(wd&&wd.year)||(ol&&ol.year)||0, publisher=(wd&&wd.publisher)||(ol&&ol.publisher)||"";
  if(!year&&!publisher)return null;
  const src=[...new Set([wd&&(wd.year||wd.publisher)?"Wikidata":"",ol&&((!(wd&&wd.year)&&ol.year)||(!(wd&&wd.publisher)&&ol.publisher))?"Open Library":""].filter(Boolean))];
  return {firstYear:year?String(year):"",firstPublisher:String(publisher).slice(0,200),source:src.join(" + ")};
}

/* ---------- form ---------- */
const RANK={photo:3,catalog:2,online:2,knowledge:1};
const BADGE={photo:"photo",catalog:"catalog",online:"online",knowledge:"check"};
function findDupe(r,selfId){
  const mine=isbnDigits(r.isbn);
  return books.find(b=>b.id!==selfId&&((mine.length&&isbnDigits(b.isbn).some(x=>mine.includes(x)))||(norm(b.title)&&norm(b.title)===norm(r.title)&&norm(b.author)===norm(r.author)&&norm(b.language)===norm(r.language))));
}
function datalist(id,vals){return `<datalist id="${id}">${vals.map(v=>`<option value="${esc(v)}"></option>`).join("")}</datalist>`}

function openForm(b,capture,pre){
  const isNew=!b;const v=b?{...b}:{status:"TBR",rating:0,...(pre||{})};
  const uniq=k=>[...new Set(books.map(x=>x[k]).filter(Boolean).map(String))].sort();
  const inp=(k,label,cls="",extra="")=>`<div class="f ${cls}" data-f="${k}"><label for="i-${k}">${label}<span class="src"></span></label><input id="i-${k}" name="${k}" type="text" value="${esc(v[k]??"")}" autocomplete="off" ${extra}></div>`;
  const photos=capture?capture.photos:[];let coverIdx=photos.length?0:-1;
  const s=sheet(`
   <div class="sheet-head"><div><div class="eyebrow">${isNew?"New entry":"Editing No. "+pad(b.id)}</div><h2>${isNew?"Add a book":esc(b.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   ${photos.length?`<section class="photo">
     <div class="sectlabel">Your photos · tap one to make it the book’s photo</div>
     <div class="thumbs" id="thumbs">${photos.map((p,i)=>`<button type="button" class="thumb" data-i="${i}" aria-pressed="${i===0}" aria-label="Use photo ${i+1} as the book’s photo"><img src="${p.url}" alt=""><span class="lbl" ${i===0?"":"hidden"}>Cover</span></button>`).join("")}</div>
     <div class="progress" id="prog"></div>
     <div class="legend"><span><span class="badge photo">photo</span> read from your photos</span><span><span class="badge catalog">catalog</span> from the ISBN</span><span><span class="badge online">online</span> found on the internet</span><span><span class="badge knowledge">check</span> Claude’s suggestion</span></div>
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
     <div class="f marks"><span class="lbl">Highlight this copy</span><div class="markrow">
       <button type="button" class="marktog" id="mkSpecial" aria-pressed="false">${ICON.star}Special edition</button>
       <label class="sigsel">${ICON.sig}<span class="vh">Signed</span><select id="mkSigned" aria-label="Signed"><option value="">Not signed</option>${window.BCStats.SIGNED_TYPES.map(t=>`<option>${esc(t)}</option>`).join("")}</select></label>
     </div></div>
    </div></fieldset>
    <fieldset class="fs"><legend>About the work</legend><div class="grid">
     <div class="f firstrow"><button type="button" class="btn" id="firstBtn">Find 1st edition online</button><span class="small" id="firstStatus" role="status"></span></div>
     ${inp("firstPublisher","First edition publisher","h full-sm",'list="dl-publisher"')}
     ${inp("firstYear","First edition year","t",'inputmode="numeric"')}
     ${inp("genre","Genre","t",'list="dl-genre"')}
     ${inp("subgenre","Subgenres","",'list="dl-sub" placeholder="Comma-separated, e.g. High Fantasy, Dragons"')}
     ${inp("awards","Awards","",'placeholder="Hugo 1990; Locus 1990"')}
    </div></fieldset>
    <fieldset class="fs"><legend>My reading</legend><div class="grid">
     <div class="f"><span class="lbl">Status</span><div class="seg" id="segStatus">${["TBR","Reading","Read","DNF","Wishlist"].map(x=>`<button type="button" data-v="${x}" aria-pressed="${v.status===x}">${statusLabel(x)}</button>`).join("")}</div></div>
     <div class="f h full-sm"><span class="lbl">Rating</span><div class="rate" id="rate">${[1,2,3,4,5].map(n=>`<button type="button" data-n="${n}" aria-label="${n} star${n>1?"s":""}" class="${n<=(+v.rating||0)?"":"off"}">★</button>`).join("")}</div></div>
     ${inp("dateRead","Date read","h full-sm",'placeholder="YYYY-MM"')}
     <div class="f h full-sm"><label for="i-priority">Priority to read</label><select id="i-priority" name="priority"><option value="">Normal</option><option value="High">High</option></select></div>
     ${inp("location","Where it is","",'list="dl-location" placeholder="Room, shelf…"')}
     <div class="f"><label for="i-comments">Comments</label><textarea id="i-comments" name="comments">${esc(v.comments||"")}</textarea></div>
    </div></fieldset>
    ${datalist("dl-author",uniq("author"))}${datalist("dl-series",uniq("series"))}${datalist("dl-publisher",[...new Set([...uniq("publisher"),...uniq("firstPublisher")])].sort())}
    ${datalist("dl-language",[...new Set(["English","Portuguese",...uniq("language")])])}${datalist("dl-genre",[...new Set([...GENRES,...uniq("genre")])].sort())}${datalist("dl-sub",SUBGENRES)}${datalist("dl-special",uniq("special"))}${datalist("dl-location",uniq("location"))}
   </form>
   <div id="dupArea"></div>
   <div class="actions"><span class="small left" id="formStatus"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="saveBtn">${isNew?"Add to shelf":"Save changes"}</button></div>`);
  $("#i-cover",s).value=v.cover||"";
  // The two highlight controls read and write the "Special edition details" text, so the Sheet stays readable.
  const spIn=$("#i-special",s), mkSp=$("#mkSpecial",s), mkSg=$("#mkSigned",s);
  const syncMarks=()=>{const m=window.BCStats.marksOf(spIn.value);mkSp.setAttribute("aria-pressed",String(m.special));mkSg.value=m.signed;mkSg.closest(".sigsel").classList.toggle("on",!!m.signed)};
  const setMarks=ch=>{spIn.value=window.BCStats.applyMarks(spIn.value,ch);spIn.dispatchEvent(new Event("input",{bubbles:true}));syncMarks()};
  mkSp.onclick=()=>setMarks({special:mkSp.getAttribute("aria-pressed")!=="true"});
  mkSg.onchange=()=>setMarks({signed:mkSg.value});
  spIn.addEventListener("input",syncMarks);syncMarks();
  $("#i-priority",s).value=v.priority==="High"?"High":"";
  let status=v.status||"TBR", rating=+v.rating||0;
  $("#segStatus",s).onclick=e=>{const btn=e.target.closest("button");if(!btn)return;status=btn.dataset.v;$$("#segStatus button",s).forEach(x=>x.setAttribute("aria-pressed",String(x===btn)))};
  $("#rate",s).onclick=e=>{const btn=e.target.closest("button");if(!btn)return;const n=+btn.dataset.n;rating=rating===n?0:n;$$("#rate button",s).forEach(x=>x.classList.toggle("off",+x.dataset.n>rating))};
  const thumbs=$("#thumbs",s);
  if(thumbs)thumbs.onclick=e=>{const t=e.target.closest(".thumb");if(!t)return;const i=+t.dataset.i;coverIdx=coverIdx===i?-1:i;
    $$(".thumb",thumbs).forEach(x=>{const on=+x.dataset.i===coverIdx;x.setAttribute("aria-pressed",String(on));$(".lbl",x).hidden=!on})};

  const dirty=new Set(), rank={};
  $$(".f[data-f] input,.f[data-f] select",s).forEach(el=>el.addEventListener("input",()=>{const f=el.closest(".f");dirty.add(f.dataset.f);f.classList.remove("src-photo","src-catalog","src-online","src-knowledge");$(".src",f).innerHTML=""}));
  const apply=(k,val,src)=>{
    if(val==null||val==="")return;val=String(val).trim();if(!val)return;
    const f=$(`.f[data-f="${k}"]`,s);if(!f||dirty.has(k))return;
    if((rank[k]||0)>=RANK[src])return;
    const el=$("input,select",f);
    if(el.tagName==="SELECT"&&![...el.options].some(o=>o.value===val))return;
    el.value=val;rank[k]=RANK[src];
    f.classList.remove("src-photo","src-catalog","src-online","src-knowledge");f.classList.add("src-"+src);
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
    if(isNew)runFirst(true);
  };
  // First edition year and publisher: what the photos show wins; otherwise it's looked up online (free).
  let firstKey="",firstSeq=0;
  const runFirst=async auto=>{
    const val=k=>($(`#i-${k}`,s)||{}).value?.trim()||"";
    const title=val("title"),author=val("author"),isbn=isbnDigits(val("isbn"))[0]||"";
    const fst=$("#firstStatus",s);
    if(!title&&!isbn){if(!auto)fst.textContent="Add the title (or ISBN) first.";return}
    // Fill only what's empty or just a guess; never touch what you typed or what the photos show.
    const open=k=>!dirty.has(k)&&(rank[k]?rank[k]<RANK.online:!val(k));
    const need=["firstYear","firstPublisher"].filter(open);
    if(auto&&!need.length)return;
    const key=[title,author,isbn].join("|");if(auto&&key===firstKey)return;firstKey=key;
    const seq=++firstSeq;
    fst.textContent="Looking up the first edition online…";setProg("first","busy","Looking up the first edition online…");
    const r=await findFirstEdition({title,author,isbn});
    if(seq!==firstSeq||!s.isConnected)return;
    if(!r){fst.textContent="Not found online. Fill it in by hand if you know it.";setProg("first","err","First edition not found online");return}
    const filled=["firstYear","firstPublisher"].filter(k=>open(k)&&r[k]);filled.forEach(k=>apply(k,r[k],"online"));
    const what=[r.firstYear,r.firstPublisher].filter(Boolean).join(", ");
    fst.textContent=`Found online (${r.source}): ${what}${!filled.length?" · your values were kept":filled.length<2&&need.length<2?" · only the empty field was filled":""}`;
    setProg("first","ok",`First edition found online (${r.source}): ${what}`);
  };
  $("#firstBtn",s).onclick=()=>runFirst(false);
  if(isNew){let t;["title","author"].forEach(k=>$(`#i-${k}`,s).addEventListener("change",()=>{clearTimeout(t);t=setTimeout(()=>runFirst(true),300)}))}
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
        if(r.isbn&&!lookedUp)runLookup(isbnDigits(r.isbn)[0]);else runFirst(true);
      }catch(e){
        if(e.budget){budget=e.budget;store.set("bc-budget",budget)}
        setProg("ai","err",e.code==="unauthorized"?"Access key not accepted. Reconnect in Settings.":(e.message||"Claude couldn’t read the photos."));
      }
    })();
  }

  let force=false, copyOf=null, buyInto=null;
  $("#saveBtn",s).onclick=async()=>{
    const fd=Object.fromEntries(new FormData($("#bookForm",s)).entries());
    for(const k in fd)fd[k]=String(fd[k]).trim();
    const fs=$("#formStatus",s);fs.classList.remove("err");
    if(!fd.title){fs.textContent="Add a title before saving.";fs.classList.add("err");$("#i-title",s).focus();return}
    const rec={...(b||{}),...fd,status,rating,id:b?b.id:0};delete rec.hasPhoto;
    if(!force){
      const dupe=findDupe(rec,b?b.id:null);
      if(dupe&&dupe.status==="Wishlist"){$("#dupArea",s).innerHTML=`<div class="warn"><span>This book is on your wishlist: <strong>No. ${pad(dupe.id)} · ${esc(dupe.title)}</strong>. Bought it?</span><div class="actions"><button class="btn" id="dupSave">Save as a separate book</button><button class="btn primary" id="dupBuy">Move it to my shelves</button></div></div>`;
        $("#dupSave",s).onclick=()=>{force=true;$("#saveBtn",s).click()};$("#dupBuy",s).onclick=()=>{force=true;buyInto=dupe;$("#saveBtn",s).click()};return}
      if(dupe){$("#dupArea",s).innerHTML=`<div class="warn"><span>This looks like a book you already have: <strong>No. ${pad(dupe.id)} · ${esc(dupe.title)}</strong> (${esc([dupe.publisher,dupe.editionYear,dupe.cover].filter(Boolean).join(", "))}).</span><div class="actions"><button class="btn" id="dupOpen">Open it</button><button class="btn" id="dupSave">Save as a separate book</button><button class="btn primary" id="dupCopy">Add as another copy</button></div></div>`;
        $("#dupOpen",s).onclick=()=>{closeSheet();openBook(dupe.id)};$("#dupSave",s).onclick=()=>{force=true;$("#saveBtn",s).click()};
        $("#dupCopy",s).onclick=()=>{force=true;copyOf=dupe;$("#saveBtn",s).click()};return}
    }
    const btn=$("#saveBtn",s);btn.disabled=true;fs.textContent="Saving to your Google Sheet…";
    try{
      if(copyOf)rec.workId=copyOf.workId||("W"+copyOf.id);
      if(buyInto){rec.id=buyInto.id;rec.workId=buyInto.workId||rec.workId||"";if(rec.status==="Wishlist")rec.status="TBR"}
      const d=await api("save",{book:rec});let saved=upsertBook(d.book);
      if(copyOf&&!copyOf.workId){try{await setWork([copyOf.id],rec.workId)}catch(e){toast("Saved, but linking the copies failed: "+e.message)}}
      if(coverIdx>=0&&photos[coverIdx]){
        fs.textContent="Saving the photo to your Drive…";
        try{const pd=await api("photo_set",{id:saved.id,image:await blobToB64(photos[coverIdx].blob)});saved=upsertBook(pd.book);setCachedPhoto(saved.id,photos[coverIdx].blob)}
        catch(e){toast("Book saved, but the photo wasn’t: "+e.message)}
      }
      photos.forEach(p=>URL.revokeObjectURL(p.url));
      closeSheet();render();
      if(buyInto){toast(`Moved to your shelves: No. ${pad(saved.id)}`)}else if(isNew){toast(`Added as No. ${pad(saved.id)}`)}else{toast("Saved");if($(".book"))openBook(saved.id)}
    }catch(e){btn.disabled=false;fs.textContent="";handleApiError(e,"Couldn’t save")}
  };
}



/* ---------- what to read next ---------- */
let lastPicks=[], lastMood="";
function recHtml(){
  return lastPicks.filter(p=>books.find(b=>b.id===p.id)).map(p=>{const b=books.find(x=>x.id===p.id);
    return `<div class="pick"><div class="shelf">${spineHtml(b)}</div><p class="small">${esc(p.reason)}</p></div>`}).join("");
}
async function runRecommend(v){
  const btn=$("#recGo",v),out=$("#recOut",v);lastMood=$("#recMood",v).value.trim();
  btn.disabled=true;out.innerHTML=`<p class="small muted">Claude is looking through your to-read pile… (about 10–20 seconds)</p>`;
  try{const d=await api("recommend",{mood:lastMood});lastPicks=d.picks;if(d.budget){budget=d.budget;store.set("bc-budget",budget)}renderStats(v)}
  catch(e){if(e.budget){budget=e.budget;store.set("bc-budget",budget)}btn.disabled=false;out.innerHTML=`<p class="small err">${esc(e.message)}</p>`}
}

/* ---------- missing volumes → wishlist ---------- */
async function addMissingToWishlist(series,btn){
  const g=window.BCStats.missingVolumes(books).find(x=>x.series===series);if(!g)return;
  const todo=g.missing.filter(x=>!x.wish);btn.disabled=true;
  try{for(const m of todo){btn.textContent=`Adding #${m.n}…`;const d=await api("save",{book:{title:`${series} #${m.n}`,author:g.author,series,seriesNo:m.n,status:"Wishlist"}});upsertBook(d.book)}
    render();toast(`Added ${todo.length} volume${todo.length>1?"s":""} to your wishlist`)}
  catch(e){btn.disabled=false;render();handleApiError(e,"Couldn’t add them all")}
}

/* ---------- photo session ---------- */
function openPhotoSession(list){
  list=[...list].sort((a,b)=>a.id-b.id);
  let i=0,saved=0,failed=0,pending=0,queue=Promise.resolve();
  const ses={
    current:()=>list[i]||null,
    left:()=>list.length-i,
    status:()=>`${saved} saved${pending?` · ${pending} uploading`:""}${failed?` · ${failed} failed`:""}`,
    skip:()=>{i++},
    shot:blob=>{const b=list[i];i++;pending++;
      queue=queue.then(async()=>{try{const d=await api("photo_set",{id:b.id,image:await blobToB64(blob)});upsertBook(d.book);setCachedPhoto(b.id,blob);saved++}catch(e){failed++}pending--;ses.repaint&&ses.repaint()})},
    repaint:null
  };
  openCamera({session:ses},async()=>{await queue;render();toast(`Photo session done: ${saved} saved${failed?`, ${failed} failed`:""}`)});
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
    if(e.target.closest("#stSugg")){openCopySuggestions();return}
    if(e.target.closest("#phSession")){openPhotoSession((v._base||[]).filter(b=>!b.hasPhoto));return}
    if(e.target.closest("#recGo")){runRecommend(v);return}
    const ws=e.target.closest("[data-wishseries]");if(ws){addMissingToWishlist(ws.dataset.wishseries,ws);return}
    if(e.target.closest("#recOut .spine")){const sp=e.target.closest(".spine");openBook(+sp.dataset.id);return}
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
  const wishN=books.filter(b=>!owned(b)).length;
  const base=books.filter(b=>owned(b)&&(!sf.language||b.language===sf.language)&&(!sf.genre||b.genre===sf.genre)&&(!sf.cover||b.cover===sf.cover));
  const S=window.BCStats.compute(base);
  S.missing=window.BCStats.missingVolumes(books); // includes wishlist, so planned buys show as such
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
  const sugCount=window.BCStats.suggestCopies(base).length;
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
     <button class="tile" data-d="${idTbr}"><span class="k">To read</span><span class="v">${tbrCount}</span><span class="s">${S.upNext.length} high priority${wishN?` · ${wishN} on wishlist`:""}</span></button>
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
   <section class="vcard"><h2>Most copies</h2>${S.copies.groups?`<p class="sub">${S.copies.groups} book${S.copies.groups===1?" has":"s have"} more than one copy · ${S.copies.extra} extra cop${S.copies.extra===1?"y":"ies"}</p>${(()=>{const max=Math.max(...S.copies.top.map(x=>x.value));return `<div class="hbars">${S.copies.top.map(x=>{const id=reg(`Copies: ${x.label}`,x.books);return `<button class="hrow" data-d="${id}"><span class="lab">${esc(x.label)}</span><span class="trk"><span class="fill" data-w="${(100*x.value/max).toFixed(1)}"></span></span><span class="num">${x.value}</span></button>`}).join("")}</div>`})()}`:`<p class="vnote">No copies linked yet.</p>`}
     ${sugCount?`<button class="btn" id="stSugg">${sugCount} possible group${sugCount===1?"":"s"} of copies found: review</button>`:""}</section>
   <section class="vcard"><h2>Special &amp; signed</h2><p class="sub">The treasures on your shelves</p>
     <div class="tiles">
       <button class="tile treasure" data-d="${reg(T("Special editions"),S.marks.special)}"><span class="k">${ICON.star}Special editions</span><span class="v">${S.marks.special.length}</span><span class="s">${pct(S.marks.special.length,S.total)}% of your books</span></button>
       <button class="tile treasure" data-d="${reg(T("Signed copies"),S.marks.signed)}"><span class="k">${ICON.sig}Signed</span><span class="v">${S.marks.signed.length}</span><span class="s">${S.marks.signedTypes.filter(x=>x.value).map(x=>`${x.value} ${x.key==="Signed"?"signed":x.key==="Signed bookplate"?"bookplate":"personalised"}`).join(" · ")||"none yet"}</span></button>
     </div>
     ${S.marks.sprayed.length?`<button class="btn" data-d="${reg(T("Sprayed edges"),S.marks.sprayed)}">${S.marks.sprayed.length} with sprayed edges</button>`:""}</section>
   <section class="vcard"><h2>Top authors</h2><p class="sub">By books you own</p>${hbars(S.authors,"Author",(b,x)=>b.author===x.key)}</section>
   <section class="vcard"><h2>The collection</h2><div class="twocol">
     <div class="mini"><h3>Language</h3>${segbar(S.languages.slice(0,4),"Language",b=>b.language,x=>String(x.key))}</div>
     <div class="mini"><h3>Format</h3>${segbar(S.covers.slice(0,4),"Format",b=>b.cover,x=>String(x.key))}</div>
   </div>${S.publishers.length?`<div class="mini"><h3>Top publishers</h3>${hbars(S.publishers,"Publisher",(b,x)=>b.publisher===x.key)}</div>`:""}</section>
   <section class="vcard"><h2>When they were first published</h2>${cols(S.decades,"First published",(b,x)=>window.BCStats.decadeKey(b.firstYear)===x.key,"Tap a bar to see its books.")}</section>
   <section class="vcard"><h2>Up next</h2><p class="sub">To read, marked high priority</p>
     ${S.upNext.length?`<div class="shelf upnext">${S.upNext.slice(0,5).map(spineHtml).join("")}</div>${S.upNext.length>5?`<button class="btn" data-d="${idUp}">Show all ${S.upNext.length}</button>`:""}`:`<p class="vnote">Nothing marked high priority.</p>`}</section>
   <section class="vcard"><h2>What to read next</h2><p class="sub">Claude picks 3 books from your to-read pile, based on your ratings</p>
     ${hasClaude?`<div class="inrow"><input id="recMood" class="field" type="text" maxlength="200" autocomplete="off" placeholder="Optional: in the mood for… (e.g. something light)" value="${esc(lastMood)}"><button class="btn primary" id="recGo" ${budgetLeft()?"":"disabled"}>Suggest</button></div>
     <p class="budgetline">${esc(budgetText())}${budgetLeft()?" · about $0.01 per suggestion":""}</p><div id="recOut">${recHtml()}</div>`:`<p class="vnote">Needs your Anthropic key in the Google script.</p>`}</section>
   <section class="vcard"><h2>Missing volumes</h2><p class="sub">Gaps in numbered series, up to the highest volume you own</p>
     ${S.missing.length?`<div class="hbars">${S.missing.slice(0,10).map(g=>{const id=reg(T(g.series),g.books);
       return `<div class="mrow"><button class="mlink" data-d="${id}"><span class="ms">${esc(g.series)}</span><span class="mm">Missing ${g.missing.map(x=>"#"+x.n+(x.wish?" (on wishlist)":"")).join(", ")}</span></button>${g.missing.some(x=>!x.wish)?`<button class="btn small-btn" data-wishseries="${esc(g.series)}">Add to wishlist</button>`:""}</div>`}).join("")}</div>`:`<p class="vnote">No gaps in your numbered series.</p>`}</section>
   <section class="vcard"><h2>Where they are</h2>${S.locations.length?hbars(S.locations,"Location",(b,x)=>b.location===x.key):""}
     ${S.noLocation?`<button class="btn" data-d="${reg(T("No location yet"),base.filter(b=>!b.location))}">${S.noLocation} book${S.noLocation===1?" has":"s have"} no location yet</button>`:""}</section>
   <section class="vcard"><h2>Photos</h2><p class="sub">${S.withPhoto} of ${S.total} books have a photo of your copy</p>
     <div class="prow done"><span class="trk"><span class="fill" data-w="${S.total?(100*S.withPhoto/S.total).toFixed(1):0}"></span></span></div>
     ${S.total-S.withPhoto?`<button class="btn primary" id="phSession">${ICON.cam}Start a photo session (${S.total-S.withPhoto} to go)</button>`:""}</section>
   `}</div>`;
  v._drills=drills;v._base=base;
  $$("[data-w]",v).forEach(el=>el.style.width=el.dataset.w+"%");
  $$("[data-h]",v).forEach(el=>el.style.height=el.dataset.h+"%");
  $$("[data-grow]",v).forEach(el=>el.style.flexGrow=el.dataset.grow);
  $$(".upnext",v).forEach(sh=>sh.onclick=e=>{const sp=e.target.closest(".spine");if(sp){e.stopPropagation();openBook(+sp.dataset.id)}});
}

/* ---------- shelf twin: bookcases, shelves, where each book is ---------- */
let twin=store.get("bc-twin",null); // {cases:[{id,room,name,shelves:[{n,free,photo}]}]}
let twinOld=false; // the Google script doesn't know the shelf twin yet
const tw={room:store.get("bc-tw-room",""),caseId:store.get("bc-tw-case","")};
const ICON_CASE=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 3h16v18H4zM4 9h16M4 15h16M8 5v3M11 5v3M8 11v3M14 11v3M8 17v3M11 17v3M16 17v3"/></svg>`;
async function loadTwin(){
  try{const d=await api("twin_get");twin={cases:d.cases||[]};twinOld=false;store.set("bc-twin",twin);refreshTwin()}
  catch(e){if(e.code==="unknown_action"){twinOld=true;twin=null;store.del("bc-twin");refreshTwin()}}
}
const twCases=()=>(twin&&twin.cases)||[];
const caseById=id=>twCases().find(c=>c.id===id);
const shelfParts=k=>{const m=String(k||"").match(/^(C\d+):(\d+)$/);return m?{c:caseById(m[1]),n:+m[2]}:null};
const shelfInfo=k=>{const p=shelfParts(k);return p&&p.c?p.c.shelves.find(s=>s.n===p.n)||null:null};
const shelfOk=k=>!!shelfInfo(k);
const shelfName=(k,short)=>{const p=shelfParts(k);if(!p||!p.c)return "";return short?`${p.c.name} · Shelf ${p.n}`:`${p.c.room} · ${p.c.name} · Shelf ${p.n}`};
const onShelf=k=>books.filter(b=>b.shelf===k&&owned(b)).sort((a,b)=>(+a.shelfPos||0)-(+b.shelfPos||0)||a.id-b.id);
const isPlaced=b=>shelfOk(b.shelf);
const unplacedBooks=()=>books.filter(b=>owned(b)&&!isPlaced(b));
const colorCls=b=>spineOf(b).cls.split(" ")[0]+(spineOf(b).light?" light":"");
const unitsOf=b=>b.cover==="Hardcover"?1.35:b.cover==="Paperback"?1:1.15;
const ordinal=n=>n+((n%100>=11&&n%100<=13)?"th":({1:"st",2:"nd",3:"rd"}[n%10]||"th"));
const fmtDay=s=>{const m=String(s||"").match(/^(\d{4})-(\d\d)-(\d\d)$/);return m?new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):""};
function freeCount(k,list){
  const f=(shelfInfo(k)||{}).free;if(f==null)return null;if(!list.length)return null;
  const used=list.reduce((s,b)=>s+unitsOf(b),0);return Math.max(0,Math.round(used*f/(1-Math.min(f,.95))/(used/list.length)));
}
// Spines are drawn from data-u (width in "book units") and data-h (height): the page's security rules forbid inline styles in HTML.
function spineBits(list,{hl,big,maxH}){
  return list.map((b,i)=>{const mk=marksOf(b);const h0=hash(b.title+"|"+b.author);
    const h=Math.round(maxH*(b.cover==="Paperback"?.8:.93)-(h0%9)*maxH/100);
    return `<span class="tsp ${colorCls(b)}${hl===b.id?" hl":""}" data-u="${unitsOf(b)}" data-h="${h}">${big?`<i>${esc(b.title)}</i><em>${i+1}</em>`:""}${mk.special?`<b class="tfoil"></b>`:""}${mk.signed?`<b class="tsig"></b>`:""}</span>`}).join("");
}
// Fit the books of every shelf in a bookcase to the width available (all shelves share one scale, like a real bookcase).
function layoutSpines(root,{maxPpu=22,minW=3,fixedPpu=0}={}){
  $$("[data-fit]",root).forEach(box=>{
    const rows=$$(".srow",box);if(!rows.length)return;
    let ppu=fixedPpu;
    if(!ppu){const W=rows[0].clientWidth-14;ppu=maxPpu;
      rows.forEach(r=>{const items=$$("[data-u]",r);const u=items.reduce((s,x)=>s+(+x.dataset.u||0),0);if(u)ppu=Math.min(ppu,(W-items.length*2)/u)})}
    $$("[data-u]",box).forEach(el=>{el.style.width=Math.max(minW,(+el.dataset.u)*ppu)+"px"});
    $$("[data-h]",box).forEach(el=>{el.style.height=el.dataset.h+"px"});
  });
}

function closeTwin(){const v=$(".twinv");if(v)v.remove();syncScroll()}
function refreshTwin(){const v=$(".twinv");if(v)renderTwin(v);renderChrome()}
function openTwin(){
  closeTwin();
  const v=document.createElement("div");v.className="twinv";v.setAttribute("role","dialog");v.setAttribute("aria-label","Bookcases");
  document.body.append(v);syncScroll();renderTwin(v);
  if(conn)loadTwin();
  v.addEventListener("click",e=>{
    const t=e.target.closest("button,[data-shelf]");if(!t)return;
    if(t.id==="twBack"){closeTwin();return}
    if(t.id==="twEdit"){openCaseEditor(caseById(tw.caseId));return}
    if(t.id==="twAdd"||t.id==="twFirst"){openCaseEditor(null);return}
    if(t.id==="twPlace"){openShelfPicker({title:"Which shelf?",sub:"Choose where the books go, then pick them."},k=>openBookPicker({k},ids=>addToShelf(k,ids)));return}
    if(t.id==="twPhoto"){openShelfPicker({title:"Which shelf are you photographing?"},k=>photographShelf(k));return}
    if(t.id==="twRetry"){loadTwin();return}
    if(t.dataset.room!==undefined){tw.room=t.dataset.room;tw.caseId="";store.set("bc-tw-room",tw.room);renderTwin(v);return}
    if(t.dataset.case){tw.caseId=t.dataset.case;store.set("bc-tw-case",tw.caseId);renderTwin(v);return}
    if(t.dataset.shelf){openShelf(t.dataset.shelf);return}
  });
}
function renderTwin(v){
  const cases=twCases();
  const rooms=[...new Set(cases.map(c=>c.room))];
  if(!rooms.includes(tw.room))tw.room=rooms[0]||"";
  const inRoom=cases.filter(c=>c.room===tw.room);
  if(!inRoom.some(c=>c.id===tw.caseId))tw.caseId=(inRoom[0]||{}).id||"";
  const c=caseById(tw.caseId);
  const nUn=unplacedBooks().length;
  const head=`<div class="statsv-head"><button class="roundbtn" id="twBack" aria-label="Back to shelves">${ICON.back}</button><div class="grow1"><div class="eyebrow">Shelf twin</div><h1>Bookcases</h1></div>${c?`<button class="roundbtn" id="twEdit" aria-label="Edit this bookcase">${ICON.pen.replace(/26/g,"20")}</button>`:""}</div>`;
  if(twinOld){v.innerHTML=`<div class="statsv-inner">${head}<div class="notice"><strong>Update your Google script</strong><span>The bookcases need the new version of the script. Follow “Adding the shelf twin” in the setup guide, then come back.</span><button class="btn" id="twRetry">Check again</button></div></div>`;return}
  if(!cases.length){v.innerHTML=`<div class="statsv-inner">${head}<div class="notice"><strong>Set up your first bookcase</strong><span>Tell the app which bookcases you have and how many shelves each one has. Then photograph each shelf and Claude puts your books in place.</span><button class="btn primary" id="twFirst">Add a bookcase</button></div></div>`;return}
  const shelves=c?c.shelves.map(s=>{const k=`${c.id}:${s.n}`,list=onShelf(k),fc=freeCount(k,list);
    return `<button class="bshelf" data-shelf="${k}" aria-label="Shelf ${s.n}: ${list.length} book${list.length===1?"":"s"}${fc!=null?`, room for about ${fc} more`:""}"><span class="sno">${s.n}</span><span class="srow">${spineBits(list,{maxH:72})}${fc!=null?`<span class="sfree" data-u="${Math.max(.8,fc*(list.length?list.reduce((a,b)=>a+unitsOf(b),0)/list.length:1.15))}" data-h="54">+${fc}</span>`:!list.length?`<span class="sempty">Empty: tap to add books</span>`:""}</span></button><span class="board" aria-hidden="true"></span>`}).join(""):"";
  const total=c?c.shelves.reduce((s,x)=>s+onShelf(`${c.id}:${x.n}`).length,0):0;
  v.innerHTML=`<div class="statsv-inner">${head}
    <div class="chips twchips" role="group" aria-label="Room">${rooms.map(r=>`<button class="chip" data-room="${esc(r)}" aria-pressed="${r===tw.room}">${esc(r)}<span class="n">${cases.filter(x=>x.room===r).length}</span></button>`).join("")}</div>
    <div class="castabs">${inRoom.map(x=>`<button class="castab" data-case="${x.id}" aria-pressed="${x.id===tw.caseId}">${esc(x.name)}</button>`).join("")}<button class="castab add" id="twAdd">+ Bookcase</button></div>
    ${c?`<div class="casemeta">${total} book${total===1?"":"s"} · ${c.shelves.length} shelves</div><div class="bcase" data-fit>${shelves}</div>
    <div class="twlegend"><span><span class="lg foil"></span>Special edition</span><span><span class="lg sig"></span>Signed</span><span><span class="lg free"></span>Free space, from your last photo</span></div>`:""}
    ${nUn?`<div class="card twun"><div><b>${nUn} book${nUn===1?"":"s"} not on a shelf yet</b><span class="small muted">${books.filter(owned).length-nUn} of ${books.filter(owned).length} placed</span></div><button class="btn" id="twPlace">Place them</button></div>`:""}
    ${hasClaude?`<button class="fab twfab" id="twPhoto">${ICON.cam}Photograph a shelf</button>`:""}
  </div>`;
  layoutSpines(v);
}

/* bookcase editor */
function openCaseEditor(c){
  const rooms=[...new Set(twCases().map(x=>x.room))];
  const room=c?c.room:(tw.room||"");
  const used=new Set(twCases().filter(x=>x.room===room).map(x=>x.name));
  const letter=[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find(l=>!used.has("Bookcase "+l))||"";
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${c?"Edit bookcase":"New bookcase"}</div><h2>${c?esc(c.name):"Add a bookcase"}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="grid">
      <div class="f"><label for="ceRoom">Room</label><input id="ceRoom" type="text" maxlength="60" list="dl-rooms" autocomplete="off" value="${esc(room)}" placeholder="Living room, office…"></div>
      <div class="f"><label for="ceName">Bookcase name</label><input id="ceName" type="text" maxlength="60" autocomplete="off" value="${esc(c?c.name:"Bookcase "+letter)}"></div>
      <div class="f"><label for="ceN">Shelves</label><select id="ceN">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${(c?c.shelves.length:5)===i+1?"selected":""}>${i+1}</option>`).join("")}</select></div>
    </div>
    <p class="small muted">Shelf 1 is the top one. Several rooms or bookcases? Add each one separately.</p>
    ${datalist("dl-rooms",rooms)}
    <p class="small err" id="ceMsg"></p>
    <div class="actions" id="ceActs">${c?`<button class="btn danger left" id="ceDel">Delete</button>`:""}<button class="btn" data-close>Cancel</button><button class="btn primary" id="ceSave">${c?"Save":"Add bookcase"}</button></div>`);
  const msg=$("#ceMsg",s);
  $("#ceSave",s).onclick=async e=>{
    const room=$("#ceRoom",s).value.trim(),name=$("#ceName",s).value.trim(),n=+$("#ceN",s).value;
    if(!room||!name){msg.textContent="Give the room and the bookcase a name.";return}
    if(c&&n<c.shelves.length){const lost=c.shelves.filter(x=>x.n>n).reduce((a,x)=>a+onShelf(`${c.id}:${x.n}`).length,0);
      if(lost&&!e.target.dataset.ok){e.target.dataset.ok="1";e.target.textContent="Save anyway";msg.textContent=`${lost} book${lost===1?"":"s"} on the removed shelves will go back to “not on a shelf”.`;return}}
    e.target.disabled=true;msg.textContent="";
    try{const d=await api("twin_case",{bookcase:{id:c?c.id:"",room,name,shelves:n}});twin={cases:d.cases};store.set("bc-twin",twin);(d.books||[]).forEach(upsertBook);
      tw.room=room;tw.caseId=d.id;store.set("bc-tw-room",room);store.set("bc-tw-case",d.id);closeSheet();refreshTwin();render();toast(c?"Bookcase saved":"Bookcase added")}
    catch(err){e.target.disabled=false;msg.textContent=err.message}
  };
  if(c)$("#ceDel",s).onclick=()=>{
    const n=c.shelves.reduce((a,x)=>a+onShelf(`${c.id}:${x.n}`).length,0);
    $("#ceActs",s).innerHTML=`<div class="confirm"><span>Delete ${esc(c.name)}? ${n?`Its ${n} book${n===1?"":"s"} go back to “not on a shelf”. `:""}Your books are not deleted.</span><button class="btn" data-close>Keep</button><button class="btn dangerfill" id="ceYes">Delete</button></div>`;
    $$("[data-close]",s).forEach(x=>x.onclick=closeSheet);
    $("#ceYes",s).onclick=async()=>{try{const d=await api("twin_case_delete",{id:c.id});twin={cases:d.cases};store.set("bc-twin",twin);(d.books||[]).forEach(upsertBook);closeSheet();refreshTwin();render();toast("Bookcase deleted")}catch(err){handleApiError(err,"Couldn’t delete")}};
  };
}

/* saving places */
async function placeMoves(moves,okMsg){
  try{const d=await api("twin_place",{moves});(d.books||[]).forEach(upsertBook);if(d.cases){twin={cases:d.cases};store.set("bc-twin",twin)}
    render();refreshTwin();if(okMsg)toast(okMsg);return true}
  catch(e){handleApiError(e,"Couldn’t save");return false}
}
const idsOn=(k,except=[])=>onShelf(k).map(b=>b.id).filter(id=>!except.includes(id));
function addToShelf(k,ids){if(!ids.length)return Promise.resolve(false);return placeMoves([{shelf:k,ids:[...idsOn(k,ids),...ids]}],`${ids.length} book${ids.length===1?"":"s"} placed on ${shelfName(k,true)}`)}

/* one shelf, in order */
function openShelf(k){
  const p=shelfParts(k),info=shelfInfo(k);if(!p||!info){toast("That shelf no longer exists.");return}
  const list=onShelf(k),fc=freeCount(k,list);
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(p.c.room)} · ${esc(p.c.name)}</div><h2>Shelf ${p.n}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    ${list.length?`<div class="closeup" data-fit><div class="srow big">${spineBits(list,{big:true,maxH:170})}</div><span class="board" aria-hidden="true"></span></div>`:""}
    <p class="small muted shmeta"><span><b>${list.length} book${list.length===1?"":"s"}</b>${list.length?", left to right":""}</span>${fc!=null?`<span>Room for about ${fc} more</span>`:""}${info.photo?`<span>Last photo ${esc(fmtDay(info.photo))}</span>`:""}</p>
    <div class="actions grow">${hasClaude?`<button class="btn primary" id="shPhoto">${ICON.cam}${info.photo?"Re-photograph":"Photograph it"}</button>`:""}<button class="btn" id="shAdd">Add books here</button></div>
    ${list.length?`<div class="sectlabel">Order · drag ☰ to rearrange</div><div class="olist" id="olist">${list.map((b,i)=>`<div class="orow" data-id="${b.id}"><span class="opos">${i+1}</span><span class="ochip ${colorCls(b)}"></span><button class="otxt" data-open="${b.id}"><span class="t">${esc(b.title)}</span><span class="s">No. ${pad(b.id)}${b.author?` · ${esc(b.author)}`:""}</span></button><button class="drag" aria-label="Move ${esc(b.title)}: drag, or use the arrow keys">☰</button></div>`).join("")}</div>`
    :`<div class="notice"><strong>Nothing here yet</strong><span>${hasClaude?"Photograph the shelf and Claude finds the books, or add them by hand.":"Add the books that are on this shelf."}</span></div>`}`);
  layoutSpines(s,{fixedPpu:26,minW:12});
  const ph=$("#shPhoto",s);if(ph)ph.onclick=()=>photographShelf(k);
  $("#shAdd",s).onclick=()=>openBookPicker({k,onCancel:()=>openShelf(k)},ids=>addToShelf(k,ids).then(()=>openShelf(k)));
  const ol=$("#olist",s);if(!ol)return;
  ol.addEventListener("click",e=>{const o=e.target.closest("[data-open]");if(o){closeSheet();openBook(+o.dataset.open)}});
  const save=order=>{order.forEach((id,i)=>{const b=books.find(x=>x.id===id);if(b)b.shelfPos=i+1});openShelf(k);placeMoves([{shelf:k,ids:order}],"New order saved")};
  const order=()=>$$(".orow",ol).map(r=>+r.dataset.id);
  // drag by the ☰ handle; arrow keys do the same for keyboards
  ol.addEventListener("keydown",e=>{const h=e.target.closest(".drag");if(!h||!["ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();
    const ids=order(),i=ids.indexOf(+h.closest(".orow").dataset.id),j=i+(e.key==="ArrowUp"?-1:1);if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];save(ids);
    setTimeout(()=>{const nh=$(`.orow[data-id="${ids[j]}"] .drag`);if(nh)nh.focus()},50)});
  ol.addEventListener("pointerdown",e=>{
    const h=e.target.closest(".drag");if(!h)return;e.preventDefault();
    const rows=$$(".orow",ol),row=h.closest(".orow"),from=rows.indexOf(row),rh=row.offsetHeight,y0=e.clientY;let to=from;
    row.classList.add("dragging");h.setPointerCapture(e.pointerId);
    const move=ev=>{const dy=ev.clientY-y0;row.style.transform=`translateY(${dy}px)`;to=Math.max(0,Math.min(rows.length-1,from+Math.round(dy/rh)));
      rows.forEach((r,j)=>{if(r===row)return;r.style.transform=(j>from&&j<=to)?`translateY(${-rh}px)`:(j<from&&j>=to)?`translateY(${rh}px)`:""})};
    const end=()=>{h.removeEventListener("pointermove",move);h.removeEventListener("pointerup",end);h.removeEventListener("pointercancel",end);
      rows.forEach(r=>r.style.transform="");row.classList.remove("dragging");
      if(to!==from){const ids=rows.map(r=>+r.dataset.id);const [m]=ids.splice(from,1);ids.splice(to,0,m);save(ids)}};
    h.addEventListener("pointermove",move);h.addEventListener("pointerup",end);h.addEventListener("pointercancel",end);
  });
}

/* pickers */
function openShelfPicker(o,onPick){
  const cases=twCases();
  const s=sheet(`<div class="sheet-head"><div><h2>${esc(o.title)}</h2>${o.sub?`<div class="sub">${esc(o.sub)}</div>`:""}</div><button class="x" id="spX" aria-label="Close">×</button></div>
    ${cases.length?[...new Set(cases.map(c=>c.room))].map(r=>`<div class="sectlabel">${esc(r)}</div>${cases.filter(c=>c.room===r).map(c=>`<div class="card spcase"><div class="spname">${esc(c.name)}</div><div class="spgrid">${c.shelves.map(x=>{const k=`${c.id}:${x.n}`,n=onShelf(k).length;
      return `<button class="spbtn" data-k="${k}" ${o.current===k?"aria-current=\"true\"":""}><b>Shelf ${x.n}</b><span>${n} book${n===1?"":"s"}${o.current===k?" · here now":""}</span></button>`}).join("")}</div></div>`).join("")}`).join("")
      :`<div class="notice"><strong>No bookcases yet</strong><button class="btn primary" id="spSetup">Add a bookcase</button></div>`}
    ${o.allowOff?`<div class="actions"><button class="btn" id="spOff">Take it off the shelf</button></div>`:""}`);
  $("#spX",s).onclick=()=>{closeSheet();if(o.onCancel)o.onCancel()};
  s.addEventListener("click",e=>{const b=e.target.closest("[data-k]");if(b){closeSheet();onPick(b.dataset.k)}});
  const su=$("#spSetup",s);if(su)su.onclick=()=>openCaseEditor(null);
  const off=$("#spOff",s);if(off)off.onclick=()=>{closeSheet();onPick(null)};
}
function openBookPicker(o,onDone){
  const k=o.k,picked=new Set(o.picked||[]);let q="";
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${k?esc(shelfName(k)):""}</div><h2>${o.single?"Which book is it?":"Add books"}</h2></div><button class="x" id="bpX" aria-label="Close">×</button></div>
    <input class="field" id="bpQ" type="search" placeholder="Search your books" autocomplete="off">
    <div class="bplist" id="bpList"></div>
    ${o.single?"":`<div class="actions sticky"><button class="btn" id="bpCancel">Cancel</button><button class="btn primary" id="bpGo" disabled>Add</button></div>`}`);
  const cancel=()=>{closeSheet();if(o.onCancel)o.onCancel()};
  $("#bpX",s).onclick=cancel;const bc=$("#bpCancel",s);if(bc)bc.onclick=cancel;
  const paint=()=>{
    const nq=norm(q).trim();
    let list=books.filter(b=>owned(b)&&b.shelf!==k);
    if(nq)list=list.map(b=>[b,searchScore(b,nq)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).map(x=>x[0]).slice(0,80);
    else list=list.filter(b=>!isPlaced(b)).sort((a,b)=>a.id-b.id);
    $("#bpList",s).innerHTML=(nq?"":`<div class="sectlabel">Not on a shelf yet (${list.length})${o.single?"":" · search to find books on other shelves"}</div>`)+
      (list.length?list.map(b=>`<button class="bprow" data-id="${b.id}" aria-pressed="${picked.has(b.id)}"><span class="ochip ${colorCls(b)}"></span><span class="otxt"><span class="t">${esc(b.title)}</span><span class="s">No. ${pad(b.id)}${b.author?` · ${esc(b.author)}`:""}${isPlaced(b)?` · on ${esc(shelfName(b.shelf,true))}`:""}</span></span>${o.single?"":`<span class="tick" aria-hidden="true"></span>`}</button>`).join("")
        :`<p class="muted small">${nq?"No books match.":"Every book is on a shelf. Search to move one from another shelf."}</p>`);
    const go=$("#bpGo",s);if(go){go.disabled=!picked.size;go.textContent=picked.size?`Add ${picked.size} book${picked.size===1?"":"s"}`:"Add"}
  };
  $("#bpQ",s).addEventListener("input",e=>{q=e.target.value;paint()});
  $("#bpList",s).addEventListener("click",e=>{const r=e.target.closest(".bprow");if(!r)return;const id=+r.dataset.id;
    if(o.single){closeSheet();onDone([id]);return}
    picked.has(id)?picked.delete(id):picked.add(id);r.setAttribute("aria-pressed",String(picked.has(id)));paint()});
  const go=$("#bpGo",s);if(go)go.onclick=()=>{closeSheet();onDone([...picked])};
  paint();
}

/* book page: where it is */
function whereHtml(b){
  if(!owned(b)||!twCases().length)return "";
  if(!isPlaced(b))return `<div class="card where"><div class="whhead"><h3>Where it is</h3></div><p class="small muted">Not on a shelf in your bookcases yet.</p><div class="actions"><button class="btn" id="whMove">Place it</button></div></div>`;
  const p=shelfParts(b.shelf),list=onShelf(b.shelf),i=list.findIndex(x=>x.id===b.id);
  const L=list[i-1],R=list[i+1],info=shelfInfo(b.shelf);
  const mini=p.c.shelves.map(x=>{const k=`${p.c.id}:${x.n}`;return `<span class="srow${k===b.shelf?" here":""}">${spineBits(onShelf(k),{hl:b.id,maxH:26})}</span><span class="board"></span>`}).join("");
  return `<div class="card where"><div class="whhead"><h3>Where it is</h3>${info&&info.photo?`<span class="small muted">photo ${esc(fmtDay(info.photo))}</span>`:""}</div>
    <div class="small muted">${esc(p.c.room)} › ${esc(p.c.name)} › <b class="ink">Shelf ${p.n}</b></div>
    <div class="whbody"><div class="minicase" data-fit role="img" aria-label="${esc(p.c.name)}, this book highlighted on shelf ${p.n}">${mini}</div>
      <div class="whtxt"><div class="big">${ordinal(i+1)}</div><div>from the left on shelf ${p.n}</div>${L||R?`<div class="small muted">${L&&R?`Between <b class="ink">${esc(L.title)}</b> and <b class="ink">${esc(R.title)}</b>`:L?`After <b class="ink">${esc(L.title)}</b>`:`Before <b class="ink">${esc(R.title)}</b>`}</div>`:""}</div></div>
    <div class="actions grow"><button class="btn primary" id="whShow">Show the shelf</button><button class="btn" id="whMove">Move it</button></div></div>`;
}
function wireWhere(v,b){
  const card=$(".where",v);if(!card)return;
  layoutSpines(card,{maxPpu:7,minW:2});
  const sh=$("#whShow",v);if(sh)sh.onclick=()=>openShelf(b.shelf);
  $("#whMove",v).onclick=()=>openShelfPicker({title:isPlaced(b)?"Move it to which shelf?":"Which shelf is it on?",sub:"It goes at the right end; reorder it on the shelf.",current:b.shelf,allowOff:isPlaced(b)},async k=>{
    const ok=k===null?await placeMoves([{shelf:b.shelf,ids:idsOn(b.shelf,[b.id])}],"Taken off the shelf"):await placeMoves([{shelf:k,ids:[...idsOn(k,[b.id]),b.id]}],`Moved to ${shelfName(k,true)}`);
    if(ok&&$(".book"))openBook(b.id);
  });
}

/* photograph a shelf → Claude reads the spines → you check → saved */
const SHELF_STEPS=[["The whole shelf","Stand straight in front of it. Long shelf? Start with the left half"],["Right half (optional)","Only for long shelves. Otherwise tap Done"]];
function photographShelf(k){
  if(!hasClaude){toast("Shelf photos need the Anthropic key in your Google script.");return}
  if(!budgetLeft()){toast("This month’s Claude limit is reached. Add the books by hand for now.");return}
  closeSheet();
  openCamera({steps:SHELF_STEPS,max:2,noIsbn:true,frame:"full"},r=>{if(r&&r.photos&&r.photos.length)reviewShelf(k,r.photos)});
}
function copyCands(b){
  const wk=window.BCStats.workKey(b);
  return books.filter(x=>owned(x)&&(x.id===b.id||(b.workId&&x.workId===b.workId)||window.BCStats.workKey(x)===wk)).sort((a,c)=>a.id-c.id);
}
async function reviewShelf(k,photos){
  let s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(shelfName(k))}</div><h2>Reading the spines…</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="notice"><strong>Claude is reading your shelf</strong><span>About 10–30 seconds. Keep this open.</span></div>`);
  let d;
  try{const images=await Promise.all(photos.map(p=>blobToB64(p.blob)));d=await api("twin_read",{images})}
  catch(e){
    if(e.budget){budget=e.budget;store.set("bc-budget",budget)}
    if(!s.isConnected)return;
    s.innerHTML=`<div class="sheet-head"><div><div class="eyebrow">${esc(shelfName(k))}</div><h2>Couldn’t read it</h2></div><button class="x" data-close aria-label="Close">×</button></div>
      <div class="notice"><span>${esc(e.message||"Something went wrong.")}</span><div class="actions"><button class="btn" id="rvAdd">Add books by hand</button><button class="btn primary" id="rvAgain">Try again</button></div></div>`;
    $$("[data-close]",s).forEach(x=>x.onclick=closeSheet);$("#rvAgain",s).onclick=()=>photographShelf(k);$("#rvAdd",s).onclick=()=>openShelf(k);return;
  }finally{photos.forEach(p=>URL.revokeObjectURL(p.url))}
  if(d.budget){budget=d.budget;store.set("bc-budget",budget)}
  // one row per spine, left to right
  const used=new Set(),rows=[];
  for(const sp of d.spines||[]){
    const b=sp.id?books.find(x=>x.id===sp.id&&owned(x)):null;
    if(b){const cands=copyCands(b);
      const pick=cands.find(x=>x.shelf===k&&!used.has(x.id))||cands.find(x=>!used.has(x.id)&&!isPlaced(x))||cands.find(x=>x.id===b.id&&!used.has(x.id))||cands.find(x=>!used.has(x.id));
      if(!pick)continue;used.add(pick.id);
      rows.push({read:sp.read,id:pick.id,cands:cands.length>1?cands.map(x=>x.id):null,unsure:!sp.sure,skip:false});
    }else rows.push({read:sp.read,id:null,cands:null,unsure:true,skip:true});
  }
  const st={rows,free:d.free,cost:+d.costUsd||0,step:"review",fate:{}};
  showReview(k,st);
}
function showReview(k,st){
  const byId=id=>books.find(x=>x.id===id);
  const isDone=r=>r.done||(!r.skip&&r.id&&!r.unsure&&!r.cands);const nOk=st.rows.filter(r=>isDone(r)&&!r.skip).length,nCheck=st.rows.filter(r=>!isDone(r)).length;
  const chip=(act,label,on)=>`<button class="rvchip" data-act="${act}" aria-pressed="${!!on}">${esc(label)}</button>`;
  let n=0;
  const rowHtml=(r,i)=>{const b=r.id?byId(r.id):null;const pos=r.skip?"–":String(++n);
    const elsewhere=b&&isPlaced(b)&&b.shelf!==k?` · now on ${shelfName(b.shelf,true)}`:"";
    const check=!isDone(r);
    return `<div class="rvrow${check?" check":""}${r.skip?" skipped":""}" data-i="${i}">
      <div class="rvtop"><span class="rvpos">${pos}</span>${b?`<span class="ochip ${colorCls(b)}"></span>`:""}<span class="otxt"><span class="t">${b?(r.cands&&!r.done?`${esc(b.title)}: which copy?`:esc(b.title)+(r.unsure?"?":"")):`Couldn’t match “${esc(r.read||"?")}”`}</span>
        <span class="s">${b?(r.cands&&!r.done?`You have ${r.cands.length} copies`:r.unsure&&!r.done?`Spine hard to read${r.read?`: “${esc(r.read)}”`:""}`:`No. ${pad(b.id)}${b.publisher?` · ${esc(b.publisher)}`:""}`)+esc(elsewhere):"Not found in your catalog"}</span></span>${!check&&!r.skip?`<span class="okmark" role="img" aria-label="Matched">✓</span>`:""}</div>
      ${r.cands?`<div class="rvchips">${r.cands.map(id=>{const c=byId(id);return chip("copy:"+id,`No. ${id}${c&&c.publisher?` · ${c.publisher}`:""}`,!r.skip&&r.id===id)}).join("")}${chip("skip","Not here",r.skip)}</div>`
        :r.unsure&&b?`<div class="rvchips">${chip("yes","Yes",!r.skip)}${chip("pick","Pick another",false)}${chip("skip","Not mine",r.skip)}</div>`
        :!b?`<div class="rvchips">${chip("pick","Pick the book",false)}${chip("skip","Skip",r.skip)}</div>`:""}
    </div>`};
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(shelfName(k))}</div><h2>${st.rows.length} book${st.rows.length===1?"":"s"} found</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="rvsum"><span class="pill okp">✓ ${nOk} matched</span>${nCheck?`<span class="pill chk">${nCheck} to check</span>`:""}</div>
    ${st.rows.length?`<div class="rvlist">${st.rows.map(rowHtml).join("")}</div>`:`<div class="notice"><span>No spines could be read. Try a straighter, closer photo, or add the books by hand.</span></div>`}
    <p class="small muted center">This photo cost about $${st.cost.toFixed(3)} · ${esc(budgetText())}</p>
    <div class="actions"><button class="btn" id="rvMissing">+ A book it missed</button><button class="btn primary" id="rvSave" ${st.rows.some(r=>r.id&&!r.skip)?"":"disabled"}>Save this shelf</button></div>`);
  s.addEventListener("click",e=>{
    const c=e.target.closest(".rvchip");if(!c)return;const i=+c.closest(".rvrow").dataset.i,r=st.rows[i],act=c.dataset.act;
    if(act==="skip"){r.skip=true;r.done=true}
    else if(act==="yes"){r.skip=false;r.unsure=false;r.done=true}
    else if(act.startsWith("copy:")){const id=+act.slice(5);const other=st.rows.find(x=>x!==r&&x.id===id&&!x.skip);if(other)other.id=r.id;r.id=id;r.skip=false;r.done=true}
    else if(act==="pick"){openBookPicker({k:null,single:true,onCancel:()=>showReview(k,st)},ids=>{const id=ids[0];st.rows.forEach(x=>{if(x!==r&&x.id===id)x.skip=true});r.id=id;r.cands=null;r.unsure=false;r.skip=false;r.done=true;showReview(k,st)});return}
    showReview(k,st);
  });
  $("#rvMissing",s).onclick=()=>openBookPicker({k:null,single:true,onCancel:()=>showReview(k,st)},ids=>{const id=ids[0];if(!st.rows.some(x=>x.id===id&&!x.skip))st.rows.push({read:"",id,cands:null,unsure:false,skip:false});showReview(k,st)});
  $("#rvSave",s).onclick=()=>shelfChanges(k,st);
}
function shelfChanges(k,st){
  const fin=[...new Set(st.rows.filter(r=>r.id&&!r.skip).map(r=>r.id))];
  const prev=idsOn(k),missing=prev.filter(id=>!fin.includes(id));
  if(!missing.length)return saveShelfPhoto(k,st,fin,prev);
  const comeIn=fin.filter(id=>!prev.includes(id)).map(id=>books.find(b=>b.id===id)).filter(Boolean);
  const same=a=>a.filter(id=>prev.includes(id)&&fin.includes(id));
  const reordered=same(prev).join()!==same(fin).join();
  const fate=st.fate;missing.forEach(id=>{if(!fate[id])fate[id]={how:"off"}});
  const opt=(id,how,label)=>`<button class="rvchip" data-id="${id}" data-how="${how}" aria-pressed="${fate[id].how===how}">${esc(label)}</button>`;
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(shelfName(k))}</div><h2>${missing.length+comeIn.length+(reordered?1:0)} change${missing.length+comeIn.length+(reordered?1:0)===1?"":"s"} since ${esc(fmtDay((shelfInfo(k)||{}).photo)||"last time")}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    ${comeIn.length?`<div class="card chg"><span class="tagp new">New here</span>${comeIn.map(b=>`<div><b>${esc(b.title)}</b><span class="small muted">${isPlaced(b)?` · was on ${esc(shelfName(b.shelf,true))}`:" · wasn’t on a shelf"}</span></div>`).join("")}</div>`:""}
    <div class="card chg"><span class="tagp gone">Not in the photo</span>${missing.map(id=>{const b=books.find(x=>x.id===id)||{title:"No. "+id};return `<div class="gone1"><b>${esc(b.title)}</b><div class="rvchips">${opt(id,"off","Not on a shelf now")}${opt(id,"keep","Keep it here")}${opt(id,"move",fate[id].how==="move"&&fate[id].to?`Moved to ${shelfName(fate[id].to,true)}`:"Moved…")}</div></div>`}).join("")}
      <p class="small muted">“Keep it here” if the photo just missed it.</p></div>
    ${reordered?`<div class="card chg"><span class="tagp ord">Order changed</span><span class="small muted">The shelf will follow the new order from the photo.</span></div>`:""}
    <div class="actions"><button class="btn" id="chBack">Back</button><button class="btn primary" id="chSave">Update the twin</button></div>`);
  s.addEventListener("click",e=>{const c=e.target.closest("[data-how]");if(!c)return;const id=+c.dataset.id;
    if(c.dataset.how==="move"){openShelfPicker({title:"Where is it now?",onCancel:()=>shelfChanges(k,st)},to=>{fate[id]=to===k?{how:"keep"}:{how:"move",to};shelfChanges(k,st)});return}
    fate[id]={how:c.dataset.how};shelfChanges(k,st)});
  $("#chBack",s).onclick=()=>showReview(k,st);
  $("#chSave",s).onclick=()=>saveShelfPhoto(k,st,fin,prev);
}
async function saveShelfPhoto(k,st,fin,prev){
  const ids=fin.slice();
  prev.forEach((id,i)=>{if(!ids.includes(id)&&st.fate[id]&&st.fate[id].how==="keep")ids.splice(Math.min(i,ids.length),0,id)});
  const moves=[{shelf:k,ids,free:st.free,photo:true}];
  const to={};Object.entries(st.fate).forEach(([id,f])=>{if(f.how==="move"&&f.to&&prev.includes(+id)&&!ids.includes(+id))(to[f.to]=to[f.to]||[]).push(+id)});
  Object.entries(to).slice(0,5).forEach(([t,list])=>moves.push({shelf:t,ids:[...idsOn(t,[...ids,...list]),...list]}));
  const btn=$("#chSave")||$("#rvSave");if(btn){btn.disabled=true;btn.textContent="Saving…"}
  if(await placeMoves(moves,"Shelf saved"))openShelf(k);else if(btn){btn.disabled=false;btn.textContent="Try again"}
}

/* ---------- boot ---------- */
render();
if(conn){loadBooks();loadStatus();loadTwin()}
})();
