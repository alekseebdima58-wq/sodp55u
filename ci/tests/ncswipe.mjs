import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = []; const errs = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
async function open() {
  const c = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await p.goto('http://localhost:8772/?now=2026-10-19T11:55&n=15.1.0.1&ts=1&k=' + 'cd'.repeat(16)); await p.waitForSelector('.week'); await sleep(700);
  await p.tap('[data-act="notif"]'); await sleep(900); return { c, p };
}
const count = (p) => p.$$eval('#app .ncw:not(.gone)', (x) => x.length);
// путь пальца: до frac ширины карточки за ~0.4 с, потом (по желанию) чуть назад
async function swipe(p, frac, backPx = 0, backMs = 60, pause = 0) {
  const r = await (await p.$('#app .ncw')).boundingBox(); const cdp = await touchSession(p);
  const x0 = r.x + r.width - 30, y = r.y + 40, x1 = x0 - r.width * frac, n = 22;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y }] }); await sleep(18); }
  if (pause) await sleep(pause);
  for (let i = 1; i <= 4 && backPx; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + backPx * i / 4, y }] }); await sleep(backMs / 4); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(900);
}
const state = (p) => p.evaluate(() => { const w = document.querySelector('#app .ncw:not(.gone)'); const c = w.querySelector('.nc'); return { tr: c.style.transform, open: w.classList.contains('ncsw') }; });
for (const [name, frac, back, backMs, pause, want] of [
  ['дотянул до 45 % и отпустил', 0.45, 0, 60, 0, 'удалено'],
  ['дотянул до 45 %, при отпускании палец дёрнулся назад на 25 px', 0.45, 25, 50, 0, 'удалено'],
  ['дотянул до 60 % (как на видео)', 0.6, 40, 80, 0, 'удалено'],
  ['до 30 % — кнопка «Удалить» остаётся открытой', 0.3, 0, 60, 0, 'открыто'],
  ['до 45 %, подержал и медленно отвёл назад к 20 % — передумал', 0.45, 0.25 * 333, 600, 200, 'открыто'],
  ['чуть-чуть (10 %) — закрылось', 0.1, 0, 60, 0, 'закрыто'],
]) {
  const { c, p } = await open(); const n0 = await count(p);
  await swipe(p, frac, typeof back === 'number' ? back : 0, backMs, pause);
  const n1 = await count(p); const st = n1 === n0 ? await state(p) : null;
  const got = n1 === n0 - 1 ? 'удалено' : st && st.open && st.tr ? 'открыто' : 'закрыто';
  ok(got === want, `${name} → ${want}`, { got, n0, n1, st });
  if (got === 'открыто') { await p.tap('#app .ncw .nc-del'); await sleep(900); ok((await count(p)) === n0 - 1, '   …нажал «Удалить» — удалено'); }
  await c.close(); }
// снимок «взведённого» состояния
{ const { c, p } = await open(); const r = await (await p.$('#app .ncw')).boundingBox(); const cdp = await touchSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width - 30, y: r.y + 40 }] });
  for (let i = 1; i <= 20; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width - 30 - r.width * 0.5 * i / 20, y: r.y + 40 }] }); await sleep(16); }
  await sleep(250); await p.screenshot({ path: 'ncarmed.png', clip: { x: 0, y: r.y - 20, width: 393, height: r.height + 40 } });
  ok(await p.evaluate(() => document.querySelector('#app .ncw').classList.contains('armed')), 'на 50 % — «взведено» (значок уехал к пальцу)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await c.close(); }
ok(!errs.length, 'нет ошибок JS', errs); console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
