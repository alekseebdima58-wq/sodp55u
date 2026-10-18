// Service worker расписания: приложение открывается с главного экрана даже без сети.
// Страницу отдаём сразу из сохранённой копии и тихо обновляем её из сети. Иконки и шрифты — из кэша
// с тихим обновлением. Расписание (data/*.json) не трогаем: офлайн-копию держит сама страница.
const CACHE = "shell-v31";
const ICONS = ["icon-192", "icon-512", "maskable-512", "apple-touch-icon", "favicon-64"];
const SHELL = [
  "./",
  "fonts/fonts.css",
  "icons/badge-96.png",
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
  if (url.pathname.includes("/media/")) return;       // видео — напрямую (iPhone качает его кусками)
  if (url.pathname.endsWith("/version.json")) return; // версия приложения — всегда из сети
  if (url.pathname.includes("/splash/")) return;      // заставки iPhone берёт сам при установке
  if (req.mode === "navigate") {
    event.respondWith(pageFirstFromNetwork(event));
  } else {
    event.respondWith(cachedThenRefresh(event));
  }
});

async function pageFirstFromNetwork(event) {
  // Сохранённая страница есть — отдаём её сразу (запуск без чёрного экрана), а свежую тихо кладём
  // в кэш на следующий раз. Вышла новая версия — страница сама заметит (version.json) и перезагрузится.
  const cache = await caches.open(CACHE);
  const saved = (await cache.match("./")) || (await cache.match(event.request, { ignoreSearch: true }));
  const net = fetch(event.request).then((res) => {
    if (res && res.ok) return cache.put("./", res.clone()).then(() => res);
    return res;
  });
  if (saved) {
    event.waitUntil(net.catch(() => {}));
    return saved;
  }
  try {
    return await net;   // первый запуск — без вариантов, из сети
  } catch (e) {
    return Response.error();
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
