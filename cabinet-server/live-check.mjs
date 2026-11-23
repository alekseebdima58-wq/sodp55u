// Проверка на настоящем сайте вуза: один вход и чтение всех разделов.
// Печатает только количество строк в разделах — без оценок, ФИО и других данных. Ничего не сохраняет.
//   LK_LOGIN=… LK_PASSWORD=… node live-check.mjs
import { collectCabinet, isSessionEvent, openPortal, readExamFilterEvents, readScheduleEvents, signInToPortal, SignInFailed } from './portal.mjs';

const login = process.env.LK_LOGIN;
const password = process.env.LK_PASSWORD;
if (!login || !password) {
  console.error('Укажи LK_LOGIN и LK_PASSWORD');
  process.exit(2);
}

try {
  const started = Date.now();
  const { identity, browserState } = await signInToPortal({ login, password });
  const names = browserState.cookies.map(cookie => cookie.name.replace(/^remember_web_.*/, 'remember_web_…'));
  console.log(`Вход: успешно за ${Date.now() - started} мс`);
  console.log(`Cookie: ${names.join(', ')}`);
  console.log(`«Запомнить меня»: ${names.includes('remember_web_…') ? 'выдан' : 'НЕ выдан — фоновое обновление работать не будет'}`);

  const portal = openPortal({ cookies: browserState.cookies });
  const { sections, unavailable } = await collectCabinet(portal, identity, {
    onError: (key, error) => console.log(`${key}: ошибка — ${error.message}`),
  });
  for (const [key, tables] of Object.entries(sections)) {
    const parts = tables.map(table => `${table.title || 'без заголовка'}: ${table.rows.length} стр.`);
    console.log(`${key}: ${tables.length} табл. — ${parts.join('; ') || 'пусто'}`);
    if (key === 'group' && tables[0]) {
      console.log(`  столбцы группы: ${tables[0].columns.join(', ')}`);
      // Только количество заполненных значений, без самих данных
      tables[0].columns.forEach((name, i) => console.log(`    ${name || '(без названия)'}: заполнено ${tables[0].rows.filter(row => String(row[i] ?? '').trim()).length} из ${tables[0].rows.length}`));
    }
  }
  // Виды событий в расписании на полгода вперёд: как их называет сайт и что попадает в «Сессию».
  // Печатаются только вид, код и цвет события — без дисциплин, преподавателей и дат.
  try {
    const events = await readScheduleEvents(portal, 6);
    const kinds = new Map();
    for (const event of events) {
      const key = `${event.groupType || '(без вида)'} · код ${event.code || '—'} · цвет ${event.color || '—'}`;
      const item = kinds.get(key) || { count: 0, session: isSessionEvent(event) };
      item.count++;
      kinds.set(key, item);
    }
    console.log(`Расписание на 6 месяцев: ${events.length} событий, видов — ${kinds.size}`);
    for (const [key, { count, session }] of [...kinds].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${session ? '[сессия]' : '        '} ${key}: ${count}`);
    }
    const inSession = [...kinds.values()].filter(item => item.session).reduce((sum, item) => sum + item.count, 0);
    console.log(inSession ? `В «Сессию» попадает ${inSession} событий.` : 'Экзаменов и зачётов в расписании пока нет (или они названы иначе — пришли этот список).');
  } catch (error) {
    console.log(`Виды событий расписания: ошибка — ${error.message}`);
  }
  // Фильтр сайта «Экзамены (зачеты)»: если он есть, сервер берёт экзамены по нему, а не только по названию
  try {
    const filter = await readExamFilterEvents(portal, 3);
    console.log(filter
      ? `Фильтр сайта «Экзамены (зачеты)»: работает (${filter.source}, ${filter.mode === 'only' ? 'показывает только экзамены' : 'добавляет экзамены'}), событий: ${filter.events.length}`
      : 'Фильтр сайта «Экзамены (зачеты)»: не найден или ничего не меняет сейчас — экзамены распознаются по виду, цвету и коду');
  } catch (error) {
    console.log(`Фильтр сайта «Экзамены (зачеты)»: ошибка — ${error.message}`);
  }
  if (unavailable.length) {
    console.log(`Не прочитались: ${unavailable.join(', ')}`);
    process.exitCode = 1;
  } else console.log('Все разделы прочитаны.');
} catch (error) {
  console.error(error instanceof SignInFailed ? `Вход не удался: ${error.code}` : `Ошибка: ${error.message}`);
  process.exitCode = 1;
}
