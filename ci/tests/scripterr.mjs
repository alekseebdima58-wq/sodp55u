import { chromium, touchSession } from '../lib.mjs';
const b = await chromium.launch(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const res = [];
const ok = (c, t, x) => { res.push(!!c); console.log((c ? 'OK  ' : 'FAIL'), t, !c && x !== undefined ? JSON.stringify(x) : ''); };
const c = await b.newContext(); const p = await c.newPage();
await p.route(/fonts\.g|telegram\.org|telegram-web-app\.js|ntfy/, (r) => r.abort());
// чужой скрипт с другого адреса, который падает (как расширение / блокировщик)
await p.route('http://127.0.0.1:8772/evil.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'setTimeout(function(){ null.x }, 10)' }));
await p.goto('http://localhost:8772/?now=2026-10-19T12:00'); await p.waitForSelector('.week'); await sleep(500);
const diag = () => p.evaluate(() => JSON.parse(localStorage.getItem('diag') || '{}'));
await p.evaluate(() => { const s = document.createElement('script'); s.src = 'http://127.0.0.1:8772/evil.js'; document.head.appendChild(s); });
await sleep(400);
let d = await diag(); ok(!Object.keys(d).some((k) => /Script error|evil/.test(k)), 'ошибка чужого скрипта (другой адрес) в отчёт не попала', d);
await p.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' })));
d = await diag(); ok(!Object.keys(d).some((k) => /Script error/.test(k)), '«Script error.» без файла — пропущена', d);
await p.evaluate(() => setTimeout(() => { undefined.boom; }, 0)); await sleep(200);
d = await diag(); ok(Object.keys(d).some((k) => /^err\|.*TypeError.*boom/.test(k)), 'настоящая ошибка нашей страницы — в отчёте, с местом', Object.keys(d));
const ver = await p.evaluate(() => { document.querySelector('.tab[data-tab="settings"]').click(); return new Promise((r) => setTimeout(() => r((document.querySelector('.ver') || {}).textContent), 600)); });
ok(/v\d+\.\d+\.\d+/.test(ver || ''), 'внизу настроек — номер версии', ver);
console.log(`\n${res.filter(Boolean).length}/${res.length}`); await b.close();
