import { createHash } from 'node:crypto';

// Личный кабинет ПривГУПС — Laravel + Livewire 2. Работаем обычными HTTP-запросами, без браузера:
// форма входа (_token, login, password, remember), страницы разделов — HTML, траектория — запросы
// /livewire/message/… так же, как их отправляет livewire.js на странице.
export const portalOrigin = 'https://newlk.samgups.ru';
const userAgent = 'Mozilla/5.0 (compatible; sodp55u-cabinet/2.0)';
const redirectCodes = new Set([301, 302, 303, 307, 308]);

export class SessionExpired extends Error {}
export class SignInFailed extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// ---------- разбор HTML ----------
// Каждая функция чтения получает document и возвращает обычные данные. Функции самодостаточны
// (не используют ничего снаружи), поэтому в тестах их можно для сверки выполнить и в Chromium.
let linkedom;
async function linkedomExtract(html, read, args) {
  linkedom ??= import('linkedom');
  const { parseHTML } = await linkedom;
  return read(parseHTML(html).document, args);
}

function readLoginForm(document, { origin }) {
  const inputs = [...document.querySelectorAll('input, iframe')];
  const challenge = inputs.some(node => {
    const name = (node.getAttribute('name') || '').toLowerCase();
    const src = (node.getAttribute('src') || '').toLowerCase();
    return name.includes('captcha') || name === 'otp' || (node.tagName.toUpperCase() === 'IFRAME' && src.includes('captcha'));
  });
  const forms = [...document.querySelectorAll('form')]
    .filter(form => form.querySelector('input[name="login"]') && form.querySelector('input[name="password"]'));
  if (forms.length !== 1) return { ok: false, challenge, fields: {} };
  const form = forms[0];
  const action = new URL(form.getAttribute('action') || '/login', `${origin}/login`);
  const method = (form.getAttribute('method') || 'get').toLowerCase();
  const fields = {};
  for (const input of form.querySelectorAll('input')) {
    const name = input.getAttribute('name');
    if (!name || name === 'login' || name === 'password') continue;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (type === 'hidden') fields[name] = input.getAttribute('value') || '';
    else if (type === 'checkbox' && /remember/i.test(name)) fields[name] = input.getAttribute('value') || 'on';
  }
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (!fields._token && meta) fields._token = meta.getAttribute('content') || '';
  return {
    ok: action.origin === origin && action.pathname === '/login' && method === 'post' && !!fields._token,
    challenge,
    fields,
  };
}

function readBookNumber(document) {
  const clean = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
  const pattern = /^·?\s*Зач[её]тная книжка\s*№\s*\S+/i;
  const nodes = [...document.querySelectorAll('body *')].filter(node => pattern.test(clean(node)));
  const deepest = nodes.find(node => !nodes.some(other => other !== node && node.contains(other)));
  const match = deepest && /№\s*([^·\r\n]+)/.exec(deepest.textContent || '');
  return match ? match[1].trim() : '';
}

function readTables(document, { expected, columns, semester }) {
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const cells = row => [...row.children].filter(cell => /^(TD|TH)$/i.test(cell.tagName));
  const sections = [...document.querySelectorAll('table')].flatMap(table => {
    const own = node => node.closest('table') === table;
    const head = [...table.querySelectorAll('thead tr')].find(own);
    if (!head) return [];
    const headings = cells(head).map(text);
    if (!expected.every(label => headings.includes(label))) return [];
    const selected = columns || headings;
    const indices = columns ? columns.map(column => headings.indexOf(column)) : headings.map((_, index) => index);
    if (indices.some(index => index < 0)) return [];
    const minimum = 1 + Math.max(...indices);
    const rows = [...table.querySelectorAll('tbody tr')].filter(own).map(cells).filter(row => row.length >= minimum);
    let title = '';
    if (semester) {
      for (let node = table.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
        title = [...node.children].filter(child => child !== table && !child.contains(table)).map(text)
          .find(value => /^\d+\s+семестр$/i.test(value)) || '';
        if (title) break;
      }
    }
    return [{ title, columns: selected, rows: rows.map(row => indices.map(i => text(row[i]))).filter(row => row.some(Boolean)) }];
  });
  const empty = [...document.querySelectorAll('body *')].some(node => !node.children.length
    && /^Нет (данных(?: для отображения)?|приказов|записей|результатов)\.?$/i.test(text(node)));
  return { sections, empty };
}

