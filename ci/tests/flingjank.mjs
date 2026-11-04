// Быстрый короткий бросок (88 px за 48 мс), а в момент отпускания страница занята 150 мс (подтормаживание —
// на телефоне так бывает при открытии и подгрузке). Палец бросил — день должен перелистнуться.
// Скорость считается по времени касаний (e.timeStamp), а не по времени, когда до события дошла очередь.
import { chromium, touchSession } from '../lib.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch(); let ok = 0, n = 0;
for (let k = 0; k < 5; k++) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage();
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.goto('http://localhost:8772/?now=2026-10-20T10:00'); await p.waitForSelector('.week'); await sleep(900);
  const day = () => p.evaluate(() => document.querySelector('[data-cur] .dayhead h2').textContent);
  const d0 = await day(); const cdp = await touchSession(p); const y = 560, x0 = 300;
  const T0 = Date.now() / 1000; let i = 0; const ts = () => T0 + 0.012 * (i++);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }], timestamp: ts() });
  for (let s = 1; s <= 4; s++) { await sleep(12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - 22 * s, y }], timestamp: ts() }); }
  await p.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 150); }, 0); });
  await sleep(5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: ts() });
  await sleep(1200); n++; const d1 = await day();
  console.log(`${d1 !== d0 ? 'OK  ' : 'FAIL'} бросок при подтормаживании #${k + 1}: ${d0} → ${d1}`); if (d1 !== d0) ok++;
  await c.close();
}
console.log(`\n${ok}/${n}`); await b.close();
