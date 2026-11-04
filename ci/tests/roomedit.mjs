// Владелец меняет кабинет пары кнопкой в приложении: окно, подписанное сообщение боту.
// Подпись проверяем тем же способом, что и бот (HMAC личного ключа), — ключ тестовый, как и сводка stats.json.
import { chromium } from '../lib.mjs';
import fs from 'node:fs'; import crypto from 'node:crypto';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, n = 0; const T = (name, c, info = '') => { n++; if (c) ok++; console.log(`${c ? 'OK  ' : 'FAIL'} ${name} ${info}`); };
const KEY = 'cd'.repeat(16); const STATS = fs.readFileSync('stats.json', 'utf8');
async function page(admin) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const sent = [];
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js/, (r) => r.abort());
  // ответ канала — с разрешением CORS, как у настоящего ntfy (иначе WebKit отвергает ответ)
  await p.route(/ntfy\.invalid/, async (r) => { await r.fulfill({ status: 200, body: '{}', headers: { 'access-control-allow-origin': '*' } }); });
  // что именно отправило приложение — записываем на стороне страницы (в WebKit тело запроса через перехват не всегда видно)
  await p.addInitScript(() => { window.__sent = []; const f = window.fetch.bind(window);
    // канал бота подменяем прямо в странице: настоящий ntfy отвечает «принято», а перехват запросов к чужому
    // сайту в WebKit (CORS, запросы no-cors) ведёт себя иначе, чем в Chromium, — проверялся бы перехват, а не приложение
    window.fetch = (u, o) => { if (String(u).includes('ntfy.invalid')) { if (o && typeof o.body === 'string') window.__sent.push(o.body);
      return Promise.resolve(new Response('{}', { status: 200 })); } return f(u, o); }; });
  await p.route(/data\/stats\.json/, (r) => admin ? r.fulfill({ contentType: 'application/json', body: STATS }) : r.fulfill({ status: 404, body: '' }));
  await p.addInitScript(() => { try { localStorage.setItem('onb', '1'); localStorage.setItem('installBar', '0'); } catch (e) {} });
  await p.goto(`http://localhost:8772/?now=2026-10-26T09:00&n=15.1.0.1&ts=1&k=${KEY}`); await p.waitForSelector('.week'); await sleep(1500);
  await p.evaluate(() => document.querySelector('.page.cur .row [data-act="open"]').click()); await sleep(800);
  return { c, p, errs, sent };
}
{ const { c, p } = await page(false);
  T('у обычного человека кнопки «Изменить кабинет» нет', !(await p.$('.page.cur [data-act="room"]'))); await c.close(); }
{ const { c, p, errs, sent } = await page(true);
  T('у владельца в раскрытой карточке есть «Изменить кабинет»', !!(await p.$('.page.cur [data-act="room"]')));
  await p.tap('.page.cur [data-act="room"]'); await sleep(500);
  const pre = await p.evaluate(() => ({ num: document.querySelector('#rsNum').value, corp: document.querySelector('#rsCorp').value, kind: !!document.querySelector('#rsKind') }));
  T('окно открылось, кабинет и корпус подставлены из расписания', /^\d+/.test(pre.num) && /орпус/.test(pre.corp) && pre.kind, JSON.stringify(pre));
  await p.fill('#rsNum', '2399'); await p.tap('[data-rs="save"]');
  let got = [];
  for (let i = 0; i < 40 && !got.some((x) => x.includes('"room"')); i++) { await sleep(100); got = await p.evaluate(() => window.__sent || []); }
  await sleep(600);
  const diag = await p.evaluate(() => ({ toast: (document.querySelector('.toast') || {}).textContent || '', sheet: !!document.querySelector('.rsheet'), btn: (document.querySelector('[data-rs="save"]') || {}).disabled }));
  const msg = got.map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).find((x) => x && x.q === 'room');
  T('ушло сообщение боту q:"room"', !!msg, JSON.stringify({ diag, errs }));
  if (msg) {
    const h = crypto.createHmac('sha256', Buffer.from(KEY, 'hex')).update(`room|${msg.t}|${msg.n}|${msg.p}`).digest('hex');
    T('подпись — личным ключом владельца', h === msg.h);
    const pl = JSON.parse(msg.p);
    T('правило: предмет, вид, новый кабинет с корпусом', pl.a === 'set' && pl.r.s && pl.r.t && /^2399 \(/.test(pl.r.room), msg.p);
  }
  T('окно закрылось', !(await p.$('.rsheet')), JSON.stringify(diag));
  T('нет ошибок JavaScript', errs.length === 0, errs.join(' | '));
  await c.close(); }
await b.close(); console.log(`ИТОГО ${ok}/${n}`);
