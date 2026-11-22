// Book Catalog: keeps the app's own files on the phone so it opens straight away.
// Your books and photos are NOT stored here: they always come from your Google script.
const VERSION = "27";
const SHELL = "bc-shell-v" + VERSION, FONTS = "bc-fonts-v1";
const FILES = ["./", "app.js?v=" + VERSION, "styles.css?v=" + VERSION, "stats-core.js?v=" + VERSION,
  "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const PAGE_WAIT_MS = 2500; // after this, a slow network shows the saved page (it still refreshes for next time)

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("bc-") && k !== SHELL && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const okToKeep = r => r && r.ok && r.type === "basic" && !r.redirected;
const scopeUrl = () => new URL("./", self.registration.scope).href;

// The page itself: the newest from the internet, or the saved one when the network is slow or off.
async function page(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(r => { if (okToKeep(r)) cache.put(scopeUrl(), r.clone()); return r; });
  const saved = await cache.match(scopeUrl());
  if (!saved) return net;
  const late = new Promise(res => setTimeout(() => res(saved), PAGE_WAIT_MS));
  try { return await Promise.race([net, late]); } catch (e) { return saved; }
}
// Files named with ?v=N never change: the saved copy is used; older versions of the same file are removed.
async function versioned(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (okToKeep(r)) {
    cache.put(req, r.clone());
    const path = new URL(req.url).pathname;
    cache.keys().then(ks => ks.forEach(k => { const u = new URL(k.url); if (u.pathname === path && k.url !== req.url) cache.delete(k); }));
  }
  return r;
}
// Icons and the manifest: the saved copy at once, refreshed in the background.
async function fresh(req, name, keep) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then(r => { if (keep(r)) cache.put(req, r.clone()); return r; });
  if (hit) { net.catch(() => {}); return hit; }
  return net;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return; // your Google script is never cached
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/sw.js")) return;
    if (req.mode === "navigate") { e.respondWith(page(req)); return; }
    if (/[?&]v=\d+/.test(url.search)) { e.respondWith(versioned(req)); return; }
    e.respondWith(fresh(req, SHELL, okToKeep));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) e.respondWith(fresh(req, FONTS, r => r && (r.ok || r.type === "opaque")));
  // Everything else (covers, Google Books, Wikidata…) goes to the internet as before.
});
