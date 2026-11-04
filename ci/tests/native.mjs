// v2.0: лента дней — родная прокрутка. Главная проверка «как у нативного приложения»: если приложение
// занято (основной поток стоит 400 мс), лента всё равно едет за пальцем и доезжает — её ведёт браузер, а не JS.
import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = []; const errs = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript(() => { window.__nonPassive = []; const o = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, f, opt) { if (/^touch(start|move)$/.test(t) && !(opt && opt.passive) && !(t === 'touchstart' && opt === undefined && false)) { const passive = opt && typeof opt === 'object' ? opt.passive : undefined; if (passive === false || (passive === undefined && t === 'touchmove')) window.__nonPassive.push({ t, el: this === document ? 'document' : this === window ? 'window' : (this.className || this.nodeName), get pager() { return /pager/.test(String(this.el)) || (this.t === 'touchmove' && (this.el === 'document' || this.el === 'window')); } }); } return o.call(this, t, f, opt); }; });
await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.goto('http://localhost:8772/?now=2026-10-20T10:00'); await p.waitForSelector('.week'); await sleep(900);
const cdp = await touchSession(p); const T = (type, x, y = 560) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const left = () => p.evaluate(() => Math.round(document.querySelector('[data-pager]').scrollLeft));
const busy = (ms) => p.evaluate((ms) => { setTimeout(() => { const t0 = performance.now(); while (performance.now() - t0 < ms) {} }, 0); }, ms);
// 1) палец ведёт ленту, пока основной поток занят
const l0 = await left();
await T('touchStart', 300); await busy(400); await sleep(20);
for (let i = 1; i <= 10; i++) { await T('touchMove', 300 - 18 * i); await sleep(16); }
await T('touchEnd'); await sleep(1200);
const h = await p.evaluate(() => document.querySelector('[data-cur] .dayhead h2').textContent);
ok(h.startsWith('Среда'), 'свайп, пока приложение занято 400 мс, — перелистнул на среду', h);
// 2) ничто не может задержать родную прокрутку ленты: на ней и над ней нет обработчиков касаний
//    с правом отменить прокрутку (passive: false) — иначе телефон ждал бы JS на каждом движении пальца
const blockers = await p.evaluate(() => (window.__nonPassive || []).filter((x) => x.pager));
ok(!blockers.length, 'над лентой нет «непассивных» касаний — прокрутку ведёт телефон, не дожидаясь приложения', blockers);
// 3) быстрый бросок, а сразу за ним приложение занято 400 мс — лента всё равно встаёт ровно на следующий день
await T('touchStart', 300); for (let i = 1; i <= 5; i++) { await T('touchMove', 300 - 46 * i); await sleep(16); } await T('touchEnd');
await busy(400); await sleep(1500);
const off = await p.evaluate(() => { const pg = document.querySelector('[data-pager]'), cur = document.querySelector('[data-cur]'); return Math.round(cur.getBoundingClientRect().left - pg.getBoundingClientRect().left); });
ok(off === 0 && (await p.evaluate(() => document.querySelector('[data-cur] .dayhead h2').textContent)).startsWith('Четверг'), 'бросок + занятое приложение — встал ровно на четверг', off);
ok(l0 >= 0 && !errs.length, 'нет ошибок JS', errs);
console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
