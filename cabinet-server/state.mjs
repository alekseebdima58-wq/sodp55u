import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const accountPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const pending = () => ({ version: 1, status: 'pending', syncedAt: null, sections: null });

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function openStore(location = process.env.CABINET_STATE_DIR || join(homedir(), '.local', 'state', 'sodp55u-cabinet')) {
  const dir = resolve(location);
  await mkdir(dir, { mode: 0o700, recursive: true });
  await chmod(dir, 0o700);
  const accountFile = id => join(dir, id, 'account.json');
  const sessionFile = account => join(dir, account.id, `${account.generation}.json`);
  const find = async id => accountPattern.test(id) ? readJson(accountFile(id)) : null;

  return {
    async accounts() {
      const accounts = await Promise.all((await readdir(dir)).map(find));
      return accounts.filter(account => account && !account.disabled);
    },
    find,
    async findByKey(key) {
      const id = /^sc_([a-f0-9-]{36})\.[\w-]{43}$/.exec(key)?.[1];
      const account = id && await find(id);
      if (!account || account.disabled || !/^[a-f0-9]{64}$/.test(account.keyHash)) return null;
      return timingSafeEqual(Buffer.from(account.keyHash, 'hex'), Buffer.from(digest(key), 'hex')) ? account : null;
    },
    async create(identity, browserState) {
      const id = randomUUID();
      const key = `sc_${id}.${randomBytes(32).toString('base64url')}`;
      const account = { id, identity, keyHash: digest(key), generation: randomUUID() };
      await mkdir(join(dir, id), { mode: 0o700 });
      await writeJson(sessionFile(account), { browserState, snapshot: pending() });
      await writeJson(accountFile(id), account);
      return { id, key };
    },
    async reconnect(id, identity, browserState) {
      const account = await find(id);
      if (!account || account.disabled || account.identity !== identity) throw new Error('Подключение отсутствует или выбрана другая учётная запись');
      const old = await this.session(account);
      const next = { ...account, generation: randomUUID() };
      await writeJson(sessionFile(next), { browserState, snapshot: { ...old.snapshot, status: 'pending' } });
      await writeJson(accountFile(id), next);
      await rm(sessionFile(account), { force: true });
    },
    async disable(id) {
      const account = await find(id);
      if (!account || account.disabled) throw new Error('Подключение не найдено');
      await writeJson(accountFile(id), { ...account, disabled: true });
      await rm(sessionFile(account), { force: true });
    },
    async session(account) {
      return readJson(sessionFile(account), { browserState: null, snapshot: pending() });
    },
    async saveSession(account, value) {
      const current = await find(account.id);
      if (!current || current.disabled || current.generation !== account.generation) return;
      const file = sessionFile(account);
      await writeJson(file, value);
      const latest = await find(account.id);
      if (!latest || latest.disabled || latest.generation !== account.generation) await rm(file, { force: true });
    },
  };
}
