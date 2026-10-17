// Service worker расписания: приложение открывается с главного экрана даже без сети.
// Страницу берём из сети (не дольше 4 с), иначе — сохранённую копию. Иконки и шрифты — из кэша
// с тихим обновлением. Расписание (data/*.json) не трогаем: офлайн-копию держит сама страница.
const CACHE = "shell-v2";
const ICONS = ["icon-192", "icon-512", "maskable-512", "apple-touch-icon", "favicon-64"];
const SHELL = [
  "./",
  "fonts/fonts.css",
  ...["", "-light", "-dark"].flatMap((s) => [`manifest${s}.webmanifest`, ...ICONS.map((n) => `icons/${n}${s}.png`)]),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // telegram.org, Google Fonts — напрямую
  if (url.pathname.includes("/data/")) return;        // расписание — без кэша service worker
  if (req.mode === "navigate") {
    event.respondWith(pageFirstFromNetwork(event));
  } else {
    event.respondWith(cachedThenRefresh(event));
  }
});

async function pageFirstFromNetwork(event) {
  const cache = await caches.open(CACHE);
  const net = fetch(event.request).then((res) => {
    if (res && res.ok) cache.put("./", res.clone());
    return res;
  });
  event.waitUntil(net.catch(() => {}));
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))]);
  } catch (e) {
    const saved = (await cache.match("./")) || (await cache.match(event.request, { ignoreSearch: true }));
    return saved || net.catch(() => Response.error());
  }
}

async function cachedThenRefresh(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request, { ignoreSearch: true });
  const net = fetch(event.request).then((res) => {
    if (res && res.ok) cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  event.waitUntil(net);
  return hit || (await net) || Response.error();
}
