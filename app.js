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
const st={q:"",status:"",mark:"",genre:"",lang:"",sort:"id-desc",view:"list",shown:60,...store.get("bc-view",{})};
st.q="";st.shown=60;
const saveView=()=>store.set("bc-view",{view:st.view,status:st.status,mark:st.mark,genre:st.genre,lang:st.lang,sort:st.sort});
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
  const todo=backlog.length&&!st.q.trim()?`<div class="hiddenhint todohint"><span><b>${backlog.length} book${backlog.length===1?"":"s"}</b> seen on your shelves ${backlog.length===1?"isn’t":"aren’t"} in your catalog yet</span><button class="btn" id="todoBtn">Add ${backlog.length===1?"it":"them"}</button></div>`:"";
  const miss=st.view==="wall"&&!st.q.trim()?books.filter(b=>owned(b)&&!b.coverUrl).length:0;
  const covHint=miss?`<div class="hiddenhint"><span><b>${miss} book${miss===1?"":"s"}</b> without an online cover</span><button class="btn" id="findCovers">Find covers</button></div>`:"";
  list.innerHTML=`${todo}${hint}${covHint}${st.view==="wall"?wallHtml(r.slice(0,st.shown)):`<div class="shelf">${r.slice(0,st.shown).map(spineHtml).join("")}</div>`}`;wire();
  const fc=$("#findCovers");if(fc)fc.onclick=()=>openCoverRun();
  if(st.view==="wall"){$$(".wtile",list).forEach(t=>{const b=books.find(x=>x.id===+t.dataset.id);if(b)applyPalette($(".wcov",t),b)});wireCoverImages(list)}
  const tb=$("#todoBtn");if(tb)tb.onclick=()=>openBacklog();
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
$("#list").addEventListener("click",e=>{const sp=e.target.closest(".spine,.wtile");if(sp)openBook(+sp.dataset.id)});
function setView(v){st.view=v==="wall"?"wall":"list";st.shown=60;saveView();$("#vList").setAttribute("aria-pressed",String(st.view==="list"));$("#vWall").setAttribute("aria-pressed",String(st.view==="wall"));renderList()}
$("#vList").addEventListener("click",()=>setView("list"));$("#vWall").addEventListener("click",()=>setView("wall"));
$("#vList").setAttribute("aria-pressed",String(st.view!=="wall"));$("#vWall").setAttribute("aria-pressed",String(st.view==="wall"));
function wallHtml(list){
  return `<div class="wall">${list.map(b=>{const mk=marksOf(b);const label=[b.title,b.author,mk.special?"special edition":"",mk.signed?mk.signed.toLowerCase():""].filter(Boolean).join(", ");
    return `<button class="wtile" data-id="${+b.id}" aria-label="${esc(label)}"><span class="wcov ${colorCls(b)}${mk.sprayed?" sprayed":""}"><span class="wedge"></span><span class="wface">${coverFaceHtml(b)}${mk.special?`<span class="wfoil"></span><span class="wcorner"></span>`:""}${mk.signed?`<span class="wsig">${ICON.sig}</span>`:""}</span></span>
      <span class="wt">${esc(b.title)}</span><span class="wsub">${+b.rating?"★".repeat(+b.rating):esc(statusLabel(b.status||"TBR"))}</span></button>`}).join("")}</div>`;
}
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
function syncScroll(){document.body.style.overflow=(layer.innerHTML||$(".book")||$(".cam")||$(".statsv")||$(".twinv")||$(".fixv"))?"hidden":""}
function sheet(html){
  layer.innerHTML=`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  syncScroll();
  const scrim=layer.firstElementChild;scrim.addEventListener("click",e=>{if(e.target===scrim)closeSheet()});
  const s=scrim.firstElementChild;$$("[data-close]",s).forEach(x=>x.onclick=closeSheet);return s;
}
document.addEventListener("keydown",e=>{if(e.key!=="Escape"||$(".cam"))return;if($(".fixv")){closeFix();return}if(layer.innerHTML)closeSheet();else if($(".book"))closeBook();else if($(".statsv"))closeStats();else if($(".fixrunv"))closeFixRun();else if($(".coverv"))closeCoverRun();else if($(".twinv"))closeTwin()});

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
      $("#fYes",s).onclick=()=>{["bc-conn","bc-books","bc-budget","bc-claude","bc-twin","bc-backlog"].forEach(store.del);twin=null;backlog=[];conn=null;books=[];budget=null;hasClaude=false;photoCache.forEach(u=>URL.revokeObjectURL(u));photoCache.clear();closeSheet();closeBook();render();toast("Disconnected")};
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
function newPhotoTaken(id,blob){setCachedPhoto(id,blob);if(origCache.has(id)){URL.revokeObjectURL(origCache.get(id));origCache.delete(id)}} // a retake replaces the photo as taken too

function ribbonsHtml(b){
  const mk=marksOf(b);if(!mk.special&&!mk.signed)return "";
  const sp=mk.special?(/edition/i.test(mk.specialSeg)&&mk.specialSeg.length<=34?mk.specialSeg:"Special edition"):"";
  return `<div class="ribbons">${sp?`<span class="ribbon">${ICON.star}${esc(sp)}</span>`:""}${mk.signed?`<span class="ribbon">${ICON.sig}${esc(mk.signed)}</span>`:""}</div>`;
}
function openBook(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  closeBook();
  const sp=spineOf(b),mode=coverMode(b),mk0=marksOf(b),is3d=true,pal=mode==="online"?paletteOf(b):null;
  const srcName=/openlibrary/.test(b.coverUrl||"")?"Open Library":"Google Books";
  const fact=(k,v,s)=>v?`<div class="fact"><div class="k">${k}</div><div class="v">${esc(v)}</div>${s?`<div class="s">${esc(s)}</div>`:""}</div>`:"";
  const v=document.createElement("div");v.className="book";v.setAttribute("role","dialog");v.setAttribute("aria-label",b.title);
  v.innerHTML=`<div class="book-inner ${sp.cls}">
    <div class="hero${is3d?" h3d":""}" id="hero">
      ${is3d?`<div class="hbackdrop" aria-hidden="true">${mode==="online"?`<img src="${esc(b.coverUrl)}" alt="" referrerpolicy="no-referrer">`:mode==="photo"?`<img alt="" data-photo="${b.id}">`:""}</div>
        <div class="b3d${mk0.special?" special":""}${mk0.sprayed?" sprayed":""}" role="img" aria-label="${esc(mode==="online"?`Cover of ${b.title}`:mode==="photo"?`Your photo of ${b.title}`:`${b.title}: no cover yet`)}"><div class="b3d-book"><span class="b3d-pages"></span><span class="b3d-front">${coverFaceHtml(b,mode)}${mk0.special?`<span class="b3d-foil"></span>`:""}</span></div><span class="b3d-shadow"></span></div>`
        :`<div class="loading" id="heroInner">Loading photo…</div>`}
      <button class="over back" id="bkBack" aria-label="Back to shelves">${ICON.back}</button>
      ${ribbonsHtml(b)}
      <div class="herobar"><span class="hchip">${mode==="online"?`Online cover · ${srcName}`:mode==="photo"?(b.photoFixed?"Your photo · edited":"Your photo"):"No cover yet"}</span><span class="hbtns">${mode==="photo"?`<button class="over hbtn" id="bkFix">Edit photo</button>`:""}${mode==="none"?`<button class="over hbtn" id="bkPhoto">${ICON.cam}Add photo</button>`:""}<button class="over hbtn" id="bkCover">${mode==="none"?"Find cover":"Change cover"}</button></span></div>
    </div>
    <div class="band ${sp.light&&!pal?"light":""}">
      <div class="row"><span class="no">No. ${pad(b.id)}</span>${stars(b.rating)}</div>
      <h1>${esc(b.title)}</h1>
      <div class="by">${esc(b.author)}${b.series?` · ${esc(b.series)}${b.seriesNo!==""?` #${esc(b.seriesNo)}`:""}`:""}</div>
      ${readBarHtml(b)}
      <div class="row start"><span class="pill">${esc(statusLabel(b.status||"TBR"))}</span>${b.priority?`<span class="pill prio">High priority</span>`:""}${marksOf(b).sprayed?`<span class="pill edge">Sprayed edges</span>`:""}${b.dateRead&&b.dateRead!=="Not registered"?`<span class="by">Read ${esc(b.dateRead)}</span>`:""}<span class="swatches" hidden><span>Cover colours</span><i></i><i></i><i></i></span></div>
    </div>
    <div class="book-body">
      ${b.coverUrl&&b.hasPhoto?`<div class="card covershown"><div class="sectlabel">Cover shown</div><div class="seg2"><button data-pref="" aria-pressed="${mode==="online"}">Online cover</button><button data-pref="photo" aria-pressed="${mode==="photo"}">My photo</button></div><div class="small muted">Both are kept: switch any time.</div></div>`:""}
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
  if(pal){const bi=$(".book-inner",v);bi.style.setProperty("--sp-bg",pal[0]);bi.style.setProperty("--sp-fg",pal[2]);applyPalette(bi,b)}
  wireCoverImages(v);
  const fx=$("#bkFix",v);if(fx)fx.onclick=()=>openStraighten(books.find(x=>x.id===b.id)||b);
  const showSwatches=p=>{const sw=$(".swatches",v);if(!sw||!p)return;$$("i",sw).forEach((x,i)=>x.style.background=p[i]);sw.hidden=false};
  if(pal)showSwatches(pal);
  if(mode==="photo")photoUrl(b).then(u=>u&&loadImg(u)).then(img=>{if(!img||!v.isConnected)return;const p=paletteFromImage(img);const bi=$(".book-inner",v);
    bi.style.setProperty("--sp-bg",p[0]);bi.style.setProperty("--sp-fg",p[2]);bi.style.setProperty("--cv-dark",p[0]);bi.style.setProperty("--cv-accent",p[1]);bi.style.setProperty("--cv-light",p[2]);$(".band",v).classList.remove("light");showSwatches(p)}).catch(()=>{});
  const cs=$(".covershown",v);if(cs)cs.onclick=async e=>{const t=e.target.closest("[data-pref]");if(!t||t.getAttribute("aria-pressed")==="true")return;
    $$("[data-pref]",cs).forEach(x=>x.disabled=true);try{await quickSave(books.find(x=>x.id===b.id)||b,{coverPref:t.dataset.pref});render();openBook(b.id)}catch(err){$$("[data-pref]",cs).forEach(x=>x.disabled=false);handleApiError(err,"Couldn’t switch")}};
  $("#bkCover",v).onclick=()=>openCoverPicker(books.find(x=>x.id===b.id)||b);
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
  const bp=$("#bkPhoto",v);if(bp)bp.onclick=()=>openCamera({steps:COVER_STEPS,max:1},r=>{
    if(!r.photos.length)return;
    cropNewPhoto(b.title,r.photos[0].blob,async(shown,asTaken)=>{
      if(!shown)return;
      const btn=$("#bkPhoto",v);if(btn){btn.disabled=true;btn.innerHTML=`${ICON.cam}<span>Saving photo…</span>`}
      try{await saveNewPhoto(b.id,shown,asTaken);toast("Photo saved");render();openBook(b.id)}
      catch(e){handleApiError(e,"Couldn’t save the photo");openBook(b.id)}
    });
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
  if(!inner)return;
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
    $("#camThumbs",root).innerHTML=(photos.length>2?`<span class="cam-count">${photos.length} photos</span>`:"")+photos.slice(-2).map((p,i)=>`<img src="${p.url}" alt="Photo ${photos.length>2?photos.length-1+i:i+1}">`).join("");
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
/* Combo boxes: type freely, or tap ▾ to choose from the values you already use (several at once for subgenres and edition details). */
const splitList=v=>String(v??"").split(",").map(x=>x.trim()).filter(Boolean);
let comboSeq=0;
// A tap anywhere outside an open list closes it.
document.addEventListener("pointerdown",e=>{$$(".combo.open").forEach(w=>{if(!w.contains(e.target)&&w._close)w._close()})},true);
function enhanceCombos(root,sources){
  $$("input[data-combo]",root).forEach(inp=>{
    const key=inp.dataset.combo,multi=inp.hasAttribute("data-multi"),all=()=>sources[key]||[];
    const wrap=document.createElement("div");wrap.className="combo";inp.parentNode.insertBefore(wrap,inp);wrap.append(inp);
    const btn=document.createElement("button");btn.type="button";btn.className="cbtn";btn.tabIndex=-1;
    const lab=(inp.id&&root.querySelector(`label[for="${inp.id}"]`))||null;btn.setAttribute("aria-label","Show choices"+(lab?" for "+lab.childNodes[0].textContent.trim():""));
    btn.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
    const panel=document.createElement("div");panel.className="cpanel";panel.id="cp"+(++comboSeq);panel.setAttribute("role","listbox");if(multi)panel.setAttribute("aria-multiselectable","true");panel.hidden=true;
    wrap.append(btn,panel);
    inp.setAttribute("role","combobox");inp.setAttribute("aria-autocomplete","list");inp.setAttribute("aria-expanded","false");inp.setAttribute("aria-controls",panel.id);
    let browsing=false,silent=false;
    const term=()=>multi?((inp.value.split(",").pop()||"").trim()):inp.value.trim();
    const close=()=>{panel.hidden=true;inp.setAttribute("aria-expanded","false");wrap.classList.remove("open");browsing=false};wrap._close=close;
    const paint=()=>{
      const t=norm(term());let opts=all();
      if(!browsing&&t)opts=opts.filter(o=>norm(o).includes(t)).sort((a,b)=>(norm(b).startsWith(t)?1:0)-(norm(a).startsWith(t)?1:0));
      if(!browsing&&opts.length===1&&norm(opts[0])===t)opts=[];
      if(!opts.length){close();return}
      const picked=multi?splitList(inp.value).map(norm):[norm(inp.value)];
      panel.innerHTML=(multi&&browsing?`<div class="chint">Tap to add or remove · ${picked.filter(Boolean).length} chosen</div>`:"")+opts.slice(0,80).map(o=>`<button type="button" role="option" class="copt" data-v="${esc(o)}" aria-selected="${picked.includes(norm(o))}">${esc(o)}</button>`).join("");
      panel.hidden=false;inp.setAttribute("aria-expanded","true");wrap.classList.add("open");
    };
    const set=v=>{inp.value=v;silent=true;inp.dispatchEvent(new Event("input",{bubbles:true}));silent=false};
    btn.addEventListener("pointerdown",e=>e.preventDefault());
    btn.onclick=()=>{if(!panel.hidden){close();return}browsing=true;paint();if(document.activeElement!==inp&&matchMedia("(pointer:fine)").matches)inp.focus()};
    inp.addEventListener("input",()=>{if(silent||document.activeElement!==inp)return;browsing=false;if(term())paint();else close()});
    inp.addEventListener("blur",()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))close()},180));
    inp.addEventListener("keydown",e=>{
      if(e.key==="Escape"&&!panel.hidden){e.stopPropagation();close()}
      else if(e.key==="ArrowDown"){e.preventDefault();if(panel.hidden){browsing=!term();paint()}const f=$(".copt",panel);if(f)f.focus()}});
    panel.addEventListener("keydown",e=>{const o=e.target.closest(".copt");if(!o)return;
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const os=$$(".copt",panel),i=os.indexOf(o)+(e.key==="ArrowDown"?1:-1);if(i<0)inp.focus();else if(os[i])os[i].focus()}
      if(e.key==="Escape"){e.stopPropagation();close();inp.focus()}});
    panel.addEventListener("pointerdown",e=>e.preventDefault());
    panel.addEventListener("click",e=>{const o=e.target.closest(".copt");if(!o)return;const v=o.dataset.v;
      if(!multi){set(v);close();return}
      const list=splitList(inp.value);
      if(!browsing&&list.length&&!inp.value.trim().endsWith(",")){list.pop();if(!list.some(x=>norm(x)===norm(v)))list.push(v)} // the half-typed word becomes the choice
      else{const i=list.findIndex(x=>norm(x)===norm(v));if(i>=0)list.splice(i,1);else list.push(v)}
      set(list.join(", "));browsing=true;paint()});
  });
}