function readPlan(document) {
  const clean = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const lessons = new Map();
  for (const row of document.querySelectorAll('[class~="xl:block"] > div.flex.items-center')) {
    const [index, subject, , hours, period, assessment] = [...row.children].map(clean);
    if (!/^[А-ЯA-Z]+\d*(?:\.[А-ЯA-Z0-9]+)*\.\d+$/u.test(index || '') || !subject) continue;
    lessons.set(index, [index, subject, hours, period, assessment]);
  }
  return [...lessons.values()];
}

function readProfile(document) {
  const clean = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const fields = ['ФИО', 'Фамилия', 'Имя', 'Отчество', 'Курс', 'Группа', 'Учебная группа', 'Направление подготовки', 'Форма обучения', 'Институт', 'Факультет', 'Подразделение', 'Квалификация'];
  const result = new Map();
  const links = [...document.querySelectorAll('a[href$="/user/profile"]')];
  const label = node => node.getAttribute('aria-label') || node.getAttribute('title') || node.querySelector('img')?.getAttribute('alt') || '';
  const name = links.map(label).find(Boolean) || links.map(clean).find(Boolean);
  for (const node of document.querySelectorAll('label, div, dt')) {
    const field = clean(node);
    if (!fields.includes(field) || node.children.length || result.has(field)) continue;
    const control = node.control || document.getElementById(node.getAttribute('for') || '') || node.nextElementSibling?.querySelector('input') || node.nextElementSibling;
    const value = control?.getAttribute('value')?.trim() || clean(control);
    if (value) result.set(field, value);
  }
  if (!result.has('Группа') && !result.has('Учебная группа')) {
    const role = [...document.querySelectorAll('a, button')].map(clean).find(value => /^Студент\s*\|\s*[^\s]+$/i.test(value));
    if (role) result.set('Группа', role.split('|').pop().trim());
  }
  const fallback = name && !result.has('ФИО') && !result.has('Имя') ? [['Имя', name]] : [];
  return [...fallback, ...result];
}

