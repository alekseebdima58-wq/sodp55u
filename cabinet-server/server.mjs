import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cabinetEvents, checkRelay, sendToBot } from './notify.mjs';
import { collectCabinet, openPortal, SessionExpired, signInToPortal, SignInFailed } from './portal.mjs';
import { openStore } from './state.mjs';

const snapshotPath = '/cabinet/v1/snapshot';
const loginPath = '/cabinet/v1/login';
const refreshPath = '/cabinet/v1/refresh';
const notifyPath = '/cabinet/v1/notify';
// Кнопка «Обновить» в приложении: сервер сразу идёт на сайт вуза, но не чаще раза в 30 минут на подключение
// Ручное обновление (свайп) — без ограничения по времени: каждый раз сразу на сайт вуза.
// Параллельно для одного подключения идёт только одно обновление.
export const manualRefreshInterval = 0;
const bearer = request => /^Bearer (\S+)$/.exec(request.headers.authorization || '')?.[1] || '';
// Как часто обновлять кабинет каждого подключения: обычно раз в 3 дня,
// в декабре и январе (зимняя сессия) — каждые 4 часа, чтобы новые оценки приходили сразу
export const refreshInterval = 3 * 24 * 60 * 60 * 1000;
export const sessionRefreshInterval = 4 * 60 * 60 * 1000;
const sessionMonths = new Set([11, 0]);   // декабрь, январь
export function refreshIntervalAt(time) {
  const month = new Date(time + 4 * 60 * 60 * 1000).getUTCMonth();   // по самарскому времени (UTC+4)
  return sessionMonths.has(month) ? sessionRefreshInterval : refreshInterval;
}
const dueCheckInterval = 5 * 60 * 1000;
// Сайт вуза не ответил (или ответил не всё) — не ждём 3 дня, а пробуем снова: через 15 минут, 30, час, 2 часа…
// но не реже обычного срока. Счётчик неудач подряд хранится в сессии и сбрасывается после удачного обновления.
export const retryDelays = [15, 30, 60, 120, 240].map(minutes => minutes * 60 * 1000);
export function retryDelay(failures, time) {
  const normal = refreshIntervalAt(time);
  return Math.min(normal, retryDelays[Math.min(Math.max(failures, 1), retryDelays.length) - 1]);
}

