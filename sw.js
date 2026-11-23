// Service worker расписания: приложение открывается с главного экрана даже без сети.
// Страницу отдаём сразу из сохранённой копии и тихо обновляем её из сети. Иконки и шрифты — из кэша
// с тихим обновлением. Расписание (data/*.json) не трогаем: офлайн-копию держит сама страница.
const CACHE = "shell-v65";
const ICONS = ["icon-192", "icon-512", "maskable-512", "apple-touch-icon", "favicon-64"];
const SHELL = [
  "./",
  "fonts/fonts.css",
  "fonts/onest-cyrillic.woff2", "fonts/onest-latin.woff2",
  "cabinet.css",
  "cabinet.js",
  "telegram-web-app.js",   // копия скрипта Telegram (v1.8.6): запуск в Telegram не ждёт telegram.org
  "icons/badge-96.png",
  ...["", "-light", "-dark"].flatMap((s) => [`manifest${s}.webmanifest`, ...ICONS.map((n) => `icons/${n}${s}.png`)]),
];
const appURL = new URL("./", self.registration.scope);
const shellPaths = new Set(SHELL.map((path) => new URL(path, appURL).pathname));
const appIndex = new URL("index.html", appURL).pathname;

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
  if (url.origin !== appURL.origin || req.headers.has("Authorization")) return;
  if (req.mode === "navigate") {
    if (url.pathname === appURL.pathname || url.pathname === appIndex) event.respondWith(cachedPage(event));
  } else if (shellPaths.has(url.pathname)) {
    event.respondWith(cachedAsset(event));
  }
});

function remember(cache, key, response) {
  if (!cache || !response.ok) return Promise.resolve();
  return cache.put(key, response.clone()).catch(() => {});
}

async function cachedPage(event) {
  const cache = await caches.open(CACHE).catch(() => null);
  const saved = cache && await cache.match(appURL.href).catch(() => null);
  const net = fetch(event.request, { cache: "no-cache" }).then(async (response) => {
    await remember(cache, appURL.href, response);
    return response;
  }).catch(() => null);
  if (saved) {
    event.waitUntil(net);
    return saved;
  }
  return (await net) || Response.error();
}

async function cachedAsset(event) {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = cache && await cache.match(event.request).catch(() => null);
  const net = fetch(event.request, { cache: "no-cache" }).then(async (response) => {
    await remember(cache, event.request, response);
    return response;
  }).catch(() => null);
  event.waitUntil(net);
  return hit || (await net) || Response.error();
}

// ---------- push-уведомления от бота (ярлык на экране «Домой») ----------
// Число на иконке: сколько изменений в расписании пришло, пока приложение не открывали.
async function badgeGet() {
  try { const r = await (await caches.open("badge")).match("n"); return r ? +(await r.text()) || 0 : 0; } catch (e) { return 0; }
}
async function badgeSet(n) {
  try { await (await caches.open("badge")).put("n", new Response(String(n))); } catch (e) { /* не страшно */ }
  try { if (n > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(n); else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge(); } catch (e) { /* не поддерживается */ }
}
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "Расписание", body: event.data ? event.data.text() : "" }; }
  const title = d.title || "Расписание";
  // Короткий текст готовит бот. tag: напоминание о той же паре или новая сводка заменяют старое уведомление,
  // а не копятся стопкой. badge — белый силуэт для строки состояния Android.
  const opts = {
    body: d.body || "", tag: d.tag || d.kind || "info", renotify: true, lang: "ru", dir: "ltr",
    icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    timestamp: d.ts || Date.now(),
    vibrate: d.kind === "remind" || d.kind === "changes" ? [70, 50, 70] : [40],
    data: { url: d.url || "./" },
  };
  event.waitUntil((async () => {
    if (d.kind === "changes") await badgeSet((await badgeGet()) + 1);
    await self.registration.showNotification(title, opts);
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        try { c.postMessage({ type: "open", url }); } catch (e) { /* старый браузер */ }
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