function trajectoryState(document) {
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const nav = document.querySelector('.scroll-tandem-trajectory');
  if (!nav) return null;
  const owner = node => {
    for (let current = node; current && current.getAttribute; current = current.parentElement) {
      const id = current.getAttribute('wire:id');
      if (id) return id;
    }
    return '';
  };
  const semesters = [...nav.children].flatMap(child => {
    const label = text(child);
    if (!/^\d{4}\/\d{4}\s*\((зимний|летний)\)$/i.test(label)) return [];
    const link = [child, ...child.querySelectorAll('*')].find(node => /selectSemester/.test(node.getAttribute('wire:click') || ''));
    const key = link ? (/selectSemester\(\s*['"]([^'"]+)['"]/.exec(link.getAttribute('wire:click')) || [])[1] || '' : '';
    return [{ label, key, component: link ? owner(link) : '' }];
  });
  const panel = nav.nextElementSibling;
  const main = panel?.firstElementChild;
  const rows = [...(main?.children || [])].flatMap(block => {
    const parts = [...block.children];
    const subject = text(parts[0]);
    if (!subject || parts.length < 2) return [];
    return [[subject, parts.slice(1).map(text).filter(Boolean).join(' · ')]];
  });
  const footer = panel?.children[1];
  const status = text(footer?.lastElementChild);
  if (status) rows.push(['Статус семестра', status]);
  return { semesters, footer: text(footer), rows };
}

function collectLivewire(document) {
  const components = [];
  for (const node of document.querySelectorAll('*')) {
    const id = node.getAttribute('wire:id');
    const raw = node.getAttribute('wire:initial-data');
    if (!id || !raw) continue;
    try { components.push({ id, data: JSON.parse(raw) }); } catch { /* битые данные компонента пропускаем */ }
  }
  const scripts = [...document.querySelectorAll('script')].map(node => node.textContent || '');
  const fromScript = pattern => scripts.map(source => pattern.exec(source)?.[1]).find(value => value !== undefined);
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    || fromScript(/livewire_token\s*=\s*['"]([^'"]+)['"]/) || '';
  const appUrl = fromScript(/livewire_app_url\s*=\s*['"]([^'"]*)['"]/) || '';
  return { components, csrf, appUrl };
}

// Ответ Livewire заменяет корень компонента. Вложенные компоненты в ответе — пустые заглушки
// с wire:id: на их место возвращаем уже отрисованные (так делает morphdom в livewire.js).
function patchComponent(document, { id, html }) {
  const find = target => [...document.querySelectorAll('*')].find(node => node.getAttribute('wire:id') === target);
  const old = find(id);
  const box = document.createElement('div');
  box.innerHTML = html;
  const fresh = box.firstElementChild;
  if (old && fresh) {
    for (const stub of [...fresh.querySelectorAll('*')]) {
      const child = stub.getAttribute('wire:id');
      if (!child || child === id || stub.hasAttribute('wire:initial-data')) continue;
      const existing = find(child);
      if (existing && old.contains(existing)) stub.replaceWith(existing);
    }
    old.replaceWith(fresh);
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

// ---------- cookie ----------
function cookieJar(host, initial = []) {
  const jar = new Map();
  const now = () => Date.now() / 1000;
  const live = cookie => !(cookie.expires > 0 && cookie.expires <= now());
  const domainMatches = value => {
    const domain = value.replace(/^\./, '').toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  };
  for (const cookie of initial || []) {
    if (!cookie?.name || typeof cookie.value !== 'string') continue;
    if (cookie.domain && !domainMatches(cookie.domain)) continue;
    const saved = { name: cookie.name, value: cookie.value, expires: Number.isFinite(cookie.expires) ? cookie.expires : -1 };
    if (live(saved)) jar.set(saved.name, saved);
  }
  return {
    header: () => [...jar.values()].filter(live).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    store(response) {
      for (const line of response.headers.getSetCookie?.() || []) {
        const [pair, ...attributes] = line.split(';');
        const split = pair.indexOf('=');
        if (split <= 0) continue;
        const name = pair.slice(0, split).trim();
        const value = pair.slice(split + 1).trim();
        let expires = -1, maxAge = false, allowed = true;
        for (const attribute of attributes) {
          const [rawKey, ...rest] = attribute.split('=');
          const key = rawKey.trim().toLowerCase();
          const setting = rest.join('=').trim();
          if (key === 'max-age') {
            const seconds = Number(setting);
            if (Number.isFinite(seconds)) { expires = seconds <= 0 ? 0 : now() + seconds; maxAge = true; }
          } else if (key === 'expires' && !maxAge) {
            const time = Date.parse(setting);
            if (Number.isFinite(time)) expires = time <= Date.now() ? 0 : time / 1000;
          } else if (key === 'domain' && setting) allowed = domainMatches(setting);
        }
        if (!allowed) continue;
        if (expires === 0) jar.delete(name);
        else jar.set(name, { name, value, expires });
      }
    },
    list: () => [...jar.values()].filter(live).map(cookie => ({ ...cookie, domain: host })),
  };
}

// ---------- клиент портала ----------
function checkedOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Портал должен работать по HTTPS');
  return url.origin;
}

export function openPortal({ origin = portalOrigin, fetch: send = globalThis.fetch, extract = linkedomExtract, cookies = [], timeout = 15000 } = {}) {
  const base = checkedOrigin(origin);
  const jar = cookieJar(new URL(base).hostname, cookies);

  async function request(path, { method = 'GET', headers = {}, body } = {}) {
    const url = new URL(path, base);
    if (url.origin !== base) throw new Error('Запрос за пределы портала');
    const cookie = jar.header();
    const response = await send(url, {
      method, body, redirect: 'manual', signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'ru-RU,ru;q=0.9', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    });
    jar.store(response);
    return response;
  }

  async function page(path) {
    let current = new URL(path, base);
    for (let hops = 0; hops < 6; hops++) {
      const response = await request(current.pathname + current.search, { headers: { Accept: 'text/html,application/xhtml+xml' } });
      if (redirectCodes.has(response.status)) {
        await response.arrayBuffer().catch(() => {});
        const next = new URL(response.headers.get('location') || '/', current);
        if (next.origin !== base) throw new Error('Портал перенаправил на другой сайт');
        current = next;
        continue;
      }
      return { status: response.status, ok: response.ok, path: current.pathname, html: await response.text() };
    }
    throw new Error('Слишком много перенаправлений');
  }

  return {
    origin: base,
    request,
    page,
    extract: (html, read, args) => extract(html, read, args),
    cookies: () => jar.list(),
    // Страница кабинета: перенаправили на вход — сессия (и cookie «Запомнить меня») больше не действуют
    async open(path) {
      const result = await page(path);
      if (result.path === '/login' || result.status === 401 || result.status === 419) throw new SessionExpired();
      if (result.path !== path || !result.ok) throw new Error(`Страница кабинета недоступна: ${path}`);
      return result.html;
    },
  };
}

// ---------- Livewire 2 ----------
const randomId = () => Math.random().toString(36).slice(2, 7);

async function livewireSession(portal, html, path) {
  const initial = await portal.extract(html, collectLivewire);
  if (!initial.csrf) throw new Error('Не найден CSRF-токен страницы');
  const base = new URL(initial.appUrl || portal.origin, portal.origin);
  if (base.origin !== portal.origin) throw new Error('Livewire указывает на другой сайт');
  const components = new Map();
  const remember = list => {
    for (const { id, data } of list) {
      if (components.has(id) || !data?.fingerprint?.name || !data?.serverMemo) continue;
      components.set(id, { fingerprint: data.fingerprint, serverMemo: data.serverMemo, listeners: data.effects?.listeners || [] });
    }
  };
  remember(initial.components);
  let page = html;

  async function send(component, updates) {
    const endpoint = `${base.pathname.replace(/\/$/, '')}/livewire/message/${encodeURIComponent(component.fingerprint.name)}`;
    const response = await portal.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({ fingerprint: component.fingerprint, serverMemo: component.serverMemo, updates }),
      headers: {
        'Content-Type': 'application/json', Accept: 'text/html, application/xhtml+xml', 'X-Livewire': 'true',
        'X-CSRF-TOKEN': initial.csrf, Origin: portal.origin, Referer: `${portal.origin}${path}`,
      },
    });
    if (redirectCodes.has(response.status) || response.status === 401 || response.status === 419) {
      await response.arrayBuffer().catch(() => {});
      throw new SessionExpired();
    }
    if (!response.ok) throw new Error(`Livewire ответил ${response.status}`);
    return response.json();
  }

  return {
    // Состояние компонента (его публичные свойства) по имени, например schedule-student-main
    component(name) {
      for (const [id, component] of components) if (component.fingerprint.name === name) return { id, data: component.serverMemo.data || {} };
      return null;
    },
    // Вызов метода и все события, которые он породил: каждый слушающий компонент получает
    // свои fireEvent одним запросом — как в браузере
    async dispatch(id, updates) {
      let queue = new Map([[id, updates]]);
      for (let round = 0; queue.size; round++) {
        if (round > 8) throw new Error('Слишком длинная цепочка событий Livewire');
        const current = queue;
        queue = new Map();
        for (const [target, batch] of current) {
          const component = components.get(target);
          if (!component) throw new Error('Компонент Livewire не найден');
          const result = await send(component, batch);
          for (const [key, value] of Object.entries(result?.serverMemo || {})) {
            component.serverMemo[key] = key === 'data' ? { ...component.serverMemo.data, ...value } : value;
          }
          const effects = result?.effects || {};
          if (Array.isArray(effects.listeners)) component.listeners = effects.listeners;
          if (effects.redirect) {
            if (new URL(effects.redirect, portal.origin).pathname === '/login') throw new SessionExpired();
            throw new Error('Livewire запросил переход на другую страницу');
          }
          if (typeof effects.html === 'string') {
            page = await portal.extract(page, patchComponent, { id: target, html: effects.html });
            remember((await portal.extract(page, collectLivewire)).components);
          }
          for (const emit of effects.emits || []) {
            const targets = emit.selfOnly ? [target] : [...components]
              .filter(([, other]) => (!emit.to || other.fingerprint.name === emit.to) && other.listeners.includes(emit.event))
              .map(([other]) => other);
            for (const receiver of targets) {
              if (!queue.has(receiver)) queue.set(receiver, []);
              queue.get(receiver).push({ type: 'fireEvent', payload: { id: randomId(), event: emit.event, params: emit.params || [] } });
            }
          }
        }
      }
      return page;
    },
  };
}

