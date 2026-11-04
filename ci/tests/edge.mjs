import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
async function inTeacher() {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage();
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await p.goto('http://localhost:8772/?now=2026-10-20T11:00'); await p.waitForSelector('.week'); await sleep(800);
  await p.tap('.tab[data-tab="teachers"]'); await sleep(600); await p.tap('#app .item >> nth=1'); await sleep(900); return { c, p };
}
const where = (p) => p.evaluate(() => document.querySelector('[data-act="back"]') ? 'преподаватель' : ((document.querySelector('.top h1') || {}).textContent || '?'));
// Время каждого касания задаём явно (timestamp): иначе каждая команда протоколу идёт 35–50 мс,
// и «быстрый бросок» на деле получался медленным — тест падал через раз из-за себя, а не приложения.
async function drag(p, pts, dt) { const cdp = await touchSession(p);
  const T0 = Date.now() / 1000; let k = 0; const ts = () => T0 + dt / 1000 * (k++);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }], timestamp: ts() });
  for (const [x, y] of pts.slice(1)) { await sleep(dt); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }], timestamp: ts() }); }
  await sleep(dt); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts() }); }
const line = (x0, x1, n, y = 400) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y]);
for (const [name, pts, dt, want] of [
  ['медленно на 60 px и отпустил', line(8, 68, 10), 40, 'преподаватель'],
  ['медленно на 120 px (меньше трети)', line(8, 128, 12), 40, 'преподаватель'],
  ['медленно больше половины экрана', line(8, 260, 14), 30, 'Преподаватели'],
  ['быстрый короткий бросок от края', line(8, 70, 3), 12, 'Преподаватели'],
  ['свайп не от края (листание дней)', line(250, 40, 8), 16, 'преподаватель'],
  ['вертикальная прокрутка от края', [[8, 600], [10, 560], [12, 500], [12, 420], [12, 360]], 20, 'преподаватель'],
]) {
  const { c, p } = await inTeacher(); await drag(p, pts, dt); await sleep(900);
  const w = await where(p); const tr = await p.evaluate(() => document.getElementById('app').style.transform);
  ok(w === want && !tr, `${name} → ${want}`, { w, tr }); await c.close(); }
console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
