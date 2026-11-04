import { chromium, touchSession } from '../lib.mjs';
const PORT = 8772; const b = await chromium.launch(); const res = []; const errs = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAKE = () => { const ev = {}; let backCb = null; window.__tgBack = () => backCb && backCb();
  const W = { platform: 'ios', version: '8.0', colorScheme: 'dark', initData: '', initDataUnsafe: {}, isFullscreen: true,
  safeAreaInset: { top: 59, bottom: 34 }, contentSafeAreaInset: { top: 50, bottom: 0 }, isVersionAtLeast: () => true, ready() {}, expand() {}, disableVerticalSwipes() {},
  setHeaderColor() {}, setBackgroundColor() {}, BackButton: { show() {}, hide() {}, onClick(f) { backCb = f; } }, HapticFeedback: { selectionChanged() {}, impactOccurred() {}, notificationOccurred() {} },
  onEvent(n, f) { (ev[n] = ev[n] || []).push(f); }, openLink() {}, openTelegramLink() {}, requestFullscreen() {}, exitFullscreen() {} }; window.Telegram = { WebApp: W }; };
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
  const cdp = await touchSession(p); const y = 560, x0 = dir > 0 ? 320 : 70, x1 = dir > 0 ? 50 : 340, n = fast ? 4 : 9;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y: y + i }] }); await sleep(fast ? 8 : 16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}
