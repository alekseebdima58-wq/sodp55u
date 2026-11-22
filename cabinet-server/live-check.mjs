// Проверка на настоящем сайте вуза: один вход и чтение всех разделов.
// Печатает только количество строк в разделах — без оценок, ФИО и других данных. Ничего не сохраняет.
//   LK_LOGIN=… LK_PASSWORD=… node live-check.mjs
import { collectCabinet, openPortal, signInToPortal, SignInFailed } from './portal.mjs';

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
    if (key === 'group' && tables[0]) console.log(`  столбцы группы: ${tables[0].columns.join(', ')}`);
  }
  if (unavailable.length) {
    console.log(`Не прочитались: ${unavailable.join(', ')}`);
    process.exitCode = 1;
  } else console.log('Все разделы прочитаны.');
} catch (error) {
  console.error(error instanceof SignInFailed ? `Вход не удался: ${error.code}` : `Ошибка: ${error.message}`);
  process.exitCode = 1;
}
