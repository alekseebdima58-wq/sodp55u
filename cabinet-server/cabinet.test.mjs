import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { createMockPortal } from './mock-portal.mjs';
import { cabinetEvents, checkRelay, sendToBot } from './notify.mjs';
import { collectCabinet, openPortal, SessionExpired, signInToPortal, SignInFailed } from './portal.mjs';
import { dueAccounts, makeApi, manualRefreshInterval, refreshInterval, refreshIntervalAt, scheduleSync, syncAll } from './server.mjs';
import { openStore } from './state.mjs';

const indexFile = fileURLToPath(new URL('../', import.meta.url));
const launchBrowser = () => chromium.launch({ executablePath: process.env.CABINET_CHROMIUM_PATH || undefined });
const students = () => ({
  alice: { name: 'А', book: 'TEST-А' },
  bob: { name: 'Б', book: 'TEST-Б' },
  verification: { name: 'В', book: 'TEST-В' },
});

// CABINET_PARSER=chromium — разбирать страницы в Chromium вместо linkedom.
// Для сверки: функции чтения не должны зависеть от того, чем разобран HTML.
function chromiumExtract(browser) {
  let page, chain = Promise.resolve();
  return (html, read, args) => {
    const run = chain.then(async () => {
      page ??= await browser.newContext().then(async context => {
        await context.route('**/*', route => route.abort());
        return context.newPage();
      });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      return page.evaluate(([source, value]) => (0, eval)(`(${source})`)(document, value), [read.toString(), args]);
    });
    chain = run.catch(() => {});
    return run;
  };
}
const parser = browser => process.env.CABINET_PARSER === 'chromium' ? { extract: chromiumExtract(browser) } : {};

