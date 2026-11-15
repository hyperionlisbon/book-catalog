/* Book Catalog — phone web app.
   Talks only to: your Google Apps Script (books + Claude) and the free Google Books / Open Library catalogs.
   No third-party scripts are loaded; the Content-Security-Policy in index.html enforces that. */
(() => {
'use strict';

const GENRES=["Biography","Dystopia","Fantasy","Fiction","Graphic Novel","Historical Fantasy","Historical Fiction","History, Non-Fiction","Literary Fiction","Manga","Manhua","Manwha","Non-Fiction","Romance","Science Books","Science Fiction","Travel Book"];
const SUBGENRES=["AGI","AI","Asian","BL","Children","Classic","Cyberpunk","Dark Academia","Dark Fantasy","Dragons","Faeries","Fantasy Adventure","Gods","Gothic","High Fantasy","Isekai","LitRPG","Medieval","Memoir","Mystery","Nature Powers","Other Civilizations","Other Worlds","Post-Apocalyptic","Romantsy","Shōjo","Shōnen","Soft-horror","Space","Special School","Trials","VRMMORPG","Vampires","Vitorian England","War","Witches","Witty","Wizzards","Xianxia","YA","Zombies"];
const STATUSES=["TBR","Reading","Read","DNF"];
const LANGS={en:"English",pt:"Portuguese",es:"Spanish",fr:"French",de:"German",it:"Italian",ja:"Japanese",ko:"Korean",zh:"Chinese",nl:"Dutch"};
const CAM_STEPS=[["Front cover","Fill the frame with the cover"],["Back cover","Keep the barcode visible"],["Copyright page","Inside page with publisher and year"],["Anything else","Optional: spine or flap"]];
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
const starHtml=n=>{n=+n||0;return n?`<span class="stars" aria-label="${n} of 5 stars">${"★".repeat(n)}<span class="off">${"★".repeat(5-n)}</span></span>`:""};
const statusLabel=s=>s==="TBR"?"To read":s;
const isbnDigits=s=>String(s||"").split(/[,;\s]+/).map(x=>x.replace(/[^0-9Xx]/g,"")).filter(x=>x.length===10||x.length===13);
let toastT;
function toast(msg){clearTimeout(toastT);let t=$(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.append(t)}t.textContent=msg;t.hidden=false;toastT=setTimeout(()=>t.hidden=true,3000)}

/* ---------- state ---------- */
let conn=store.get("bc-conn",null);
let books=store.get("bc-books",[]);
let budget=store.get("bc-budget",null);
let hasClaude=store.get("bc-claude",false);
const st={q:"",status:"",genre:"",lang:"",sort:"id-desc",shown:60,...store.get("bc-view",{})};
st.q="";st.shown=60;
const saveView=()=>store.set("bc-view",{status:st.status,genre:st.genre,lang:st.lang,sort:st.sort});

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
  try{
    res=await fetch(c.u,{method:"POST",body:JSON.stringify({...payload,action,token:c.t}),redirect:"follow",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer"});
  }catch(e){throw Object.assign(new Error("No connection. Check your internet and try again."),{code:"network"})}
  let data;
  try{data=await res.json()}catch(e){throw Object.assign(new Error("Unexpected reply from your Google script. Check that it is deployed as a web app."),{code:"bad_reply"})}
  if(!data.ok){
    const msg=data.message||({unauthorized:"Access key not accepted. Reconnect in Settings.",locked:"Too many wrong keys. Wait 15 minutes."}[data.error])||data.error||"Something went wrong.";
    throw Object.assign(new Error(msg),{code:data.error,budget:data.budget});
  }
  return data;
}
function handleApiError(e,fallback){
  if(e.code==="unauthorized"){toast("Access key not accepted. Reconnect in Settings.");openSettings();return}
  toast((fallback?fallback+": ":"")+e.message);
}

/* ---------- list ---------- */
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
  $("#tally").textContent=books.length?`${books.length} books · ${counts.Read||0} read`:"";
  $("#statusChips").innerHTML=[["","All",books.length],...STATUSES.map(s=>[s,statusLabel(s),counts[s]||0])]
    .map(([v,l,n])=>`<button class="chip" data-status="${esc(v)}" aria-pressed="${st.status===v}">${esc(l)}<span class="n">${n}</span></button>`).join("");
  const uniq=k=>[...new Set(books.map(b=>b[k]).filter(Boolean).map(String))].sort((a,b)=>a.localeCompare(b));
  const fill=(sel,vals,label,cur)=>{const el=$(sel);el.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");el.value=vals.includes(cur)?cur:""};
  fill("#fGenre",uniq("genre"),"All genres",st.genre);
  fill("#fLang",uniq("language"),"All languages",st.lang);
  $("#fSort").value=st.sort;
  $("#addBtn").hidden=!conn;
}
function renderList(){
  const list=$("#list");
  if(!conn){
    list.innerHTML=`<div class="notice"><strong>Connect your catalog</strong><span>Paste the connection code from your Google script once, and your books appear here.</span><button class="btn primary" id="connectBtn">Connect</button></div>`;
    $("#connectBtn").onclick=openSettings;$("#moreWrap").hidden=true;return;
  }
  if(!books.length){list.innerHTML=`<div class="notice"><strong>Loading your books…</strong><span>Fetching them from your Google Sheet.</span></div>`;$("#moreWrap").hidden=true;return}
  const r=filtered();
  if(!r.length){list.innerHTML=`<div class="notice"><strong>No books match</strong><span>Try a different search or clear the filters.</span></div>`;$("#moreWrap").hidden=true;return}
  list.innerHTML=r.slice(0,st.shown).map(b=>{
    const series=b.series?`<span class="eseries">${esc(b.series)}${b.seriesNo!==""&&b.seriesNo!=null?` · #${esc(b.seriesNo)}`:""}</span>`:"";
    const tags=[b.genre,b.cover,b.language].filter(Boolean).map(t=>`<span class="tag">${esc(t)}</span>`).join("")+(b.priority?`<span class="tag hi">High priority</span>`:"");
    return `<button class="entry" data-id="${+b.id}"><span class="callno">${pad(+b.id)}</span>
      <span class="ebody"><span class="etitle">${esc(b.title)}</span><span class="eauthor">${esc(b.author)}</span>${series}<span class="tags">${tags}</span></span>
      <span class="eside">${b.status?`<span class="pill s-${esc(b.status)}">${esc(statusLabel(b.status))}</span>`:""}${starHtml(b.rating)}</span></button>`}).join("");
  $("#moreWrap").hidden=r.length<=st.shown;
  $("#moreBtn").textContent=`Show more (${r.length-st.shown} left)`;
}
function render(){renderChrome();renderList()}

$("#q").addEventListener("input",e=>{st.q=e.target.value;st.shown=60;renderList()});
$("#statusChips").addEventListener("click",e=>{const c=e.target.closest(".chip");if(!c)return;st.status=c.dataset.status;st.shown=60;saveView();render()});
$("#fGenre").addEventListener("change",e=>{st.genre=e.target.value;st.shown=60;saveView();renderList()});
$("#fLang").addEventListener("change",e=>{st.lang=e.target.value;st.shown=60;saveView();renderList()});
$("#fSort").addEventListener("change",e=>{st.sort=e.target.value;saveView();renderList()});
$("#moreBtn").addEventListener("click",()=>{st.shown+=60;renderList()});
$("#list").addEventListener("click",e=>{const en=e.target.closest(".entry");if(en)openDetail(+en.dataset.id)});
$("#addBtn").addEventListener("click",openAddChoice);
$("#settingsBtn").addEventListener("click",openSettings);

async function loadBooks(){
  try{
    const d=await api("list");
    books=d.books.map(b=>({...b,id:+b.id}));store.set("bc-books",books);render();
  }catch(e){handleApiError(e,"Couldn’t load your books")}
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

/* ---------- sheets ---------- */
const layer=$("#layer");
function closeSheet(){layer.innerHTML="";document.body.style.overflow=""}
function sheet(html){
  layer.innerHTML=`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.style.overflow="hidden";
  const scrim=layer.firstElementChild;scrim.addEventListener("click",e=>{if(e.target===scrim)closeSheet()});
  const s=scrim.firstElementChild;$$("[data-close]",s).forEach(x=>x.onclick=closeSheet);return s;
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&layer.innerHTML&&!$(".cam"))closeSheet()});

/* ---------- settings / connect ---------- */
function openSettings(){
  const s=sheet(`
   <div class="sheet-head"><div><h2>Settings</h2><div class="sub">${conn?"This phone is connected to your Google Sheet.":"Connect this phone to your Google Sheet."}</div></div><button class="x" data-close aria-label="Close">×</button></div>
   ${conn?`<p class="okline small">Connected. ${books.length} books loaded.</p><p class="budgetline">${esc(budgetText())}</p>`:""}
   <div class="stack">
     <label class="sectlabel" for="codeIn">${conn?"Replace connection code":"Connection code"}</label>
     <textarea id="codeIn" class="codebox" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="BC1.…"></textarea>
     <p class="small muted">Find it in your Google script: run <span class="mono">showConnectionCode</span> and copy the line that starts with BC1. Treat it like a password.</p>
     <p class="small" id="codeMsg"></p>
     <div class="actions">${conn?`<button class="btn ghost dangertext left" id="forgetBtn">Disconnect this phone</button>`:""}<button class="btn primary" id="connectGo">Connect</button></div>
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
      const a=$(".actions",s);a.innerHTML=`<div class="confirm"><span>Remove the connection and the saved book list from this phone? Your Google Sheet is not touched.</span><button class="btn" id="fNo">Keep</button><button class="btn danger" id="fYes">Disconnect</button></div>`;
      $("#fNo",s).onclick=()=>{closeSheet();openSettings()};
      $("#fYes",s).onclick=()=>{["bc-conn","bc-books","bc-budget","bc-claude"].forEach(store.del);conn=null;books=[];budget=null;hasClaude=false;closeSheet();render();toast("Disconnected")};
    };
    $("#reloadBtn",s).onclick=()=>{closeSheet();loadBooks();loadStatus()};
  }
}

/* ---------- detail ---------- */
function openDetail(id){
  const b=books.find(x=>x.id===id);if(!b)return;
  const row=(k,v,cls="")=>v!==""&&v!=null?`<dt>${k}</dt><dd class="${cls}">${esc(v)}</dd>`:"";
  const s=sheet(`
   <div class="sheet-head"><div><div class="tally">No. ${pad(b.id)}</div><h2>${esc(b.title)}</h2><div class="sub">${esc(b.author)}</div></div><button class="x" data-close aria-label="Close">×</button></div>
   <div class="tags">${b.status?`<span class="pill s-${esc(b.status)}">${esc(statusLabel(b.status))}</span>`:""}${starHtml(b.rating)}${b.priority?`<span class="tag hi">High priority</span>`:""}</div>
   ${b.comments?`<blockquote class="quote">${esc(b.comments)}</blockquote>`:""}
   <dl class="kv">
    ${row("Series",b.series?b.series+(b.seriesNo!==""?` · #${b.seriesNo}`:""):"")}
    ${row("Genre",[b.genre,b.subgenre].filter(Boolean).join(" — "))}
    ${row("This edition",[b.publisher,b.editionYear].filter(Boolean).join(", "))}
    ${row("Format",[b.cover,b.special].filter(Boolean).join(" · "))}
    ${row("Language",b.language)}
    ${row("First published",[b.firstPublisher,b.firstYear].filter(Boolean).join(", "))}
    ${row("Awards",b.awards)}
    ${row("Date read",b.dateRead)}
    ${row("ISBN",b.isbn,"mono")}
   </dl>
   <div id="delArea"></div>
   <div class="actions"><button class="btn ghost dangertext left" id="delBtn">Delete</button><button class="btn primary" id="editBtn">Edit</button></div>`);
  $("#editBtn",s).onclick=()=>openForm(b);
  $("#delBtn",s).onclick=()=>{
    const area=$("#delArea",s);
    area.innerHTML=`<div class="confirm"><span>Delete “${esc(b.title)}” from your catalog? This removes its row from the Google Sheet.</span><button class="btn" id="dNo">Keep</button><button class="btn danger" id="dYes">Delete</button></div>`;
    $("#dNo",s).onclick=()=>area.innerHTML="";
    $("#dYes",s).onclick=async e=>{e.target.disabled=true;
      try{await api("delete",{id:b.id});books=books.filter(x=>x.id!==b.id);store.set("bc-books",books);closeSheet();render();toast("Deleted")}
      catch(err){e.target.disabled=false;handleApiError(err,"Couldn’t delete")}};
  };
}

/* ---------- add: choose how ---------- */
function openAddChoice(){
  const s=sheet(`
   <div class="sheet-head"><div><h2>Add a book</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   <div class="choice">
     <button class="btn primary" id="chCam"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>Take photos<small>The camera opens here. Claude and the barcode fill in the details.</small></span></button>
     <button class="btn" id="chType"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg><span>Type it in<small>Fill in the form yourself.</small></span></button>
   </div>
   <p class="budgetline">${esc(budgetText())}</p>`);
  $("#chCam",s).onclick=()=>{closeSheet();openCamera(r=>openForm(null,r))};
  $("#chType",s).onclick=()=>openForm(null);
}

/* ---------- camera ---------- */
async function shrink(source,w,h){
  const max=1568, sc=Math.min(1,max/Math.max(w,h));
  const c=document.createElement("canvas");c.width=Math.round(w*sc);c.height=Math.round(h*sc);
  c.getContext("2d").drawImage(source,0,0,c.width,c.height);
  let q=.85, blob;
  for(let i=0;i<3;i++){blob=await new Promise(r=>c.toBlob(r,"image/jpeg",q));if(blob&&blob.size<1000000)break;q-=.15}
  return {blob,canvas:c};
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
  try{const codes=await d.detect(src);const hit=codes.map(c=>c.rawValue).find(v=>/^97[89]\d{10}$/.test(v));return hit||""}catch(e){return ""}
}

function openCamera(onDone){
  const photos=[];let isbn="";let stream=null;let scanTimer=null;let closed=false;
  const root=document.createElement("div");root.className="cam";root.setAttribute("role","dialog");root.setAttribute("aria-label","Camera");
  root.innerHTML=`
   <div class="cam-top"><button class="x" id="camClose" aria-label="Close camera">×</button><div class="cam-step" id="camStep"></div><span class="x" aria-hidden="true"></span></div>
   <div class="cam-view"><video id="camVideo" playsinline muted autoplay></video><div class="cam-frame" id="camFrame" hidden></div><div class="cam-chip" id="camChip" hidden></div><div class="flash" id="camFlash"></div><div class="cam-msg" id="camMsg"></div></div>
   <div class="cam-bottom"><div class="cam-thumbs" id="camThumbs"></div><button class="shutter" id="shutter" aria-label="Take photo" disabled></button><button class="cam-done" id="camDone" disabled>Done</button></div>`;
  document.body.append(root);document.body.style.overflow="hidden";
  const video=$("#camVideo",root), msg=$("#camMsg",root), shutter=$("#shutter",root), done=$("#camDone",root);
  const stepEl=$("#camStep",root);
  const paintStep=()=>{const i=Math.min(photos.length,CAM_STEPS.length-1);stepEl.innerHTML=photos.length>=MAX_PHOTOS?`All set<small>Tap Done</small>`:`${photos.length+1}. ${esc(CAM_STEPS[i][0])}<small>${esc(CAM_STEPS[i][1])}</small>`;
    $("#camThumbs",root).innerHTML=photos.map((p,i)=>`<img src="${p.url}" alt="Photo ${i+1}">`).join("");
    done.disabled=!photos.length;shutter.disabled=!stream||photos.length>=MAX_PHOTOS};
  const showIsbn=()=>{const chip=$("#camChip",root);chip.textContent=`Barcode read: ${isbn}`;chip.hidden=!isbn};
  const stop=()=>{clearInterval(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null};
  const close=()=>{if(closed)return;closed=true;stop();root.remove();document.body.style.overflow=""};
  $("#camClose",root).onclick=()=>{photos.forEach(p=>URL.revokeObjectURL(p.url));close()};
  done.onclick=()=>{close();onDone({photos,isbn})};

  const addBlob=async(blob)=>{photos.push({blob,url:URL.createObjectURL(blob)});paintStep()};
  const fallbackHtml=`<label class="btn">Use the phone’s camera app instead<input type="file" accept="image/*" capture="environment" id="camFile" hidden></label>`;
  const wireFallback=()=>{const f=$("#camFile",root);if(!f)return;f.onchange=async()=>{const file=f.files[0];f.value="";if(!file)return;
    try{const bmp=await createImageBitmap(file);const {blob,canvas}=await shrink(bmp,bmp.width,bmp.height);if(!isbn){isbn=await findIsbn(canvas);showIsbn()}await addBlob(blob)}catch(e){toast("That photo couldn’t be used.")}}};

  async function start(){
    msg.innerHTML=`<div class="stack"><p>Starting the camera…</p></div>`;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}});
      if(closed){stop();return}
      video.srcObject=stream;await video.play().catch(()=>{});
      msg.innerHTML="";msg.hidden=true;$("#camFrame",root).hidden=false;paintStep();
      if(await getDetector()){scanTimer=setInterval(async()=>{if(isbn||!video.videoWidth)return;const v=await findIsbn(video);if(v){isbn=v;showIsbn();if(navigator.vibrate)navigator.vibrate(60)}},450)}
    }catch(e){
      stream=null;paintStep();msg.hidden=false;
      if(e&&(e.name==="NotAllowedError"||e.name==="SecurityError")){
        msg.innerHTML=`<div class="stack"><p><strong>Camera access is blocked.</strong></p><p class="small">To allow it: iPhone → Settings › Safari › Camera › Allow (or tap “aA” in the address bar › Website Settings). Android → tap the lock icon next to the address › Permissions › Camera › Allow. Then close and reopen the camera.</p>${fallbackHtml}</div>`;
      }else if(e&&e.name==="NotFoundError"){
        msg.innerHTML=`<div class="stack"><p>No camera was found on this device.</p>${fallbackHtml}</div>`;
      }else{
        msg.innerHTML=`<div class="stack"><p>The camera couldn’t start${e&&e.name?" ("+esc(e.name)+")":""}.</p>${fallbackHtml}</div>`;
      }
      wireFallback();
    }
  }

  shutter.onclick=async()=>{
    if(!stream||!video.videoWidth||photos.length>=MAX_PHOTOS)return;
    shutter.disabled=true;
    const fl=$("#camFlash",root);fl.classList.remove("on");void fl.offsetWidth;fl.classList.add("on");
    try{const {blob,canvas}=await shrink(video,video.videoWidth,video.videoHeight);if(!isbn){const v=await findIsbn(canvas);if(v){isbn=v;showIsbn()}}await addBlob(blob)}
    catch(e){toast("Couldn’t take the photo. Try again.")}
    paintStep();
  };

  paintStep();
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    msg.innerHTML=`<div class="stack"><p>This browser can’t show the camera inside the app${window.isSecureContext?"":" (the page must be opened over https)"}.</p>${fallbackHtml}</div>`;wireFallback();return;
  }
  // First use: explain, then let the phone ask for permission.
  (async()=>{
    let state="prompt";
    try{if(navigator.permissions&&navigator.permissions.query){state=(await navigator.permissions.query({name:"camera"})).state}}catch(e){}
    if(state==="granted"){start();return}
    msg.innerHTML=`<div class="stack"><p><strong>Allow the camera</strong></p><p class="small">Book Catalog uses your camera only to photograph the book you’re adding. Your phone will ask for permission now; photos are sent only to your own Google script.</p><button class="btn primary big" id="camAllow">Allow camera</button>${fallbackHtml}</div>`;
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
function nextId(){return books.reduce((m,b)=>Math.max(m,+b.id||0),0)+1}
function findDupe(r,selfId){
  const mine=isbnDigits(r.isbn);
  return books.find(b=>b.id!==selfId&&((mine.length&&isbnDigits(b.isbn).some(x=>mine.includes(x)))||(norm(b.title)&&norm(b.title)===norm(r.title)&&norm(b.author)===norm(r.author)&&norm(b.language)===norm(r.language))));
}
function datalist(id,vals){return `<datalist id="${id}">${vals.map(v=>`<option value="${esc(v)}"></option>`).join("")}</datalist>`}

function openForm(b,capture){
  const isNew=!b;const v=b?{...b}:{status:"TBR",rating:0};
  const uniq=k=>[...new Set(books.map(x=>x[k]).filter(Boolean).map(String))].sort();
  const inp=(k,label,cls="",extra="")=>`<div class="f ${cls}" data-f="${k}"><label for="i-${k}">${label}<span class="src"></span></label><input id="i-${k}" name="${k}" type="text" value="${esc(v[k]??"")}" autocomplete="off" ${extra}></div>`;
  const s=sheet(`
   <div class="sheet-head"><div><div class="tally">${isNew?"New entry":"Editing No. "+pad(b.id)}</div><h2>${isNew?"Add a book":esc(b.title)}</h2></div><button class="x" data-close aria-label="Close">×</button></div>
   ${capture&&capture.photos.length?`<section class="photo">
     <div class="sectlabel">From your photos</div>
     <div class="thumbs">${capture.photos.map((p,i)=>`<div class="thumb"><img src="${p.url}" alt="Photo ${i+1}"></div>`).join("")}</div>
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
     <div class="f h full-sm"><span class="lbl">Status</span><div class="seg" id="segStatus">${STATUSES.map(x=>`<button type="button" data-v="${x}" aria-pressed="${v.status===x}">${statusLabel(x)}</button>`).join("")}</div></div>
     <div class="f h full-sm"><span class="lbl">Rating</span><div class="rate" id="rate">${[1,2,3,4,5].map(n=>`<button type="button" data-n="${n}" aria-label="${n} star${n>1?"s":""}" class="${n<=(+v.rating||0)?"":"off"}">★</button>`).join("")}</div></div>
     ${inp("dateRead","Date read","h full-sm",'placeholder="YYYY-MM"')}
     <div class="f h full-sm"><label for="i-priority">Priority to read</label><select id="i-priority" name="priority"><option value="">Normal</option><option value="High">High</option></select></div>
     <div class="f"><label for="i-comments">Comments</label><textarea id="i-comments" name="comments">${esc(v.comments||"")}</textarea></div>
    </div></fieldset>
    ${datalist("dl-author",uniq("author"))}${datalist("dl-series",uniq("series"))}${datalist("dl-publisher",[...new Set([...uniq("publisher"),...uniq("firstPublisher")])].sort())}
    ${datalist("dl-language",[...new Set(["English","Portuguese",...uniq("language")])])}${datalist("dl-genre",[...new Set([...GENRES,...uniq("genre")])].sort())}${datalist("dl-sub",SUBGENRES)}${datalist("dl-special",uniq("special"))}
   </form>
   <div id="dupArea"></div>
   <div class="actions"><span class="small left" id="formStatus"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="saveBtn">${isNew?"Add to catalog":"Save changes"}</button></div>`);
  $("#i-cover",s).value=v.cover||"";
  $("#i-priority",s).value=v.priority==="High"?"High":"";
  let status=v.status||"TBR", rating=+v.rating||0;
  $("#segStatus",s).onclick=e=>{const btn=e.target.closest("button");if(!btn)return;status=btn.dataset.v;$$("#segStatus button",s).forEach(x=>x.setAttribute("aria-pressed",String(x===btn)))};
  $("#rate",s).onclick=e=>{const btn=e.target.closest("button");if(!btn)return;const n=+btn.dataset.n;rating=rating===n?0:n;$$("#rate button",s).forEach(x=>x.classList.toggle("off",+x.dataset.n>rating))};

  // Field filling from photos / catalog, never overwriting what you typed.
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
  const applyCatalog=c=>{if(c)["title","author","publisher","editionYear","language","isbn"].forEach(k=>apply(k,c[k],"catalog"))};

  const prog=$("#prog",s);
  const setProg=(key,state,text)=>{if(!prog)return;let row=$(`[data-p="${key}"]`,prog);if(!row){row=document.createElement("div");row.className="row";row.dataset.p=key;row.innerHTML=`<span class="dot"></span><span></span>`;prog.append(row)}
    $(".dot",row).className="dot "+state;row.lastElementChild.textContent=text};
  let lookedUp="";
  const runLookup=async(isbn,quiet)=>{
    const d=String(isbn||"").replace(/[^0-9Xx]/g,"");if(!d||d===lookedUp)return;lookedUp=d;
    setProg("cat","busy",`Looking up ISBN ${d}…`);
    const c=await lookupIsbn(d);
    if(c){applyCatalog(c);setProg("cat","ok",`Found in the free book catalogs (ISBN ${d})`)}
    else setProg("cat","err",`ISBN ${d} isn’t in the free catalogs${quiet?"":""}`);
  };
  $("#lookupBtn",s).onclick=async e=>{
    const val=$("#i-isbn",s).value;const d=isbnDigits(val)[0];
    if(!d){$("#formStatus",s).textContent="Type a 10- or 13-digit ISBN first.";return}
    e.target.disabled=true;$("#formStatus",s).textContent="Looking up…";
    const c=await lookupIsbn(d);e.target.disabled=false;
    if(!c){$("#formStatus",s).textContent="Not found in the free catalogs.";return}
    // An explicit look-up may fill empty fields only.
    ["title","author","publisher","editionYear","language"].forEach(k=>{const el=$(`#i-${k}`,s);if(el&&!el.value.trim())apply(k,c[k],"catalog")});
    $("#formStatus",s).textContent="Filled what the catalog knows.";
  };

  if(capture&&capture.photos.length){
    (async()=>{
      if(capture.isbn){apply("isbn",capture.isbn,"photo");runLookup(capture.isbn)}
      if(!hasClaude){setProg("ai","err","Claude photo reading is off (no Anthropic key in your Google script).");return}
      if(!budgetLeft()){setProg("ai","err","Monthly Claude limit reached. Fill in the rest by hand, or raise the limit in your Google script.");return}
      setProg("ai","busy","Claude is reading your photos… (about 10–30 seconds)");
      try{
        const images=await Promise.all(capture.photos.map(p=>blobToB64(p.blob)));
        const d=await api("read",{images});
        const r=d.result||{};const from=r.from||{};
        Object.keys(r).forEach(k=>{if(k!=="from")apply(k,r[k],from[k]==="photo"?"photo":"knowledge")});
        if(d.budget){budget=d.budget;store.set("bc-budget",budget);const bl=$("#budgetLine",s);if(bl)bl.textContent=budgetText()}
        setProg("ai","ok",`Claude read the photos${d.costUsd?` (cost about $${(+d.costUsd).toFixed(3)})`:""}. Check the highlighted fields.`);
        if(r.isbn&&!lookedUp)runLookup(isbnDigits(r.isbn)[0]);
      }catch(e){
        if(e.budget){budget=e.budget;store.set("bc-budget",budget)}
        if(e.code==="unauthorized"){setProg("ai","err","Access key not accepted. Reconnect in Settings.");return}
        setProg("ai","err",e.message||"Claude couldn’t read the photos.");
      }
    })();
  }

  let force=false;
  $("#saveBtn",s).onclick=async()=>{
    const fd=Object.fromEntries(new FormData($("#bookForm",s)).entries());
    for(const k in fd)fd[k]=String(fd[k]).trim();
    const fs=$("#formStatus",s);fs.classList.remove("err");
    if(!fd.title){fs.textContent="Add a title before saving.";fs.classList.add("err");$("#i-title",s).focus();return}
    const rec={...(b||{}),...fd,status,rating,id:b?b.id:0};
    if(!force){
      const dupe=findDupe(rec,b?b.id:null);
      if(dupe){$("#dupArea",s).innerHTML=`<div class="warn"><span>This looks like a book you already have: <strong>No. ${pad(dupe.id)} · ${esc(dupe.title)}</strong> (${esc([dupe.publisher,dupe.editionYear,dupe.cover].filter(Boolean).join(", "))}).</span><div class="actions"><button class="btn" id="dupOpen">Open it</button><button class="btn primary" id="dupSave">Save anyway</button></div></div>`;
        $("#dupOpen",s).onclick=()=>openDetail(dupe.id);$("#dupSave",s).onclick=()=>{force=true;$("#saveBtn",s).click()};return}
    }
    const btn=$("#saveBtn",s);btn.disabled=true;fs.textContent="Saving to your Google Sheet…";
    try{
      const d=await api("save",{book:rec});const saved={...d.book,id:+d.book.id};
      books=books.filter(x=>x.id!==saved.id).concat(saved);store.set("bc-books",books);
      if(capture)capture.photos.forEach(p=>URL.revokeObjectURL(p.url));
      closeSheet();render();toast(isNew?`Added as No. ${pad(saved.id)}`:"Saved");
    }catch(e){btn.disabled=false;fs.textContent="";handleApiError(e,"Couldn’t save")}
  };
}

/* ---------- boot ---------- */
render();
if(conn){loadBooks();loadStatus()}
})();
