// «Стекло»: пока карточка пары раскрывается или сворачивается маской, её цветное свечение не должно пропадать.
// Раньше на iPhone маска срезала тень на полпути (уборка шла по окончании «старого» текста, а не маски).
// Проверяем по кадрам: в каждом кадре, где карточку открывает «окно», свечение рисует отдельный слой, а не сама карточка.
import { chromium } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, n = 0; const T = (name, c, info = '') => { n++; if (c) ok++; console.log(`${c ? 'OK  ' : 'FAIL'} ${name} ${info}`); };
for (const w of [390, 430]) {   // на 430 точках перенос названия у свёрнутой и раскрытой карточки одинаковый — тот самый случай
  const c = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: 'dark', hasTouch: true, isMobile: true }); const p = await c.newPage();
  await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
  await p.addInitScript(() => { try { localStorage.setItem('onb', '1'); localStorage.setItem('installBar', '0'); } catch (e) {} });
  await p.goto('http://localhost:8772/?now=2026-10-26T08:00'); await p.waitForSelector('.week'); await sleep(900);
  for (const phase of ['раскрытие', 'сворачивание']) {
    await p.evaluate(() => { window.__log = []; const t0 = performance.now(); const f = () => {
      const row = [...document.querySelectorAll('.page.cur .row')].pop(); const body = row && row.querySelector('.card, .cc');
      const win = row && row.querySelector(':scope > [data-fx="win"]'); const mask = !!win && win.getAnimations().some((a) => a.playState === 'running');
      const layer = row && !!row.querySelector(':scope > [data-fx="glow"]') && !!row.querySelector(':scope > [data-fx="edge"]');
      const sh = body ? getComputedStyle(body).boxShadow : '';
      const outer = sh.split(/,(?![^(]*\))/).some((x) => x.trim() && x.trim() !== 'none' && !/inset/.test(x));
      window.__log.push({ mask, layer, outer }); if (performance.now() - t0 < 700) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const cs = await p.$$('.page.cur .row .cc, .page.cur .row .card'); await cs[cs.length - 1].tap(); await sleep(950);
    const log = await p.evaluate(() => window.__log);
    const masked = log.filter((x) => x.mask), cut = masked.filter((x) => !x.layer);
    T(`${w} точек, ${phase}: свечение держится всё движение`, masked.length > 5 && cut.length === 0, `кадров с маской ${masked.length}, без слоя свечения ${cut.length}`);
    const end = log[log.length - 1];
    T(`${w} точек, ${phase}: в конце свечение снова у самой карточки`, end && !end.mask && !end.layer && end.outer);
  }
  await c.close();
}
await b.close(); console.log(`ИТОГО ${ok}/${n}`);
