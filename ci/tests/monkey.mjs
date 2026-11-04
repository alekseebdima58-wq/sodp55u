// Полная проверка: случайные цепочки действий (свайпы, нажатия на дни, недели, карточки, переходы),
// после КАЖДОГО действия — проверка инвариантов экрана.
import { chromium, touchSession } from '../lib.mjs';
const PORT = 8772, OUT = process.argv[2] || '.', STEPS = +(process.argv[3] || 60);
const b = await chromium.launch();
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE = () => { const ev = {}; let backCb = null; window.__tgBack = () => backCb && backCb();
  const W = { platform: 'ios', version: '8.0', colorScheme: 'dark', initData: '', initDataUnsafe: {}, isFullscreen: true,
  safeAreaInset: { top: 59, bottom: 34 }, contentSafeAreaInset: { top: 50, bottom: 0 }, isVersionAtLeast: () => true, ready() {}, expand() {}, disableVerticalSwipes() {},
  setHeaderColor() {}, setBackgroundColor() {}, BackButton: { show() {}, hide() {}, onClick(f) { backCb = f; } }, HapticFeedback: { selectionChanged() {}, impactOccurred() {}, notificationOccurred() {} },
  onEvent(n, f) { (ev[n] = ev[n] || []).push(f); }, openLink() {}, openTelegramLink() {}, requestFullscreen() {}, exitFullscreen() {} }; window.Telegram = { WebApp: W }; };
const SPY = () => {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
  Object.defineProperty(Element.prototype, 'scrollLeft', { get() { return d.get.call(this); }, set(v) { if (this.matches && this.matches('[data-pager]')) console.log('DBG set scrollLeft=' + v + ' ' + (new Error().stack.split('\n')[2] || '').trim()); d.set.call(this, v); }, configurable: true });
  const si = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { console.log('DBG scrollIntoView ' + this.className); return si.call(this, o); };
  document.addEventListener('scroll', (e) => { const t = e.target; if (t.matches && t.matches('[data-pager]')) console.log('DBG pager scrolled to ' + t.scrollLeft + ' active=' + (document.activeElement && document.activeElement.className)); }, true);
};
const INV = () => { window.__inv = () => {
  const e = [], q = (s) => document.querySelector(s);
  const vw = innerWidth;
  if (document.documentElement.scrollWidth > vw + 1) e.push(`гориз. прокрутка ${document.documentElement.scrollWidth}>${vw}`);
  const app = q('#app');
  if (app.style.transform && app.style.transform !== 'none') e.push('у #app остался сдвиг ' + app.style.transform);
  const pager = q('[data-pager]');
  if (pager) {
    const cur = document.querySelectorAll('[data-cur]');
    if (cur.length !== 1) e.push('страниц [data-cur]: ' + cur.length);
    const c = cur[0];
    if (c) {
      const pl = pager.getBoundingClientRect().left, cl = c.getBoundingClientRect().left;
      if (Math.abs(pl - cl) > 2) e.push(`лента не на текущем дне: сдвиг ${Math.round(cl - pl)}px`);
      const h2 = c.querySelector('.dayhead h2'), on = q('.day.on');
      if (h2 && on) { const n = on.querySelector('.n') && on.querySelector('.n').textContent.trim(); if (n && !new RegExp(`(^|\\D)${n}(\\D|$)`).test(h2.textContent)) e.push(`выделен день ${n}, а показан «${h2.textContent}»`); }
      const rows = [...c.querySelectorAll('.tl > .row, .tl > .brk')];
      for (let i = 1; i < rows.length; i++) { const a = rows[i - 1].getBoundingClientRect(), bb = rows[i].getBoundingClientRect(); if (bb.top < a.bottom - 2) e.push(`строки ${i - 1} и ${i} налезают на ${Math.round(a.bottom - bb.top)}px`); }
      for (const card of c.querySelectorAll('.card')) { if (card.scrollWidth > card.clientWidth + 2) e.push('текст вылезает из карточки'); }
      for (const row of c.querySelectorAll('.row.live')) {
        const l = row.querySelector('[data-nowlbl]'); if (!l || l.hidden) continue;
        const lb = l.getBoundingClientRect(), en = row.querySelector('.time .en'), st = row.querySelector('.time .st');
        const eb = en.getBoundingClientRect(), sb = st.getBoundingClientRect();
        const enVis = +getComputedStyle(en).opacity > 0.05 && en.textContent;
        if (enVis && lb.top < eb.bottom - 1 && lb.bottom > eb.top + 1 && lb.left < eb.right && lb.right > eb.left) e.push(`«сейчас» на времени конца (${l.textContent} / ${en.textContent})`);
        if (lb.top < sb.bottom - 2 && lb.left < sb.right) e.push('«сейчас» на времени начала');
      }
      const live = c.querySelectorAll('.row.live').length; if (live > 1) e.push('идущих пар: ' + live);
    }
  }
  const h = q('.whead'); if (h) { const t = h.querySelector('h1').getBoundingClientRect(); for (const x of h.querySelectorAll('.top-actions > *')) { const r = x.getBoundingClientRect(); if (Math.abs((r.top + r.bottom) / 2 - (t.top + t.bottom) / 2) > 1.5) { e.push('кнопки шапки не по центру'); break; } } }
  const tabs = q('.tabs'); if (tabs) { const on = tabs.querySelectorAll('.tab.on, .tab[aria-current="page"]').length; if (on > 1) e.push('активных вкладок ' + on); }
  return e;
}; };
async function swipe(p, dir, fast) {
  const cdp = await touchSession(p); const y = 520, x0 = dir > 0 ? 320 : 70, x1 = dir > 0 ? 50 : 340, n = fast ? 4 : 9;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y: y + i }] }); await sleep(fast ? 8 : 16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}
