import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { collectCabinet, getBookIdentity, portalOrigin, safeSession, SessionExpired } from './portal.mjs';
import { openStore } from './state.mjs';

export function makeApi(store, allowedOrigins) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    function send(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    }
    if (request.url !== '/cabinet/v1/snapshot') return send(404, { error: 'not_found' });
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return send(403, { error: 'forbidden_origin' });
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS' && origin) {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization' });
      return response.end();
    }
    if (request.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    try {
      const key = /^Bearer (\S+)$/.exec(request.headers.authorization || '')?.[1] || '';
      const account = await store.findByKey(key);
      if (!account) return send(401, { error: 'invalid_key' });
      const { snapshot } = await store.session(account);
      const current = await store.findByKey(key);
      if (!current || current.generation !== account.generation) return send(401, { error: 'invalid_key' });
      return send(200, snapshot);
    } catch (error) {
      return send(500, { error: 'unavailable' });
    }
  });
}

export function launchBrowser(headless = true) {
  const executablePath = process.env.CABINET_CHROMIUM_PATH || undefined;
  return chromium.launch({ headless, executablePath });
}

export async function syncAll(store, browser, prepareContext = async () => {}) {
  for (const account of await store.accounts()) {
    const { browserState, snapshot } = await store.session(account);
    if (!browserState || snapshot.status === 'expired') continue;
    const context = await browser.newContext({ storageState: browserState, viewport: { width: 1440, height: 900 } });
    try {
      await prepareContext(context);
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const sections = await collectCabinet(page, account.identity);
      const updatedState = safeSession(await context.storageState());
      await store.saveSession(account, {
        browserState: updatedState,
        snapshot: { version: 1, status: 'ready', syncedAt: new Date().toISOString(), sections },
      });
    } catch (error) {
      const expired = error instanceof SessionExpired;
      await store.saveSession(account, {
        browserState: expired ? null : browserState,
        snapshot: { ...snapshot, status: expired ? 'expired' : 'error' },
      });
      if (!expired) console.error('Не удалось обновить один из кабинетов. Последняя версия данных сохранена.');
    } finally {
      await context.close();
    }
  }
}

export function scheduleSync(run, interval, onError = () => {}) {
  let timer, cancelled = false;
  async function cycle() {
    try { await run(); }
    catch (error) { onError(error); }
    finally { if (!cancelled) timer = setTimeout(cycle, interval); }
  }
  cycle();
  return () => { cancelled = true; clearTimeout(timer); };
}

async function connect(store, id) {
  if (id) {
    const previous = await store.find(id);
    if (!previous || previous.disabled) throw new Error('Подключение не найдено');
  }
  const browser = await launchBrowser(false);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${portalOrigin}/login`, { waitUntil: 'domcontentloaded' });
    console.log('Войди на официальном сайте вуза в открывшемся окне Chromium.');
    await page.waitForURL(url => url.origin === portalOrigin && url.pathname === '/dashboard', { timeout: 300000 });
    const identity = await getBookIdentity(page);
    const storageState = safeSession(await context.storageState());
    if (!storageState.cookies.length) throw new Error('Сессия кабинета не сохранилась');
    if (id) {
      await store.reconnect(id, identity, storageState);
      console.log('Кабинет переподключён. Ключ PWA прежний.');
    } else {
      const account = await store.create(identity, storageState);
      console.log(`Идентификатор: ${account.id}\nКлюч подключения: ${account.key}`);
    }
  } finally {
    await browser.close();
  }
}

async function serve(store) {
  const origins = new Set((process.env.CABINET_PWA_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));
  if (!origins.size || [...origins].some(origin => {
    const url = new URL(origin);
    return url.origin !== origin || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  })) throw new Error('Укажи CABINET_PWA_ORIGIN без пути, например https://example.github.io');
  const port = Number(process.env.CABINET_PORT || 8776);
  const minutes = Number(process.env.CABINET_SYNC_MINUTES || 30);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
    throw new Error('Некорректный CABINET_PORT или CABINET_SYNC_MINUTES (5–1440 минут)');
  }
  let browser;
  const api = makeApi(store, origins);
  api.listen(port, '127.0.0.1');
  const cancel = scheduleSync(async () => {
    if (!browser?.isConnected()) browser = await launchBrowser();
    await syncAll(store, browser);
  }, minutes * 60000, () => console.error('Цикл синхронизации временно недоступен.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { cancel(); api.close(); await browser?.close(); });
  console.log(`Кабинет принимает запросы на 127.0.0.1:${port}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [command, id] = process.argv.slice(2);
  try {
    const store = await openStore();
    if (command === 'serve') await serve(store);
    else if (command === 'connect' || command === 'reconnect' && id) await connect(store, command === 'reconnect' ? id : null);
    else if (command === 'disable' && id) await store.disable(id);
    else throw new Error('Команды: serve, connect, reconnect <идентификатор>, disable <идентификатор>');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
