import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const DBG = true; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = []; const errs = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
async function page() { const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (/DBG/.test(m.text())) console.log(m.text()); });
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.goto('http://localhost:8772/?now=2026-10-20T10:00'); await p.waitForSelector('.week'); await sleep(900);
  const cdp = await touchSession(p); return { c, p, cdp }; }
const T = (cdp, type, x, y = 560) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function flick(cdp, dir) { await T(cdp, 'touchStart', dir > 0 ? 300 : 80); for (let i = 1; i <= 5; i++) { await T(cdp, 'touchMove', (dir > 0 ? 300 : 80) - dir * 46 * i); await sleep(16); } await T(cdp, 'touchEnd'); }
// где на экране заголовок дня «Среда» (тот, к которому едем)
const where = (p, txt) => p.evaluate((txt) => { const h = [...document.querySelectorAll('[data-pager] .page h2')].find((x) => x.textContent.startsWith(txt)); return h ? Math.round(h.getBoundingClientRect().left) : null; }, txt);
const h2 = (p) => p.evaluate(() => document.querySelector('[data-cur] .dayhead h2').textContent);
// 1) подхватил на лету и держит — картинка не прыгает
{ const { c, p, cdp } = await page();
  await p.evaluate(() => { const w = () => { const h = [...document.querySelectorAll('[data-pager] .page h2')].find((x) => x.textContent.startsWith('Среда')); return h ? h.getBoundingClientRect().left : null; };
    window.addEventListener('touchstart', () => { window.__b = w(); }, { capture: true }); document.addEventListener('touchstart', () => { window.__a = w(); }); });
  await flick(cdp, 1); await sleep(90);
  await T(cdp, 'touchStart', 200); await sleep(30); const { before, after } = await p.evaluate(() => ({ before: window.__b, after: window.__a }));
  ok(before !== null && after !== null && Math.abs(before - after) <= 2, 'подхватил ленту на лету — ничего не прыгнуло', { before, after });
  // v2.0: лента — родная прокрутка. Как в iOS: касание останавливает её там, где она есть, а после
  // отпускания она встаёт на ближайший день — ровно по краю
  await T(cdp, 'touchEnd'); await sleep(900);
  const st = await p.evaluate(() => { const pg = document.querySelector('[data-pager]'), cur = document.querySelector('[data-cur]'); return { h: cur.querySelector('h2').textContent, off: Math.round(cur.getBoundingClientRect().left - pg.getBoundingClientRect().left) }; });
  ok(/^(Вторник|Среда)/.test(st.h) && st.off === 0, 'отпустил без движения — встал ровно на ближайший день', st);
  await c.close(); }
// 2) подхватил и потянул обратно — вернулся на вторник
{ const { c, p, cdp } = await page();
  await flick(cdp, 1); await sleep(80);
  await T(cdp, 'touchStart', 100); for (let i = 1; i <= 8; i++) { await T(cdp, 'touchMove', 100 + i * 30); await sleep(20); } await T(cdp, 'touchEnd'); await sleep(1000);
  ok((await h2(p)).startsWith('Вторник'), 'подхватил и бросил обратно — снова вторник', await h2(p));
  await c.close(); }
// 3) нажатие по экрану во время листания — доезжает до нужного дня (раньше откатывалось назад)
{ const { c, p, cdp } = await page();
  await flick(cdp, 1); await sleep(60); await T(cdp, 'touchStart', 200, 700); await T(cdp, 'touchEnd'); await sleep(900);
  ok((await h2(p)).startsWith('Среда'), 'тап во время листания — день не теряется', await h2(p));
  await c.close(); }
// 4) быстрые свайпы до упора: дальше последнего дня не уходит
{ const { c, p, cdp } = await page();
  for (let i = 0; i < 22; i++) { await flick(cdp, 1); await sleep(60); } await sleep(1300);
  ok((await h2(p)).startsWith('Воскресенье, 8'), '22 быстрых свайпа — упёрлось в последний день данных (вс 8 ноября)', await h2(p));
  const off = await p.evaluate(() => { const pg = document.querySelector('[data-pager]'), cur = document.querySelector('[data-cur]'); return Math.round(cur.getBoundingClientRect().left - pg.getBoundingClientRect().left); });
  ok(off === 0, 'лента стоит ровно', off);
  for (let i = 0; i < 22; i++) { await flick(cdp, -1); await sleep(60); } await sleep(1300);
  ok((await h2(p)).startsWith('Понедельник, 19'), 'и 22 обратно — первый день (пн 19)', await h2(p));
  await c.close(); }
// 5) нажал на субботу и сразу подхватил ленту — встал на субботу, без прыжка
{ const { c, p, cdp } = await page();
  await p.evaluate(() => { const w = () => { const h = [...document.querySelectorAll('[data-pager] .page h2')].find((x) => x.textContent.startsWith('Суббота')); return h ? h.getBoundingClientRect().left : null; };
    window.addEventListener('touchstart', () => { window.__b = w(); }, { capture: true }); document.addEventListener('touchstart', () => { window.__a = w(); }); });
  const r = await (await p.$$('.days .day'))[5].boundingBox(); await p.touchscreen.tap(r.x + 20, r.y + 20); await sleep(110);
  await T(cdp, 'touchStart', 200); await sleep(20); const { before, after } = await p.evaluate(() => ({ before: window.__b, after: window.__a }));
  await T(cdp, 'touchEnd'); await sleep(900);
  ok(before !== null && Math.abs(before - after) <= 2 && (await h2(p)).startsWith('Суббота'), 'нажал на субботу и подхватил ленту на лету — суббота, без прыжка', { before, after, h: await h2(p) });
  await c.close(); }
// 6) через границу недели на лету: вс → пн следующей недели, шапка недели сменилась
{ const { c, p, cdp } = await page();
  const r = await (await p.$$('.days .day'))[6].boundingBox(); await p.touchscreen.tap(r.x + 20, r.y + 20); await sleep(900);
  await flick(cdp, 1); await sleep(80); await flick(cdp, 1); await sleep(1200);
  const t = await p.evaluate(() => document.querySelector('.whead h1').textContent);
  ok((await h2(p)).startsWith('Вторник, 27') && t.includes('26'), 'два быстрых свайпа через границу недели — вт 27, шапка «26 окт – 1 ноя»', [await h2(p), t]);
  await c.close(); }
ok(!errs.length, 'нет ошибок JS', errs); console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