// Нажатие — как пальцем: настоящий tap в точку элемента (Playwright click сам прокручивал бы
// даже скрытую ленту дней, чего пользователь сделать не может)
const clickIf = async (p, sel, nth = 0) => {
  const els = await p.$$(sel); if (!els.length) return false;
  const el = els[Math.min(nth, els.length - 1)];
  let r = await el.boundingBox(); if (!r) return false;
  const vh = 844;
  if (r.y < 120 || r.y + Math.min(r.height, 40) > vh - 100) { await p.evaluate((y) => window.scrollBy(0, y), r.y - vh / 2); await sleep(250); r = await el.boundingBox(); if (!r) return false; }
  const x = r.x + Math.min(r.width / 2, 40), y = r.y + Math.min(r.height / 2, 20);
  if (x < 0 || x > (await p.evaluate(() => innerWidth))) return false;
  await p.touchscreen.tap(x, y); return true;
};
const ACTIONS = {
  swipeL: (p) => swipe(p, 1), swipeR: (p) => swipe(p, -1),
  swipeLL: async (p) => { await swipe(p, 1, true); await sleep(60); await swipe(p, 1, true); },
  swipeRR: async (p) => { await swipe(p, -1, true); await sleep(60); await swipe(p, -1, true); },
  day: (p) => clickIf(p, '.days .day', Math.floor(rnd() * 7)),
  dayDbl: async (p) => { const n = Math.floor(rnd() * 7); await clickIf(p, '.days .day', n); await sleep(40); await clickIf(p, '.days .day', n); },
  weekNext: (p) => clickIf(p, '.whead [data-act="week"][data-dir="1"], .week [data-act="week"][data-dir="1"]'),
  weekPrev: (p) => clickIf(p, '.whead [data-act="week"][data-dir="-1"], .week [data-act="week"][data-dir="-1"]'),
  today: (p) => clickIf(p, '.tab[data-tab="schedule"]'),
  card: (p) => clickIf(p, '[data-cur] [data-act="open"]', Math.floor(rnd() * 5)),
  cardLive: async (p) => { if (!(await clickIf(p, '[data-cur] .row.live [data-act="open"]'))) await clickIf(p, '[data-cur] [data-act="open"]'); },
  cardTwice: async (p) => { const n = Math.floor(rnd() * 4); await clickIf(p, '[data-cur] [data-act="open"]', n); await sleep(120); await clickIf(p, '[data-cur] [data-act="open"]', n); },
  scroll: (p) => p.evaluate((y) => window.scrollTo(0, y), Math.floor(rnd() * 900)),
  scrollTop: (p) => p.evaluate(() => window.scrollTo(0, 0)),
  teacher: async (p) => { await clickIf(p, '.tab[data-tab="teachers"]'); await sleep(400); await clickIf(p, '#app .item', Math.floor(rnd() * 8)); },
  back: async (p) => { if (!(await clickIf(p, '.top [data-act="back"]'))) await p.evaluate(() => window.__tgBack && window.__tgBack()); },
  notif: async (p) => { if (await clickIf(p, '[data-act="notif"]')) { await sleep(400); await clickIf(p, '[data-act="back"]') || await p.evaluate(() => window.__tgBack && window.__tgBack()); } },
  settings: async (p) => { await clickIf(p, '.tab[data-tab="settings"]'); await sleep(400); await clickIf(p, '#ncard .nhead'); await sleep(500); await clickIf(p, '#ncard .nhead'); await sleep(300); await clickIf(p, '.tab[data-tab="schedule"]'); },
  tabDbl: async (p) => { await clickIf(p, '.tab[data-tab="schedule"]'); await sleep(50); await clickIf(p, '.tab[data-tab="schedule"]'); },
};
const NAMES = Object.keys(ACTIONS);
let total = 0, bad = 0; const seen = new Set(); const transient = []; const problems = new Map();
const ONLY = process.argv[4] ? +process.argv[4] : -1;
const COMBOS0 = [['2026-10-19T12:10', 390, 'dark', true], ['2026-10-19T12:40', 430, 'light', false], ['2026-10-21T13:55', 360, 'dark', true],['2026-10-19T12:14', 390, 'dark', true], ['2026-10-19T09:55', 360, 'light', false], ['2026-10-19T10:05', 430, 'dark', false],
  ['2026-10-20T08:00', 393, 'light', true], ['2026-10-18T15:00', 390, 'dark', false], ['2026-10-23T17:50', 375, 'dark', true]];
