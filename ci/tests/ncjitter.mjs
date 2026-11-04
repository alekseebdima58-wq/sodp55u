import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }); const p = await c.newPage();
await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
await p.goto('http://localhost:8772/?now=2026-10-19T11:55&n=15.1.0.1&ts=1&k=' + 'cd'.repeat(16)); await p.waitForSelector('.week'); await sleep(600);
await p.tap('[data-act="notif"]'); await sleep(900);
await p.evaluate(() => { const card = document.querySelector('#app .ncw .nc'); window.__xs = []; const f = () => { window.__xs.push(card.getBoundingClientRect().left); if (window.__xs.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); });
const r = await (await p.$('#app .ncw')).boundingBox(); const cdp = await touchSession(p);
// палец движется рывками, как на настоящем экране: события через 8–24 мс, шаги разной длины
const x0 = r.x + r.width - 30, y = r.y + 40; let x = x0;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
for (let i = 0; i < 40; i++) { x -= 3 + (i % 3) * 2; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(8 + (i % 3) * 8); }
await sleep(100);
const xs = await p.evaluate(() => window.__xs.slice());
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
let back = 0, maxBack = 0; for (let i = 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; if (d > 0.5) { back++; maxBack = Math.max(maxBack, d); } }
const lagEnd = Math.round(xs[xs.length - 1] - (r.x - (x0 - x)));
console.log(`кадров ${xs.length}: шагов назад (против движения пальца) ${back}, самый большой ${maxBack.toFixed(1)} px`);
await b.close();