async function readJson(request, limit = 4096) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { request.resume(); return null; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

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

// Попытки входа. Вуз может заблокировать адрес сервера, если с него много раз вводят неверный пароль, поэтому:
// • не больше 2 входов одновременно и не два входа одного логина сразу;
// • 5 неверных паролей для одного логина за 15 минут — этот логин ждёт 15 минут;
// • 10 неверных паролей по всем логинам за 15 минут — вход для всех на паузе 15 минут;
// • не больше 30 попыток входа всего за 5 минут.
// Удачный вход неудачи этого логина обнуляет. Логины в памяти — только хешем.
export const signInLimits = { window: 15 * 60 * 1000, perLogin: 5, total: 10, burstWindow: 5 * 60 * 1000, burst: 30, parallel: 2 };
export function signInLimiter(now = Date.now, limits = signInLimits) {
  const failures = new Map();   // логин (хеш) → времена неудач
  let all = [];                 // времена неудач всех логинов
  let tries = [];               // времена всех попыток
  const active = new Set();
  const recent = (list, window) => list.filter(time => now() - time < window);
  const wait = (list, limit, window) => (list.length >= limit ? list[list.length - limit] + window - now() : 0);
  return login => {
    const id = createHash('sha256').update(login.toLowerCase()).digest('hex');
    all = recent(all, limits.window);
    tries = recent(tries, limits.burstWindow);
    const mine = recent(failures.get(id) || [], limits.window);
    if (mine.length) failures.set(id, mine); else failures.delete(id);
    const retryAfter = Math.max(wait(mine, limits.perLogin, limits.window), wait(all, limits.total, limits.window), wait(tries, limits.burst, limits.burstWindow));
    if (retryAfter > 0) return { blocked: true, retryAfter: Math.ceil(retryAfter / 1000) };
    if (active.size >= limits.parallel || active.has(id)) return { blocked: true, retryAfter: 5 };
    tries.push(now());
    active.add(id);
    return {
      blocked: false,
      // ok — пароль подошёл; false — неверный пароль; null — сайт вуза не ответил (не считаем)
      done(ok) {
        active.delete(id);
        if (ok === true) failures.delete(id);
        if (ok === false) { failures.set(id, [...(failures.get(id) || []), now()]); all.push(now()); }
      },
    };
  };
}

export function makeApi(store, allowedOrigins, { signIn, onConnected = () => {}, onRefresh, now = Date.now, limits = signInLimits } = {}) {
  const loginSlot = signInLimiter(now, limits);
  const refreshing = new Set();
  return createServer({ requestTimeout: 25000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    function send(status, body) {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    }
    const isLogin = request.url === loginPath;
    const isRefresh = request.url === refreshPath;
    const isNotify = request.url === notifyPath;
    const isPost = isLogin || isRefresh || isNotify;
    if (!isPost && request.url !== snapshotPath) return send(404, { error: 'not_found' });
    const origin = request.headers.origin;
    if ((isPost || origin) && !allowedOrigins.has(origin)) return send(403, { error: 'forbidden_origin' });
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS' && origin) {
      response.writeHead(204, { 'Access-Control-Allow-Methods': isPost ? 'POST, OPTIONS' : 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      return response.end();
    }
    if (request.method !== (isPost ? 'POST' : 'GET')) return send(405, { error: 'method_not_allowed' });
    if (isNotify) {
      // Приложение сообщает, куда слать уведомления о кабинете: {label, relay} или {label: ""} — не слать
      try {
        const account = await store.findByKey(bearer(request));
        if (!account) return send(401, { error: 'invalid_key' });
        const body = await readJson(request);
        if (!body || typeof body.label !== 'string') return send(400, { error: 'bad_request' });
        if (!body.label) {
          await store.setNotify(account.id, null);
          return send(200, { notify: false });
        }
        const relay = checkRelay(body.relay);
        if (!/^[0-9a-f]{64}$/.test(body.label) || !relay) return send(400, { error: 'bad_request' });
        await store.setNotify(account.id, { label: body.label, relay });
        return send(200, { notify: true });
      } catch (error) {
        return send(500, { error: 'unavailable' });
      }
    }
    if (isRefresh) {
      if (!onRefresh) return send(503, { error: 'unavailable' });
      try {
        const account = await store.findByKey(bearer(request));
        if (!account) return send(401, { error: 'invalid_key' });
        const { browserState, snapshot, lastAttemptAt } = await store.session(account);
        if (!browserState || snapshot.status === 'expired') return send(409, { error: 'expired' });
        // Ответ сразу; приложение ждёт новую копию через /snapshot (в ней изменится syncedAt)
        if (refreshing.has(account.id)) return send(202, { status: 'queued' });
        refreshing.add(account.id);
        Promise.resolve().then(() => onRefresh(account)).catch(() => {}).finally(() => refreshing.delete(account.id));
        return send(202, { status: 'queued' });
      } catch (error) {
        return send(500, { error: 'unavailable' });
      }
    }
    if (isLogin) {
      if (!signIn) return send(503, { error: 'portal_unavailable' });
      try {
        const key = bearer(request);
        const old = key ? await store.findByKey(key) : null;
        if (key && !old) return send(401, { error: 'invalid_key' });
        const credentials = await readCredentials(request);
        if (!credentials) return send(400, { error: 'bad_request' });
        const slot = loginSlot(credentials.login);
        if (slot.blocked) { credentials.password = ''; return send(429, { error: 'rate_limited', retryAfter: slot.retryAfter }); }
        let outcome = null;
        try {
          let signedIn;
          try { signedIn = await signIn(credentials); }
          catch (error) { if (error instanceof SignInFailed && error.code === 'invalid_credentials') outcome = false; throw error; }
          outcome = true;
          const { identity, browserState } = signedIn;
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
          slot.done(outcome);
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

export async function dueAccounts(store, accounts, now = Date.now()) {
  const due = [];
  for (const account of accounts ?? await store.accounts()) {
    if (!account || account.disabled) continue;
    const { browserState, snapshot, lastAttemptAt, failures = 0 } = await store.session(account);
    if (!browserState || snapshot.status === 'expired') continue;
    const previous = Date.parse(lastAttemptAt ?? (snapshot.status === 'pending' ? null : snapshot.syncedAt));
    const failed = failures > 0 && (snapshot.status === 'error' || snapshot.status === 'partial');
    const interval = failed ? retryDelay(failures, now) : refreshIntervalAt(now);
    if (!Number.isFinite(previous) || now - previous >= interval) due.push(account);
  }
  return due;
}

// portal — настройки клиента портала (в тестах — адрес макета); по умолчанию настоящий сайт вуза
export async function syncAll(store, portal = {}, accounts, now = Date.now, { notify = sendToBot } = {}) {
  for (const account of accounts ?? await store.accounts()) {
    const session = await store.session(account);
    const { browserState, snapshot } = session;
    if (!browserState || snapshot.status === 'expired') continue;
    const lastAttemptAt = new Date(now()).toISOString();
    if (!await store.saveSession(account, { ...session, lastAttemptAt })) continue;
    const client = openPortal({ ...portal, cookies: browserState.cookies });
    try {
      const { sections, unavailable } = await collectCabinet(client, account.identity);
      // Новые оценки и изменения сессии — уведомлением через бота (как изменения расписания)
      const events = snapshot.sections ? cabinetEvents(snapshot.sections, sections) : [];
      const target = (await store.find(account.id))?.notify;
      if (events.length && target) {
        try { await notify(target, events); } catch { console.error('Не удалось отправить уведомление о кабинете.'); }
      }
      // Сайт обновляет cookie сессии при каждом входе по «Запомнить меня» — сохраняем свежие
      await store.saveSession(account, {
        browserState: { cookies: client.cookies(), origins: [] },
        lastAttemptAt,
        // часть разделов не прочиталась — это тоже неудача: повторим скоро; всё прочиталось — счётчик сброшен
        ...(unavailable.length ? { failures: (session.failures || 0) + 1 } : {}),
        snapshot: {
          version: 1, status: unavailable.length ? 'partial' : 'ready', syncedAt: new Date().toISOString(),
          sections: { ...snapshot.sections, ...sections }, unavailable,
        },
      });
    } catch (error) {
      const expired = error instanceof SessionExpired;
      await store.saveSession(account, {
        browserState: expired ? null : { cookies: client.cookies(), origins: [] },
        lastAttemptAt,
        ...(expired ? {} : { failures: (session.failures || 0) + 1 }),
        snapshot: { ...snapshot, status: expired ? 'expired' : 'error' },
      });
      if (!expired) console.error('Не удалось обновить один из кабинетов. Последняя версия данных сохранена.');
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

async function serve(store) {
  const origins = new Set((process.env.CABINET_PWA_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));
  if (!origins.size || [...origins].some(origin => {
    const url = new URL(origin);
    return url.origin !== origin || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  })) throw new Error('Укажи CABINET_PWA_ORIGIN без пути, например https://example.github.io');
  const port = Number(process.env.CABINET_PORT || 8776);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный CABINET_PORT');
  let syncQueue = Promise.resolve();
  const queueSync = (run) => {
    const execution = syncQueue.then(run);
    syncQueue = execution.catch(() => {});
    return execution;
  };
  const syncDue = async (accounts) => {
    const due = await dueAccounts(store, accounts);
    if (due.length) await syncAll(store, {}, due);
  };
  const api = makeApi(store, origins, {
    signIn: credentials => signInToPortal(credentials),
    onConnected: id => {
      queueSync(async () => syncDue([await store.find(id)]))
        .catch(() => console.error('Не удалось запустить синхронизацию подключённого кабинета.'));
    },
    onRefresh: account => queueSync(() => syncAll(store, {}, [account]))
      .catch(() => console.error('Не удалось обновить кабинет по запросу.')),
  });
  api.listen(port, '127.0.0.1');
  const cancel = scheduleSync(() => queueSync(() => syncDue()), dueCheckInterval,
    () => console.error('Цикл синхронизации временно недоступен.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancel(); api.close(); });
  console.log(`Кабинет принимает запросы на 127.0.0.1:${port}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [command, id] = process.argv.slice(2);
  try {
    const store = await openStore();
    if (command === 'serve') await serve(store);
    else if (command === 'disable' && id) await store.disable(id);
    else throw new Error('Команды: serve, disable <идентификатор>');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
