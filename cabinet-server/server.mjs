import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { collectCabinet, getBookIdentity, portalOrigin, safeSession, SessionExpired, signInToPortal, SignInFailed } from './portal.mjs';
import { openStore } from './state.mjs';

const snapshotPath = '/cabinet/v1/snapshot';
const loginPath = '/cabinet/v1/login';
const bearer = request => /^Bearer (\S+)$/.exec(request.headers.authorization || '')?.[1] || '';
const refreshInterval = 21 * 24 * 60 * 60 * 1000;
const dueCheckInterval = 5 * 60 * 1000;

async function readCredentials(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8192) { request.resume(); return null; }
    chunks.push(chunk);
  }
  try {
    const { login, password } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const username = typeof login === 'string' ? login.trim() : '';
    if (!username || username.length > 256 || typeof password !== 'string' || !password || password.length > 1024) return null;
    return { login: username, password };
  } catch { return null; }
}

function signInLimiter() {
  let windowEnd = 0, attempts = 0;
  const users = new Map();
  const active = new Set();
  return login => {
    const now = Date.now();
    if (now >= windowEnd) { windowEnd = now + 300000; attempts = 0; users.clear(); }
    const id = createHash('sha256').update(login.toLowerCase()).digest('hex');
    const tries = users.get(id) || 0;
    if (active.size >= 2 || active.has(id) || tries >= 5 || attempts >= 30) return null;
    attempts++;
    users.set(id, tries + 1);
    active.add(id);
    return () => active.delete(id);
  };
}

export function makeApi(store, allowedOrigins, { signIn, onConnected = () => {} } = {}) {
  const loginSlot = signInLimiter();
  return createServer({ requestTimeout: 25000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    function send(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    }
    const isLogin = request.url === loginPath;
    if (!isLogin && request.url !== snapshotPath) return send(404, { error: 'not_found' });
    const origin = request.headers.origin;
    if ((isLogin || origin) && !allowedOrigins.has(origin)) return send(403, { error: 'forbidden_origin' });
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS' && origin) {
      response.writeHead(204, { 'Access-Control-Allow-Methods': isLogin ? 'POST, OPTIONS' : 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      return response.end();
    }
    if (request.method !== (isLogin ? 'POST' : 'GET')) return send(405, { error: 'method_not_allowed' });
    if (isLogin) {
      if (!signIn) return send(503, { error: 'portal_unavailable' });
      try {
        const key = bearer(request);
        const old = key ? await store.findByKey(key) : null;
        if (key && !old) return send(401, { error: 'invalid_key' });
        const credentials = await readCredentials(request);
        if (!credentials) return send(400, { error: 'bad_request' });
        const release = loginSlot(credentials.login);
        if (!release) return send(429, { error: 'rate_limited' });
        try {
          const { identity, browserState } = await signIn(credentials);
          if (old && old.identity !== identity) return send(409, { error: 'different_account' });
          let connection;
          if (old) {
            await store.reconnect(old.id, identity, browserState);
            connection = { id: old.id, key };
          } else connection = await store.create(identity, browserState);
          const current = await store.find(connection.id);
          const { snapshot } = await store.session(current);
          onConnected(connection.id);
          return send(200, { key: connection.key, snapshot });
        } finally {
          credentials.password = '';
          release();
        }
      } catch (error) {
        const code = error instanceof SignInFailed ? error.code : 'portal_unavailable';
        const status = { invalid_credentials: 401, interaction_required: 422, rate_limited: 429 }[code] || 503;
        return send(status, { error: code });
      }
    }
    try {
      const key = bearer(request);
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

export async function dueAccounts(store, accounts, now = Date.now()) {
  const due = [];
  for (const account of accounts ?? await store.accounts()) {
    if (!account || account.disabled) continue;
    const { browserState, snapshot, lastAttemptAt } = await store.session(account);
    if (!browserState || snapshot.status === 'expired') continue;
    const previous = Date.parse(lastAttemptAt ?? (snapshot.status === 'pending' ? null : snapshot.syncedAt));
    if (!Number.isFinite(previous) || now - previous >= refreshInterval) due.push(account);
  }
  return due;
}

export async function syncAll(store, browser, prepareContext = async () => {}, accounts) {
  for (const account of accounts ?? await store.accounts()) {
    const session = await store.session(account);
    const { browserState, snapshot } = session;
    if (!browserState || snapshot.status === 'expired') continue;
    const lastAttemptAt = new Date().toISOString();
    if (!await store.saveSession(account, { ...session, lastAttemptAt })) continue;
    let context;
    try {
      context = await browser.newContext({ storageState: browserState, viewport: { width: 1440, height: 900 } });
      await prepareContext(context);
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const { sections, unavailable } = await collectCabinet(page, account.identity);
      const updatedState = safeSession(await context.storageState());
      await store.saveSession(account, {
        browserState: updatedState,
        lastAttemptAt,
        snapshot: {
          version: 1, status: unavailable.length ? 'partial' : 'ready', syncedAt: new Date().toISOString(),
          sections: { ...snapshot.sections, ...sections }, unavailable,
        },
      });
    } catch (error) {
      const expired = error instanceof SessionExpired;
      await store.saveSession(account, {
        browserState: expired ? null : browserState,
        lastAttemptAt,
        snapshot: { ...snapshot, status: expired ? 'expired' : 'error' },
      });
      if (!expired) console.error('Не удалось обновить один из кабинетов. Последняя версия данных сохранена.');
    } finally {
      await context?.close();
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
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный CABINET_PORT');
  let browser, starting;
  const getBrowser = async () => {
    if (browser?.isConnected()) return browser;
    if (!starting) starting = launchBrowser().then(instance => { browser = instance; return instance; }).finally(() => { starting = null; });
    return starting;
  };
  let syncQueue = Promise.resolve();
  const queueSync = (run) => {
    const execution = syncQueue.then(run);
    syncQueue = execution.catch(() => {});
    return execution;
  };
  const syncDue = async (accounts) => {
    const due = await dueAccounts(store, accounts);
    if (due.length) await syncAll(store, await getBrowser(), undefined, due);
  };
  const api = makeApi(store, origins, {
    signIn: async credentials => signInToPortal(await getBrowser(), credentials),
    onConnected: id => {
      queueSync(async () => syncDue([await store.find(id)]))
        .catch(() => console.error('Не удалось запустить синхронизацию подключённого кабинета.'));
    },
  });
  api.listen(port, '127.0.0.1');
  const cancel = scheduleSync(() => queueSync(() => syncDue()), dueCheckInterval,
    () => console.error('Цикл синхронизации временно недоступен.'));
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
