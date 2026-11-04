// Пустой раздел «Уведомления» виден: после удаления последнего уведомления и при открытии без уведомлений.
// (v1.9.3: правило полоски прогресса .fill { transform: scaleY(…) } задевало #app.fill — экран сплющивался в линию)
import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const res = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
await ctx.addInitScript(() => localStorage.setItem('onb', '1'));
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:8772/?now=2026-11-02T22:57'); await p.waitForSelector('.week'); await sleep(800);
await p.tap('[data-act="notif"]'); await p.waitForSelector('.ncw'); await sleep(700);
const shown = () => p.evaluate(() => { const a = document.getElementById('app'), em = document.querySelector('.nempty'), er = em && em.getBoundingClientRect();
  return { appH: Math.round(a.getBoundingClientRect().height), tr: getComputedStyle(a).transform, empty: !!em, emptyH: er ? Math.round(er.height) : 0, emptyTop: er ? Math.round(er.top) : -1 }; });
// смахиваем уведомления по одному, пока не останется ни одного (последнее — тот самый случай)
const t = await touchSession(p);
for (let n = await p.$$eval('.ncw', (x) => x.length), k = 0; n > 0 && k < 12; k++) {
  const r = await p.$eval('.ncw', (e) => { const b = e.getBoundingClientRect(); return { x: b.right - 30, y: b.top + 40 }; });
  let x = r.x, ts = Date.now() / 1000;
  const send = (type) => t.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: r.y }], timestamp: (ts += 0.016) });
  await send('touchStart'); for (let i = 0; i < 8; i++) { x -= 32; await send('touchMove'); await sleep(16); } await send('touchEnd');
  await sleep(1100); n = await p.$$eval('.ncw', (x) => x.length);
}
await sleep(1500);
let s = await shown();
ok(s.empty && s.emptyH > 20 && s.emptyTop >= 0 && s.emptyTop < 874, 'после удаления последнего — «Уведомлений пока нет» на экране', s);
ok(s.tr === 'none', 'экран не сжат и не сдвинут', s);
await p.reload(); await p.waitForSelector('.week'); await sleep(600); await p.tap('[data-act="notif"]'); await sleep(1200);
s = await shown();
ok(s.empty && s.emptyH > 20 && s.tr === 'none', 'открыли пустой раздел — он виден', s);
ok(!errs.length, 'нет ошибок JS', errs);
console.log(`\nИТОГО ${res.filter(Boolean).length}/${res.length}`); await b.close();
