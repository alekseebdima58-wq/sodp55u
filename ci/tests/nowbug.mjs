import { chromium, touchSession } from '../lib.mjs';
const PORT = process.argv[2] || 8772; const out = process.argv[3] || 'link/out';
const b = await chromium.launch(); const res = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
for (const [w, mode] of [[390, 'browser'], [430, 'browser'], [360, 'browser'], [390, 'reload'], [390, 'tapcard'], [390, 'tap2'], [390, 'today']]) for (const t of ['12:10', '12:11', '12:14', '12:20', '12:30']) {
  const c = await b.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' }); const p = await c.newPage();
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.goto(`http://localhost:${PORT}/?now=2026-10-19T${t}`); await p.waitForSelector('.week'); await p.waitForTimeout(1500);
  if (mode === 'reload') { await p.evaluate(() => document.querySelector('[data-act="notif"]').click()); await p.waitForTimeout(500); await p.click('.tab[data-tab="schedule"]'); await p.waitForTimeout(1500); }
  if (mode === 'tapcard' || mode === 'tap2') { await p.click('[data-cur] .row.live [data-act="open"]'); await p.waitForTimeout(900); if (mode === 'tap2') { await p.click('[data-cur] .row.live [data-act="open"]'); await p.waitForTimeout(900); } }
  if (mode === 'today') { await p.click('.day >> nth=3'); await p.waitForTimeout(900); await p.click('.day >> nth=0'); await p.waitForTimeout(1200); }
  const m = await p.evaluate(() => { const row = document.querySelector('[data-cur] .row.live'); if (!row) return null;
    const en = row.querySelector('.time .en').getBoundingClientRect(), st = row.querySelector('.time .st').getBoundingClientRect(), l = row.querySelector('[data-nowlbl]');
    const lb = l.getBoundingClientRect(); const enVis = getComputedStyle(row.querySelector('.time .en')).opacity;
    return { lbl: l.hidden ? null : [Math.round(lb.top), Math.round(lb.bottom), Math.round(lb.left), Math.round(lb.right)], en: [Math.round(en.top), Math.round(en.bottom), Math.round(en.left), Math.round(en.right)], st: [Math.round(st.top), Math.round(st.bottom)], enVis, off: row.classList.contains('en-off') }; });
  if (!m) { ok(false, `${w} ${mode} ${t}: нет идущей пары`); await c.close(); continue; }
  const overlapEn = m.lbl && m.lbl[0] < m.en[1] && m.lbl[1] > m.en[0] && +m.enVis > 0.05;
  const overlapSt = m.lbl && m.lbl[0] < m.st[1] - 1;
  ok(!overlapEn && !overlapSt, `${w}px ${mode} ${t}: подпись не наезжает ни на начало, ни на конец`, m);
  if (t === '12:14' && w === 390) await p.screenshot({ path: `${out}/now-${mode}.png`, clip: { x: 0, y: (await p.evaluate(() => document.querySelector('[data-cur] .row.live').getBoundingClientRect().top)) - 10, width: 390, height: 140 } });
  await c.close(); }
console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