function openForm(b,capture,pre,after){
  const isNew=!b;const v=b?{...b}:{status:"TBR",rating:0,...(pre||{})};
  const uniq=k=>[...new Set(books.map(x=>x[k]).filter(Boolean).map(String))].sort();
  const inp=(k,label,cls="",extra="")=>`<div class="f ${cls}" data-f="${k}"><label for="i-${k}">${label}<span class="src"></span></label><input id="i-${k}" name="${k}" type="text" value="${esc(v[k]??"")}" autocomplete="off" ${extra}></div>`;
  const photos=capture?capture.photos:[];let coverIdx=photos.length?0:-1;
  const s=sheet(`
   <div class="sheet-head"><div><div class="eyebrow">${isNew?"New entry":"Editing No. "+pad(b.id)}</div><h2>${isNew?"Add a book":esc(b.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   ${photos.length?`<section class="photo">
     <div class="sectlabel">Your photos · tap one to make it the book’s photo</div>
     <div class="thumbs" id="thumbs">${photos.map((p,i)=>`<button type="button" class="thumb" data-i="${i}" aria-pressed="${i===0}" aria-label="Use photo ${i+1} as the book’s photo"><img src="${p.url}" alt=""><span class="lbl" ${i===0?"":"hidden"}>Cover</span></button>`).join("")}</div>
     <div class="thumbacts"><button type="button" class="btn" id="cropBtn">Crop the cover photo</button></div>
     <div class="progress" id="prog"></div>
     <div class="legend"><span><span class="badge photo">photo</span> read from your photos</span><span><span class="badge catalog">catalog</span> from the ISBN</span><span><span class="badge online">online</span> found on the internet</span><span><span class="badge knowledge">check</span> Claude’s suggestion</span></div>
     <p class="budgetline" id="budgetLine">${esc(budgetText())}</p>
   </section>`:""}
   <form id="bookForm" novalidate>
    <fieldset class="fs"><legend>From the book</legend><div class="grid">
     ${inp("title","Title *","",'required')}
     ${inp("author","Author","h full-sm",'data-combo="author"')}
     <div class="f h full-sm" data-f="isbn"><label for="i-isbn">ISBN<span class="src"></span></label><div class="inrow"><input id="i-isbn" name="isbn" type="text" inputmode="numeric" value="${esc(v.isbn||"")}" autocomplete="off" placeholder="978…"><button type="button" class="btn" id="lookupBtn">Look up</button></div></div>
     ${inp("series","Series","h full-sm",'data-combo="series"')}
     ${inp("seriesNo","Series #","t",'inputmode="numeric"')}
     <div class="f t" data-f="cover"><label for="i-cover">Cover<span class="src"></span></label><select id="i-cover" name="cover"><option value=""></option><option>Paperback</option><option>Hardcover</option></select></div>
     ${inp("publisher","Publisher (this edition)","h full-sm",'data-combo="publisher"')}
     ${inp("editionYear","Edition year","t",'inputmode="numeric"')}
     ${inp("language","Language","t",'data-combo="language"')}
     ${inp("special","Special edition details","",'data-combo="special" data-multi placeholder="Sprayed edges, dust jacket, folded cover…"')}
     <div class="f marks"><span class="lbl">Highlight this copy</span><div class="markrow">
       <button type="button" class="marktog" id="mkSpecial" aria-pressed="false">${ICON.star}Special edition</button>
       <label class="sigsel">${ICON.sig}<span class="vh">Signed</span><select id="mkSigned" aria-label="Signed"><option value="">Not signed</option>${window.BCStats.SIGNED_TYPES.map(t=>`<option>${esc(t)}</option>`).join("")}</select></label>
     </div></div>
    </div></fieldset>
    <fieldset class="fs"><legend>About the work</legend><div class="grid">
     <div class="f firstrow"><button type="button" class="btn" id="firstBtn">Find 1st edition online</button><span class="small" id="firstStatus" role="status"></span></div>
     ${inp("firstPublisher","First edition publisher","h full-sm",'data-combo="publisher"')}
     ${inp("firstYear","First edition year","t",'inputmode="numeric"')}
     ${inp("genre","Genre","t",'data-combo="genre"')}
     ${inp("subgenre","Subgenres","",'data-combo="subgenre" data-multi placeholder="Choose several, or type them"')}
     ${inp("awards","Awards","",'placeholder="Hugo 1990; Locus 1990"')}
    </div></fieldset>
    <fieldset class="fs"><legend>My reading</legend><div class="grid">
     <div class="f"><span class="lbl">Status</span><div class="seg" id="segStatus">${["TBR","Reading","Read","DNF","Wishlist"].map(x=>`<button type="button" data-v="${x}" aria-pressed="${v.status===x}">${statusLabel(x)}</button>`).join("")}</div></div>
     <div class="f h full-sm"><span class="lbl">Rating</span><div class="rate" id="rate">${[1,2,3,4,5].map(n=>`<button type="button" data-n="${n}" aria-label="${n} star${n>1?"s":""}" class="${n<=(+v.rating||0)?"":"off"}">★</button>`).join("")}</div></div>
     ${inp("dateRead","Date read","h full-sm",'placeholder="YYYY-MM"')}
     <div class="f h full-sm"><label for="i-priority">Priority to read</label><select id="i-priority" name="priority"><option value="">Normal</option><option value="High">High</option></select></div>
     ${inp("location","Where it is","",'data-combo="location" placeholder="Room, shelf…"')}
     <div class="f"><label for="i-comments">Comments</label><textarea id="i-comments" name="comments">${esc(v.comments||"")}</textarea></div>
    </div></fieldset>
   </form>
   <div id="dupArea"></div>
   <div class="actions"><span class="small left" id="formStatus"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="saveBtn">${isNew?"Add to shelf":"Save changes"}</button></div>`);
  $("#i-cover",s).value=v.cover||"";
  const segs=k=>books.flatMap(x=>splitList(x[k]));
  const sorted=a=>[...new Set(a.filter(Boolean).map(String))].sort((x,y)=>x.localeCompare(y));
  enhanceCombos(s,{author:sorted(uniq("author")),series:sorted(uniq("series")),publisher:sorted([...uniq("publisher"),...uniq("firstPublisher")]),
    language:[...new Set(["English","Portuguese",...sorted(uniq("language"))])],genre:sorted([...GENRES,...uniq("genre")]),
    subgenre:sorted([...SUBGENRES,...segs("subgenre")]),special:sorted(["Sprayed edges","Dust jacket","Folded cover","Illustrated","Special edition","Signed",...segs("special")]),
    location:sorted(uniq("location"))});
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
  const cropBtn=$("#cropBtn",s);
  if(cropBtn)cropBtn.onclick=()=>{
    const i=coverIdx>=0?coverIdx:0,ph=photos[i];if(!ph)return;
    cropNewPhoto($("#i-title",s).value||"Cover photo",ph.orig||ph.blob,(shown,asTaken)=>{
      if(!shown)return;
      if(asTaken){ph.orig=asTaken;ph.blob=shown}else if(ph.orig){ph.blob=ph.orig;ph.orig=null}
      const img=$(`.thumb[data-i="${i}"] img`,s);if(img){const u=URL.createObjectURL(ph.blob);img.src=u;ph.url=u}
      if(coverIdx<0){coverIdx=i;$$(".thumb",thumbs).forEach(x=>{const on=+x.dataset.i===i;x.setAttribute("aria-pressed",String(on));$(".lbl",x).hidden=!on})}
      cropBtn.textContent=ph.orig?"Cropped ✓ · crop again":"Crop the cover photo";
    });
  };
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
    ["subgenre","special"].forEach(k=>{if(fd[k]!=null)fd[k]=splitList(fd[k]).join(", ")});
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
        try{saved=await saveNewPhoto(saved.id,photos[coverIdx].blob,photos[coverIdx].orig||null)}
        catch(e){toast("Book saved, but the photo wasn’t: "+e.message)}
      }
      photos.forEach(p=>URL.revokeObjectURL(p.url));
      closeSheet();render();
      if(buyInto){toast(`Moved to your shelves: No. ${pad(saved.id)}`)}else if(isNew){toast(`Added as No. ${pad(saved.id)}`)}else{toast("Saved");if($(".book"))openBook(saved.id)}
      if(after&&isNew&&!buyInto){try{await after(saved)}catch(e){}}
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
      queue=queue.then(async()=>{try{const d=await api("photo_set",{id:b.id,image:await blobToB64(blob)});upsertBook(d.book);newPhotoTaken(b.id,blob);saved++}catch(e){failed++}pending--;ses.repaint&&ses.repaint()})},
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
    if(e.target.closest("#phFix")){openFixRun();return}
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
     ${S.total-S.withPhoto?`<button class="btn primary" id="phSession">${ICON.cam}Start a photo session (${S.total-S.withPhoto} to go)</button>`:""}
     ${(()=>{const n=books.filter(b=>owned(b)&&b.hasPhoto&&!b.photoFixed).length;return n?`<button class="btn" id="phFix">Straighten my photos (${n})</button>`:""})()}</section>
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
let backlog=store.get("bc-backlog",[]); // books seen on shelf photos that aren't in the catalog yet
function setBacklog(list){backlog=Array.isArray(list)?list:[];store.set("bc-backlog",backlog);renderList();const v=$(".twinv");if(v)renderTwin(v)}
const tw={room:store.get("bc-tw-room",""),caseId:store.get("bc-tw-case","")};
const ICON_CASE=`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 3h16v18H4zM4 9h16M4 15h16M8 5v3M11 5v3M8 11v3M14 11v3M8 17v3M11 17v3M16 17v3"/></svg>`;
async function loadTwin(){
  try{const d=await api("twin_get");twin={cases:d.cases||[]};twinOld=false;store.set("bc-twin",twin);if(d.backlog)setBacklog(d.backlog);refreshTwin()}
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

function closeTwin(){const v=$(".twinv:not(.coverv):not(.fixrunv)");if(v)v.remove();syncScroll()}
function refreshTwin(){const v=$(".twinv:not(.coverv):not(.fixrunv)");if(v)renderTwin(v);renderChrome()}
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
    if(t.id==="twTodo"){openBacklog();return}
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
    ${backlog.length?`<div class="card twun"><div><b>${backlog.length} to add to your catalog</b><span class="small muted">Seen on your shelf photos</span></div><button class="btn" id="twTodo">Review</button></div>`:""}
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
      <div class="f"><label for="ceRoom">Room</label><input id="ceRoom" type="text" maxlength="60" data-combo="room" autocomplete="off" value="${esc(room)}" placeholder="Living room, office…"></div>
      <div class="f"><label for="ceName">Bookcase name</label><input id="ceName" type="text" maxlength="60" autocomplete="off" value="${esc(c?c.name:"Bookcase "+letter)}"></div>
      <div class="f"><label for="ceN">Shelves</label><select id="ceN">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${(c?c.shelves.length:5)===i+1?"selected":""}>${i+1}</option>`).join("")}</select></div>
    </div>
    <p class="small muted">Shelf 1 is the top one. Several rooms or bookcases? Add each one separately.</p>
    <p class="small err" id="ceMsg"></p>
    <div class="actions" id="ceActs">${c?`<button class="btn danger left" id="ceDel">Delete</button>`:""}<button class="btn" data-close>Cancel</button><button class="btn primary" id="ceSave">${c?"Save":"Add bookcase"}</button></div>`);
  enhanceCombos(s,{room:rooms});
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
const SHELF_PHOTOS=6;
const SHELF_STEPS=[["Left end of the shelf","Stand straight in front of it. Short shelf? One photo of all of it, then Done"],["Next part, to the right","Overlap a book or two with the last photo · Done when you reach the end"]];
function photographShelf(k){
  if(!hasClaude){toast("Shelf photos need the Anthropic key in your Google script.");return}
  if(!budgetLeft()){toast("This month’s Claude limit is reached. Add the books by hand for now.");return}
  closeSheet();
  openCamera({steps:SHELF_STEPS,max:SHELF_PHOTOS,noIsbn:true,frame:"full"},r=>{if(r&&r.photos&&r.photos.length)reviewShelf(k,r.photos)});
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
    }else rows.push({read:sp.read,title:sp.title||"",author:sp.author||"",id:null,cands:null,unsure:true,skip:true,backlog:true,done:true});
  }
  const st={rows,free:d.free,cost:+d.costUsd||0,step:"review",fate:{}};
  showReview(k,st);
}
function showReview(k,st){
  const byId=id=>books.find(x=>x.id===id);
  const isDone=r=>r.done||(!r.skip&&r.id&&!r.unsure&&!r.cands);const nOk=st.rows.filter(r=>isDone(r)&&!r.skip).length,nCheck=st.rows.filter(r=>!isDone(r)).length,nAdd=st.rows.filter(r=>r.backlog).length;
  const onList=r=>{const key=norm(r.title||r.read).replace(/[^a-z0-9]+/g,"");return backlog.some(x=>x.shelf===k&&norm(x.title||x.read).replace(/[^a-z0-9]+/g,"")===key)};
  const chip=(act,label,on)=>`<button class="rvchip" data-act="${act}" aria-pressed="${!!on}">${esc(label)}</button>`;
  let n=0;
  const rowHtml=(r,i)=>{const b=r.id&&!r.backlog?byId(r.id):null;const pos=r.backlog?"+":r.skip?"–":String(++n);
    const elsewhere=b&&isPlaced(b)&&b.shelf!==k?` · now on ${shelfName(b.shelf,true)}`:"";
    const check=!isDone(r);
    return `<div class="rvrow${check?" check":""}${r.skip&&!r.backlog?" skipped":""}${r.backlog?" tolist":""}" data-i="${i}">
      <div class="rvtop"><span class="rvpos">${pos}</span>${b?`<span class="ochip ${colorCls(b)}"></span>`:""}<span class="otxt"><span class="t">${b?(r.cands&&!r.done?`${esc(b.title)}: which copy?`:esc(b.title)+(r.unsure&&!r.done?"?":"")):`Not in your catalog: ${esc(r.title||r.read||"?")}`}</span>
        <span class="s">${b?(r.cands&&!r.done?`You have ${r.cands.length} copies`:r.unsure&&!r.done?`Spine hard to read${r.read?`: “${esc(r.read)}”`:""}`:`No. ${pad(b.id)}${b.publisher?` · ${esc(b.publisher)}`:""}`)+esc(elsewhere):esc([r.author,r.read&&r.read!==r.title?`spine: “${r.read}”`:"",r.backlog?(onList(r)?"already on your to-add list":"goes to your to-add list"):""].filter(Boolean).join(" · "))}</span></span>${!check&&!r.skip?`<span class="okmark" role="img" aria-label="Matched">✓</span>`:""}</div>
      ${r.cands?`<div class="rvchips">${r.cands.map(id=>{const c=byId(id);return chip("copy:"+id,`No. ${id}${c&&c.publisher?` · ${c.publisher}`:""}`,!r.skip&&r.id===id)}).join("")}${chip("skip","Not here",r.skip)}</div>`
        :r.unsure&&b?`<div class="rvchips">${chip("yes","Yes",!r.skip)}${chip("pick","Pick another",false)}${chip("backlog","Not in my catalog",false)}${chip("skip","Skip",r.skip)}</div>`
        :!b?`<div class="rvchips">${chip("backlog","Add to to-add list",r.backlog)}${chip("pick","It’s in my catalog",false)}${chip("skip","Ignore",r.skip&&!r.backlog)}</div>`:""}
    </div>`};
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(shelfName(k))}</div><h2>${st.rows.length} book${st.rows.length===1?"":"s"} found</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    <div class="rvsum"><span class="pill okp">✓ ${nOk} matched</span>${nCheck?`<span class="pill chk">${nCheck} to check</span>`:""}${nAdd?`<span class="pill addp">${nAdd} not in your catalog</span>`:""}</div>
    ${st.rows.length?`<div class="rvlist">${st.rows.map(rowHtml).join("")}</div>`:`<div class="notice"><span>No spines could be read. Try a straighter, closer photo, or add the books by hand.</span></div>`}
    <p class="small muted center">This photo cost about $${st.cost.toFixed(3)} · ${esc(budgetText())}</p>
    <div class="actions"><button class="btn" id="rvMissing">+ A book it missed</button><button class="btn primary" id="rvSave" ${st.rows.some(r=>(r.id&&!r.skip)||r.backlog)?"":"disabled"}>Save this shelf</button></div>`);
  s.addEventListener("click",e=>{
    const c=e.target.closest(".rvchip");if(!c)return;const i=+c.closest(".rvrow").dataset.i,r=st.rows[i],act=c.dataset.act;
    if(act==="skip"){r.skip=true;r.done=true;r.backlog=false}
    else if(act==="backlog"){r.skip=true;r.done=true;r.backlog=true;if(!r.title&&!r.author&&r.id){const bb=byId(r.id);r.read=r.read||(bb&&bb.title)||""}r.id=null;r.cands=null}
    else if(act==="yes"){r.skip=false;r.unsure=false;r.done=true}
    else if(act.startsWith("copy:")){const id=+act.slice(5);const other=st.rows.find(x=>x!==r&&x.id===id&&!x.skip);if(other)other.id=r.id;r.id=id;r.skip=false;r.done=true}
    else if(act==="pick"){openBookPicker({k:null,single:true,onCancel:()=>showReview(k,st)},ids=>{const id=ids[0];st.rows.forEach(x=>{if(x!==r&&x.id===id)x.skip=true});r.id=id;r.cands=null;r.unsure=false;r.skip=false;r.done=true;r.backlog=false;showReview(k,st)});return}
    showReview(k,st);
  });
  $("#rvMissing",s).onclick=()=>openBookPicker({k:null,single:true,onCancel:()=>showReview(k,st)},ids=>{const id=ids[0];if(!st.rows.some(x=>x.id===id&&!x.skip))st.rows.push({read:"",id,cands:null,unsure:false,skip:false});showReview(k,st)});
  $("#rvSave",s).onclick=()=>shelfChanges(k,st);
}
function shelfChanges(k,st){
  const fin=[...new Set(st.rows.filter(r=>r.id&&!r.skip&&!r.backlog).map(r=>r.id))];
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
  const items=[];let left=0;st.rows.forEach(r=>{if(r.id&&!r.skip&&!r.backlog){left=r.id;return}if(r.backlog)items.push({title:r.title||"",author:r.author||"",read:r.read||"",shelf:k,after:left})});
  const btn=$("#chSave")||$("#rvSave");if(btn){btn.disabled=true;btn.textContent="Saving…"}
  const ok=ids.length||prev.length?await placeMoves(moves,items.length?"":"Shelf saved"):true;
  if(!ok){if(btn){btn.disabled=false;btn.textContent="Try again"}return}
  if(items.length){try{const d=await api("backlog_add",{items:items.slice(0,40)});setBacklog(d.backlog);
    toast(d.added?`Shelf saved · ${d.added} book${d.added===1?"":"s"} added to your to-add list`:"Shelf saved")}catch(e){handleApiError(e,"Shelf saved, but the to-add list wasn’t")}}
  openShelf(k);
}

/* to add: books seen on shelf photos that aren't in the catalog yet */
async function removeBacklog(id){try{const d=await api("backlog_remove",{id});setBacklog(d.backlog);return true}catch(e){handleApiError(e,"Couldn’t update the list");return false}}
// Put a book where the spine was seen: right after the book that was on its left.
function placeAfter(x,id){
  if(!x.shelf||!shelfOk(x.shelf))return Promise.resolve(true);
  const ids=idsOn(x.shelf,[id]),i=x.after?ids.indexOf(x.after):-1;
  ids.splice(!x.after?0:i>=0?i+1:ids.length,0,id);
  return placeMoves([{shelf:x.shelf,ids}]);
}
function openBacklog(){
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">From your shelf photos</div><h2>To add</h2></div><button class="x" data-close aria-label="Close">×</button></div>
    ${backlog.length?`<p class="small muted">Books Claude saw on your shelves that aren’t in your catalog. Add one and it goes straight to the spot where it was seen.</p>
      <div class="todolist">${backlog.map(x=>`<div class="card todo" data-t="${esc(x.id)}"><div class="todotxt"><b>${esc(x.title||x.read||"Unknown book")}</b>
        ${x.author||(x.read&&x.read!==x.title)?`<span class="small muted">${esc([x.author,x.read&&x.read!==x.title?`spine: “${x.read}”`:""].filter(Boolean).join(" · "))}</span>`:""}
        <span class="small muted">${x.shelf&&shelfOk(x.shelf)?`Seen on ${esc(shelfName(x.shelf,true))}`:"Seen on a shelf photo"}${x.seen?` · ${esc(fmtDay(x.seen))}`:""}</span></div>
        <div class="actions"><button class="btn danger left" data-act="remove">Remove</button><button class="btn" data-act="have">Already in catalog</button><button class="btn primary" data-act="add">Add to catalog</button></div></div>`).join("")}</div>`
    :`<div class="notice"><strong>All done</strong><span>Nothing left to add.</span></div>`}`);
  s.addEventListener("click",async e=>{
    const btn=e.target.closest("[data-act]");if(!btn)return;const x=backlog.find(y=>y.id===btn.closest("[data-t]").dataset.t);if(!x)return;
    const act=btn.dataset.act;
    if(act==="remove"){btn.disabled=true;if(await removeBacklog(x.id)){toast("Removed from the list");openBacklog()}else btn.disabled=false}
    else if(act==="add")addFromBacklog(x);
    else if(act==="have")openBookPicker({k:null,single:true,onCancel:openBacklog},async ids=>{
      const b=books.find(y=>y.id===ids[0]);if(!b)return;
      if(await placeAfter(x,b.id)&&await removeBacklog(x.id))toast(x.shelf&&shelfOk(x.shelf)?`${b.title} placed on ${shelfName(x.shelf,true)}`:"Removed from the list");
      if(backlog.length)openBacklog();
    });
  });
}
function addFromBacklog(x){
  const pre={title:x.title||"",author:x.author||""};
  const after=async saved=>{const placed=x.shelf&&shelfOk(x.shelf);await placeAfter(x,saved.id);await removeBacklog(x.id);
    toast(`Added as No. ${pad(saved.id)}${placed?` and placed on ${shelfName(x.shelf,true)}`:""}`)};
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">To add</div><h2>${esc(x.title||x.read||"Add a book")}</h2></div><button class="x" id="afX" aria-label="Close">×</button></div>
   <div class="choice">
     ${hasClaude?`<button class="btn primary" id="afCam">${ICON.cam.replace('width="18" height="18"','width="26" height="26"')}<span>Take photos<small>Take the book off the shelf and photograph it. Claude and the barcode fill in the details.</small></span></button>`:""}
     <button class="btn" id="afType">${ICON.pen}<span>Type it in<small>The title${x.author?" and author":""} Claude read on the spine are filled in for you.</small></span></button>
   </div>
   <p class="budgetline">${esc(budgetText())}</p>`);
  $("#afX",s).onclick=openBacklog;
  const cam=$("#afCam",s);if(cam)cam.onclick=()=>{closeSheet();openCamera({steps:ADD_STEPS,max:MAX_PHOTOS},r=>openForm(null,r,pre,after))};
  $("#afType",s).onclick=()=>openForm(null,null,pre,after);
}

/* ---------- covers: found online (free), shown as 3D books; your own photos stay saved ---------- */
const httpsImg=u=>u?String(u).replace(/^http:\/\//,"https://").replace(/&edge=curl/g,""):"";
const COVER_OK=/^https:\/\/(books\.google\.com|books\.googleusercontent\.com|covers\.openlibrary\.org)\/[A-Za-z0-9\/_.,=&?%-]{1,600}$/;
// What the book shows: the online cover by default, your photo if you chose it (or if there's no online cover), else a designed cover.
const coverMode=b=>(b.coverPref==="photo"&&b.hasPhoto)?"photo":b.coverUrl?"online":b.hasPhoto?"photo":"none";
const paletteOf=b=>{const c=String(b.coverColors||"").split(",").filter(x=>/^#[0-9a-f]{6}$/i.test(x));return c.length===3?c:null};
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const rgb2hex=a=>"#"+a.map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,"0")).join("");
const lumOf=h=>{const [r,g,b]=hex2rgb(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b};
const contrast=(a,b)=>{const x=lumOf(a),y=lumOf(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const mix=(h,t,k)=>rgb2hex(hex2rgb(h).map((v,i)=>v+(hex2rgb(t)[i]-v)*k));
// Three colours from a cover: a deep one (band), the most colourful one (sprayed edges, accents) and a light one (text).
function paletteFromImage(img){
  const W=36,H=54,cv=document.createElement("canvas");cv.width=W;cv.height=H;const g=cv.getContext("2d");g.drawImage(img,0,0,W,H);
  const px=g.getImageData(0,0,W,H).data,buckets=new Map();
  for(let i=0;i<px.length;i+=4){const k=(px[i]>>4)<<8|(px[i+1]>>4)<<4|(px[i+2]>>4);const e=buckets.get(k)||[0,0,0,0];e[0]+=px[i];e[1]+=px[i+1];e[2]+=px[i+2];e[3]++;buckets.set(k,e)}
  const all=[...buckets.values()].map(e=>({hex:rgb2hex([e[0]/e[3],e[1]/e[3],e[2]/e[3]]),n:e[3]})).sort((a,b)=>b.n-a.n);
  const total=W*H,big=all.filter(c=>c.n>=total*.02);
  const sat=h=>{const [r,g2,b]=hex2rgb(h);const mx=Math.max(r,g2,b),mn=Math.min(r,g2,b);return mx?(mx-mn)/mx:0};
  let dark=(big.find(c=>lumOf(c.hex)<.08)||{}).hex||mix(all[0].hex,"#000000",.6);
  if(lumOf(dark)>.08)dark=mix(dark,"#000000",.45);
  const light=(big.slice().sort((a,b)=>lumOf(b.hex)-lumOf(a.hex))[0]||{}).hex;
  const lightOk=light&&lumOf(light)>.55&&contrast(dark,light)>=4.5?light:mix(light||"#ffffff","#ffffff",.75);
  const dist=(x,y)=>{const p=hex2rgb(x),q=hex2rgb(y);return Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])};
  const far=all.filter(c=>c.n>=total*.006&&dist(c.hex,dark)>70&&dist(c.hex,all[0].hex)>40);
  const accent=((far.length?far:big).slice().sort((a,b)=>(sat(b.hex)+.35)*Math.sqrt(b.n)-(sat(a.hex)+.35)*Math.sqrt(a.n))[0]||{hex:mix(dark,"#ffffff",.45)}).hex;
  return [dark,accent,contrast(dark,lightOk)>=4.5?lightOk:"#F4F7F4"];
}
function paletteFromB64(b64,type){return new Promise(res=>{const img=new Image();img.onload=()=>{try{res(paletteFromImage(img))}catch(e){res(null)}};img.onerror=()=>res(null);img.src=`data:${type||"image/jpeg"};base64,${b64}`})}
// The script fetches the images (the app can't read pixels from other sites) and the colours are worked out here.
async function coverColors(urls){
  const d=await api("cover_fetch",{urls});
  return Promise.all((d.covers||[]).map(c=>c&&c.image?paletteFromB64(c.image,c.type):null));
}

/* finding covers: Google Books and Open Library, by ISBN first, then by title */
async function findCoverCandidates(b,{quick=false,query=""}={}){
  const out=[],seen=new Set(),isbns=isbnDigits(b.isbn);
  const add=c=>{if(!c.url||!COVER_OK.test(c.url))return;const k=c.key||c.url;if(seen.has(k))return;seen.add(k);out.push(c)};
  const gbF="items(id,volumeInfo(title,publisher,publishedDate,imageLinks,industryIdentifiers,printType))";
  const gbAdd=async(items,exactIsbns,limit)=>{
    for(const it of (items||[]).filter(x=>x.volumeInfo&&x.volumeInfo.imageLinks).slice(0,limit)){
      const vi=it.volumeInfo;let links=vi.imageLinks;
      const det=await getJson(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(it.id)}?fields=volumeInfo(imageLinks)`);
      if(det&&det.volumeInfo&&det.volumeInfo.imageLinks)links={...links,...det.volumeInfo.imageLinks};
      const ids=(vi.industryIdentifiers||[]).map(x=>x.identifier);
      add({key:"gb:"+it.id,url:httpsImg(links.large||links.medium||links.small||links.thumbnail),thumb:httpsImg(links.thumbnail||links.smallThumbnail),
        src:"Google Books",label:[vi.publisher,yearIn(vi.publishedDate)||""].filter(Boolean).join(" · ")||"Edition not stated",exact:exactIsbns.some(x=>ids.includes(x))});
    }
  };
  const olAdd=async(workKey,exactIsbns,limit)=>{
    if(!/^\/works\/OL\d+W$/.test(workKey||""))return;
    const e=await getJson(`https://openlibrary.org${workKey}/editions.json?limit=60`);
    const eds=((e&&e.entries)||[]).filter(x=>(x.covers||[]).some(c=>c>0));
    eds.sort((a,c)=>{const ex=x=>[...(x.isbn_13||[]),...(x.isbn_10||[])].some(i=>exactIsbns.includes(i))?0:1;return ex(a)-ex(c)});
    for(const x of eds.slice(0,limit)){const id=x.covers.find(c=>c>0);
      add({key:"ol:"+id,url:`https://covers.openlibrary.org/b/id/${id}-L.jpg`,thumb:`https://covers.openlibrary.org/b/id/${id}-M.jpg`,src:"Open Library",
        label:[(x.publishers||[])[0],yearIn(x.publish_date)||"",x.physical_format].filter(Boolean).join(" · ")||"Edition not stated",
        exact:[...(x.isbn_13||[]),...(x.isbn_10||[])].some(i=>exactIsbns.includes(i))});}
  };
  if(!query){
    for(const i of isbns.slice(0,2)){
      const j=await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${i}&maxResults=3&fields=${gbF}`);
      await gbAdd(j&&j.items,isbns,2);
      const o=await getJson(`https://openlibrary.org/search.json?q=isbn:${i}&fields=key&limit=1`);
      await olAdd(o&&o.docs&&o.docs[0]&&o.docs[0].key,isbns,quick?2:5);
    }
    if(quick&&out.some(c=>c.exact))return out.sort((a,c)=>c.exact-a.exact);
  }
  const terms=query?[query]:titleVariants(b.title).slice(0,quick?1:2);
  for(const t of terms){
    if(out.length>=9)break;
    const qa=query?`q=${encodeURIComponent(query)}`:`q=${encodeURIComponent(`intitle:${t}`+(b.author?` inauthor:${b.author}`:""))}`;
    const j=await getJson(`https://www.googleapis.com/books/v1/volumes?${qa}&maxResults=8&fields=${gbF}`);
    await gbAdd(j&&j.items,isbns,quick?2:4);
    const o=await getJson(query?`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key&limit=1`:`https://openlibrary.org/search.json?title=${encodeURIComponent(t)}${b.author?`&author=${encodeURIComponent(b.author)}`:""}&fields=key&limit=1`);
    await olAdd(o&&o.docs&&o.docs[0]&&o.docs[0].key,isbns,quick?2:4);
  }
  return out.sort((a,c)=>c.exact-a.exact).slice(0,9);
}

