import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = []; const errs = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); };
// заставка ярлыка
for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.route(/data\/g\.json/, async (r) => { await sleep(700); r.fulfill({ response: await r.fetch() }); });
  await p.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await p.goto('http://localhost:8772/?now=2026-10-19T12:00', { waitUntil: 'domcontentloaded' }); await sleep(250);
  const s = await p.evaluate(() => { const e = document.getElementById('splash'); return e && !e.hidden ? getComputedStyle(e).backgroundColor : null; });
  ok(!!s, `ярлык ${scheme}: заставка при запуске`, s); await p.waitForSelector('.week'); await sleep(1500);
  ok(!(await p.$('#splash:not([hidden])')), `ярлык ${scheme}: заставка ушла после загрузки`); await c.close(); }
// видео установки
for (const [ua, name] of [['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'iPhone'], ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 'Android']]) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, hasTouch: true, isMobile: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.goto('http://localhost:8772/?now=2026-10-19T12:00'); await p.waitForSelector('.week'); await sleep(600);
  await p.tap('.tab[data-tab="settings"]'); await sleep(800);
  const v = await p.$('#app video'); if (v) { await v.scrollIntoViewIfNeeded(); await sleep(2500); }
  const st = v ? await v.evaluate((x) => ({ src: x.currentSrc || x.getAttribute('data-src'), rs: x.readyState, paused: x.paused, err: x.error && x.error.code })) : null;
  ok(st && st.src && /install-(ios|android)/.test(st.src) && (name === 'iPhone' ? /ios/.test(st.src) : /android/.test(st.src)), `${name}: в «Установить» своё видео`, st);
  // браузер без H.264 (Chromium для тестов) mp4 не играет вовсе — тогда проверка не о приложении, пропускаем
  const h264 = await p.evaluate(() => !!document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'));
  if (st && /\.mp4/.test(st.src || '') && !h264) ok(true, `${name}: видео — пропущено, браузер не умеет H.264`, st.src);
  else ok(st && st.rs >= 2 && !st.err, `${name}: видео загрузилось и играет`, st);
  await c.close(); }
// Telegram: «Во весь экран» выкл/вкл
{ const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.addInitScript(() => { const ev = {}; const W = { platform: 'ios', version: '8.0', colorScheme: 'dark', initData: '', initDataUnsafe: {}, isFullscreen: false, themeParams: {},
    safeAreaInset: { top: 0, bottom: 34 }, contentSafeAreaInset: { top: 0, bottom: 0 }, isVersionAtLeast: () => true, ready() {}, expand() {}, disableVerticalSwipes() {},
    setHeaderColor() {}, setBackgroundColor() {}, BackButton: { show() {}, hide() {}, onClick() {} }, HapticFeedback: { selectionChanged() {}, impactOccurred() {}, notificationOccurred() {} },
    onEvent(n, f) { (ev[n] = ev[n] || []).push(f); }, offEvent() {}, openLink() {}, openTelegramLink() {},
    requestFullscreen() { setTimeout(() => { W.isFullscreen = true; W.safeAreaInset = { top: 59, bottom: 34 }; W.contentSafeAreaInset = { top: 50, bottom: 0 }; (ev.fullscreenChanged || []).forEach((f) => f()); (ev.safeAreaChanged || []).forEach((f) => f()); }, 30); },
    exitFullscreen() { setTimeout(() => { W.isFullscreen = false; W.safeAreaInset = { top: 0, bottom: 34 }; W.contentSafeAreaInset = { top: 0, bottom: 0 }; (ev.fullscreenChanged || []).forEach((f) => f()); }, 30); } };
    window.Telegram = { WebApp: W }; window.__W = W; });
  await p.goto('http://localhost:8772/?now=2026-10-19T12:00#tgWebAppData=x'); await p.waitForSelector('.week'); await sleep(900);
  const top = () => p.evaluate(() => Math.round(document.querySelector('#app .eyebrow, #app h1').getBoundingClientRect().top));
  const t1 = await top(); ok(await p.evaluate(() => window.__W.isFullscreen) && t1 > 109, 'при запуске сам ушёл во весь экран, шапка ниже кнопок Telegram', t1);
  await p.tap('.tab[data-tab="settings"]'); await sleep(600); await p.tap('[data-act="fs"]'); await sleep(500);
  const t2 = await top(); ok(!(await p.evaluate(() => window.__W.isFullscreen)) && t2 < 60, 'выключил «Во весь экран» — шапка поднялась', t2);
  await p.reload(); await p.waitForSelector('.week'); await sleep(900);
  ok(!(await p.evaluate(() => window.__W.isFullscreen)), 'выключенное запомнилось — после перезапуска не во весь экран');
  await c.close(); }
ok(!errs.length, 'нет ошибок JS', errs); console.log(`\nИТОГО ${res.filter(Boolean).length}/${res.length}`); await b.close();
