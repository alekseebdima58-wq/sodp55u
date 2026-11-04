// «Потяни — обновится» и разделение жестов (только ярлык на экране «Домой»)
import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, n = 0; const T = (name, c, info = '') => { n++; if (c) ok++; console.log(`${c ? 'OK  ' : 'FAIL'} ${name} ${info}`); };
const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
await p.goto('http://localhost:8772/?now=2026-10-20T10:00'); await p.waitForSelector('.week'); await sleep(900);
const cdp = await touchSession(p);
const drag = async (x0, y0, dx, dy, steps = 20, ms = 16) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / steps, y: y0 + dy * i / steps }] }); await sleep(ms); }
  return async () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const day = () => p.evaluate(() => document.querySelector('[data-cur] .dayhead h2').textContent);
const st = () => p.evaluate(() => ({ hold: document.documentElement.classList.contains('ptr-hold'), busy: document.documentElement.classList.contains('ptr-busy'), tr: document.getElementById('app').style.transform, op: (document.querySelector('.ptr') || {}).style?.opacity }));
const d0 = await day();
let up = await drag(200, 300, 0, 260); let s = await st();
T('тянем вниз 260px: экран едет за пальцем, индикатор виден', s.hold && /translate3d\(0px?, ?[1-9]/.test(s.tr) && +s.op > 0.5, JSON.stringify(s));
await up(); await sleep(150); s = await st();
T('отпустили после полного натяжения — идёт обновление', s.busy, JSON.stringify(s));
await sleep(2200); s = await st();
const toast = await p.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
T('экран вернулся на место', !s.busy && !s.tr, JSON.stringify(s));
T('сообщение «Расписание обновлено»', /обновлено/.test(toast), toast);
up = await drag(200, 300, 0, 40); await up(); await sleep(700); s = await st();
T('чуть потянули (40px) — без обновления, экран на месте', !s.busy && !s.tr, JSON.stringify(s));
T('день не сменился от вертикальных жестов', (await day()) === d0, await day());
up = await drag(300, 400, -220, 30, 12); s = await st(); await up(); await sleep(900);
T('горизонтальный свайп с лёгким уклоном вниз — листание, а не обновление', !s.hold && (await day()) !== d0, await day());
up = await drag(200, 300, 30, 200); s = await st(); await up(); await sleep(1800);
T('вертикальный с лёгким уклоном вбок — обновление, а не листание', s.hold, JSON.stringify(s));
T('нет ошибок JS', !errs.length, errs.join(' | '));
console.log(`\n${ok}/${n}`); await b.close();