// ---------- вход ----------
export async function signInToPortal({ login, password }, options = {}) {
  try {
    const portal = openPortal({ ...options, cookies: [] });
    const form = await portal.page('/login');
    if (form.status === 429) throw new SignInFailed('rate_limited');
    if (!form.ok || form.path !== '/login') throw new SignInFailed('portal_unavailable');
    const found = await portal.extract(form.html, readLoginForm, { origin: portal.origin });
    if (found.challenge || !found.ok) throw new SignInFailed('interaction_required');
    // «Запомнить меня»: сессия сайта живёт 2 часа, а cookie remember_web_… позволяет обновлять кабинет без пароля
    const body = new URLSearchParams({ remember: 'on', ...found.fields, login, password });
    const reply = await portal.request('/login', {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html,application/xhtml+xml', Origin: portal.origin, Referer: `${portal.origin}/login` },
    });
    await reply.arrayBuffer().catch(() => {});
    if (reply.status === 429) throw new SignInFailed('rate_limited');
    if (reply.status === 401 || reply.status === 422) throw new SignInFailed('invalid_credentials');
    if (!redirectCodes.has(reply.status)) throw new SignInFailed(reply.ok ? 'interaction_required' : 'portal_unavailable');
    const target = new URL(reply.headers.get('location') || '/', `${portal.origin}/login`);
    if (target.origin !== portal.origin) throw new SignInFailed('interaction_required');
    if (target.pathname === '/login') {
      // Laravel возвращает на форму и при неверном пароле, и когда требует капчу
      const again = await portal.page('/login');
      const check = again.ok && again.path === '/login' ? await portal.extract(again.html, readLoginForm, { origin: portal.origin }) : null;
      throw new SignInFailed(check?.challenge ? 'interaction_required' : 'invalid_credentials');
    }
    if (target.pathname !== '/dashboard') throw new SignInFailed('interaction_required');
    const identity = await getBookIdentity(portal);
    const cookies = portal.cookies();
    if (!cookies.length) throw new SignInFailed('portal_unavailable');
    return { identity, browserState: { cookies, origins: [] } };
  } catch (error) {
    if (error instanceof SignInFailed) throw error;
    throw new SignInFailed('portal_unavailable');
  }
}

