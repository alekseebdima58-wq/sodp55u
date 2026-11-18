import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchBrowser, makeApi, scheduleSync, syncAll } from './server.mjs';
import { portalOrigin } from './portal.mjs';
import { openStore } from './state.mjs';

const book = name => `TEST-${name}`;
const identity = name => createHash('sha256').update(book(name)).digest('hex');
const auth = value => ({ cookies: [{ name: 'student-test', value, domain: 'newlk.samgups.ru', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] });
const row = values => `<tr>${values.map(value => `<td>${value}</td>`).join('')}</tr>`;
const table = (columns, values) => `<table><thead><tr>${columns.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${values.map(row).join('')}</tbody></table>`;
const term = (num, name, result) => `<section><div>${num} семестр</div><div>${table(['Дисциплина', 'Форма контроля', 'Результат'], [[`Дисциплина ${name} ${num}`, 'Экзамен', result]])}</div></section>`;
const indexFile = fileURLToPath(new URL('../', import.meta.url));

function mockPortal(path, name, results) {
  switch (path) {
    case '/student/book/list': return `<h1>· Зачетная книжка № ${book(name)} ·</h1>
      <nav><a onclick="course(1)">1 курс</a> <a onclick="course(2)">2 курс</a></nav>
      <div id="book">${term(2, name, results[name])}${term(1, name, results[name])}</div>
      <script>function course(n) { document.getElementById('book').innerHTML = n === 1 ? ${JSON.stringify(term(2, name, results[name]) + term(1, name, results[name]))} : ${JSON.stringify(term(3, name, results[name]))}; }</script>`;
    case '/student/orders': return name === 'Б' ? '<p>Нет данных для отображения</p>' : table(['Дата', 'Номер приказа', 'Название', 'Содержание'], [['01.11.2026', `ТЕСТ-${name}`, 'Приказ', 'Содержание']]);
    case '/student/curriculum': return `<div>Название дисциплины</div><div class="xl:block"><div class="flex items-center">
      <div>Б1.О.1</div><div>План ${name}</div><div></div><div>72</div><div>1</div><div>Зачёт</div></div></div>`;
    case '/student/trajectory': return `<div class="scroll-tandem-trajectory" id="terms"></div><div id="panel"></div>
      <script>
        const terms=['2026/2027 (зимний)','2026/2027 (летний)'];
        const student=${JSON.stringify(name)};
        function choose(i) {
          document.getElementById('terms').innerHTML=terms.map((term,n)=>n===i?'<div>'+term+'</div>':'<div><a href="#" onclick="choose('+n+');return false;">'+term+'</a></div>').join('');
          document.getElementById('panel').innerHTML='<div><div><div>Предмет '+student+' '+i+'</div><div>Зачёт · 72 ч.</div></div></div><div><span>'+terms[i]+'</span><span>Пройден</span></div>';
        }
        choose(0);
      </script>`;
    case '/user/profile': return `<a href="/user/profile" aria-label="Студент ${name}">Профиль</a><div><div>Курс</div><div>2</div></div><div><div>Направление подготовки</div><div>Тестовая программа ${name}</div></div>`;
    case '/dashboard': return `<a href="#" onclick="document.getElementById('group').hidden=false;return false;">Моя группа</a>
      <div id="group" hidden>${table(['', 'ФИО', 'День рождения'], [['1', `Участник ${name}`, '01.01']])}</div>`;
    default: return '<h1>Вход в систему</h1>';
  }
}

async function address(server) {
  await new Promise((done, fail) => server.listen(0, '127.0.0.1', done).once('error', fail));
  return `http://127.0.0.1:${server.address().port}`;
}

async function waitFor(check, milliseconds = 12000) {
  const deadline = Date.now() + milliseconds;
  do {
    const result = await check();
    if (result) return result;
    await delay(40);
  } while (Date.now() < deadline);
  assert.fail('Не дождались результата фоновой синхронизации');
}

function staticApp(directory) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(directory, path === '/' ? 'index.html' : `.${path}`);
    if (!file.startsWith(directory + sep)) { response.writeHead(404).end(); return; }
    try {
      const contents = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(contents);
    } catch (error) { response.writeHead(404).end(); }
  });
}