/* one cover image or a designed stand-in, for the 3D book, the wall and the picker */
function coverFaceHtml(b,mode){
  mode=mode||coverMode(b);
  if(mode==="online")return `<img class="cimg" src="${esc(b.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${b.id}">`;
  if(mode==="photo")return `<img class="cimg mine" alt="" data-photo="${b.id}">`;
  const lw=Math.max(...String(b.title||"").split(/\s+/).map(w=>w.length),0);
  return `<span class="cph ${colorCls(b)}${lw>12?" xs":lw>8?" s":""}"><i>${esc(b.title)}</i>${b.author?`<em>${esc(b.author)}</em>`:""}</span>`;
}
// Load photos when they scroll into view; swap broken online covers for the designed stand-in.
let photoObserver=null;
function wireCoverImages(root){
  $$("img[data-fallback]",root).forEach(img=>{if(img._w)return;img._w=1;img.addEventListener("error",()=>{const b=books.find(x=>x.id===+img.dataset.fallback);if(b)img.outerHTML=coverFaceHtml(b,b.hasPhoto?"photo":"none");wireCoverImages(root)})});
  const load=img=>{const b=books.find(x=>x.id===+img.dataset.photo);if(!b)return;photoUrl(b).then(u=>{if(u)img.src=u;else img.outerHTML=coverFaceHtml(b,"none")}).catch(()=>{})};
  const ph=$$("img[data-photo]:not([src])",root);if(!ph.length)return;
  if(!("IntersectionObserver" in window)){ph.forEach(load);return}
  if(!photoObserver)photoObserver=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){photoObserver.unobserve(e.target);load(e.target)}}),{rootMargin:"300px"});
  ph.forEach(i=>photoObserver.observe(i));
}
// Colours from the cover go into CSS variables (inline styles are blocked by the page's security rules).
function applyPalette(el,b){
  const p=paletteOf(b);if(!el)return;
  if(!p)return;
  el.style.setProperty("--cv-dark",p[0]);el.style.setProperty("--cv-accent",p[1]);el.style.setProperty("--cv-light",p[2]);el.classList.add("haspal");
}

