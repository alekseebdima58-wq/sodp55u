import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchBrowser, makeApi, scheduleSync, syncAll } from './server.mjs';
import { portalOrigin, signInToPortal } from './portal.mjs';
import { openStore } from './state.mjs';

const book = name => `TEST-${name}`;
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

async function saveMockup(browser, appUrl, directory) {
  await mkdir(directory, { recursive: true });
  const columns = ['Дисциплина', 'Форма контроля', 'Дата', 'Результат'];
  const snapshot = {
    version: 1, status: 'ready', syncedAt: '2026-11-19T05:42:00Z',
    sections: { grades: [
      { title: '3 семестр', columns, rows: [
        ['Рельсовые цепи', 'Экзамен', '18.11.2026', 'Отлично'],
        ['Электрические машины', 'Экзамен', '16.11.2026', 'Хорошо'],
        ['Теория передачи сигналов', 'Зачёт', '14.11.2026', 'Зачтено'],
      ] },
      { title: '2 семестр', columns, rows: [
        ['Электротехника', 'Экзамен', '25.06.2026', 'Отлично'],
        ['Математика', 'Экзамен', '20.06.2026', 'Хорошо'],
      ] },
    ],
    orders: [{ columns: ['Дата', 'Номер приказа', 'Название', 'Содержание'], rows: [
      ['03.09.2026', '104-У', 'О переводе на следующий курс', 'Перевод на второй курс с 1 сентября.'],
      ['21.08.2025', '182-У', 'О зачислении', 'Зачисление на очную форму обучения.'],
    ] }],
    plan: [{ columns: ['Индекс', 'Дисциплина', 'Часы', 'Период', 'Вид контроля'], rows: [
      ['Б1.О.12', 'Рельсовые цепи', '108', '3 семестр', 'Экзамен'],
      ['Б1.О.13', 'Электрические машины', '144', '3 семестр', 'Экзамен'],
      ['Б1.В.04', 'Теория передачи сигналов', '72', '3 семестр', 'Зачёт'],
      ['Б1.О.15', 'Метрология и стандартизация', '72', '4 семестр', 'Зачёт'],
    ] }],
    trajectory: [
      { title: '2026/2027 (зимний)', columns: ['Дисциплина', 'Контроль, нагрузка и статус'], rows: [
        ['Рельсовые цепи', 'Экзамен · 108 ч. · 3 з. е.'],
        ['Теория передачи сигналов', 'Зачёт · 72 ч. · 2 з. е.'],
        ['Статус семестра', 'Обучение продолжается'],
      ] },
      { title: '2025/2026 (летний)', columns: ['Дисциплина', 'Контроль, нагрузка и статус'], rows: [
        ['Электротехника', 'Экзамен · 108 ч. · 3 з. е.'],
        ['Статус семестра', 'Курс полностью пройден'],
      ] },
    ],
    profile: [{ columns: ['Поле', 'Значение'], rows: [
      ['Имя', 'Иван Соколов'], ['Группа', 'СОДП-00у'], ['Курс', '2'],
      ['Направление подготовки', 'Системы обеспечения движения поездов'], ['Форма обучения', 'Очная'],
    ] }],
    group: [{ columns: ['ФИО'], rows: [
      ['Алексеева Анна Игоревна'], ['Белов Максим Олегович'], ['Данилова Софья Павловна'],
      ['Ковалёв Артём Денисович'], ['Соколов Иван Сергеевич'], ['Федорова Полина Андреевна'],
    ] }],
    },
  };
  for (const colorScheme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
    try {
      let expired = false;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== appUrl) return route.abort();
        if (url.pathname === '/cabinet-config.json') return route.fulfill({ json: { server: appUrl } });
        if (url.pathname === '/cabinet/v1/login') {
          const key = `sc_00000000-0000-0000-0000-000000000000.${'a'.repeat(43)}`;
          return route.fulfill({ json: { key, snapshot } });
        }
        if (url.pathname === '/cabinet/v1/snapshot') {
          return route.fulfill({ json: expired ? { ...snapshot, status: 'expired' } : snapshot });
        }
        return route.continue();
      });
      const page = await context.newPage();
      const capture = filename => page.screenshot({ path: join(directory, `${filename}.png`), animations: 'disabled' });
      await page.goto(`${appUrl}/?now=2026-11-19T09:42`);
      await page.getByRole('button', { name: 'Личный кабинет', exact: true }).click();
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.getByRole('heading', { name: 'Войти в кабинет', exact: true }).waitFor();
      if (colorScheme === 'dark') await capture('cabinet-connect');
      await enterCredentials(page, 'demo', 'fictional-password');
      await page.getByText('Рельсовые цепи', { exact: true }).waitFor();
      await page.locator('.cabinet-overview').getByText('Иван Соколов', { exact: true }).waitFor();
      await page.locator('.cabinet-overview').getByText('СОДП-00у · 2 курс', { exact: true }).waitFor();
      const footer = await page.locator('.cabinet-footer').boundingBox();
      const navigation = await page.getByRole('navigation', { name: 'Разделы', exact: true }).boundingBox();
      assert(footer.y + footer.height <= navigation.y, 'Нижняя панель перекрывает действия кабинета');
      await capture(`cabinet-${colorScheme}`);
      if (colorScheme === 'dark') {
        for (const [tab, filename, sample] of [
          ['Приказы', 'cabinet-orders', 'О переводе на следующий курс'],
          ['Учебный план', 'cabinet-plan', 'Метрология и стандартизация'],
          ['Траектория', 'cabinet-trajectory', 'Обучение продолжается'],
          ['Профиль', 'cabinet-profile', 'Иван Соколов'],
          ['Моя группа', 'cabinet-group', 'Данилова Софья Павловна'],
        ]) {
          await page.getByRole('button', { name: tab, exact: true }).click();
          await page.locator('.cabinet-content').getByText(sample, { exact: true }).waitFor();
          await capture(filename);
        }
        await page.getByRole('button', { name: 'Зачётка', exact: true }).click();
        expired = true;
        await page.getByRole('button', { name: 'Проверить обновление' }).click();
        await page.getByText(/Войди в кабинет вуза повторно/).waitFor();
        await capture('cabinet-expired');
        await page.getByRole('button', { name: 'Войти снова' }).click();
        await capture('cabinet-reauth');
      }
    } finally { await context.close(); }
  }
}

