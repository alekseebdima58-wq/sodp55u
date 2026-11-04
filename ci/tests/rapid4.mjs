import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:8772/';
async function flick(p, dir, dur, dist = 230) { const cdp = await touchSession(p); const y = 560, x0 = dir > 0 ? 300 : 80, n = Math.max(2, Math.round(dur / 16));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - dir * dist * i / n, y }] }); await sleep(dur / n); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); }
for (const [dur, gap, dist] of [[30, 70, 270], [60, 70, 230], [90, 100, 200], [120, 150, 180], [100, 250, 200], [150, 300, 160], [60, 40, 230], [80, 0, 200]]) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage();
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.goto(URL + '?now=2026-10-20T10:00'); await p.waitForSelector('.week'); await sleep(900); const cd = await touchSession(p); await cd.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let i = 0; i < 3; i++) { await flick(p, 1, dur, dist); await sleep(gap); }
  await sleep(1300);
  const h = await p.evaluate(() => document.querySelector('[data-cur] .dayhead h2').textContent);
  console.log(`свайп ${dur} мс на ${dist}px, пауза ${gap} мс ×3: вторник 20 → ${h} ${h.startsWith('Пятница, 23') ? '✓' : '✗'}`);
  await c.close(); }
await b.close();
