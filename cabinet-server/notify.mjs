import { createHash, createHmac, randomBytes } from 'node:crypto';

// Уведомления о кабинете идут через бота — тем же путём, что изменения расписания.
// Приложение передаёт серверу метку label = HMAC(личный ключ уведомлений, "cabinet") и адрес канала бота (ntfy).
// Сервер после обновления кабинета кладёт в канал сообщение {q:"cab", u, n, t, c, h}:
//   u — sha256(label)[:16] (по нему бот находит чат), c — события, зашифрованные потоком из sha256(label|n),
//   h — HMAC(label, "cab|t|n|" + c). Сам личный ключ сервер не знает; бот вычисляет label из него сам.

const clip = (value, n = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const b64u = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function keystreamXor(secret, data) {
  const key = createHash('sha256').update(Buffer.concat([secret, Buffer.from('enc')])).digest();
  const out = Buffer.alloc(data.length);
  for (let i = 0; i * 32 < data.length; i++) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(i);
    const block = createHash('sha256').update(Buffer.concat([key, counter])).digest();
    for (let j = 0; j < 32 && i * 32 + j < data.length; j++) out[i * 32 + j] = data[i * 32 + j] ^ block[j];
  }
  return out;
}

export function buildBotMessage(labelHex, items, now = Date.now()) {
  const label = Buffer.from(labelHex, 'hex');
  const nonce = randomBytes(8).toString('hex');
  const plain = Buffer.from(JSON.stringify({ items }));
  const cipher = keystreamXor(createHash('sha256').update(Buffer.concat([label, Buffer.from(nonce)])).digest(), plain);
  const h = createHmac('sha256', label).update(Buffer.concat([Buffer.from(`cab|${now}|${nonce}|`), cipher])).digest('hex');
  const u = createHash('sha256').update(label).digest('hex').slice(0, 16);
  return { q: 'cab', u, n: nonce, t: now, c: b64u(cipher), h };
}

// Канал бота — только https на разрешённом хосте (по умолчанию ntfy.sh) и имя канала, без пути и параметров
export function checkRelay(value, hosts = (process.env.CABINET_RELAY_HOSTS || 'ntfy.sh').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)) {
  try {
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (!hosts.includes(url.host.toLowerCase()) || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/[A-Za-z0-9_-]{16,64}$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

// Что изменилось в кабинете с прошлого обновления: новые оценки и новые или перенесённые события сессии.
// Первое обновление (прошлых данных нет) ничего не присылает.
export function cabinetEvents(before, after) {
  const events = [];
  const col = (section, name) => section.columns.indexOf(name);
  const grades = sections => new Map((sections || []).flatMap(section => section.rows.map(row => {
    const get = name => row[col(section, name)] ?? '';
    return [`${section.title}|${get('Дисциплина')}|${get('Форма контроля')}`, { s: get('Дисциплина'), r: get('Результат'), f: get('Форма контроля'), m: section.title, d: get('Дата') }];
  })));
  if (Array.isArray(before?.grades) && Array.isArray(after?.grades)) {
    const old = grades(before.grades);
    for (const [key, grade] of grades(after.grades)) {
      if (grade.r && old.get(key)?.r !== grade.r) events.push({ k: 'grade', s: clip(grade.s), r: clip(grade.r, 40), f: clip(grade.f, 40), m: clip(grade.m, 40), d: clip(grade.d, 20) });
    }
  }
  const session = sections => new Map((sections || []).flatMap(section => section.rows.map(row => {
    const [d, t, s, v, a] = row;
    return [`${s}|${v}`, { s, v, d, t, a }];
  })));
  if (Array.isArray(before?.session) && Array.isArray(after?.session)) {
    const old = session(before.session);
    for (const [key, item] of session(after.session)) {
      const was = old.get(key);
      if (was && was.d === item.d && was.t === item.t && was.a === item.a) continue;
      const moved = was ? [was.d, was.t, was.a].filter(Boolean).join(' · ') : '';
      events.push({ k: 'exam', s: clip(item.s), v: clip(item.v, 40), d: clip(item.d, 20), t: clip(item.t, 20), a: clip(item.a, 80), ...(moved ? { o: clip(moved, 120) } : {}) });
    }
  }
  return events.slice(0, 20);
}

export async function sendToBot(notify, items, { fetch: send = globalThis.fetch, now = Date.now() } = {}) {
  const relay = checkRelay(notify?.relay);
  if (!relay || !/^[0-9a-f]{64}$/.test(notify?.label || '') || !items.length) return false;
  const response = await send(relay, { method: 'POST', body: JSON.stringify(buildBotMessage(notify.label, items, now)), signal: AbortSignal.timeout(15000) });
  return response.ok;
}