/* choosing the cover of one book */
function openCoverPicker(b,o={}){
  let cands=o.cands||null,picked=-1,query="";
  const s=sheet(`<div class="sheet-head"><div><div class="eyebrow">${esc(b.title)}${b.author?" · "+esc(b.author):""}</div><h2>Choose the cover</h2>
      <div class="sub">Your copy: ${esc([b.cover,b.publisher,b.editionYear].filter(Boolean).join(", ")||"edition not recorded")}</div></div><button class="x" id="cpX" aria-label="Close">×</button></div>
    <div id="cpBody"><div class="notice"><span>Searching Google Books and Open Library…</span></div></div>
    <form class="cpsearch" id="cpSearch"><input class="field" id="cpQ" type="search" placeholder="Search other words: title, author, publisher" value="${esc(query)}" autocomplete="off"><button class="btn" type="submit">Search</button></form>
    <div class="card cpphoto">${b.hasPhoto?`<img class="cpthumb" data-photo="${b.id}" alt="">`:`<span class="cpthumb none">${ICON.cam}</span>`}
      <span class="cptxt"><b>Your photo</b><span class="small muted">${b.hasPhoto?"Kept in your Drive. Show it instead of an online cover any time.":"Photograph your own copy."}</span></span>
      <span class="cpbtns">${b.hasPhoto?`<button class="btn" id="cpFix">Edit</button>`:""}${b.hasPhoto?`<button class="btn" id="cpUsePhoto" ${coverMode(b)==="photo"?"disabled":""}>${coverMode(b)==="photo"?"Shown":"Use it"}</button>`:""}<button class="btn" id="cpPhoto">${b.hasPhoto?"Retake":"Take photo"}</button></span></div>
    <p class="small err" id="cpMsg"></p>
    <div class="actions">${b.coverUrl?`<button class="btn danger left" id="cpRemove">Remove online cover</button>`:""}${o.onSkip?`<button class="btn" id="cpSkip">Skip</button>`:`<button class="btn" id="cpCancel">Cancel</button>`}<button class="btn primary" id="cpUse" disabled>Use this cover</button></div>`);
  wireCoverImages(s);
  const msg=$("#cpMsg",s),useBtn=$("#cpUse",s);
  const done=()=>{closeSheet();if(o.onDone)o.onDone();else{render();if($(".book"))openBook(b.id)}};
  $("#cpX",s).onclick=()=>{closeSheet();if(o.onClose)o.onClose()};
  const cc=$("#cpCancel",s);if(cc)cc.onclick=()=>{closeSheet();if(o.onClose)o.onClose()};
  const sk=$("#cpSkip",s);if(sk)sk.onclick=()=>{closeSheet();o.onSkip()};
  const paint=()=>{
    const body=$("#cpBody",s);
    if(!cands)return;
    if(!cands.length){body.innerHTML=`<div class="notice"><span>No covers found${query?` for “${esc(query)}”`:""}. Try other words below, or use your photo.</span></div>`;return}
    body.innerHTML=`<div class="cpgrid">${cands.map((c,i)=>`<button class="cpc" data-i="${i}" aria-pressed="${i===picked}"><span class="cpimg"><img src="${esc(c.thumb||c.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">${c.exact?`<span class="cpexact">Your ISBN</span>`:""}</span><span class="cpsrc">${esc(c.src)}</span><span class="cplab">${esc(c.label)}</span></button>`).join("")}</div>`;
    $$(".cpimg img",body).forEach(img=>img.addEventListener("error",()=>{const bt=img.closest(".cpc");if(bt)bt.remove()}));
    useBtn.disabled=picked<0;
  };
  const search=async q=>{query=q;cands=null;picked=-1;useBtn.disabled=true;$("#cpBody",s).innerHTML=`<div class="notice"><span>Searching Google Books and Open Library…</span></div>`;
    try{cands=await findCoverCandidates(b,{query:q})}catch(e){cands=[]}
    if(!s.isConnected)return;picked=cands.findIndex(c=>c.exact&&c.url===b.coverUrl);if(picked<0)picked=cands.findIndex(c=>c.url===b.coverUrl);if(picked<0&&!q)picked=cands.findIndex(c=>c.exact);paint()};
  $("#cpBody",s).addEventListener("click",e=>{const c=e.target.closest(".cpc");if(!c)return;picked=+c.dataset.i;$$(".cpc",s).forEach(x=>x.setAttribute("aria-pressed",String(+x.dataset.i===picked)));useBtn.disabled=false});
  $("#cpSearch",s).addEventListener("submit",e=>{e.preventDefault();search($("#cpQ",s).value.trim())});
  useBtn.onclick=async()=>{
    const c=cands&&cands[picked];if(!c)return;useBtn.disabled=true;useBtn.textContent="Saving…";msg.textContent="";
    try{
      const [pal]=await coverColors([c.url]);
      if(!pal){msg.textContent="That cover couldn’t be loaded. Pick another one.";useBtn.textContent="Use this cover";useBtn.disabled=false;return}
      const d=await api("covers_set",{items:[{id:b.id,url:c.url,colors:pal.join(",")}]});(d.books||[]).forEach(upsertBook);
      const nb=books.find(x=>x.id===b.id);if(nb&&nb.coverPref==="photo")await quickSave(nb,{coverPref:""});
      toast("Cover saved");done();
    }catch(e){useBtn.textContent="Use this cover";useBtn.disabled=false;handleApiError(e,"Couldn’t save the cover")}
  };
  const cf=$("#cpFix",s);if(cf)cf.onclick=()=>{closeSheet();openStraighten(b,{onSaved:()=>{if(o.onDone)o.onDone();else{render();if($(".book"))openBook(b.id)}},onClose:()=>openCoverPicker(books.find(x=>x.id===b.id)||b,o)})};
  const up=$("#cpUsePhoto",s);if(up)up.onclick=async()=>{up.disabled=true;try{await quickSave(b,{coverPref:"photo"});toast("Showing your photo");done()}catch(e){up.disabled=false;handleApiError(e,"Couldn’t save")}};
  const rm=$("#cpRemove",s);if(rm)rm.onclick=async()=>{rm.disabled=true;try{const d=await api("covers_set",{items:[{id:b.id,url:""}]});(d.books||[]).forEach(upsertBook);toast("Online cover removed");done()}catch(e){rm.disabled=false;handleApiError(e,"Couldn’t remove")}};
  $("#cpPhoto",s).onclick=()=>{closeSheet();openCamera({steps:COVER_STEPS,max:1},async r=>{
    if(!r.photos.length){openCoverPicker(b,o);return}
    cropNewPhoto(b.title,r.photos[0].blob,async(shown,asTaken)=>{
      if(!shown){openCoverPicker(books.find(x=>x.id===b.id)||b,o);return}
      try{let nb=await saveNewPhoto(b.id,shown,asTaken);
        if(nb.coverUrl&&nb.coverPref!=="photo")nb=await quickSave(nb,{coverPref:"photo"});toast("Photo saved");if(o.onDone)o.onDone();else{render();if($(".book"))openBook(b.id)}}
      catch(e){handleApiError(e,"Couldn’t save the photo")}
    });
  })};
  if(cands){picked=cands.findIndex(c=>c.exact);paint()}else search("");
}