// ---------- разделы ----------
const hash = value => createHash('sha256').update(value).digest('hex');

async function bookIdentity(portal, html) {
  const number = await portal.extract(html, readBookNumber);
  if (!number) throw new Error('Не найден идентификатор зачётной книжки');
  return hash(number);
}

export async function getBookIdentity(portal) {
  return bookIdentity(portal, await portal.open('/student/book/list'));
}

async function tables(portal, html, options) {
  const { sections, empty } = await portal.extract(html, readTables, options);
  if (!sections.length && empty) return [];
  if (!sections.length) throw new Error(`Не найдена таблица с полем «${options.expected[0]}»`);
  return sections;
}

async function readTrajectory(portal) {
  const path = '/student/trajectory';
  const html = await portal.open(path);
  let state = await portal.extract(html, trajectoryState);
  if (!state?.semesters.length) throw new Error('Не найдены семестры образовательной траектории');
  const order = state.semesters.map(semester => semester.label);
  const results = new Map();
  // Открытый семестр уже на странице; остальные — через selectSemester, как при нажатии
  const shown = order.find(label => state.footer.includes(label));
  if (shown) results.set(shown, state.rows);
  let livewire;
  for (const label of order) {
    if (results.has(label)) continue;
    const target = state.semesters.find(semester => semester.label === label);
    if (!target?.key || !target.component) throw new Error(`Семестр «${label}» нельзя выбрать`);
    livewire ??= await livewireSession(portal, html, path);
    const page = await livewire.dispatch(target.component, [{ type: 'callMethod', payload: { id: randomId(), method: 'selectSemester', params: [target.key] } }]);
    state = await portal.extract(page, trajectoryState);
    if (!state?.footer.includes(label)) throw new Error(`Не открылся семестр «${label}»`);
    results.set(label, state.rows);
  }
  return order.map(label => ({ title: label, columns: ['Дисциплина', 'Контроль, нагрузка и статус'], rows: results.get(label) }));
}

