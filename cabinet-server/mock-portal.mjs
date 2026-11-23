// Все данные в ответах макета вымышлены.
// Макет newlk.samgups.ru для тестов. Повторяет то, что видно в DevTools у настоящего сайта:
// форма входа с _token / login / password / remember, ответ 302 на /dashboard, cookie
// licnyi_kabinet_studenta_session (2 часа) и remember_web_… (долгий), Livewire 2 на траектории
// с цепочкой selectSemester → select-semester → четыре события для списка дисциплин.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const sessionCookie = 'licnyi_kabinet_studenta_session';
const rememberCookie = 'remember_web_mock';
const secret = randomBytes(16).toString('hex');
const token = () => randomBytes(16).toString('hex');
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const checksum = (name, data) => createHash('sha256').update(secret + name + JSON.stringify(data)).digest('hex');
const row = values => `<tr>${values.map(value => `<td>${value}</td>`).join('')}</tr>`;
const table = (columns, values) => `<table><thead><tr>${columns.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${values.map(row).join('')}</tbody></table>`;
const bookColumns = ['Дисциплина', 'Форма контроля', 'Часы', 'Зач. ед.', 'Дата', 'Результат', 'Преподаватель'];
const semesterKeys = ['2025/2026_1', '2025/2026_2', '2026/2027_1'];
const semesterLabel = key => `${key.slice(0, 9)} (${key.endsWith('_1') ? 'зимний' : 'летний'})`;
const disciplineEvents = ['set-semester-key', 'set-semester', 'set-controll-action-types', 'set-selected-year'];

