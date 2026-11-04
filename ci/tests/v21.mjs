// v2.1: фон картинкой совпадает с прежним; кнопки недели и дальние дни — без перерисовки экрана;
// подложка перехода — отдельный элемент; слой экрана только на время перехода
import { chromium } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? '✓' : '✗'), t, x !== undefined ? JSON.stringify(x) : ''); };
const errs = [];
async function open(theme) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: theme || 'dark' });
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await p.goto('http://localhost:8772/?now=2026-10-20T11:00'); await p.waitForSelector('.week'); await sleep(1200);
  return { c, p };
}
for (const theme of ['dark', 'light']) {
  const { c, p } = await open(theme);
  ok(await p.evaluate(() => document.documentElement.classList.contains('gpic')), `${theme}: фон нарисован картинкой`);
  // сравнение с прежним фоном: прячем экран и панель, снимаем body::before с картинкой и с градиентами
  await p.addStyleTag({ content: '#app, .tabs, .topveil, .navbar, .ptr, #splash, .ibar, .toast { visibility: hidden !important; }' });
  await sleep(600);
  const a = await p.screenshot();
  await p.evaluate(() => document.documentElement.classList.remove('gpic')); await p.evaluate(() => document.documentElement.style.removeProperty('--g-img'));
  await sleep(200);
  const g = await p.screenshot();
  const diff = await p.evaluate(async ([A, G]) => {
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + u; });
    const [ia, ig] = await Promise.all([load(A), load(G)]);
    const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height; const x = cv.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, cv.width, cv.height).data;
    x.drawImage(ig, 0, 0); const dg = x.getImageData(0, 0, cv.width, cv.height).data;
    let big = 0, sum = 0, n = 0;
    for (let i = 0; i < da.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) { const d = Math.abs(da[i + k] - dg[i + k]); if (d > m) m = d; sum += d; } if (m > 12) big++; n++; }
    return { bigShare: +(big / n * 100).toFixed(3), avg: +(sum / n / 3).toFixed(2) };
  }, [a.toString('base64'), g.toString('base64')]);
  ok(diff.bigShare <= 0.2 && diff.avg <= 1.5, `${theme}: картинка совпадает с прежним фоном (разница цвета в точке)`, diff);
  await c.close();
}
{
  const { c, p } = await open();
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('app')).willChange) === 'auto', 'в покое экран — не отдельный слой');
  ok(await p.evaluate(() => !!document.getElementById('appbg') && getComputedStyle(document.getElementById('appbg')).display === 'none'), 'подложка перехода в покое скрыта');
  // кнопка следующей недели: экран не перерисовывается (шапка — да, лента — та же)
  const r0 = await p.evaluate(() => { window.__pg = document.querySelector('[data-pager]'); window.__sbar = document.querySelector('.sbar'); return document.querySelector('h1.wr').textContent; });
  await p.tap('.wbtn[data-dir="1"]'); await sleep(700);
  const r1 = await p.evaluate(() => ({ same: window.__pg === document.querySelector('[data-pager]') && window.__sbar === document.querySelector('.sbar'),
    wr: document.querySelector('h1.wr').textContent, cur: +document.querySelector('[data-pager] > [data-cur]').dataset.i,
    x: document.querySelector('[data-pager]').scrollLeft, w: document.querySelector('[data-pager]').clientWidth,
    on: [...document.querySelectorAll('.days .day')].findIndex((b) => b.classList.contains('on')),
    pill: document.querySelector('.days .pill').style.transform, anim: document.querySelector('[data-cur]').className }));
  ok(r1.same && r1.wr !== r0, 'следующая неделя — без перерисовки экрана, шапка новая', { r0, r1 });
  ok(Math.abs(r1.x - r1.cur * r1.w) < 1 && r1.cur === 8 && r1.on === 1, 'лента встала на тот же день следующей недели', r1);
  await sleep(500);
  ok(!/from-[rl]/.test(await p.evaluate(() => document.querySelector('[data-cur]').className)), 'метка въезда снята после анимации');
  await p.tap('.wbtn[data-dir="-1"]'); await sleep(700);
  const r2 = await p.evaluate(() => ({ cur: +document.querySelector('[data-pager] > [data-cur]').dataset.i, wr: document.querySelector('h1.wr').textContent }));
  ok(r2.cur === 1 && r2.wr === r0, 'и обратно', r2);
  // дальний день той же недели — без перерисовки, таблетка переезжает
  await p.tap('.days .day[data-d="4"]'); await sleep(700);
  const r3 = await p.evaluate(() => ({ same: window.__pg === document.querySelector('[data-pager]'), cur: +document.querySelector('[data-pager] > [data-cur]').dataset.i,
    on: [...document.querySelectorAll('.days .day')].findIndex((b) => b.classList.contains('on')) }));
  ok(r3.same && r3.cur === 4 && r3.on === 4, 'дальний день — без перерисовки', r3);
  // переход в уведомления: подложка видна во время движения, экран — слой; после — всё убрано
  await p.tap('.bell'); await sleep(150);
  const mid = await p.evaluate(() => ({ bg: getComputedStyle(document.getElementById('appbg')).display, wc: getComputedStyle(document.getElementById('app')).willChange,
    root: document.documentElement.getAttribute('style') || '' }));
  ok(mid.bg === 'block' && /transform/.test(mid.wc) && !/g-sy|g-vh/.test(mid.root), 'во время перехода: подложка и слой экрана есть, переменные у <html> не трогаются', mid);
  await sleep(900);
  const end = await p.evaluate(() => ({ bg: getComputedStyle(document.getElementById('appbg')).display, t: document.getElementById('appbg').style.transform, wc: getComputedStyle(document.getElementById('app')).willChange }));
  ok(end.bg === 'none' && !end.t && end.wc === 'auto', 'после перехода всё убрано', end);
  await c.close();
}
ok(!errs.length, 'без ошибок скрипта', errs.slice(0, 3));
console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
