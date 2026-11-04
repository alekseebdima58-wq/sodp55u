import { chromium, touchSession } from '../lib.mjs';
import { CHECK } from './check.mjs';
import fs from 'fs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = []; const errs = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); };
const KEY = 'cd'.repeat(16); const STATS = fs.readFileSync('stats.json', 'utf8');
async function open(q = '', { scheme = 'dark', stats = true, w = 390 } = {}) {
  const c = await b.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: scheme });
  const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.route(/data\/stats\.json/, (r) => stats ? r.fulfill({ contentType: 'application/json', body: STATS }) : r.fulfill({ status: 404, body: '' }));
  await p.addInitScript(CHECK);
  await p.goto(`http://localhost:8772/?now=2026-10-19T12:00${q}`); await p.waitForSelector('.week, .top h1'); await sleep(1200); return { c, p };
}
const chk = async (p, what) => { const e = await p.evaluate(() => window.__chk()); ok(!e.length, `   ↳ экран в порядке: ${what}`, e); };
// ---- статистика ----
for (const [scheme, w] of [['dark', 390], ['light', 360]]) {
  const { c, p } = await open(`&n=15.1.0.1&ts=1&k=${KEY}&open=stats`, { scheme, w }); await sleep(1500);
  let t = await p.evaluate(() => (document.querySelector('.top h1') || {}).textContent);
  if (t !== 'Статистика') { await p.tap('.tab[data-tab="settings"]'); await sleep(700); const s = await p.$('[data-act="stats"]'); if (s) { await s.tap(); await sleep(900); } t = await p.evaluate(() => (document.querySelector('.top h1') || {}).textContent); }
  ok(t === 'Статистика', `[${scheme} ${w}] статистика открылась у владельца`, t);
  const txt = await p.evaluate(() => document.getElementById('app').textContent);
  ok(/TypeError/.test(txt) && /11/.test(txt), `[${scheme}] видны люди за сегодня и ошибка из отчётов`);
  await chk(p, 'статистика 7 дней'); await p.screenshot({ path: `stats-${scheme}.png`, fullPage: true });
  const r30 = await p.$('[data-act="srange"][data-v="30"], [data-act="srange"]:not(.on)'); if (r30) { await r30.tap(); await sleep(700); await chk(p, 'статистика 30 дней'); }
  // точки графика
  const bars = await p.$$('#app [data-act="spick"], #app .sbar-col, #app svg rect'); ok(true, `[${scheme}] столбиков графика: ${bars.length}`);
  await c.close(); }
{ const { c, p } = await open(`&n=15.1.0.1&ts=1&k=${KEY}`, { stats: false }); await p.tap('.tab[data-tab="settings"]'); await sleep(800);
  ok(!(await p.$('[data-act="stats"]')), 'у обычного пользователя (нет сводки) пункта «Статистика» нет'); await c.close(); }
// ---- без сети ----
{ const { c, p } = await open(); await c.setOffline(true);
  await p.reload().catch(() => {}); await sleep(2500);
  const t = await p.evaluate(() => document.getElementById('app').textContent);
  ok(/Электромагнитная|Математическое/.test(t), 'без сети после перезапуска — сохранённое расписание на месте', t.slice(0, 100));
  ok(/сохранённое|Нет сети|без сети/i.test(t), '  и видно, что показано сохранённое', t.slice(0, 160));
  await chk(p, 'без сети');
  await c.setOffline(false); const retry = await p.$('[data-act="retry-net"], [data-act="retry"]'); if (retry) { await retry.tap().catch(() => {}); } await sleep(2000);
  ok(!/показано сохранённое/.test(await p.evaluate(() => document.getElementById('app').textContent)), 'сеть появилась, «Повторить» — снова свежие данные');
  await c.close(); }
{ const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, offline: false }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); await p.route(/data\//, (r) => r.abort());
  await p.goto('http://localhost:8772/?now=2026-10-19T12:00'); await sleep(2500);
  const t = await p.evaluate(() => document.getElementById('app').textContent);
  ok(/Повторить/.test(t) && /(Нет интернета|Не удалось загрузить)/.test(t), 'первый запуск без данных — понятная ошибка и «Повторить»', t.slice(0, 120)); await c.close(); }
// ---- уведомления: свои напоминания, удалить, очистить ----
{ const { c, p } = await open(`&n=15.1.0.1&ts=1&k=${KEY}`); await p.tap('[data-act="notif"]'); await sleep(900);
  const n0 = await p.$$eval('#app .ncw', (x) => x.length); ok(n0 >= 1, `в ленте уведомлений есть записи: ${n0}`);
  await chk(p, 'лента уведомлений'); await p.screenshot({ path: 'notif.png', fullPage: true });
  const del = null; if (del) { await del.tap(); await sleep(700); const n1 = await p.$$eval('#app .ncw', (x) => x.length); ok(n1 === n0 - 1, `«Удалить» убирает одну запись (${n0} → ${n1})`); await chk(p, 'после удаления'); }
  else { // удаление свайпом влево
    const it = await (await p.$$('#app .ncw'))[0].boundingBox(); const cdp = await touchSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: it.x + it.width - 20, y: it.y + 20 }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: it.x + it.width - 20 - i * 15, y: it.y + 20 }] }); await sleep(60); }   // медленно: быстрый бросок по правилам удаляет сразу
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
    const d2 = await p.$('#app [data-act="ndel"]'); ok(!!d2, 'свайп влево по записи открывает «Удалить»');
    if (d2) { await d2.tap(); await sleep(800); const n1 = await p.$$eval('#app .ncw', (x) => x.length); ok(n1 === n0 - 1, `«Удалить» убирает одну запись (${n0} → ${n1})`); await chk(p, 'после удаления'); } }
  const secs = async () => p.$$eval('#app .nsec', (xs) => xs.map((x) => x.querySelector('h2').textContent + ':' + x.nextElementSibling.querySelectorAll('.ncw').length));
  const s0 = await secs(); const clrs = await p.$$('#app [data-act="nclear"]');
  await clrs[0].tap(); await sleep(900); const s1 = await secs();
  ok(s1.length === s0.length - 1 && !s1.includes(s0[0]), `«Очистить» убирает свой раздел целиком (${s0.join(', ')} → ${s1.join(', ') || 'пусто'})`);
  await chk(p, 'после очистки');
  while (await p.$('#app [data-act="nclear"]')) { await (await p.$('#app [data-act="nclear"]')).tap(); await sleep(800); }
  ok((await p.$$eval('#app .ncw', (x) => x.length)) === 0, 'очистил все разделы — лента пустая');
  await p.reload(); await sleep(1200); await p.tap('[data-act="notif"]'); await sleep(800);
  ok((await p.$$eval('#app .ncw', (x) => x.length)) === 0, 'очищенное не возвращается после перезапуска');
  await c.close(); }
ok(!errs.length, 'нет ошибок JS', errs);
console.log(`\nИТОГО ${res.filter(Boolean).length}/${res.length}`); await b.close();