const COMBOS = ONLY >= 0 ? [COMBOS0[ONLY]] : COMBOS0;
for (const [now, w, scheme, tg] of COMBOS) {
  const c = await b.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: scheme });
  const p = await c.newPage(); const errs = []; const log = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  if (tg) await p.addInitScript(FAKE); await p.addInitScript(INV); await p.addInitScript(SPY); p.on('console', (m) => { if (/^DBG/.test(m.text())) console.log('   [шаг', log.length, log[log.length - 1], ']', m.text()); });
  await p.goto(`http://localhost:${PORT}/?now=${now}${tg ? '#tgWebAppData=x' : ''}`); await p.waitForSelector('.week'); await sleep(900);
  for (let s = 0; s < STEPS; s++) {
    const a = pick(NAMES); log.push(a);
    try { await ACTIONS[a](p); } catch (e) { log.push('!' + e.message.slice(0, 40)); }
    await sleep(a.startsWith('swipe') || a === 'day' || a.startsWith('week') ? 950 : 650);
    const snapS = await p.evaluate(() => ({ h: (document.querySelector('[data-cur] .dayhead h2') || {}).textContent || (document.querySelector('.top h1') || {}).textContent, open: document.querySelectorAll('[data-cur] .row:not(.compact) .card .more, [data-cur] .card.open').length }));
    seen.add(snapS.h);
    let e = await p.evaluate(() => window.__inv()); total++;
    if (e.length) { await sleep(1500); const e2 = await p.evaluate(() => window.__inv()); if (!e2.length) { transient.push(`${a}: ${e[0]}`); e = []; } else e = e2; }
    if (e.length) { bad++; const key = e[0].replace(/\d+/g, '#'); if (!problems.has(key)) { problems.set(key, { combo: `${now} ${w}px ${scheme}${tg ? ' TG' : ''}`, after: log.join(' → '), all: e });
        await p.screenshot({ path: `${OUT}/bug-${problems.size}.png` });
        console.log('ДИАГНОСТИКА', s, await p.evaluate(() => { const pg = document.querySelector('[data-pager]'); return { sl: pg.scrollLeft, cw: pg.clientWidth, sw: pg.scrollWidth, kids: [...pg.children].map((k) => k.className + ':' + Math.round(k.getBoundingClientRect().left) + '/' + Math.round(k.offsetWidth) + ' tr=' + k.style.transform + ' anim=' + k.getAnimations().length), pgLeft: pg.getBoundingClientRect().left, pgStyle: pg.getAttribute('style'), appStyle: document.getElementById('app').getAttribute('style'), appLeft: document.getElementById('app').getBoundingClientRect().left, rowsAnim: document.querySelectorAll('[data-cur] *').length && [...document.querySelectorAll('[data-cur] *')].filter((x) => x.getAnimations().length).map((x) => x.className).slice(0, 5), snap: getComputedStyle(pg).scrollSnapType, ov: getComputedStyle(pg).overflowX, scrollY }; })); } }
  }
  if (errs.length) problems.set('JS: ' + errs[0], { combo: now, after: '', all: errs });
  await c.close();
}
console.log(`разных экранов/дней посетили: ${seen.size}`); console.log(`проверок после действий: ${total}, с нарушениями (не прошли и через 1,5 с): ${bad}, временных: ${transient.length}`); if (transient.length) console.log('временные:', [...new Set(transient)].slice(0, 8));
for (const [k, v] of problems) console.log(`\n✗ ${k}\n   где: ${v.combo}\n   после: ${v.after}\n   ${JSON.stringify(v.all)}`);
await b.close();