// Сессия: экзамены, зачёты и консультации из «Расписание → Список». Компонент schedule-student-main
// держит события месяца готовым списком (serverMemo.data.events); следующие месяцы — методом addMonth.
// Фильтры сайта («Экзамены (зачеты)» и другие) не трогаем: отбираем по типу события сами.
const sessionColumns = ['Дата', 'Время', 'Дисциплина', 'Вид', 'Аудитория', 'Преподаватель'];
const isSessionEvent = event => event.color === 'red' || /exam|test|credit|consult/i.test(event.code || '')
  || /экзам|зач[её]т|консультац|аттестац/i.test(event.groupType || '');
function sessionRow(event) {
  const teachers = Object.values(event.teachers && typeof event.teachers === 'object' ? event.teachers : {})
    .map(teacher => [teacher.last_name, teacher.first_name_one && `${teacher.first_name_one}.`, teacher.middle_name_one && `${teacher.middle_name_one}.`].filter(Boolean).join(' '))
    .filter(Boolean);
  const room = [event.classroom && `ауд. ${event.classroom}`, event.address].filter(Boolean).join(' · ');
  const time = [event.startTime, event.endTime].filter(Boolean).join('–');
  return [event.date || '', time, event.discipline || '', event.groupType || '', room || event.place || '', teachers.join(', ')];
}
async function readSession(portal, months = 3) {
  const path = '/schedule/students/list';
  const html = await portal.open(path);
  const livewire = await livewireSession(portal, html, path);
  const list = () => livewire.component('schedule-student-main');
  const first = list();
  if (!first || !Array.isArray(first.data.events)) throw new Error('Не найден список расписания');
  const events = [...first.data.events];
  for (let month = 1; month < months; month++) {
    await livewire.dispatch(first.id, [{ type: 'callMethod', payload: { id: randomId(), method: 'addMonth', params: [] } }]);
    const next = list()?.data.events;
    if (!Array.isArray(next)) throw new Error('Не удалось открыть следующий месяц расписания');
    events.push(...next);
  }
  const seen = new Set();
  const rows = events.filter(isSessionEvent)
    .filter(event => { const key = event.id_ext || `${event.date}|${event.startTime}|${event.discipline}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .map(sessionRow);
  return [{ columns: sessionColumns, rows }];
}

export async function collectCabinet(portal, identity, { onError } = {}) {
  const book = await portal.open('/student/book/list');
  if (await bookIdentity(portal, book) !== identity) throw new Error('Зачётная книжка принадлежит другой учётной записи');
  const views = [
    // Все курсы зачётки уже в HTML: переключает их Alpine на странице
    ['grades', () => tables(portal, book, { expected: ['Дисциплина', 'Результат'], semester: true })],
    ['session', () => readSession(portal)],
    ['orders', async () => tables(portal, await portal.open('/student/orders'), { expected: ['Номер приказа', 'Содержание'] })],
    ['plan', async () => {
      const rows = await portal.extract(await portal.open('/student/curriculum'), readPlan);
      if (!rows.length) throw new Error('Не найдены дисциплины учебного плана');
      return [{ columns: ['Индекс', 'Дисциплина', 'Часы', 'Период', 'Вид контроля'], rows }];
    }],
    ['trajectory', () => readTrajectory(portal)],
    ['profile', async () => {
      const rows = await portal.extract(await portal.open('/user/profile'), readProfile);
      if (!rows.length) throw new Error('Не найдены сведения профиля');
      return [{ columns: ['Поле', 'Значение'], rows }];
    }],
    // «Моя группа» — вкладка Alpine на рабочем столе, список уже в HTML. Берём все столбцы, которые показывает
    // сайт (ФИО, день рождения и т. п.) — для карточки одногруппника; столбец без заголовка (номер) не нужен.
    ['group', async () => (await tables(portal, await portal.open('/dashboard'), { expected: ['ФИО'] })).map(section => {
      const keep = section.columns.map((name, i) => (name ? i : -1)).filter(i => i >= 0);
      return { ...section, columns: keep.map(i => section.columns[i]), rows: section.rows.map(row => keep.map(i => row[i])) };
    })],
  ];
  const sections = {};
  const unavailable = [];
  for (const [key, read] of views) {
    try {
      sections[key] = await read();
    } catch (error) {
      if (error instanceof SessionExpired) throw error;
      onError?.(key, error);
      unavailable.push(key);
    }
  }
  if (unavailable.length === views.length) throw new Error('Не удалось прочитать разделы кабинета');
  return { sections, unavailable };
}