const tap = async (p, sel, nth = 0) => {
  const els = await p.$$(sel); if (!els.length) return false; const el = els[Math.min(nth, els.length - 1)];
  let r = await el.boundingBox(); if (!r) return false;
  if (r.y < 120 || r.y + Math.min(r.height, 40) > 744) { await p.evaluate((y) => window.scrollBy(0, y), r.y - 422); await sleep(250); r = await el.boundingBox(); }
  await p.touchscreen.tap(r.x + Math.min(r.width / 2, 40), r.y + Math.min(r.height / 2, 20)); return true;
};
const h2 = (p) => p.evaluate(() => (document.querySelector('[data-cur] .dayhead h2') || {}).textContent || '');
const title = (p) => p.evaluate(() => (document.querySelector('.whead h1, .week .wr') || {}).textContent || '');
const inv = async (p, what) => { const e = await p.evaluate(() => window.__inv()); ok(!e.length, `   ↳ экран в порядке после «${what}»`, e); };
async function open(now, { tg = false, w = 390, scheme = 'dark' } = {}) {
  const c = await b.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: scheme });
  const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  if (tg) await p.addInitScript(FAKE); await p.addInitScript(INV);
  await p.goto(`http://localhost:${PORT}/?now=${now}${tg ? '#tgWebAppData=x' : ''}`); await p.waitForSelector('.week'); await sleep(900);
  return { c, p };
}
const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
for (const tg of [false, true]) {
  const T = tg ? '[TG] ' : '[браузер] ';
  // 1. нажатия на дни
  { const { c, p } = await open('2026-10-21T10:30', { tg });
    ok((await h2(p)).startsWith('Среда, 21'), T + 'открылось сегодня (среда 21)', await h2(p));
    for (const d of [0, 6, 3, 1, 5, 2, 4]) { await tap(p, '.days .day', d); await sleep(800); const h = await h2(p);
      ok(h.startsWith(DAYS[d]) && await p.evaluate((d) => document.querySelector('.day.on').dataset.d === String(d), d), `${T}нажал на ${DAYS[d]} → показан он и выделен он`, h); }
    await inv(p, 'нажатия на дни');
    // двойное нажатие на тот же день
    await tap(p, '.days .day', 2); await sleep(30); await tap(p, '.days .day', 2); await sleep(900);
    ok((await h2(p)).startsWith('Среда'), T + 'двойное нажатие на день — встал на него, без лишнего перелистывания'); await inv(p, 'двойное нажатие');
    // 2. недели
    const t0 = await title(p); await tap(p, '[data-act="week"][data-dir="1"]'); await sleep(900);
    ok((await title(p)) !== t0 && (await h2(p)).startsWith('Среда, 28'), T + 'следующая неделя → та же среда, 28', [await title(p), await h2(p)]);
    await tap(p, '[data-act="week"][data-dir="1"]'); await sleep(900);
    ok((await h2(p)).startsWith('Среда, 4'), T + 'ещё неделя вперёд → среда 4 ноября', await h2(p));
    const nextDis = await p.evaluate(() => document.querySelector('[data-act="week"][data-dir="1"]').disabled);
    ok(nextDis, T + 'на последней неделе кнопка «вперёд» неактивна');
    await tap(p, '[data-act="week"][data-dir="-1"]'); await sleep(900); await tap(p, '[data-act="week"][data-dir="-1"]'); await sleep(900);
    ok((await h2(p)).startsWith('Среда, 21'), T + 'две недели назад → снова среда 21', await h2(p));
    ok(await p.evaluate(() => document.querySelector('[data-act="week"][data-dir="-1"]').disabled), T + 'назад от текущей недели — некуда (прошлых недель в данных нет)');
    await inv(p, 'листание недель');
    // 3. свайпы
    await swipe(p, 1); await sleep(900); ok((await h2(p)).startsWith('Четверг, 22'), T + 'свайп влево → четверг', await h2(p));
    await swipe(p, -1); await sleep(900); ok((await h2(p)).startsWith('Среда, 21'), T + 'свайп вправо → среда', await h2(p));
    for (let i = 0; i < 4; i++) { await swipe(p, 1); await sleep(900); }
    ok((await h2(p)).startsWith('Воскресенье, 25'), T + 'четыре свайпа → воскресенье 25', await h2(p));
    await swipe(p, 1); await sleep(900);
    ok((await h2(p)).startsWith('Понедельник, 26') && (await title(p)).includes('26'), T + 'через границу недели → понедельник 26, шапка недели тоже сменилась', [await h2(p), await title(p)]);
    await swipe(p, -1); await sleep(900); ok((await h2(p)).startsWith('Воскресенье, 25'), T + 'и обратно через границу', await h2(p));
    await inv(p, 'свайпы');
    for (let i = 0; i < 3; i++) { await swipe(p, -1, true); await sleep(70); } await sleep(1000);
    ok((await h2(p)).startsWith('Четверг, 22'), T + 'три быстрых свайпа подряд → ровно на три дня', await h2(p)); await inv(p, 'быстрые свайпы');
    await tap(p, '.days .day', 0); await sleep(900); await swipe(p, -1); await sleep(900);
    ok((await h2(p)).startsWith('Понедельник, 19'), T + 'с первого дня данных назад не уходит (пружинит)', await h2(p)); await inv(p, 'упор в начало');
    // «Сегодня» — нажатие на вкладку
    await tap(p, '.days .day', 5); await sleep(800); await tap(p, '.tab[data-tab="schedule"]'); await sleep(900);
    ok((await h2(p)).startsWith('Среда, 21'), T + 'вкладка «Расписание» с другого дня → сегодня', await h2(p)); await inv(p, 'возврат к сегодня');
    await c.close(); }
  // 4. карточки
  for (const now of ['2026-10-19T12:10', '2026-10-19T12:14', '2026-10-19T12:45', '2026-10-19T13:35', '2026-10-19T09:55', '2026-10-19T08:31']) {
    const { c, p } = await open(now, { tg });
    const n = await p.evaluate(() => document.querySelectorAll('[data-cur] .tl [data-act="open"]').length);
    for (let i = 0; i < n; i++) {
      const before = await p.evaluate((i) => { const el = document.querySelectorAll('[data-cur] .tl [data-act="open"]')[i]; return el.closest('.row').querySelector('.card') ? 'full' : 'compact'; }, i);
      await tap(p, '[data-cur] .tl [data-act="open"]', i); await sleep(700);
      const after = await p.evaluate((i) => { const el = document.querySelectorAll('[data-cur] .tl [data-act="open"]')[i]; return el && el.closest('.row').querySelector('.card') ? 'full' : 'compact'; }, i);
      ok(before !== after, `${T}${now.slice(11)} карточка ${i + 1}: ${before === 'full' ? 'свернулась' : 'раскрылась'}`, { before, after });
      await inv(p, `${now.slice(11)} карточка ${i + 1}`);
      await tap(p, '[data-cur] .tl [data-act="open"]', i); await sleep(700); await inv(p, `${now.slice(11)} карточка ${i + 1} ещё раз`);
    }
    // раскрыл → ушёл на другой день → вернулся
    await tap(p, '[data-cur] .tl [data-act="open"]', n - 1); await sleep(600); await swipe(p, 1); await sleep(900); await swipe(p, -1); await sleep(900);
    await inv(p, `${now.slice(11)} раскрыл, ушёл и вернулся`);
    // быстрые двойные нажатия на карточку идущей пары
    if (await p.$('[data-cur] .row.live')) { for (let k = 0; k < 3; k++) { await tap(p, '[data-cur] .row.live [data-act="open"]'); await sleep(90); } await sleep(900); await inv(p, `${now.slice(11)} три быстрых нажатия на идущую пару`); }
    await c.close(); }
  // 5. преподаватель, уведомления, назад
  { const { c, p } = await open('2026-10-20T10:00', { tg });
    await tap(p, '.tab[data-tab="teachers"]'); await sleep(500); await tap(p, '#app .item', 2); await sleep(900);
    const t1 = await h2(p); ok(!!t1, T + 'расписание преподавателя открылось', t1);
    await swipe(p, 1); await sleep(900); await swipe(p, 1); await sleep(900); await inv(p, 'свайпы у преподавателя');
    if (tg) await p.evaluate(() => window.__tgBack()); else await tap(p, '.top [data-act="back"]');
    await sleep(700); ok(await p.evaluate(() => (document.querySelector('.top h1') || {}).textContent === 'Преподаватели'), T + '«Назад» → список преподавателей');
    await tap(p, '.tab[data-tab="schedule"]'); await sleep(800); await tap(p, '[data-act="notif"]'); await sleep(600);
    ok(await p.evaluate(() => /Уведомления/.test((document.querySelector('.top h1') || {}).textContent)), T + 'уведомления открылись');
    if (tg) await p.evaluate(() => window.__tgBack()); else await tap(p, '.top [data-act="back"]');
    await sleep(800); ok(!!(await p.$('.week')), T + 'из уведомлений назад → расписание'); await inv(p, 'возврат из уведомлений');
    await c.close(); }
}
ok(!errs.length, 'нет ошибок JS', errs);
console.log(`\nИТОГО ${res.filter(Boolean).length}/${res.length}`); await b.close();
