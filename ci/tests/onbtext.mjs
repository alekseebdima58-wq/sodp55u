// Знакомство при первом запуске и размер текста
import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, n = 0; const T = (name, c, info = '') => { n++; if (c) ok++; console.log(`${c ? 'OK  ' : 'FAIL'} ${name} ${info}`); };
const errs = [];
const ctx = async () => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await c.newPage();
  p.on('pageerror', (e) => errs.push(e.message)); await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort()); return { c, p }; };
const URL = 'http://localhost:8772/';
// --- знакомство ---
{ const { c, p } = await ctx();
  await p.goto(URL); await p.waitForSelector('.week'); await sleep(1500);
  T('первый запуск — знакомство открылось', !!(await p.$('.onb.in')));
  T('…три страницы, кнопка «Далее»', (await p.$$('.onb-p')).length === 3 && (await p.textContent('.onb-next')) === 'Далее');
  await p.tap('.onb-next'); await sleep(800);
  T('«Далее» — вторая страница и вторая точка', await p.evaluate(() => document.querySelectorAll('.onb-dots i')[1].classList.contains('on')));
  await p.evaluate(() => { const s = document.querySelector('.onb-pages'); s.scrollLeft = s.clientWidth * 2; }); await sleep(600);
  T('листнули пальцем к последней — кнопка «Начать»', (await p.textContent('.onb-next')) === 'Начать');
  await p.tap('.onb-next'); await sleep(600);
  T('«Начать» закрывает знакомство', !(await p.$('.onb')));
  await p.reload(); await p.waitForSelector('.week'); await sleep(1500);
  T('второй запуск — знакомства нет', !(await p.$('.onb')));
  await p.tap('[data-tab="settings"]'); await sleep(800); await p.tap('[data-act="onb"]'); await sleep(700);
  T('Настройки → «Как пользоваться» открывает снова', !!(await p.$('.onb.in')));
  await p.tap('.onb-skip'); await sleep(600); T('«Пропустить» закрывает', !(await p.$('.onb')));
  await c.close(); }
{ const { c, p } = await ctx();
  await p.goto(URL + '?now=2026-10-20T10:00'); await p.waitForSelector('.week'); await sleep(1500);
  T('служебный ?now= (тесты) — без знакомства', !(await p.$('.onb'))); await c.close(); }
{ const { c, p } = await ctx();
  await p.goto(URL); await p.waitForSelector('.week'); await sleep(1500);
  await p.tap('.onb-next'); await sleep(700); await p.tap('.onb-p.cur [data-onb="notif"]'); await sleep(1200);
  T('«Настроить уведомления» ведёт в Настройки к уведомлениям', await p.evaluate(() => !document.querySelector('.onb') && !!document.getElementById('nsec')));
  await c.close(); }
// --- размер текста ---
{ const { c, p } = await ctx();
  await p.goto(URL + '?now=2026-10-20T10:20'); await p.waitForSelector('.week'); await sleep(900);
  const fz = () => p.evaluate(() => ({ fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(), h1: parseFloat(getComputedStyle(document.querySelector('#app .top h1')).fontSize), tab: parseFloat(getComputedStyle(document.querySelector('.tab')).fontSize) }));
  await p.tap('[data-tab="settings"]'); await sleep(800);
  const f0 = await fz();
  T('в Настройках есть ползунок «Размер текста»', !!(await p.$('.tsz input[type=range]')));
  await p.evaluate(() => { const r = document.querySelector('.tsz input[type=range]'); r.value = 6; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300); const f1 = await fz();
  T('максимум — текст крупнее на 35 %', Math.abs(f1.h1 / f0.h1 - 1.35) < 0.02, `${f0.h1} → ${f1.h1}`);
  T('…а подписи вкладок не растут', f1.tab === f0.tab, `${f0.tab} → ${f1.tab}`);
  await p.reload(); await p.waitForSelector('.week'); await sleep(900);
  await p.tap('[data-tab="settings"]'); await sleep(800);
  T('размер запомнился после перезапуска', (await fz()).fs.startsWith('1.35'), (await fz()).fs);
  await p.evaluate(() => { const r = document.querySelector('.tsz input[type=range]'); r.value = 2; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300); T('вернули обычный — как было', Math.abs((await fz()).h1 - f0.h1) < 0.5);
  await c.close(); }
T('нет ошибок JS', !errs.length, errs.join(' | '));
console.log(`\n${ok}/${n}`); await b.close();