test('синхронизация по таймеру, два отдельных кабинета и вход в PWA', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sodp55u-cabinet-'));
  let browser, app, api, activeCycle, stop;
  t.after(async () => {
    stop?.();
    await activeCycle?.catch(() => {});
    await browser?.close();
    await Promise.all([app, api].filter(Boolean).map(server => new Promise(done => server.close(done))));
    await rm(dir, { recursive: true, force: true });
  });
  browser = await launchBrowser();
  const store = await openStore(dir);
  const alice = await store.create(identity('А'), auth('alice'));
  const bob = await store.create(identity('Б'), auth('bob'));
  app = staticApp(resolve(indexFile));
  const appUrl = await address(app);
  api = makeApi(store, new Set([appUrl]));
  const apiUrl = await address(api);
  const apiPath = `${apiUrl}/cabinet/v1/snapshot`;
  const marks = { А: 'Отлично', Б: 'Хорошо' };
  const identities = { alice: 'А', bob: 'Б' };
  const read = key => fetch(apiPath, { headers: { Authorization: `Bearer ${key}`, Origin: appUrl } });

  const prepare = context => context.route(`${portalOrigin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const cookie = (await context.cookies(portalOrigin)).find(item => item.name === 'student-test');
    const student = identities[cookie?.value];
    if (!student && path !== '/login') { await route.fulfill({ status: 302, headers: { Location: `${portalOrigin}/login` } }); return; }
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ru"><body>${mockPortal(path, student, marks)}</body></html>` });
  });
  let cycles = 0;
  stop = scheduleSync(async () => {
    activeCycle = syncAll(store, browser, prepare);
    await activeCycle;
    cycles++;
  }, 150);

  const ready = async key => {
    const value = await (await read(key)).json();
    return value.status === 'ready' ? value : false;
  };
  const a = await waitFor(() => ready(alice.key));
  const b = await waitFor(() => ready(bob.key));
  assert.deepEqual(Object.keys(a.sections), ['grades', 'orders', 'plan', 'trajectory', 'profile', 'group']);
  assert.deepEqual(a.sections.grades.map(entry => entry.title), ['2 семестр', '1 семестр', '3 семестр']);
  assert.equal(a.sections.grades[0].rows[0][2], 'Отлично');
  assert.equal(b.sections.grades[0].rows[0][2], 'Хорошо');
  assert.deepEqual(b.sections.orders, []);
  assert.equal(a.sections.trajectory.length, 2);
  assert.equal(a.sections.trajectory[1].rows[0][0], 'Предмет А 1');
  assert.deepEqual(a.sections.group[0], { columns: ['ФИО'], title: '', rows: [['Участник А']] });
  assert.equal((await read(alice.key.replace(alice.id, bob.id))).status, 401);
  assert.equal((await fetch(apiPath, { headers: { Origin: 'https://other.invalid' } })).status, 403);
  assert.equal((await read(alice.key)).headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(`${apiPath}?student=${bob.id}`, { headers: { Authorization: `Bearer ${alice.key}` } })).status, 404);
  assert(!JSON.stringify(a).includes('Участник Б'));
  assert(!JSON.stringify(b).includes('Участник А'));

  async function openPwa(key) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => [appUrl, apiUrl].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(`${appUrl}/?now=2026-11-19T09:00`);
    await page.getByRole('button', { name: 'Личный кабинет', exact: true }).click();
    await page.getByLabel('Адрес сервера').fill(apiUrl);
    await page.getByLabel('Ключ подключения').fill(key);
    await page.getByRole('button', { name: 'Подключить', exact: true }).click();
    return page;
  }

  const first = await openPwa(alice.key);
  const second = await openPwa(bob.key);
  await first.getByText('Дисциплина А 2', { exact: true }).waitFor();
  await second.getByText('Дисциплина Б 2', { exact: true }).waitFor();
  assert.equal(await first.getByText('Дисциплина Б 2', { exact: true }).count(), 0);
  for (const [section, expected] of [
    ['Приказы', 'ТЕСТ-А'], ['Учебный план', 'План А'], ['Траектория', 'Предмет А 1'],
    ['Профиль', 'Тестовая программа А'], ['Моя группа', 'Участник А'],
  ]) {
    await first.getByRole('button', { name: section, exact: true }).click();
    await first.getByText(expected, { exact: true }).waitFor();
  }
  assert.equal(await first.getByText('01.01', { exact: true }).count(), 0);
  assert(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await first.getByRole('button', { name: 'Расписание', exact: true }).click();
  await first.getByRole('button', { name: 'Личный кабинет', exact: true }).click();
  await first.getByText('Участник А', { exact: true }).waitFor();

  const baseline = cycles;
  marks.А = 'Удовлетворительно';
  await waitFor(async () => {
    const value = await ready(alice.key);
    return cycles > baseline && value?.sections?.grades?.[0].rows[0][2] === 'Удовлетворительно';
  });
  await first.getByRole('button', { name: 'Зачётка', exact: true }).click();
  await first.getByRole('button', { name: 'Проверить обновление' }).click();
  await first.getByText('Удовлетворительно', { exact: true }).first().waitFor();
  assert.equal((await ready(bob.key)).sections.grades[0].rows[0][2], 'Хорошо');

  delete identities.alice;
  const expired = await waitFor(async () => {
    const value = await (await read(alice.key)).json();
    return value.status === 'expired' ? value : false;
  });
  assert.equal(expired.sections.grades[0].rows[0][2], 'Удовлетворительно');
  await first.getByRole('button', { name: 'Проверить обновление' }).click();
  await first.getByRole('status').getByText(/Войди в кабинет вуза повторно/).waitFor();
  await assert.rejects(store.reconnect(alice.id, identity('Б'), auth('bob')), /другая учётная запись/);
  await store.disable(alice.id);
  assert.equal((await read(alice.key)).status, 401);
  assert.equal((await read(bob.key)).status, 200);
});