async function enterCredentials(page, login, password) {
  await page.getByLabel('Логин ПривГУПС').fill(login);
  await page.getByLabel('Пароль ПривГУПС').fill(password);
  const [reply] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/cabinet/v1/login' && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  return reply;
}

async function savedKey(page) {
  await page.waitForFunction(() => !!localStorage.getItem('student-cabinet-connection'));
  return page.evaluate(() => JSON.parse(localStorage.getItem('student-cabinet-connection')).key);
}

test('вход по паролю, повторный вход и синхронизация двух кабинетов', { timeout: 80000 }, async t => {
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
  app = staticApp(resolve(indexFile));
  const appUrl = await address(app);
  const marks = { А: 'Отлично', Б: 'Хорошо' };
  const identities = {};
  const testStudents = { alice: 'А', bob: 'Б' };
  const loginForm = `<form action="${portalOrigin}/login" method="post"><input name="login"><input name="password" type="password"><button type="submit">Войти</button></form>`;
  const portalVisits = [];
  // A real browser navigation stays inside the Playwright fixture after form submission.
  const transition = (route, path) => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: `<script>location.replace(${JSON.stringify(path)})</script>`,
  });

  const prepare = context => context.route(`${portalOrigin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    portalVisits.push(`${route.request().method()} ${path}`);
    if (path === '/login') {
      if (route.request().method() === 'POST') {
        const fields = new URLSearchParams(route.request().postData());
        const login = fields.get('login');
        if (login === 'verification') return transition(route, '/verification');
        if (testStudents[login] && fields.get('password') === `fictional-${login}`) {
          identities[login] = testStudents[login];
          await context.addCookies([{ name: 'student-test', value: login, url: portalOrigin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
          return transition(route, '/dashboard');
        }
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: loginForm });
    }
    if (path === '/verification') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>Дополнительная проверка</h1>' });
    const cookie = (await context.cookies(portalOrigin)).find(item => item.name === 'student-test');
    const student = identities[cookie?.value];
    if (!student) return route.fulfill({ status: 401, body: 'Сессия истекла' });
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ru"><body>${mockPortal(path, student, marks)}</body></html>` });
  });
  const connected = [];
  api = makeApi(store, new Set([appUrl]), {
    signIn: credentials => signInToPortal(browser, credentials, prepare), onConnected: id => connected.push(id),
  });
  const apiUrl = await address(api);
  const apiPath = `${apiUrl}/cabinet/v1/snapshot`;
  const read = key => fetch(apiPath, { headers: { Authorization: `Bearer ${key}`, Origin: appUrl } });
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
  async function openPwa() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (![appUrl, apiUrl].includes(url.origin)) return route.abort();
      if (url.origin === appUrl && url.pathname === '/cabinet-config.json') return route.fulfill({ json: { server: apiUrl } });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${appUrl}/?now=2026-11-19T09:00`);
    await page.getByRole('button', { name: 'Личный кабинет', exact: true }).click();
    return page;
  }

  async function successfulLogin(page, login) {
    const from = portalVisits.length;
    const reply = await enterCredentials(page, login, `fictional-${login}`);
    if (!reply.ok()) {
      const code = (await reply.json().catch(() => ({}))).error;
      assert.fail(`Вход ответил ${reply.status()} (${code}): ${portalVisits.slice(from).join(', ')}`);
    }
  }

  const first = await openPwa();
  await enterCredentials(first, 'alice', 'неверный');
  await first.getByText('Проверь логин и пароль ПривГУПС.', { exact: true }).waitFor();
  assert.equal(await first.getByLabel('Пароль ПривГУПС').inputValue(), '');
  assert.equal((await store.accounts()).length, 0);
  await enterCredentials(first, 'verification', 'fictional');
  await first.getByText(/Вуз запросил дополнительную проверку/).waitFor();
  assert.equal((await store.accounts()).length, 0);
  await successfulLogin(first, 'alice');
  const aliceKey = await savedKey(first);
  const alice = { key: aliceKey, id: (await store.findByKey(aliceKey)).id };
  const second = await openPwa();
  await successfulLogin(second, 'bob');
  const bobKey = await savedKey(second);
  const bob = { key: bobKey, id: (await store.findByKey(bobKey)).id };
  assert.deepEqual(connected, [alice.id, bob.id]);
  assert.equal((await first.evaluate(() => localStorage.getItem('student-cabinet-connection'))).includes('fictional-alice'), false);
  const savedSession = await store.session(await store.findByKey(aliceKey));
  assert.equal(JSON.stringify(savedSession).includes('fictional-alice'), false);
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

  await first.getByText('Дисциплина А 2', { exact: true }).waitFor();
  assert.deepEqual((await first.locator('.tabs .tab').allTextContents()).map(label => label.trim()), ['Расписание', 'Преподаватели', 'Личный кабинет', 'Настройки']);
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
  await first.getByRole('button', { name: 'Войти снова' }).click();
  await enterCredentials(first, 'bob', 'fictional-bob');
  await first.getByText(/Введи данные того же аккаунта ПривГУПС/).waitFor();
  await successfulLogin(first, 'alice');
  await first.getByRole('heading', { name: 'Войти повторно' }).waitFor({ state: 'hidden' });
  assert.equal(await savedKey(first), alice.key);
  assert.equal((await waitFor(() => ready(alice.key))).sections.grades[0].rows[0][2], 'Удовлетворительно');
  await store.disable(alice.id);
  assert.equal((await read(alice.key)).status, 401);
  assert.equal((await read(bob.key)).status, 200);
  if (process.env.CABINET_MOCKUP_DIR) await saveMockup(browser, appUrl, process.env.CABINET_MOCKUP_DIR);
});