async function signInError(promise) {
  try { await promise; } catch (error) { assert(error instanceof SignInFailed, error); return error.code; }
  assert.fail('Вход должен был завершиться ошибкой');
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
async function enterCredentials(page, login, password) {
  await page.getByLabel('Логин', { exact: true }).fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
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

async function saveMockup(browser, appUrl, directory) {
  await mkdir(directory, { recursive: true });
  const columns = ['Дисциплина', 'Форма контроля', 'Дата', 'Результат'];
  // Вымышленные данные для демонстрационных скриншотов.
  const snapshot = {
    version: 1, status: 'ready', syncedAt: '2026-11-19T05:42:00Z',
    sections: { grades: [
      { title: '3 семестр', columns, rows: [
        ['Дисциплина 1', 'Экзамен', '17.11.2026', 'Отлично'],
        ['Дисциплина 2', 'Экзамен', '15.11.2026', 'Хорошо'],
        ['Дисциплина 3', 'Зачёт', '13.11.2026', 'Зачтено'],
      ] },
      { title: '2 семестр', columns, rows: [
        ['Дисциплина 5', 'Экзамен', '24.06.2026', 'Отлично'],
        ['Дисциплина 6', 'Экзамен', '19.06.2026', 'Хорошо'],
      ] },
    ],
    orders: [{ columns: ['Дата', 'Номер приказа', 'Название', 'Содержание'], rows: [
      ['03.09.2026', 'ДЕМО-201', 'Демонстрационный перевод', 'Пример текста о переводе.'],
      ['21.08.2025', 'ДЕМО-202', 'Демонстрационное зачисление', 'Пример текста о зачислении.'],
    ] }],
    plan: [{ columns: ['Индекс', 'Дисциплина', 'Часы', 'Период', 'Вид контроля'], rows: [
      ['Б1.О.12', 'Дисциплина 1', '108', '3 семестр', 'Экзамен'],
      ['Б1.О.13', 'Дисциплина 2', '144', '3 семестр', 'Экзамен'],
      ['Б1.В.04', 'Дисциплина 3', '72', '3 семестр', 'Зачёт'],
      ['Б1.О.15', 'Дисциплина 4', '72', '4 семестр', 'Зачёт'],
    ] }],
    trajectory: [
      { title: '2026/2027 (зимний)', columns: ['Дисциплина', 'Контроль, нагрузка и статус'], rows: [
        ['Дисциплина 1', 'Экзамен · 108 ч. · 3 з. е.'],
        ['Дисциплина 3', 'Зачёт · 72 ч. · 2 з. е.'],
        ['Статус семестра', 'Обучение продолжается'],
      ] },
      { title: '2025/2026 (летний)', columns: ['Дисциплина', 'Контроль, нагрузка и статус'], rows: [
        ['Дисциплина 5', 'Экзамен · 108 ч. · 3 з. е.'],
        ['Статус семестра', 'Курс полностью пройден'],
      ] },
    ],
    profile: [{ columns: ['Поле', 'Значение'], rows: [
      ['Имя', 'Учебный профиль'], ['Группа', 'ДЕМО-00'], ['Курс', '2'],
      ['Направление подготовки', 'Демонстрационная программа'], ['Форма обучения', 'Очная'],
    ] }],
    group: [{ columns: ['ФИО'], rows: [
      ['Участник 1'], ['Участник 2'], ['Участник 3'],
      ['Участник 4'], ['Участник 5'], ['Участник 6'],
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
      const open = async id => { await page.locator(`.cabinet .item[data-page="${id}"]`).click(); await page.waitForTimeout(500); };
      const back = async () => { await page.getByRole('button', { name: 'Назад' }).click(); await page.locator('.cab-card').waitFor(); };
      await page.goto(`${appUrl}/?now=2026-11-19T09:42`);
      await page.getByRole('button', { name: 'Личный кабинет', exact: true }).click();
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
      if (colorScheme === 'dark') await capture('cabinet-connect');
      await enterCredentials(page, 'demo', 'fictional-password');
      await page.locator('.cab-card').getByText('Учебный профиль', { exact: true }).waitFor();
      await page.locator('.cab-card').getByText('ДЕМО-00 · 2 курс', { exact: true }).waitFor();
      await capture(`cabinet-${colorScheme}`);
      if (colorScheme === 'dark') {
        for (const [id, filename, sample] of [
          ['grades', 'cabinet-grades', 'Дисциплина 1'],
          ['orders', 'cabinet-orders', 'Демонстрационный перевод'],
          ['plan', 'cabinet-plan', 'Дисциплина 1'],
          ['trajectory', 'cabinet-trajectory', '2026/2027 (зимний)'],
          ['group', 'cabinet-group', 'Участник 3'],
        ]) {
          await open(id);
          await page.getByText(sample, { exact: true }).first().waitFor();
          await capture(filename);
          await back();
        }
        await page.locator('.cab-card').click();
        await page.getByText('Демонстрационная программа', { exact: true }).waitFor();
        await capture('cabinet-profile');
        await back();
        expired = true;
        await page.evaluate(() => window.studentCabinet.reload());
        await page.getByText(/Вход в кабинет вуза истёк/).waitFor();
        await capture('cabinet-expired');
        await page.locator('[data-cab="relogin"]').click();
        await capture('cabinet-reauth');
      }
    } finally { await context.close(); }
  }
}

test('обновление раз в 3 дня и сохранение срока после перезапуска', async t => {
  const path = await mkdtemp(join(tmpdir(), 'sodp55u-refresh-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const store = await openStore(path);
  const browserState = { cookies: [], origins: [] };
  const { id } = await store.create('student', browserState);
  const account = await store.find(id);
  const syncedAt = '2026-11-01T08:00:00Z';
  const now = Date.parse(syncedAt);
  const interval = refreshInterval;
  assert.deepEqual(await dueAccounts(store, undefined, now), [account]);

  const snapshot = { version: 1, status: 'ready', syncedAt, sections: {} };
  await store.saveSession(account, { browserState, snapshot });
  assert.deepEqual(await dueAccounts(store, undefined, now + interval - 1), []);
  assert.deepEqual(await dueAccounts(store, undefined, now + interval), [account]);

  const lastAttemptAt = new Date(now + interval).toISOString();
  await store.saveSession(account, { browserState, snapshot: { ...snapshot, status: 'error' }, lastAttemptAt });
  const restarted = await openStore(path);
  assert.deepEqual(await dueAccounts(restarted, undefined, now + interval * 2 - 1), []);
  assert.deepEqual(await dueAccounts(restarted, undefined, now + interval * 2), [account]);

  await restarted.saveSession(account, { browserState: null, snapshot: { ...snapshot, status: 'expired' }, lastAttemptAt });
  assert.deepEqual(await dueAccounts(restarted, undefined, now + interval * 2), []);
  await restarted.reconnect(id, 'student', browserState);
  assert.deepEqual((await dueAccounts(restarted, undefined, now + interval)).map(item => item.id), [id]);
});

test('в декабре и январе обновление каждые 4 часа', async t => {
  const hours = h => h * 60 * 60 * 1000;
  assert.equal(refreshIntervalAt(Date.parse('2026-11-30T19:59:00Z')), refreshInterval, '30 ноября, 23:59 по Самаре — обычный режим');
  assert.equal(refreshIntervalAt(Date.parse('2026-11-30T20:00:00Z')), hours(4), '1 декабря, 00:00 по Самаре — сессия');
  assert.equal(refreshIntervalAt(Date.parse('2027-01-31T19:59:00Z')), hours(4));
  assert.equal(refreshIntervalAt(Date.parse('2027-01-31T20:00:00Z')), refreshInterval, '1 февраля — снова раз в 3 дня');

  const path = await mkdtemp(join(tmpdir(), 'sodp55u-session-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const store = await openStore(path);
  const { id } = await store.create('student', { cookies: [], origins: [] });
  const account = await store.find(id);
  const syncedAt = '2026-12-10T06:00:00Z';
  await store.saveSession(account, { browserState: { cookies: [], origins: [] }, snapshot: { version: 1, status: 'ready', syncedAt, sections: {} } });
  assert.deepEqual(await dueAccounts(store, undefined, Date.parse(syncedAt) + hours(4) - 1), []);
  assert.deepEqual(await dueAccounts(store, undefined, Date.parse(syncedAt) + hours(4)), [account]);
});

test('портал: вход с «Запомнить меня», разделы, траектория через Livewire, истечение сессии', { timeout: 60000 }, async t => {
  const browser = process.env.CABINET_PARSER === 'chromium' ? await launchBrowser() : null;
  const portal = createMockPortal({ students: students(), marks: { А: 'Отлично', Б: 'Хорошо' } });
  t.after(async () => { await portal.close(); await browser?.close(); });
  const options = { origin: await portal.listen(), ...parser(browser) };

  assert.equal(await signInError(signInToPortal({ login: 'alice', password: 'неверный' }, options)), 'invalid_credentials');
  assert.equal(await signInError(signInToPortal({ login: 'verification', password: 'fictional-verification' }, options)), 'interaction_required');
  portal.state.captcha = true;
  assert.equal(await signInError(signInToPortal({ login: 'alice', password: 'fictional-alice' }, options)), 'interaction_required');
  portal.state.captcha = false;
  await assert.rejects(signInToPortal({ login: 'alice', password: 'x' }, { origin: 'http://example.com' }), SignInFailed);

  const { identity, browserState } = await signInToPortal({ login: 'alice', password: 'fictional-alice' }, options);
  const sent = portal.logins.at(-1);
  assert.equal(sent.remember, 'on', 'вход отправляет «Запомнить меня»');
  assert.deepEqual(sent.fields.sort(), ['_token', 'login', 'password', 'remember']);
  assert(browserState.cookies.some(cookie => cookie.name.startsWith('remember_web_')), 'сайт выдал cookie «Запомнить меня»');
  assert(!JSON.stringify(browserState).includes('fictional-alice'));

  const client = openPortal({ ...options, cookies: browserState.cookies });
  const { sections, unavailable } = await collectCabinet(client, identity);
  assert.deepEqual(unavailable, []);
  assert.deepEqual(sections.grades.map(section => section.title), ['1 семестр', '2 семестр', '3 семестр']);
  assert.deepEqual(sections.grades[0].columns, ['Дисциплина', 'Форма контроля', 'Часы', 'Зач. ед.', 'Дата', 'Результат', 'Преподаватель']);
  assert.equal(sections.grades[2].rows[0][0], 'Дисциплина А 3', 'скрытый курс тоже прочитан');
  assert.deepEqual(sections.group, [{ title: '', columns: ['ФИО', 'День рождения'], rows: [['Участник А', '01.01']] }], 'все столбцы, кроме номера');
  assert.deepEqual(sections.profile[0].rows, [['Имя', 'Студент А'], ['Курс', '2'], ['Направление подготовки', 'Тестовая программа А']]);
  assert.deepEqual(sections.plan[0].rows, [['Б1.О.1', 'План А', '72', '1', 'Зачёт']]);
  // Сессия: из трёх месяцев «Расписание → Список» — только консультации, экзамены и зачёты, без лекций
  assert.deepEqual(sections.session[0].columns, ['Дата', 'Время', 'Дисциплина', 'Вид', 'Аудитория', 'Преподаватель']);
  assert.equal(sections.session[0].rows.length, 6);
  assert(sections.session[0].rows.every(row => /Консультация|Экзамен|Зачет/.test(row[3])), 'лекции в сессию не попадают');
  assert.deepEqual(sections.session[0].rows[1].slice(1), ['08:30–12:00', sections.session[0].rows[1][2], sections.session[0].rows[1][3], 'ауд. 9901 · Учебный макет 1', 'Примеров Е. М.']);
  assert.equal(new Set(sections.session[0].rows.map(row => row[0].slice(3))).size, 3, 'три разных месяца');
  assert.deepEqual(sections.trajectory.map(section => section.title), ['2025/2026 (зимний)', '2025/2026 (летний)', '2026/2027 (зимний)']);
  // Все дисциплины семестра, а не только первая: на сайте они идут плоским списком с разделителями
  const semester = (n, status) => [['Предмет А ' + n, 'Зачёт · 72 ч. / 2 з.е'], ['Второй предмет А ' + n, 'Экзамен · 108 ч. / 3 з.е'], ['Статус семестра', status]];
  assert.deepEqual(sections.trajectory.map(section => section.rows), [
    semester(0, 'Курс полностью пройден'), semester(1, 'Курс полностью пройден'), semester(2, 'Обучение продолжается'),
  ]);
  // Цепочка как в DevTools: selectSemester → select-semester → четыре события одним запросом
  assert.deepEqual(portal.livewireCalls.filter(call => call.name.startsWith('trajectory')).slice(0, 6).map(call => `${call.name}:${call.method || call.event}`), [
    'trajectory-semesters:selectSemester', 'trajectory:select-semester',
    'trajectory-semester-disciplines:set-semester-key', 'trajectory-semester-disciplines:set-semester',
    'trajectory-semester-disciplines:set-controll-action-types', 'trajectory-semester-disciplines:set-selected-year',
  ]);

  // Прошло больше двух часов: сессия истекла, сайт пускает по «Запомнить меня» и выдаёт новую сессию
  portal.expireSessions();
  const later = openPortal({ ...options, cookies: client.cookies() });
  const again = await collectCabinet(later, identity);
  assert.deepEqual(again.unavailable, []);
  const session = cookies => cookies.find(cookie => cookie.name === 'licnyi_kabinet_studenta_session')?.value;
  assert.notEqual(session(later.cookies()), session(client.cookies()), 'после входа по «Запомнить меня» сохраняем новую сессию');
  // Начали с сохранённого семестра, а не с текущего — траектория всё равно в порядке вкладок
  assert.deepEqual(again.sections.trajectory, sections.trajectory);

  // Студент вышел на сайте вуза — «Запомнить меня» сброшен на всех устройствах
  portal.signOutEverywhere('alice');
  portal.expireSessions();
  await assert.rejects(collectCabinet(openPortal({ ...options, cookies: later.cookies() }), identity), SessionExpired);
});

test('обновление свайпом: каждый раз сразу на сайт вуза, одновременно — одно', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sodp55u-refresh-now-'));
  const browser = process.env.CABINET_PARSER === 'chromium' ? await launchBrowser() : null;
  const marks = { А: 'Отлично', Б: 'Хорошо' };
  const portal = createMockPortal({ students: students(), marks });
  const pwa = 'https://pwa.example';
  let clock = Date.parse('2026-11-05T10:00:00Z'), api;
  t.after(async () => { await portal.close(); await browser?.close(); await new Promise(done => api?.close(done)); await rm(dir, { recursive: true, force: true }); });
  const options = { origin: await portal.listen(), ...parser(browser) };
  const store = await openStore(dir);
  const synced = [];
  let hold = null;
  api = makeApi(store, new Set([pwa]), {
    signIn: credentials => signInToPortal(credentials, options),
    onRefresh: async account => { if (hold) await hold; await syncAll(store, options, [account], () => clock); synced.push(account.id); },
    now: () => clock,
  });
  const apiUrl = await address(api);
  const call = (path, init = {}) => fetch(`${apiUrl}/cabinet/v1/${path}`, { ...init, headers: { Origin: pwa, ...init.headers } });
  const login = await call('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'alice', password: 'fictional-alice' }) });
  assert.equal(login.status, 200);
  const { key } = await login.json();
  const auth = { Authorization: `Bearer ${key}` };
  const snapshot = async () => (await call('snapshot', { headers: auth })).json();

  assert.equal((await call('refresh', { method: 'POST' })).status, 401, 'без ключа нельзя');
  assert.equal((await fetch(`${apiUrl}/cabinet/v1/refresh`, { method: 'POST', headers: { ...auth, Origin: 'https://other.invalid' } })).status, 403);
  assert.equal((await call('refresh', { headers: auth })).status, 405, 'только POST');

  const first = await call('refresh', { method: 'POST', headers: auth });
  assert.equal(first.status, 202);
  await waitFor(() => synced.length === 1);
  assert.equal((await snapshot()).sections.grades[0].rows[0][5], 'Отлично');

  // Сразу же ещё раз — тоже идём на сайт, новая оценка приходит сразу
  marks.А = 'Хорошо';
  clock += 60 * 1000;
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 202);
  await waitFor(() => synced.length === 2);
  assert.equal((await snapshot()).sections.grades[0].rows[0][5], 'Хорошо');

  // Пока обновление идёт, второе параллельно не запускается
  let release; const gate = new Promise(r => (release = r));
  hold = gate;
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 202);
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 202);
  release(); hold = null;
  await waitFor(() => synced.length === 3);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(synced.length, 3, 'одновременно — одно обращение к сайту');

  // Вход в вуз истёк — обновлять нечего, приложение попросит войти снова
  portal.signOutEverywhere('alice');
  clock += manualRefreshInterval;
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 202);
  await waitFor(() => synced.length === 4);
  assert.equal((await snapshot()).status, 'expired');
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 409);
});

test('уведомления о кабинете: метка от приложения, новые оценки и сессия уходят боту', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sodp55u-notify-'));
  const browser = process.env.CABINET_PARSER === 'chromium' ? await launchBrowser() : null;
  const marks = { А: 'Отлично', Б: 'Хорошо' };
  const portal = createMockPortal({ students: students(), marks });
  const pwa = 'https://pwa.example';
  let clock = Date.parse('2026-11-05T10:00:00Z'), api, relay;
  // «канал бота» — свой маленький сервер вместо ntfy.sh
  const posted = [];
  relay = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    posted.push({ path: request.url, body: JSON.parse(body) }); response.writeHead(200).end('{}');
  });
  const relayUrl = await address(relay);
  const hosts = process.env.CABINET_RELAY_HOSTS;
  process.env.CABINET_RELAY_HOSTS = new URL(relayUrl).host;
  t.after(async () => {
    if (hosts === undefined) delete process.env.CABINET_RELAY_HOSTS; else process.env.CABINET_RELAY_HOSTS = hosts;
    await portal.close(); await browser?.close();
    await Promise.all([api, relay].filter(Boolean).map(server => new Promise(done => server.close(done))));
    await rm(dir, { recursive: true, force: true });
  });
  const options = { origin: await portal.listen(), ...parser(browser) };
  const store = await openStore(dir);
  const synced = [];
  api = makeApi(store, new Set([pwa]), {
    signIn: credentials => signInToPortal(credentials, options),
    onRefresh: account => syncAll(store, options, [account], () => clock).then(() => synced.push(account.id)),
    now: () => clock,
  });
  const apiUrl = await address(api);
  const call = (path, init = {}) => fetch(`${apiUrl}/cabinet/v1/${path}`, { ...init, headers: { Origin: pwa, ...init.headers } });
  const { key } = await (await call('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'alice', password: 'fictional-alice' }) })).json();
  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const label = 'c4'.repeat(32);

  // метка и канал: чужой хост и кривая метка не принимаются
  assert.equal((await call('notify', { method: 'POST', headers: auth, body: JSON.stringify({ label, relay: 'https://evil.example/sodp55u-0123456789abcdef' }) })).status, 400);
  assert.equal((await call('notify', { method: 'POST', headers: auth, body: JSON.stringify({ label: 'xyz', relay: `${relayUrl}/sodp55u-0123456789abcdef` }) })).status, 400);
  assert.equal((await call('notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })).status, 401);
  assert.equal((await call('notify', { method: 'POST', headers: auth, body: JSON.stringify({ label, relay: `${relayUrl}/sodp55u-0123456789abcdef` }) })).status, 200);

  // первое обновление — только запоминаем, ничего не шлём
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 202);
  await waitFor(() => synced.length === 1);
  assert.equal(posted.length, 0, 'первое обновление без уведомлений');

  // новая оценка — одно сообщение в канал бота
  marks.А = 'Хорошо';
  clock += manualRefreshInterval;
  assert.equal((await call('refresh', { method: 'POST', headers: auth })).status, 202);
  await waitFor(() => synced.length === 2);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].path, '/sodp55u-0123456789abcdef');
  const msg = posted[0].body;
  assert.equal(msg.q, 'cab');
  assert.match(msg.u, /^[0-9a-f]{16}$/);
  assert(!JSON.stringify(msg).includes('Хорошо'), 'оценка в канале только зашифрованной');

  // без изменений — тишина; отключили уведомления — тоже тишина
  clock += manualRefreshInterval;
  await call('refresh', { method: 'POST', headers: auth }); await waitFor(() => synced.length === 3);
  assert.equal(posted.length, 1);
  assert.equal((await call('notify', { method: 'POST', headers: auth, body: JSON.stringify({ label: '' }) })).status, 200);
  marks.А = 'Отлично';
  clock += manualRefreshInterval;
  await call('refresh', { method: 'POST', headers: auth }); await waitFor(() => synced.length === 4);
  assert.equal(posted.length, 1);
});

test('уведомления: что считается изменением', () => {
  const B = ['Дисциплина', 'Форма контроля', 'Дата', 'Результат'];
  const S = ['Дата', 'Время', 'Дисциплина', 'Вид', 'Аудитория', 'Преподаватель'];
  const g = rows => [{ title: '1 семестр', columns: B, rows }];
  const e = rows => [{ columns: S, rows }];
  assert.deepEqual(cabinetEvents(null, { grades: g([['Физика', 'Экзамен', '', 'Отлично']]) }), [], 'первое обновление');
  assert.deepEqual(cabinetEvents({ grades: g([['Физика', 'Экзамен', '', '']]) }, { grades: g([['Физика', 'Экзамен', '', '']]) }), [], 'оценки ещё нет');
  assert.equal(cabinetEvents({ grades: g([['Физика', 'Экзамен', '', '']]) }, { grades: g([['Физика', 'Экзамен', '10.01.2027', 'Хорошо']]) })[0].r, 'Хорошо');
  assert.equal(cabinetEvents({ grades: g([['Физика', 'Экзамен', '', 'Неудовлетворительно']]) }, { grades: g([['Физика', 'Экзамен', '', 'Удовлетворительно']]) })[0].r, 'Удовлетворительно', 'пересдача');
  const exam = ['10.01.2027', '08:30–12:00', 'Физика', 'Экзамен', 'ауд. 9901', ''];
  assert.deepEqual(cabinetEvents({ session: e([exam]) }, { session: e([exam]) }), []);
  assert.equal(cabinetEvents({ session: e([]) }, { session: e([exam]) })[0].o, undefined, 'новый экзамен');
  assert.equal(cabinetEvents({ session: e([exam]) }, { session: e([[...exam.slice(0, 4), 'ауд. 9902', '']]) })[0].o, '10.01.2027 · 08:30–12:00 · ауд. 9901', 'перенос');
  assert.equal(checkRelay('https://ntfy.sh/sodp55u-0123456789abcdef', ['ntfy.sh']), 'https://ntfy.sh/sodp55u-0123456789abcdef');
  for (const bad of ['http://ntfy.sh/sodp55u-0123456789abcdef', 'https://ntfy.sh/a', 'https://ntfy.sh/sodp55u-0123456789abcdef?x=1', 'https://example.com/sodp55u-0123456789abcdef', 'https://user@ntfy.sh/sodp55u-0123456789abcdef']) {
    assert.equal(checkRelay(bad, ['ntfy.sh']), null, bad);
  }
});

test('вход по паролю, повторный вход и синхронизация двух кабинетов', { timeout: 80000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sodp55u-cabinet-'));
  let browser, app, api, activeCycle, stop;
  const marks = { А: 'Отлично', Б: 'Хорошо' };
  const portal = createMockPortal({ students: students(), marks });
  t.after(async () => {
    stop?.();
    await activeCycle?.catch(() => {});
    await browser?.close();
    await portal.close();
    await Promise.all([app, api].filter(Boolean).map(server => new Promise(done => server.close(done))));
    await rm(dir, { recursive: true, force: true });
  });
  browser = await launchBrowser();
  const options = { origin: await portal.listen(), ...parser(browser) };
  const store = await openStore(dir);
  app = staticApp(resolve(indexFile));
  const appUrl = await address(app);
  const connected = [];
  api = makeApi(store, new Set([appUrl]), {
    signIn: credentials => signInToPortal(credentials, options), onConnected: id => connected.push(id),
  });
  const apiUrl = await address(api);
  const apiPath = `${apiUrl}/cabinet/v1/snapshot`;
  const read = key => fetch(apiPath, { headers: { Authorization: `Bearer ${key}`, Origin: appUrl } });
  const interval = refreshInterval;
  // Время расписания — ноябрь: обычный режим раз в 3 дня, независимо от того, когда запущен тест
  let scheduleTime = Date.parse('2026-11-02T09:00:00Z'), checkedAt;
  stop = scheduleSync(async () => {
    const now = scheduleTime;
    activeCycle = dueAccounts(store, undefined, now).then(due => syncAll(store, options, due, () => now));
    await activeCycle;
    checkedAt = now;
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
    const reply = await enterCredentials(page, login, `fictional-${login}`);
    if (!reply.ok()) {
      const code = (await reply.json().catch(() => ({}))).error;
      assert.fail(`Вход ответил ${reply.status()} (${code})`);
    }
  }

  const first = await openPwa();
  await enterCredentials(first, 'alice', 'неверный');
  await first.getByText('Проверь логин и пароль ПривГУПС.', { exact: true }).waitFor();
  assert.equal(await first.getByLabel('Пароль', { exact: true }).inputValue(), '');
  assert.equal((await store.accounts()).length, 0);
  await enterCredentials(first, 'verification', 'fictional-verification');
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
  assert.deepEqual(Object.keys(a.sections), ['grades', 'session', 'orders', 'plan', 'trajectory', 'profile', 'group']);
  assert.deepEqual(a.sections.grades.map(entry => entry.title), ['1 семестр', '2 семестр', '3 семестр']);
  assert.equal(a.sections.grades[0].rows[0][5], 'Отлично');
  assert.equal(b.sections.grades[0].rows[0][5], 'Хорошо');
  assert.deepEqual(b.sections.orders, []);
  // все приказы: и без «Содержания» (ячейки нет), и с обрезанным текстом — целиком
  assert.deepEqual(a.sections.orders[0].rows, [
    ['01.11.2026', 'ТЕСТ-А', 'Приказ', 'Содержание'],
    ['12.03.2030', 'ТЕСТ-101', 'Тестовый приказ', 'по результатам проверки демонстрационной записи в тестовом журнале'],
    ['18.02.2030', 'ТЕСТ-102', 'Тестовый приказ без содержания', ''],
  ]);
  assert.equal(a.sections.trajectory.length, 3);
  assert.equal(a.sections.trajectory[1].rows[0][0], 'Предмет А 1');
  assert.deepEqual(a.sections.group[0], { columns: ['ФИО', 'День рождения'], title: '', rows: [['Участник А', '01.01']] });
  assert.equal((await read(alice.key.replace(alice.id, bob.id))).status, 401);
  assert.equal((await fetch(apiPath, { headers: { Origin: 'https://other.invalid' } })).status, 403);
  assert.equal((await read(alice.key)).headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(`${apiPath}?student=${bob.id}`, { headers: { Authorization: `Bearer ${alice.key}` } })).status, 404);
  assert(!JSON.stringify(a).includes('Участник Б'));
  assert(!JSON.stringify(b).includes('Участник А'));

  // Главный экран кабинета: карточка студента, «Успеваемость», список разделов
  const openSection = async (page, id) => { await page.locator(`.cabinet .item[data-page="${id}"]`).click(); };
  const back = async page => { await page.getByRole('button', { name: 'Назад' }).click(); await page.locator('.cab-card').waitFor(); };
  await first.locator('.cab-card').getByText('Студент А', { exact: true }).waitFor();
  assert.deepEqual((await first.locator('.tabs .tab').allTextContents()).map(label => label.trim()), ['Расписание', 'Преподаватели', 'Личный кабинет', 'Настройки']);
  assert.deepEqual(await first.locator('.cabinet .item[data-page] .nm').allTextContents(), ['Сессия', 'Зачётка', 'Траектория', 'Учебный план', 'Моя группа', 'Приказы']);
  // Зачётка открывается на последнем семестре; другой — переключателем
  await openSection(first, 'grades');
  await first.getByText('Дисциплина А 3', { exact: true }).waitFor();
  await first.locator('[data-cab="gradesem"]', { hasText: '2 семестр' }).click();
  await first.getByText('Дисциплина А 2', { exact: true }).waitFor();
  await back(first);
  await second.locator('.cab-card').waitFor();
  await openSection(second, 'grades');
  await second.getByText('Дисциплина Б 3', { exact: true }).waitFor();
  assert.equal(await first.getByText('Дисциплина Б 3', { exact: true }).count(), 0);
  for (const [section, expected] of [
    ['orders', 'Содержание'], ['plan', 'План А'], ['trajectory', 'Предмет А 1'], ['group', 'Участник А'], ['session', 'Предмет А'],
  ]) {
    await openSection(first, section);
    await first.getByText(expected).first().waitFor();
    assert(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `ширина экрана: ${section}`);
    await back(first);
  }
  await first.locator('.cab-card').click();
  await first.getByText('Тестовая программа А', { exact: true }).waitFor();
  await back(first);
  // Карточка одногруппника: всё, что показывает сайт (здесь — день рождения)
  await openSection(first, 'group');
  await first.locator('.cab-person').first().click();
  await first.getByText('День рождения', { exact: true }).waitFor();
  assert.match(await first.locator('.cab-field .nm').first().textContent(), /^01\.01/);
  await first.getByRole('button', { name: 'Назад' }).click();
  await back(first);
  await first.getByRole('button', { name: 'Расписание', exact: true }).click();
  await first.getByRole('button', { name: 'Личный кабинет', exact: true }).click();
  await first.locator('.cab-card').getByText('Студент А', { exact: true }).waitFor();

  // Через 3 дня: сессии сайта давно истекли, сервер входит по «Запомнить меня»
  marks.А = 'Удовлетворительно';
  portal.expireSessions();
  scheduleTime += interval - 1;
  await waitFor(() => checkedAt === scheduleTime);
  assert.equal((await ready(alice.key)).sections.grades[0].rows[0][5], 'Отлично');
  scheduleTime++;
  await waitFor(async () => {
    const value = await ready(alice.key);
    return checkedAt === scheduleTime && value?.sections?.grades?.[0].rows[0][5] === 'Удовлетворительно';
  });
  await first.evaluate(() => window.studentCabinet.reload());
  await openSection(first, 'grades');
  await first.getByText('Удовлетворительно', { exact: true }).first().waitFor();
  await back(first);
  assert.equal((await ready(bob.key)).sections.grades[0].rows[0][5], 'Хорошо');

  // Студент нажал «Выход» на сайте вуза — следующее обновление просит войти снова
  portal.signOutEverywhere('alice');
  scheduleTime += interval;
  const expired = await waitFor(async () => {
    const value = await (await read(alice.key)).json();
    return value.status === 'expired' ? value : false;
  });
  assert.equal(expired.sections.grades[0].rows[0][5], 'Удовлетворительно');
  assert.equal((await ready(bob.key)).sections.grades[0].rows[0][5], 'Хорошо', 'выход Алисы не затрагивает Боба');
  await first.evaluate(() => window.studentCabinet.reload());
  await first.getByText(/Вход в кабинет вуза истёк/).waitFor();
  await first.locator('[data-cab="relogin"]').click();
  await enterCredentials(first, 'bob', 'fictional-bob');
  await first.getByText(/Введи данные того же аккаунта ПривГУПС/).waitFor();
  await successfulLogin(first, 'alice');
  await first.getByRole('heading', { name: 'Войти повторно' }).waitFor({ state: 'hidden' });
  assert.equal(await savedKey(first), alice.key);
  assert.equal((await waitFor(() => ready(alice.key))).sections.grades[0].rows[0][5], 'Удовлетворительно');
  assert(portal.logins.filter(entry => entry.login === 'alice').every(entry => entry.remember === 'on'));
  await store.disable(alice.id);
  assert.equal((await read(alice.key)).status, 401);
  assert.equal((await read(bob.key)).status, 200);
  if (process.env.CABINET_MOCKUP_DIR) await saveMockup(browser, appUrl, process.env.CABINET_MOCKUP_DIR);
});
