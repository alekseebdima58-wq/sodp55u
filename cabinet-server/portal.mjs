import { createHash } from 'node:crypto';

export const portalOrigin = 'https://newlk.samgups.ru';
export class SessionExpired extends Error {}

async function open(page, path) {
  const response = await page.goto(portalOrigin + path, { waitUntil: 'domcontentloaded' });
  const url = new URL(page.url());
  if (url.origin === portalOrigin && url.pathname === '/login') throw new SessionExpired();
  if (response?.status() === 401) throw new SessionExpired();
  if (url.origin !== portalOrigin || url.pathname !== path || !response?.ok()) {
    throw new Error(`Страница кабинета недоступна: ${path}`);
  }
}

function tableFromPage({ expected, columns, semester }) {
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('table')].flatMap(table => {
    const headings = [...(table.tHead?.rows[0]?.cells || table.querySelectorAll('thead th, thead td'))].map(text);
    if (!expected.every(label => headings.includes(label))) return [];
    const selected = columns || headings;
    const indices = selected.map(column => headings.indexOf(column));
    const minimumColumns = 1 + Math.max(...indices);
    const rows = [...table.tBodies].flatMap(body => [...body.rows]).filter(row => row.cells.length >= minimumColumns);
    let title = '';
    if (semester) {
      for (let node = table.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
        title = [...node.children].filter(child => !child.contains(table)).map(text).find(value => /^\d+\s+семестр$/i.test(value)) || '';
        if (title) break;
      }
    }
    return [{ title, columns: selected, rows: rows.map(row => indices.map(i => text(row.cells[i]))).filter(row => row.some(Boolean)) }];
  });
}

async function tables(page, expected, columns, semester = false) {
  const target = page.locator('table').filter({ has: page.getByText(expected[0], { exact: true }) }).first();
  const empty = page.getByText(/^Нет (данных(?: для отображения)?|приказов|записей|результатов)\.?$/i).first();
  await target.or(empty).first().waitFor({ state: 'attached' });
  const sections = await page.evaluate(tableFromPage, { expected, columns, semester });
  if (!sections.length && await empty.isVisible()) return [];
  if (!sections.length) throw new Error(`Не найдена таблица с полем «${expected[0]}»`);
  return sections;
}

async function bookIdentity(page) {
  const heading = await page.getByText(/^·?\s*Зач[её]тная книжка\s*№\s*\S+/i).first().textContent();
  const number = heading?.match(/№\s*([^·\r\n]+)/)?.[1].trim();
  if (!number) throw new Error('Не найден идентификатор зачётной книжки');
  return createHash('sha256').update(number).digest('hex');
}

async function readGrades(page) {
  const read = () => tables(page, ['Дисциплина', 'Результат'], undefined, true);
  const courseLinks = page.locator('nav a').filter({ hasText: /^\s*\d+\s+курс\s*$/i });
  const courses = [...new Set((await courseLinks.allTextContents()).map(label => label.trim()))];
  if (courses.length < 2) return read();

  const collected = new Map();
  const include = async () => {
    for (const section of await read()) collected.set(JSON.stringify(section), section);
  };
  await include();
  for (const course of courses) {
    const button = courseLinks.filter({ hasText: new RegExp(`^\\s*${course}\\s*$`) }).filter({ visible: true }).first();
    if (!(await button.count())) continue;
    const firstVisible = page.locator('table:visible').filter({ has: page.getByText('Дисциплина', { exact: true }) }).first();
    const before = await firstVisible.textContent().catch(() => null);
    await button.click();
    const changed = await page.waitForFunction(previous => {
      const table = [...document.querySelectorAll('table')].find(node => node.getClientRects().length && node.tHead?.textContent.includes('Дисциплина'));
      return table && table.textContent !== previous;
    }, before, { timeout: 2500 }).then(() => true, () => false);
    if (changed) await include();
  }
  return [...collected.values()];
}

async function readPlan(page) {
  await page.getByText('Название дисциплины', { exact: true }).first().waitFor({ state: 'attached' });
  const rows = await page.evaluate(() => {
    const clean = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
    const lessons = new Map();
    for (const row of document.querySelectorAll('[class~="xl:block"] > div.flex.items-center')) {
      const [index, subject, , hours, period, assessment] = [...row.children].map(clean);
      if (!/^[А-ЯA-Z]+\d*(?:\.[А-ЯA-Z0-9]+)*\.\d+$/u.test(index || '') || !subject) continue;
      lessons.set(index, [index, subject, hours, period, assessment]);
    }
    return [...lessons.values()];
  });
  if (!rows.length) throw new Error('Не найдены дисциплины учебного плана');
  return [{ columns: ['Индекс', 'Дисциплина', 'Часы', 'Период', 'Вид контроля'], rows }];
}