/* finding covers for every book at once */
let coverRun=null; // {rows:[{b,state:'wait'|'search'|'found'|'choose'|'none'|'saved',cands,pick}], running}
function closeCoverRun(){const v=$(".coverv");if(v)v.remove();syncScroll()}
function openCoverRun(){
  closeCoverRun();
  const v=document.createElement("div");v.className="twinv coverv";v.setAttribute("role","dialog");v.setAttribute("aria-label","Find covers");document.body.append(v);syncScroll();
  if(!coverRun||(!coverRun.running&&!coverRun.rows.some(r=>["found","choose"].includes(r.state)))){
    coverRun={rows:books.filter(b=>owned(b)&&!b.coverUrl).sort((a,b)=>a.id-b.id).map(b=>({b,state:"wait"})),running:false,t0:0,doneN:0};
  }
  v.addEventListener("click",e=>{const t=e.target.closest("button");if(!t)return;
    if(t.id==="crBack"){closeCoverRun();render();return}
    if(t.id==="crStart"){runCoverSearch(v);return}
    if(t.id==="crUse"){useFoundCovers(v);return}
    if(t.id==="crChoose"){chooseCovers(v);return}
    if(t.dataset.row){const r=coverRun.rows[+t.dataset.row];if(r&&["found","choose","none"].includes(r.state))openCoverPicker(r.b,{cands:r.cands,onDone:()=>{r.state=books.find(x=>x.id===r.b.id).coverUrl?"saved":r.state;paintCoverRun(v)},onClose:()=>paintCoverRun(v)})}
  });
  paintCoverRun(v);
}
function paintCoverRun(v){
  if(!v||!v.isConnected)return;const R=coverRun.rows,cnt=s=>R.filter(r=>r.state===s).length;
  const searched=R.filter(r=>!["wait","search"].includes(r.state)).length;
  const left=coverRun.running&&coverRun.doneN?Math.ceil((Date.now()-coverRun.t0)/coverRun.doneN*(R.length-searched)/60000):0;
  const lab={wait:"",search:"Searching…",found:"Found",choose:"Choose",none:"Not found",saved:"Saved ✓"};
  v.innerHTML=`<div class="statsv-inner">
    <div class="statsv-head"><button class="roundbtn" id="crBack" aria-label="Back">${ICON.back}</button><div class="grow1"><div class="eyebrow">All books · free</div><h1>Find covers</h1></div></div>
    ${!R.length?`<div class="notice"><strong>Every book has a cover</strong><span>Change one from its book page.</span></div>`:`
    <div class="card crprog"><div class="crline"><span><b>${coverRun.running?"Searching…":searched?"Search done":"Ready"}</b> ${searched} of ${R.length}</span><span class="muted">${left?`about ${left} min left`:""}</span></div>
      <div class="crbar"><span data-w="${R.length?(100*searched/R.length).toFixed(1):0}"></span></div>
      <div class="crchips"><span class="pill okp">✓ ${cnt("found")+cnt("saved")} found</span><span class="pill chk">${cnt("choose")} to choose</span><span class="pill nonep">${cnt("none")} not found</span></div>
      ${!coverRun.running&&!searched?`<p class="small muted">Looks up the ${R.length} books without an online cover on Google Books and Open Library, by ISBN first. Nothing is saved until you choose. Your own photos stay saved.</p><button class="btn primary" id="crStart">Start searching</button>`:""}</div>
    <div class="crlist">${R.map((r,i)=>`<button class="crrow st-${r.state}" data-row="${i}" ${["found","choose","none"].includes(r.state)?"":"disabled"}><span class="crcov">${r.pick?`<img src="${esc(r.pick.thumb||r.pick.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:coverFaceHtml(r.b,r.b.hasPhoto?"photo":"none")}</span>
      <span class="otxt"><span class="t">${esc(r.b.title)}</span><span class="s">No. ${pad(r.b.id)} · ${r.state==="found"?esc(r.pick.exact?"matched by ISBN":r.pick.src):r.state==="choose"?`${r.cands.length} option${r.cands.length===1?"":"s"}`:r.state==="none"?(r.b.hasPhoto?"not found online · your photo stays":"not found online"):r.state==="saved"?"cover saved":""}</span></span><span class="crtag">${lab[r.state]}</span></button>`).join("")}</div>
    ${!coverRun.running&&searched?`<div class="actions sticky">${cnt("choose")?`<button class="btn" id="crChoose">Choose the ${cnt("choose")}</button>`:""}${cnt("found")?`<button class="btn primary" id="crUse">Use the ${cnt("found")} found</button>`:""}</div>`:""}`}
  </div>`;
  $$("[data-w]",v).forEach(el=>el.style.width=el.dataset.w+"%");
  wireCoverImages(v);
}
async function runCoverSearch(v){
  if(coverRun.running)return;coverRun.running=true;coverRun.t0=Date.now();coverRun.doneN=0;paintCoverRun(v);
  const queue=coverRun.rows.filter(r=>r.state==="wait");let last=0;
  const worker=async()=>{while(queue.length){const r=queue.shift();r.state="search";
    let cands=[];try{cands=await findCoverCandidates(r.b,{quick:true})}catch(e){}
    r.cands=cands;const ex=cands.filter(c=>c.exact);
    if(ex.length){r.state="found";r.pick=ex[0]}else if(cands.length){r.state="choose";r.pick=null}else r.state="none";
    coverRun.doneN++;if(Date.now()-last>400){last=Date.now();paintCoverRun($(".coverv"))}}};
  await Promise.all([worker(),worker(),worker()]);
  coverRun.running=false;paintCoverRun($(".coverv"));
}
async function useFoundCovers(v){
  const todo=coverRun.rows.filter(r=>r.state==="found");const btn=$("#crUse",v);let n=0;
  for(let i=0;i<todo.length;i+=6){
    const chunk=todo.slice(i,i+6);if(btn){btn.disabled=true;btn.textContent=`Saving ${Math.min(i+6,todo.length)} of ${todo.length}…`}
    try{
      const pals=await coverColors(chunk.map(r=>r.pick.url));
      const items=chunk.map((r,j)=>pals[j]?{id:r.b.id,url:r.pick.url,colors:pals[j].join(",")}:null).filter(Boolean);
      chunk.forEach((r,j)=>{if(!pals[j]){r.state=r.cands.length>1?"choose":"none";r.pick=null}});
      if(items.length){const d=await api("covers_set",{items});(d.books||[]).forEach(upsertBook);chunk.forEach(r=>{if(r.state==="found"){r.state="saved";n++}})}
    }catch(e){handleApiError(e,"Couldn’t save some covers");break}
  }
  toast(`${n} cover${n===1?"":"s"} saved`);render();paintCoverRun($(".coverv"));
}
function chooseCovers(v){
  const list=coverRun.rows.filter(r=>r.state==="choose");let i=0;
  const next=()=>{const r=list[i++];if(!r){paintCoverRun($(".coverv"));return}
    openCoverPicker(r.b,{cands:r.cands,onDone:()=>{if(books.find(x=>x.id===r.b.id).coverUrl)r.state="saved";next()},onSkip:next,onClose:()=>paintCoverRun($(".coverv"))})};
  next();
}

/* ---------- straighten and clean up your own cover photos (the photo as taken is always kept) ---------- */
const b64ToUrl=(b64,type)=>{const bin=atob(b64);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return URL.createObjectURL(new Blob([a],{type:type||"image/jpeg"}))};
const loadImg=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src});
const origCache=new Map(); // book id → object URL of the photo as taken
async function originalPhoto(b){
  if(origCache.has(b.id))return origCache.get(b.id);
  if(!b.photoFixed)return photoUrl(b); // not straightened yet: the photo as taken is the current one
  const d=await api("photo_original",{id:b.id});if(!d.image)return null;
  const u=b64ToUrl(d.image);origCache.set(b.id,u);return u;
}
const DEFAULT_CORNERS=[[.04,.04],[.96,.04],[.96,.96],[.04,.96]];
// Perspective: the matrix that maps the flat result (dst) back onto the photo (src).
function homography(src,dst){
  const A=[],B=[];
  for(let i=0;i<4;i++){const [x,y]=dst[i],[u,v]=src[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v)}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];
    for(let r=0;r<8;r++){if(r===c||!A[c][c])continue;const f=A[r][c]/A[c][c];for(let k=c;k<8;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c]}}
  return [...B.map((v,i)=>v/(A[i][i]||1)),1];
}
// Cut the cover out of the photo and lay it flat. corners: fractions (top-left, top-right, bottom-right, bottom-left).
function straighten(img,corners,maxSide){
  const sw0=img.naturalWidth||img.width,sh0=img.naturalHeight||img.height;
  const pre=Math.min(1,(maxSide*1.6)/Math.max(sw0,sh0)),sw=Math.round(sw0*pre),sh=Math.round(sh0*pre);
  const sc=document.createElement("canvas");sc.width=sw;sc.height=sh;const g0=sc.getContext("2d");g0.drawImage(img,0,0,sw,sh);const S=g0.getImageData(0,0,sw,sh).data;
  const q=corners.map(([x,y])=>[x*sw,y*sh]),dd=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let W=(dd(q[0],q[1])+dd(q[3],q[2]))/2,H=(dd(q[0],q[3])+dd(q[1],q[2]))/2;
  const k=Math.min(1/pre,maxSide/Math.max(W,H));W=Math.max(20,Math.round(W*k));H=Math.max(30,Math.round(H*k));
  const h=homography(q,[[0,0],[W,0],[W,H],[0,H]]);
  const out=document.createElement("canvas");out.width=W;out.height=H;const go=out.getContext("2d");const O=go.createImageData(W,H),D=O.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const X=x+.5,Y=y+.5,den=h[6]*X+h[7]*Y+1,u=(h[0]*X+h[1]*Y+h[2])/den-.5,v=(h[3]*X+h[4]*Y+h[5])/den-.5;
    const x0=Math.max(0,Math.min(sw-2,Math.floor(u))),y0=Math.max(0,Math.min(sh-2,Math.floor(v))),fx=Math.max(0,Math.min(1,u-x0)),fy=Math.max(0,Math.min(1,v-y0));
    const a=(y0*sw+x0)*4,b2=a+4,c=a+sw*4,d=c+4,o=(y*W+x)*4;
    for(let ch=0;ch<3;ch++)D[o+ch]=S[a+ch]*(1-fx)*(1-fy)+S[b2+ch]*fx*(1-fy)+S[c+ch]*(1-fx)*fy+S[d+ch]*fx*fy;D[o+3]=255;
  }
  go.putImageData(O,0,0);return out;
}
// Better colours: a gentle white balance, contrast stretch and a little more colour.
function enhance(cv){
  const g=cv.getContext("2d"),im=g.getImageData(0,0,cv.width,cv.height),p=im.data,n=p.length/4;
  const hist=new Uint32Array(256);let sr=0,sg=0,sb=0;
  for(let i=0;i<p.length;i+=4){hist[(p[i]*299+p[i+1]*587+p[i+2]*114)/1000|0]++;sr+=p[i];sg+=p[i+1];sb+=p[i+2]}
  const pct=f=>{let a=0;for(let i=0;i<256;i++){a+=hist[i];if(a>=n*f)return i}return 255};
  const lo=Math.min(pct(.005),40),hi=Math.max(pct(.995),200),k=Math.min(1.5,255/Math.max(1,hi-lo));
  const avg=(sr+sg+sb)/3,wb=[sr,sg,sb].map(s=>1+(Math.max(.82,Math.min(1.22,avg/Math.max(1,s)))-1)*.5);
  for(let i=0;i<p.length;i+=4){
    let r=(p[i]*wb[0]-lo)*k,gg=(p[i+1]*wb[1]-lo)*k,b=(p[i+2]*wb[2]-lo)*k;const l=r*.299+gg*.587+b*.114;
    p[i]=l+(r-l)*1.12;p[i+1]=l+(gg-l)*1.12;p[i+2]=l+(b-l)*1.12;
  }
  g.putImageData(im,0,0);return cv;
}
async function canvasJpeg(cv){let q=.9,blob;for(let i=0;i<4;i++){blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",q));if(blob&&blob.size<950000)break;q-=.12}return blob}
async function makeStraight(img,corners,better){const cv=straighten(img,corners,1400);if(better)enhance(cv);return canvasJpeg(cv)}
async function findCorners(ids){
  const d=await api("photo_corners",{ids});
  if(d.budget){budget=d.budget;store.set("bc-budget",budget)}
  return d.corners||{};
}
async function saveStraight(b,blob){
  const d=await api("photo_improve",{id:b.id,image:await blobToB64(blob)});
  if(!b.photoFixed&&photoCache.has(b.id)){origCache.set(b.id,photoCache.get(b.id));photoCache.delete(b.id)} // the photo as taken stays at hand
  setCachedPhoto(b.id,blob);return upsertBook(d.book);
}

/* the photo editor: Crop (a straight rectangle) or Straighten (four free corners) */
function closeFix(){const v=$(".fixv");if(v)v.remove();syncScroll()}
const toRect=c=>{const xs=c.map(p=>p[0]),ys=c.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]};
const isRect=c=>Math.abs(c[0][1]-c[1][1])<1e-6&&Math.abs(c[3][1]-c[2][1])<1e-6&&Math.abs(c[0][0]-c[3][0])<1e-6&&Math.abs(c[1][0]-c[2][0])<1e-6;
const FULL_RECT=[[.03,.03],[.97,.03],[.97,.97],[.03,.97]];
// A plain crop keeps every pixel sharp; a straightened one is redrawn flat.
async function editedBlob(img,corners,better,mode){
  let cv;
  if(mode==="crop"||isRect(corners)){const r=toRect(corners),W=img.naturalWidth,H=img.naturalHeight,sx=r[0][0]*W,sy=r[0][1]*H,sw=(r[1][0]-r[0][0])*W,sh=(r[2][1]-r[0][1])*H,k=Math.min(1,1568/Math.max(sw,sh));
    cv=document.createElement("canvas");cv.width=Math.max(10,Math.round(sw*k));cv.height=Math.max(10,Math.round(sh*k));cv.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,cv.width,cv.height)}
  else cv=straighten(img,corners,1400);
  if(better)enhance(cv);
  return canvasJpeg(cv);
}
// o: {title, src (image url), mode, corners, better, canFind (book id for Claude), restore, saveLabel, onSave(img,corners,better,mode) → Promise, onClose}
async function openPhotoEditor(o){
  closeFix();
  let mode=o.mode||"crop",corners=(o.corners||(mode==="crop"?FULL_RECT:DEFAULT_CORNERS)).map(p=>p.slice()),better=o.better!==false,img=null,prevT=0;
  if(mode==="crop")corners=toRect(corners);
  const v=document.createElement("div");v.className="fixv";v.setAttribute("role","dialog");v.setAttribute("aria-label","Edit photo");
  v.innerHTML=`<div class="fixin">
    <div class="fixtop"><button class="x" id="fxX" aria-label="Close">×</button><div class="grow1"><div class="eyebrow">${esc(o.title||"")}</div><h2>Edit your photo</h2></div></div>
    <div class="fxmodes" role="group" aria-label="How to cut the photo"><button data-mode="crop">Crop</button><button data-mode="straighten">Straighten</button></div>
    <div class="fixstage" id="fxStage"><div class="notice"><span>Loading your photo…</span></div></div>
    <p class="fixmsg" id="fxMsg"></p>
    <div class="fixrow"><div class="fixprev"><canvas id="fxPrev" aria-label="Preview of the result" role="img"></canvas><span>Result</span></div>
      <div class="fixopts"><label class="fxtog"><input type="checkbox" id="fxBetter" ${better?"checked":""}> Better colours</label>
        ${o.canFind&&hasClaude?`<button class="btn" id="fxAuto">Find the corners</button>`:""}<button class="btn" id="fxReset">Reset</button></div></div>
    <div class="actions">${o.restore?`<button class="btn left" id="fxRestore">Back to the original</button>`:""}${o.skipLabel?`<button class="btn" id="fxSkip">${esc(o.skipLabel)}</button>`:`<button class="btn" id="fxCancel">Cancel</button>`}<button class="btn primary" id="fxSave" disabled>${esc(o.saveLabel||"Save")}</button></div>
  </div>`;
  document.body.append(v);syncScroll();
  const msg=$("#fxMsg",v),stage=$("#fxStage",v),prev=$("#fxPrev",v);
  const close=()=>{closeFix();if(o.onClose)o.onClose()};
  $("#fxX",v).onclick=close;const cc=$("#fxCancel",v);if(cc)cc.onclick=close;
  const sk=$("#fxSkip",v);if(sk)sk.onclick=()=>{closeFix();o.onSkip()};
  const rs=$("#fxRestore",v);if(rs)rs.onclick=async()=>{rs.disabled=true;try{await o.restore();closeFix()}catch(e){rs.disabled=false;handleApiError(e,"Couldn’t restore")}};
  const hint=()=>{msg.textContent=mode==="crop"?"Drag the corners, or the frame itself, to keep just the cover.":"Drag the four dots onto the corners of the cover."};
  const paintModes=()=>$$(".fxmodes button",v).forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.mode===mode)));
  paintModes();hint();
  try{img=await loadImg(await o.src());}catch(e){stage.innerHTML=`<div class="notice"><span>Couldn’t load your photo.</span></div>`;return}
  if(!v.isConnected)return;
  stage.innerHTML=`<div class="fxbox" id="fxBox"><img src="${img.src}" alt="Your photo"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="fxshade" id="fxShade"/><polygon id="fxPoly"/></svg>
    ${["Top-left","Top-right","Bottom-right","Bottom-left"].map((l,i)=>`<button class="fxh" data-k="${i}" aria-label="${l} corner: drag, or use the arrow keys"></button>`).join("")}</div>`;
  const box=$("#fxBox",v),poly=$("#fxPoly",v),shade=$("#fxShade",v),hs=$$(".fxh",v);
  const small=(()=>{const c=document.createElement("canvas"),k=Math.min(1,900/Math.max(img.naturalWidth,img.naturalHeight));c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);c.getContext("2d").drawImage(img,0,0,c.width,c.height);return c})();
  const preview=()=>{let cv;
    if(mode==="crop"){const r=toRect(corners),sw=(r[1][0]-r[0][0])*small.width,sh=(r[2][1]-r[0][1])*small.height,k=260/Math.max(sw,sh);cv=document.createElement("canvas");cv.width=Math.max(4,Math.round(sw*k));cv.height=Math.max(4,Math.round(sh*k));cv.getContext("2d").drawImage(small,r[0][0]*small.width,r[0][1]*small.height,sw,sh,0,0,cv.width,cv.height)}
    else cv=straighten(small,corners,260);
    if(better)enhance(cv);prev.width=cv.width;prev.height=cv.height;prev.getContext("2d").drawImage(cv,0,0)};
  const pts=()=>corners.map(p=>`${p[0]*100},${p[1]*100}`).join(" ");
  const place=()=>{hs.forEach((h,i)=>{h.style.left=corners[i][0]*100+"%";h.style.top=corners[i][1]*100+"%"});poly.setAttribute("points",pts());
    shade.setAttribute("d",`M0,0H100V100H0Z M${corners.map(p=>`${p[0]*100},${p[1]*100}`).join(" L")}Z`);box.classList.toggle("cropmode",mode==="crop")};
  const later=()=>{clearTimeout(prevT);prevT=setTimeout(preview,60)};
  const MIN=.06,cl=x=>Math.max(0,Math.min(1,x));
  // In crop mode a corner moves its two neighbours too, so the frame stays a rectangle.
  const setCorner=(k,x,y)=>{x=cl(x);y=cl(y);
    if(mode!=="crop"){corners[k]=[x,y];return}
    const r=toRect(corners);let [x0,y0]=r[0],[x1,y1]=r[2];
    if(k===0||k===3)x0=Math.min(x,x1-MIN);else x1=Math.max(x,x0+MIN);
    if(k===0||k===1)y0=Math.min(y,y1-MIN);else y1=Math.max(y,y0+MIN);
    corners=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]};
  place();preview();$("#fxSave",v).disabled=false;
  box.addEventListener("pointerdown",e=>{
    const h=e.target.closest(".fxh"),r0=box.getBoundingClientRect();
    if(!h&&mode!=="crop")return;
    e.preventDefault();
    if(h){h.setPointerCapture(e.pointerId);h.classList.add("drag");const k=+h.dataset.k;
      const mv=ev=>{const r=box.getBoundingClientRect();setCorner(k,(ev.clientX-r.left)/r.width,(ev.clientY-r.top)/r.height);place()};
      const up=()=>{h.classList.remove("drag");h.removeEventListener("pointermove",mv);h.removeEventListener("pointerup",up);h.removeEventListener("pointercancel",up);preview()};
      h.addEventListener("pointermove",mv);h.addEventListener("pointerup",up);h.addEventListener("pointercancel",up);return}
    // crop mode: drag inside the frame to move it
    const px=(e.clientX-r0.left)/r0.width,py=(e.clientY-r0.top)/r0.height,r=toRect(corners);
    if(px<r[0][0]||px>r[1][0]||py<r[0][1]||py>r[2][1])return;
    box.setPointerCapture(e.pointerId);const start=corners.map(p=>p.slice());
    const mv=ev=>{const rr=box.getBoundingClientRect();let dx=(ev.clientX-e.clientX)/rr.width,dy=(ev.clientY-e.clientY)/rr.height;
      dx=Math.max(-start[0][0],Math.min(1-start[1][0],dx));dy=Math.max(-start[0][1],Math.min(1-start[2][1],dy));corners=start.map(([x,y])=>[x+dx,y+dy]);place()};
    const up=()=>{box.removeEventListener("pointermove",mv);box.removeEventListener("pointerup",up);box.removeEventListener("pointercancel",up);preview()};
    box.addEventListener("pointermove",mv);box.addEventListener("pointerup",up);box.addEventListener("pointercancel",up);
  });
  box.addEventListener("keydown",e=>{const h=e.target.closest(".fxh");if(!h)return;const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();
    const k=+h.dataset.k,st=e.shiftKey?.02:.004;setCorner(k,corners[k][0]+d[0]*st,corners[k][1]+d[1]*st);place();later()});
  $(".fxmodes",v).onclick=e=>{const b2=e.target.closest("[data-mode]");if(!b2||b2.dataset.mode===mode)return;mode=b2.dataset.mode;if(mode==="crop")corners=toRect(corners);paintModes();hint();if(box)place();preview()};
  $("#fxBetter",v).onchange=e=>{better=e.target.checked;preview()};
  $("#fxReset",v).onclick=()=>{corners=(mode==="crop"?FULL_RECT:DEFAULT_CORNERS).map(p=>p.slice());place();preview();hint()};
  const auto=async()=>{const bt=$("#fxAuto",v);if(!bt)return;
    if(!budgetLeft()){msg.textContent="This month’s Claude limit is reached: drag the dots yourself.";return}
    bt.disabled=true;msg.textContent="Claude is finding the corners… (a few seconds, about $0.002)";
    try{const c=await findCorners([o.canFind]);if(!v.isConnected)return;
      if(c[o.canFind]){corners=c[o.canFind];mode="straighten";paintModes();place();preview();msg.textContent="Corners found. Drag a dot if it’s not exactly on the corner."}else msg.textContent="Claude couldn’t find the cover: drag the dots yourself."}
    catch(e){msg.textContent=(e.message||"Couldn’t find the corners")+". Drag the dots yourself."}
    bt.disabled=false};
  const ab=$("#fxAuto",v);if(ab)ab.onclick=auto;
  if(o.autoFind&&o.canFind&&hasClaude&&budgetLeft())auto();
  $("#fxSave",v).onclick=async e=>{const bt=e.target;bt.disabled=true;const lab=bt.textContent;bt.textContent="Saving…";
    try{await o.onSave(img,corners.map(p=>p.slice()),better,mode);closeFix()}catch(err){bt.disabled=false;bt.textContent=lab;handleApiError(err,"Couldn’t save")}};
}
// A photo already saved for a book: the editor works from the photo as taken, which is always kept.
function openStraighten(b,o={}){
  const after=()=>{render();if(o.onSaved)o.onSaved();else if($(".book"))openBook(b.id)};
  openPhotoEditor({title:b.title,src:()=>originalPhoto(b),mode:o.mode||"straighten",corners:o.corners,better:o.better,canFind:b.id,autoFind:!o.corners&&!o.batch,
    saveLabel:o.batch?"Use this":"Save",onClose:o.onClose,
    restore:b.photoFixed&&!o.batch?async()=>{const d=await api("photo_restore",{id:b.id});if(photoCache.has(b.id)){URL.revokeObjectURL(photoCache.get(b.id));photoCache.delete(b.id)}if(origCache.has(b.id)){photoCache.set(b.id,origCache.get(b.id));origCache.delete(b.id)}upsertBook(d.book);toast("Back to the original photo");after()}:null,
    onSave:async(img,corners,better,mode)=>{
      if(o.batch){o.onCorners(corners,better,mode);return}
      await saveStraight(b,await editedBlob(img,corners,better,mode));toast("Photo saved · the original is kept");after()}});
}
// A photo just taken: crop it before it's saved. The photo as taken is kept too when you change it.
function cropNewPhoto(title,blob,onDone){
  const url=URL.createObjectURL(blob);
  openPhotoEditor({title,src:async()=>url,mode:"crop",better:true,saveLabel:"Use this",skipLabel:"Use as taken",
    onSkip:()=>onDone(blob,null),onClose:()=>onDone(null,null),
    onSave:async(img,corners,better,mode)=>{const out=await editedBlob(img,corners,better,mode);onDone(out,blob)}});
}
// Save a new photo for a book: the edited one is shown, the one as taken is kept as the original.
async function saveNewPhoto(id,shown,asTaken){
  let d=await api("photo_set",{id,image:await blobToB64(asTaken||shown)});
  newPhotoTaken(id,asTaken||shown);
  if(asTaken){const b=upsertBook(d.book);d={book:await saveStraight(b,shown)};return d.book}
  return upsertBook(d.book);
}

/* straighten every photo at once */
let fixRun=null;
function closeFixRun(){const v=$(".fixrunv");if(v)v.remove();syncScroll()}
function openFixRun(){
  closeFixRun();
  const v=document.createElement("div");v.className="twinv fixrunv";v.setAttribute("role","dialog");v.setAttribute("aria-label","Straighten photos");document.body.append(v);syncScroll();
  if(!fixRun||(!fixRun.running&&!fixRun.rows.some(r=>r.state==="ready")))
    fixRun={rows:books.filter(b=>owned(b)&&b.hasPhoto&&!b.photoFixed).sort((a,b)=>a.id-b.id).map(b=>({b,state:"wait",better:true})),running:false,msg:""};
  v.addEventListener("click",e=>{const t=e.target.closest("button");if(!t)return;
    if(t.id==="frBack"){closeFixRun();render();return}
    if(t.id==="frStart"){runFixRun();return}
    if(t.id==="frSave"){saveFixRun();return}
    if(t.dataset.row){const r=fixRun.rows[+t.dataset.row];if(r&&["ready","saved","fail"].includes(r.state)&&!fixRun.running)
      openStraighten(r.b,{corners:r.corners||DEFAULT_CORNERS,better:r.better,batch:r.state!=="saved",onCorners:(c,bt)=>{r.corners=c;r.better=bt;r.state="ready";r.thumb=null;thumbFor(r).then(()=>paintFixRun())},onClose:()=>paintFixRun(),onSaved:()=>paintFixRun()})}
  });
  paintFixRun();
}
function paintFixRun(){
  const v=$(".fixrunv");if(!v)return;const R=fixRun.rows,cnt=s=>R.filter(r=>r.state===s).length;
  const done=R.filter(r=>!["wait","work"].includes(r.state)).length,calls=Math.ceil(R.length/4);
  v.innerHTML=`<div class="statsv-inner">
    <div class="statsv-head"><button class="roundbtn" id="frBack" aria-label="Back">${ICON.back}</button><div class="grow1"><div class="eyebrow">Your photos</div><h1>Straighten photos</h1></div></div>
    ${!R.length?`<div class="notice"><strong>Nothing to straighten</strong><span>All your photos are straightened already. Open a book to adjust one.</span></div>`:`
    <div class="card crprog"><div class="crline"><span><b>${fixRun.running?"Working…":done?"Ready to check":"Ready"}</b> ${done} of ${R.length}</span></div>
      <div class="crbar"><span data-w="${(100*done/R.length).toFixed(1)}"></span></div>
      ${fixRun.msg?`<p class="small err">${esc(fixRun.msg)}</p>`:""}
      ${!fixRun.running&&!done?`<p class="small muted">${hasClaude?`Claude finds the cover’s corners in each photo (4 photos per reading, about $${(calls*0.008).toFixed(2)} in all, ${calls} of your monthly readings). Then each photo is cut out flat and gets better colours.`:"Each photo gets a standard crop and better colours. Add the Anthropic key to find the corners automatically."} You check them before anything is saved. The photos as taken are always kept.</p><button class="btn primary" id="frStart">Start</button>`:""}</div>
    ${done?`<p class="small muted">Tap a photo to adjust its corners.</p>`:""}
    <div class="frgrid">${R.map((r,i)=>`<button class="frtile st-${r.state}" data-row="${i}" ${["ready","saved","fail"].includes(r.state)?"":"disabled"} aria-label="${esc(r.b.title)}"><span class="frimg">${r.thumb?`<img src="${r.thumb}" alt="">`:coverFaceHtml(r.b,"photo")}</span><span class="wt">${esc(r.b.title)}</span><span class="wsub">${{wait:"",work:"Working…",ready:"Ready",saved:"Saved ✓",fail:"Check corners"}[r.state]}</span></button>`).join("")}</div>
    ${!fixRun.running&&cnt("ready")?`<div class="actions sticky"><button class="btn primary" id="frSave">Save ${cnt("ready")} straightened photo${cnt("ready")===1?"":"s"}</button></div>`:""}`}
  </div>`;
  $$("[data-w]",v).forEach(el=>el.style.width=el.dataset.w+"%");wireCoverImages(v);
}
async function thumbFor(r){
  try{const img=await loadImg(await originalPhoto(r.b));const cv=straighten(img,r.corners||DEFAULT_CORNERS,220);if(r.better)enhance(cv);r.thumb=cv.toDataURL("image/jpeg",.8)}catch(e){r.state="fail"}
}
async function runFixRun(){
  if(fixRun.running)return;fixRun.running=true;fixRun.msg="";paintFixRun();
  const todo=fixRun.rows.filter(r=>r.state==="wait");
  for(let i=0;i<todo.length;i+=4){
    const chunk=todo.slice(i,i+4);chunk.forEach(r=>r.state="work");paintFixRun();
    let found={};
    if(hasClaude&&!fixRun.noClaude){
      try{found=await findCorners(chunk.map(r=>r.b.id))}
      catch(e){fixRun.msg=(e.code==="budget"||e.code==="rate_limited")?e.message+" The rest get a standard crop; adjust them by tapping.":"Claude couldn’t find corners for some photos: tap them to adjust.";if(e.code==="budget"||e.code==="rate_limited")fixRun.noClaude=true}
    }
    await Promise.all(chunk.map(async r=>{r.corners=found[r.b.id]||DEFAULT_CORNERS;r.state=(found[r.b.id]||!hasClaude)?"ready":"fail";await thumbFor(r)}));
    paintFixRun();
  }
  fixRun.running=false;paintFixRun();
}
async function saveFixRun(){
  const todo=fixRun.rows.filter(r=>r.state==="ready");fixRun.running=true;let n=0;
  for(const r of todo){
    const v=$(".fixrunv"),b=$("#frSave",v);
    try{const img=await loadImg(await originalPhoto(r.b));await saveStraight(r.b,await makeStraight(img,r.corners,r.better));r.state="saved";n++}
    catch(e){r.state="fail";fixRun.msg=e.message||"Some photos couldn’t be saved."}
    paintFixRun();
  }
  fixRun.running=false;toast(`${n} photo${n===1?"":"s"} straightened · the originals are kept`);render();paintFixRun();
}

/* ---------- boot ---------- */
render();
if(conn){loadBooks();loadStatus();loadTwin()}
})();