function layout(body, csrf) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="csrf-token" content="${csrf}">
    <title>Личный кабинет студента</title></head><body>${body}
    <script src="/vendor/livewire/livewire.js?id=test"></script></body></html>`;
}

export function createMockPortal({ students, marks }) {
  const sessions = new Map();     // id → { csrf, user }
  const remembered = new Map();   // токен «Запомнить меня» → логин
  const logins = [];              // что приходило в POST /login (без пароля)
  const livewireCalls = [];
  const state = { captcha: false };
  let origin = '';

  function readCookies(request) {
    return Object.fromEntries((request.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(([name]) => name));
  }
  function startSession(response, user = null) {
    const id = token();
    const session = { id, csrf: token(), user };
    sessions.set(id, session);
    response.appendHeader('Set-Cookie', `XSRF-TOKEN=${session.csrf}; Max-Age=7200; Path=/; SameSite=Lax`);
    response.appendHeader('Set-Cookie', `${sessionCookie}=${id}; Max-Age=7200; Path=/; HttpOnly; SameSite=Lax`);
    return session;
  }
  // Как Laravel: сессии нет или она истекла — входим по cookie «Запомнить меня», если он ещё действует
  function sessionOf(request, response) {
    const cookies = readCookies(request);
    let session = sessions.get(cookies[sessionCookie]);
    if (!session) session = startSession(response);
    if (!session.user && remembered.has(cookies[rememberCookie])) {
      sessions.delete(session.id);
      session = startSession(response, remembered.get(cookies[rememberCookie]));
    }
    return session;
  }
  const html = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(body); };
  const redirect = (response, path) => { response.writeHead(302, { Location: `${origin}${path}` }); response.end(); };
  const readBody = async request => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8'); };

  // ---------- страницы ----------
  const term = (student, n) => `<section><div>${n} семестр</div><div>${table(bookColumns, [[`Дисциплина ${student.name} ${n}`, 'Экзамен', '72', '2', '20.12.2025', marks[student.name], 'Преподаватель Т. Т.']])}</div></section>`;
  const pages = {
    '/dashboard': student => `<div x-data="{ tab: 1 }"><a href="#" @click="tab = 1">Новости</a><a href="#" @click="tab = 2">Моя группа</a>
      <div x-show="tab === 2" style="display:none">${table(['', 'ФИО', 'День рождения'], [['1', `Участник ${student.name}`, '01.01']])}</div></div>`,
    '/student/book/list': student => `<h1>· Зачетная книжка № ${student.book} ·</h1>
      <div x-data="{ activeTab: '1-course' }"><nav><a @click="activeTab = '1-course'">1 курс</a> <a @click="activeTab = '2-course'">2 курс</a></nav>
      <div x-show="activeTab === '1-course'">${term(student, 1)}${term(student, 2)}</div>
      <div x-show="activeTab === '2-course'" style="display:none">${term(student, 3)}</div></div>`,
    '/student/orders': student => student.name === 'Б' ? '<p>Нет данных для отображения</p>'
      // как на сайте: у приказа без содержания последней ячейки нет; длинный текст обрезан, целиком — в подсказке
      : `<table><thead><tr><th>Дата</th><th>Номер приказа</th><th>Название</th><th>Содержание</th></tr></thead><tbody>
          <tr><td>01.11.2026</td><td>ТЕСТ-${student.name}</td><td>Приказ</td><td>Содержание</td></tr>
          <tr><td>12.03.2030</td><td>ТЕСТ-101</td><td>Тестовый приказ</td><td class="xl:p-4 align-top relative xl:table-cell"> <div class="flex items-center"> <div wire:loading.attr="disabled" class=" inline-flex items-center justify-center tandem-popper-tooltip-root relative" data-tandem-popper-tooltip="" data-tandem-popper-placement="bottom-start" data-tandem-popper-title="по результатам проверки демонстрационной записи в тестовом журнале" data-tandem-popper-html="0" aria-describedby="tooltip_demo"> <div class="hidden xl:block text-sm text-indigo-900 font-semibold hover:text-indigo-600"> по результатам проверки демонстрационной... </div> </div> <span onclick="copyToClipboard('по результатам проверки демонстрационной записи в тестовом журнале')" class="cursor-pointer pl-2" style=""> <svg width="16" height="16"><path d="M6 2"></path></svg> </span> </div> </td></tr>
          <tr><td>18.02.2030</td><td>ТЕСТ-102</td><td>Тестовый приказ без содержания</td></tr>
        </tbody></table>`,
    '/student/curriculum': student => `<div>Название дисциплины</div><div class="hidden xl:block"><div class="flex items-center">
      <div>Б1.О.1</div><div>План ${student.name}</div><div></div><div>72</div><div>1</div><div>Зачёт</div></div></div>`,
    '/user/profile': student => `<a href="/user/profile" aria-label="Студент ${student.name}">Профиль</a>
      <div><div>Курс</div><div>2</div></div><div><div>Направление подготовки</div><div>Тестовая программа ${student.name}</div></div>`,
    '/student/trajectory': student => trajectory(student, student.trajectory, true),
  };

  // ---------- Livewire: три компонента траектории ----------
  const components = {
    'schedule-student-main': { id: 'L1', listeners: [] },
    'trajectory-semesters': { id: 'S1', listeners: [] },
    trajectory: { id: 'T1', listeners: ['select-semester'] },
    'trajectory-semester-disciplines': { id: 'D1', listeners: disciplineEvents },
  };
  const initial = (name, data, path) => esc(JSON.stringify({
    fingerprint: { id: components[name].id, name, locale: null, path, method: 'GET', v: 'acj' },
    effects: { listeners: components[name].listeners },
    serverMemo: { children: [], errors: [], htmlHash: 'test', data, dataMeta: [], checksum: checksum(name, data) },
  }));
  const semestersHTML = (data, full) => `<div wire:id="S1" class="scroll-tandem-trajectory"${full ? ` wire:initial-data='${initial('trajectory-semesters', data, 'student/trajectory')}'` : ''}>
    ${semesterKeys.map(key => key === data.selected ? `<div>${semesterLabel(key)}</div>`
      : `<div><a href="javascript:void(0)" wire:click='selectSemester("${key}")'>${semesterLabel(key)}</a></div>`).join('')}</div>`;
  const disciplinesHTML = (student, data, full) => {
    const ready = data.selected_semester_key && data.semester?.key === data.selected_semester_key
      && data.controlTypes && data.year === Number(data.selected_semester_key.slice(0, 4));
    const index = semesterKeys.indexOf(data.selected_semester_key);
    // Как на сайте: прокрутка → список, внутри плоско «название, вид контроля и часы, разделитель»
    const subject = name => `<div class="inline-block w-full"><span class="text-emerald-600">${name}</span></div>`;
    const details = (kind, hours) => `<div class="flex flex-col"><span class="flex"><div class="flex pr-5 items-center"><svg></svg>${kind}</div></span><span class="float-right">${hours}</span></div>`;
    const separator = '<div><div class="py-5"><div class="border-t"></div></div></div>';
    return `<div wire:id="D1" class="px-7 py-5 overflow-y-auto scroll-tandem"${full ? ` wire:initial-data='${initial('trajectory-semester-disciplines', data, 'student/trajectory')}'` : ''}>
      ${ready ? `<div class="md:h-100">${subject(`Предмет ${student.name} ${index}`)}${details('Зачёт', '72 ч. / 2 з.е')}${separator}${subject(`Второй предмет ${student.name} ${index}`)}${details('Экзамен', '108 ч. / 3 з.е')}</div>` : ''}</div>`;
  };
  const semesterInfo = key => ({ key, year: Number(key.slice(0, 4)), yearTitle: semesterLabel(key) });
  const disciplinesData = key => ({ selected_semester_key: key, semester: semesterInfo(key), controlTypes: { 'c1': { title: 'Коллоквиум', abbreviation: 'Кол' } }, year: Number(key.slice(0, 4)) });
  // «Расписание → Список»: в каждом месяце лекция, консультация и экзамен (или зачёт), как события сайта
  const scheduleEvents = (student, year, month) => {
    const day = n => `${String(n).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    const teacher = { t1: { id: 't1', last_name: 'Примеров', first_name_one: 'Е', middle_name_one: 'М', fio: 'Примеров Е. М.' } };
    const base = { teachers: [], comment: null, place: null, urlOnline: null, group: 'ДЕМО-00', numberPair: null };
    return [
      { ...base, id_ext: `lec-${year}-${month}`, date: day(3), startTime: '08:30', endTime: '10:00', discipline: `Лекция ${student.name} ${month}`, groupType: 'Лекции', address: 'Учебный макет 2', classroom: '9902', color: 'teal', code: 'alt.lectures', abbr: 'Л' },
      { ...base, id_ext: `cons-${year}-${month}`, date: day(14), startTime: '13:55', endTime: '15:25', discipline: `Предмет ${student.name} ${month}`, groupType: 'Консультация', address: 'Учебный макет 1', classroom: '9901', color: 'indigo', code: 'alt.consultation', abbr: 'К', teachers: teacher },
      { ...base, id_ext: `def-${year}-${month}`, date: day(16), startTime: '10:10', endTime: '11:40', discipline: `Практика ${student.name} ${month}`, groupType: 'Защита отчета', address: 'Учебный макет 1', classroom: '9903', color: 'blue', code: 'alt.defense', abbr: 'З', session: true },
      { ...base, id_ext: `exam-${year}-${month}`, date: day(15), startTime: '08:30', endTime: '12:00', discipline: `Предмет ${student.name} ${month}`, groupType: month % 2 ? 'Экзамен' : 'Зачет', address: 'Учебный макет 1', classroom: '9901', color: 'red', code: 'alt.exam', abbr: 'Э', teachers: teacher },
    ];
  };
  const now = new Date(Date.now() + 4 * 3600e3);
  // галочка «Экзамены (зачеты)»: показывает только события сессии (их сайт помечает сам, не по названию)
  const listData = (student, month = now.getUTCMonth() + 1, year = now.getUTCFullYear(), exams = false) => ({
    month: { number: String(month).padStart(2, '0') }, year: String(year), exams,
    events: scheduleEvents(student, year, month).filter(event => !exams || event.session || event.code === 'alt.exam'),
  });
  pages['/schedule/students/list'] = student => `<div wire:id="L1" wire:initial-data='${initial('schedule-student-main', listData(student), 'schedule/students/list')}'>
    <a wire:click="minusMonth">‹</a><a wire:click="addMonth">›</a></div>`;

  function trajectory(student, data, full) {
    const key = data.semester;
    const status = key === semesterKeys.at(-1) ? 'Обучение продолжается' : 'Курс полностью пройден';
    const inner = full ? semestersHTML({ selected: key }, true) : '<div wire:id="S1"></div>';
    const list = full ? disciplinesHTML(student, disciplinesData(key), true) : '<div wire:id="D1"></div>';
    return `<div wire:id="T1"${full ? ` wire:initial-data='${initial('trajectory', { semester: key }, 'student/trajectory')}'` : ''}>
      ${inner}<div class="panel">${list}<div><span>${semesterLabel(key)}</span><span>${status}</span></div></div></div>`;
  }
  function livewire(student, name, request) {
    const { fingerprint, serverMemo, updates } = request;
    if (fingerprint?.name !== name || !components[name] || serverMemo?.checksum !== checksum(name, serverMemo.data)) return null;
    const data = structuredClone(serverMemo.data);
    const before = JSON.stringify(data);
    const emits = [];
    for (const { type, payload } of updates || []) {
      livewireCalls.push({ name, type, method: payload.method, event: payload.event });
      if (name === 'schedule-student-main' && type === 'callMethod' && (payload.method === 'addMonth' || payload.method === 'minusMonth')) {
        let month = +data.month.number + (payload.method === 'addMonth' ? 1 : -1), year = +data.year;
        if (month > 12) { month = 1; year++; }
        if (month < 1) { month = 12; year--; }
        Object.assign(data, listData(student, month, year, data.exams));
      } else if (name === 'schedule-student-main' && type === 'syncInput' && payload.name === 'exams') {
        Object.assign(data, listData(student, +data.month.number, +data.year, payload.value === true));
      } else if (name === 'trajectory-semesters' && type === 'callMethod' && payload.method === 'selectSemester' && semesterKeys.includes(payload.params[0])) {
        data.selected = payload.params[0];
        emits.push({ event: 'select-semester', params: [data.selected] });
      } else if (name === 'trajectory' && type === 'fireEvent' && payload.event === 'select-semester') {
        const key = payload.params[0];
        data.semester = key;
        const next = disciplinesData(key);
        emits.push({ event: 'set-semester-key', params: [key] }, { event: 'set-semester', params: [next.semester] },
          { event: 'set-controll-action-types', params: [next.controlTypes] }, { event: 'set-selected-year', params: [next.year] });
      } else if (name === 'trajectory-semester-disciplines' && type === 'fireEvent') {
        const [value] = payload.params;
        if (payload.event === 'set-semester-key') data.selected_semester_key = value;
        if (payload.event === 'set-semester') data.semester = value;
        if (payload.event === 'set-controll-action-types') data.controlTypes = value;
        if (payload.event === 'set-selected-year') data.year = value;
      } else return null;
    }
    // Как Livewire 2: в ответе только изменившиеся свойства — клиент обязан слить их с прежними
    const dirty = Object.keys(data).filter(key => JSON.stringify(data[key]) !== JSON.stringify(serverMemo.data[key]));
    const view = name === 'schedule-student-main' ? '<div wire:id="L1"><a wire:click="minusMonth">‹</a><a wire:click="addMonth">›</a></div>'
      : name === 'trajectory-semesters' ? semestersHTML(data, false)
      : name === 'trajectory' ? trajectory(student, data, false) : disciplinesHTML(student, data, false);
    return {
      effects: { html: JSON.stringify(data) === before ? null : view, dirty, emits },
      serverMemo: { data: Object.fromEntries(dirty.map(key => [key, data[key]])), checksum: checksum(name, data), htmlHash: 'h' + dirty.length },
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const session = sessionOf(request, response);
    const student = session.user ? students[session.user] : null;
    if (url.pathname === '/login' && request.method === 'GET') {
      if (student) return redirect(response, '/dashboard');
      return html(response, layout(`<h2>Вход в систему</h2>
        <form action="${origin}/login" method="POST"><input type="hidden" name="_token" value="${session.csrf}">
        <input name="login" type="text"><input name="password" type="password">
        ${state.captcha ? '<input name="captcha" type="text">' : ''}
        <label><input type="checkbox" name="remember"> Запомнить меня</label><button type="submit">Войти</button></form>`, session.csrf));
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      const fields = new URLSearchParams(await readBody(request));
      logins.push({ login: fields.get('login'), remember: fields.get('remember'), fields: [...fields.keys()] });
      if (fields.get('_token') !== session.csrf) return html(response, 'Page Expired', 419);
      if (state.captcha) return redirect(response, '/login');
      const login = fields.get('login');
      if (login === 'verification') return redirect(response, '/verification');
      if (!students[login] || fields.get('password') !== `fictional-${login}`) return redirect(response, '/login');
      sessions.delete(session.id);
      startSession(response, login);
      if (fields.get('remember') === 'on') {
        const value = token();
        remembered.set(value, login);
        response.appendHeader('Set-Cookie', `${rememberCookie}=${value}; Max-Age=34560000; Path=/; HttpOnly; SameSite=Lax`);
      }
      return redirect(response, '/dashboard');
    }
    if (url.pathname === '/verification') return html(response, layout('<h1>Дополнительная проверка</h1>', session.csrf));
    const match = /^\/livewire\/message\/([\w.-]+)$/.exec(url.pathname);
    if (match && request.method === 'POST') {
      if (!student) return html(response, 'Unauthorized', 401);
      if (request.headers['x-livewire'] !== 'true' || request.headers['x-csrf-token'] !== session.csrf) return html(response, 'Page Expired', 419);
      const result = livewire(student, match[1], JSON.parse(await readBody(request) || '{}'));
      if (!result) return html(response, 'Bad Request', 400);
      if (match[1] === 'trajectory' && result.effects.dirty.includes('semester')) student.trajectory = { semester: result.serverMemo.data.semester };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify(result));
    }
    if (pages[url.pathname] && request.method === 'GET') {
      if (!student) return redirect(response, '/login');
      return html(response, layout(pages[url.pathname](student), session.csrf));
    }
    response.writeHead(404).end();
  });

  for (const student of Object.values(students)) student.trajectory = { semester: semesterKeys.at(-1) };
  return {
    server, logins, livewireCalls, state,
    async listen() {
      await new Promise((done, fail) => server.listen(0, '127.0.0.1', done).once('error', fail));
      origin = `http://127.0.0.1:${server.address().port}`;
      return origin;
    },
    // Прошло больше двух часов: все сессии сайта истекли, «Запомнить меня» ещё действует
    expireSessions: () => sessions.clear(),
    // Студент нажал «Выход» на сайте вуза — Laravel сбрасывает «Запомнить меня» на всех устройствах
    signOutEverywhere(login) {
      for (const [value, owner] of remembered) if (owner === login) remembered.delete(value);
      for (const [id, session] of sessions) if (session.user === login) sessions.delete(id);
    },
    close: () => new Promise(done => server.close(done)),
  };
}