async function readTrajectory(page) {
  const nav = page.locator('.scroll-tandem-trajectory');
  await nav.waitFor({ state: 'attached' });
  const labels = await nav.evaluate(node => [...node.children].map(value => value.textContent.trim().replace(/\s+/g, ' '))
    .filter(value => /^\d{4}\/\d{4}\s*\((зимний|летний)\)$/i.test(value)));
  if (!labels.length) throw new Error('Не найдены семестры образовательной траектории');
  const sections = [];
  for (const label of labels) {
    const link = nav.getByRole('link', { name: label, exact: true });
    if (await link.count()) await link.click();
    await page.waitForFunction(expected => {
      const panel = document.querySelector('.scroll-tandem-trajectory')?.nextElementSibling;
      const footer = panel?.children[1];
      return footer?.textContent.replace(/\s+/g, ' ').includes(expected);
    }, label);
    const rows = await nav.evaluate(node => {
      const text = child => (child?.textContent || '').replace(/\s+/g, ' ').trim();
      const panel = node.nextElementSibling;
      const main = panel?.firstElementChild;
      const rows = [...(main?.children || [])].flatMap(block => {
        const parts = [...block.children];
        const subject = text(parts[0]);
        if (!subject || parts.length < 2) return [];
        const description = parts.slice(1).map(text).filter(Boolean).join(' · ');
        return [[subject, description]];
      });
      const status = text(panel?.children[1]?.lastElementChild);
      if (status) rows.push(['Статус семестра', status]);
      return rows;
    });
    sections.push({ title: label, columns: ['Дисциплина', 'Контроль, нагрузка и статус'], rows });
  }
  return sections;
}

async function readProfile(page) {
  await page.getByText('Направление подготовки', { exact: true }).first().waitFor({ state: 'attached' });
  const rows = await page.evaluate(() => {
    const clean = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
    const fields = ['Курс', 'Группа', 'Учебная группа', 'Направление подготовки', 'Форма обучения', 'Институт', 'Факультет', 'Подразделение', 'Квалификация'];
    const result = new Map();
    const account = [...document.querySelectorAll('a[href$="/user/profile"]')].find(node => node.getClientRects().length);
    const name = account?.getAttribute('aria-label') || account?.getAttribute('title') || clean(account) || account?.querySelector('img')?.getAttribute('alt');
    if (name) result.set('Имя', name);
    for (const node of document.querySelectorAll('div, dt')) {
      const label = clean(node);
      if (!fields.includes(label) || node.children.length || !node.getClientRects().length) continue;
      const value = clean(node.nextElementSibling);
      if (value) result.set(label, value);
    }
    if (!result.has('Группа') && !result.has('Учебная группа')) {
      const role = [...document.querySelectorAll('a,button')].map(clean).find(label => /^Студент\s*\|\s*[^\s]+$/i.test(label));
      if (role) result.set('Группа', role.split('|').pop().trim());
    }
    return [...result];
  });
  if (!rows.length) throw new Error('Не найдены сведения профиля');
  return [{ columns: ['Поле', 'Значение'], rows }];
}

export function safeSession(state) {
  return {
    cookies: state.cookies.filter(cookie => /^(?:\.?newlk\.samgups\.ru|\.?samgups\.ru)$/i.test(cookie.domain)),
    origins: state.origins.filter(entry => entry.origin === portalOrigin),
  };
}

export async function getBookIdentity(page) {
  await open(page, '/student/book/list');
  return bookIdentity(page);
}

export async function collectCabinet(page, identity) {
  await open(page, '/student/book/list');
  if (await bookIdentity(page) !== identity) throw new Error('Зачётная книжка принадлежит другой учётной записи');
  const views = [
    ['grades', null, () => readGrades(page)],
    ['orders', '/student/orders', () => tables(page, ['Номер приказа', 'Содержание'])],
    ['plan', '/student/curriculum', () => readPlan(page)],
    ['trajectory', '/student/trajectory', () => readTrajectory(page)],
    ['profile', '/user/profile', () => readProfile(page)],
    ['group', '/dashboard', async () => {
      await page.getByRole('link', { name: 'Моя группа', exact: true }).click();
      return tables(page, ['ФИО'], ['ФИО']);
    }],
  ];
  const sections = {};
  const unavailable = [];
  for (const [key, path, read] of views) {
    try {
      if (path) await open(page, path);
      sections[key] = await read();
    } catch (error) {
      if (error instanceof SessionExpired) throw error;
      unavailable.push(key);
    }
  }
  if (unavailable.length === views.length) throw new Error('Не удалось прочитать разделы кабинета');
  return { sections, unavailable };
}
