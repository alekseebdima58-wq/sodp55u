import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }); const p = await c.newPage();
await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
await p.goto('http://localhost:8772/?now=2026-10-19T11:55&n=15.1.0.1&ts=1&k=' + 'cd'.repeat(16)); await p.waitForSelector('.week'); await sleep(600);
await p.tap('[data-act="notif"]'); await sleep(900);
const r = await (await p.$('#app .ncw')).boundingBox(); const cdp = await touchSession(p);
const drag = async (fr, back = 0) => { const x0 = r.x + r.width - 30, y = r.y + 40;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 15; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - r.width * fr * i / 15 + back * i / 15, y }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
await drag(0.28); await sleep(600);   // открыли кнопку
// следим каждый кадр, пока закрываем: торчит ли красное правее карточки (и не обрезано)
await p.evaluate(() => { window.__bad = 0; window.__n = 0; const w = document.querySelector('#app .ncw'), d = w.querySelector('.nc-del');
  const f = () => { window.__n++; const wr = w.getBoundingClientRect(), dr = d.getBoundingClientRect(), vis = getComputedStyle(d).visibility === 'visible', clip = getComputedStyle(w).clipPath !== 'none';
    if (vis && !clip && dr.right > wr.right + 0.5) window.__bad++; if (window.__n < 60) requestAnimationFrame(f); }; requestAnimationFrame(f); });
{ // пальцем тянем открытую карточку обратно вправо, медленно
  const y = r.y + 40, x0 = r.x + 150; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 25; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 4, y }] }); await sleep(20); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(700); }
const res = await p.evaluate(() => ({ bad: window.__bad, n: window.__n, open: document.querySelector('#app .ncw').className }));
console.log('кадров при закрытии:', res.n, ' кадров с красной полоской правее карточки:', res.bad, ' итог:', res.open);
await b.close();
