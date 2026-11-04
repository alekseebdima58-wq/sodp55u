// Прогоняет все тесты приложения в одном браузере (BROWSER=chromium | webkit) и печатает итог.
// Код выхода 0 — всё прошло, 1 — есть провалы. Упавший тест перезапускается один раз:
// пара тестов чувствительна ко времени (быстрые броски пальцем), и один случайный промах — не поломка.
//   cd ci && BROWSER=webkit node run.mjs [только_эти.mjs ...]
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { BROWSER } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, "out"), { recursive: true });

const ratio = (out) => { const m = [...out.matchAll(/(?:ИТОГО\s+)?(\d+)\/(\d+)\s*$/gm)].pop(); return m ? { ok: +m[1], n: +m[2] } : null; };
const zero = (re) => (out) => { const m = re.exec(out); return m ? { ok: +m[1] === 0 ? 1 : 0, n: 1, note: m[0] } : null; };
const marks = (allow = 0) => (out) => { const y = (out.match(/✓/g) || []).length, x = (out.match(/✗/g) || []).length; return y + x ? { ok: x <= allow ? y + x : y, n: y + x, note: x ? `не прошло ${x}${allow ? ` (допускается ${allow})` : ""}` : "" } : null; };

const TESTS = [
  { f: "check_all.mjs", what: "все экраны, листание, раскрытие карточек", t: 900, w: 330 },
  { w: 40, f: "catch.mjs", what: "подхват ленты дней на лету" },
  { w: 60, f: "rapid.mjs", what: "три быстрых свайпа подряд", parse: marks() },
  // свайп за 30 мс на в 4 раза замедленном процессоре — известный предел и старой версии, один промах допустим
  { w: 70, f: "rapid4.mjs", what: "быстрые свайпы, процессор ×4 медленнее", parse: marks(1), only: "chromium" },
  { w: 40, f: "ncswipe.mjs", what: "свайп уведомления: открыть, удалить, передумать" },
  { f: "ncclose.mjs", what: "закрытие: красная кнопка не торчит", parse: zero(/полоской правее карточки:\s*(\d+)/) },
  { f: "ncjitter.mjs", what: "карточка не дрожит под пальцем", parse: zero(/шагов назад \(против движения пальца\)\s*(\d+)/) },
  // подтормаживание и точное время касаний задаются через протокол Chromium — в WebKit так не воспроизвести
  // v2.0: лента дней — родная прокрутка; занятость приложения её не останавливает (касания — через протокол Chromium)
  { w: 30, f: "native.mjs", what: "листание не ждёт приложение (поток занят 400 мс)", only: "chromium" },
  { w: 40, f: "flingjank.mjs", what: "быстрый бросок при подтормаживании не теряется", only: "chromium" },
  { w: 40, f: "edge.mjs", what: "свайп «назад» от края" },
  { f: "ptr.mjs", what: "«потяни — обновится» и разделение жестов" },
  { f: "ios26.mjs", what: "линза вкладок, заголовок, ползунок, круглая кнопка" },
  { w: 30, f: "cardglow.mjs", what: "свечение карточки не гаснет при раскрытии" },
  { f: "roomedit.mjs", what: "кнопка «Изменить кабинет» у владельца" },
  { w: 45, f: "onbtext.mjs", what: "знакомство при первом запуске, размер текста" },
  { w: 80, f: "misc.mjs", what: "разное: уведомления, статистика, проверки разметки" },
  { w: 70, f: "misc2.mjs", what: "заставка, видео установки, полноэкранный режим" },
  { f: "scripterr.mjs", what: "чужие «Script error.» не попадают в отчёты" },
  { w: 40, f: "v21.mjs", what: "v2.1: фон картинкой, неделя без перерисовки, слои перехода" },
  { w: 30, f: "ncempty.mjs", what: "пустой раздел уведомлений виден (после удаления последнего)" },
  { w: 60, f: "nowbug.mjs", what: "надпись «сейчас» не наезжает на время", args: ["8772", "out"] },
  { f: "monkey.mjs", what: "случайные жесты: ничего не ломается", args: ["out", "30"], parse: zero(/с нарушениями[^:]*:\s*(\d+)/), t: 1500, w: 240 },
];

function runOne(t) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [join("tests", t.f), ...(t.args || [])], { cwd: HERE, env: { ...process.env, BROWSER } });
    let out = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { out += "\nПРЕВЫШЕНО ВРЕМЯ"; p.kill("SIGKILL"); }, (t.t || 400) * 1000);
    p.on("close", () => { clearTimeout(timer); done(out); });
  });
}

const only = process.argv.slice(2);
// тесты с only: "chromium" управляют временем касаний и процессором через протокол Chromium;
// с подменными касаниями (WebKit или TOUCH=page) это не воспроизвести — такие тесты пропускаются
const CDP_TOUCH = BROWSER === "chromium" && process.env.TOUCH !== "page";
// SHARD=2/3 — только своя часть тестов: части примерно равны по времени (долгие — в разные части),
// GitHub гоняет их одновременно
const sh = /^(\d+)\/(\d+)$/.exec(process.env.SHARD || "");
const mine = new Set();
if (sh) {
  const k = +sh[1], N = +sh[2], load = Array(N).fill(0);
  const list = TESTS.filter((t) => !t.only || (t.only === BROWSER && CDP_TOUCH)).sort((a, b) => (b.w || 20) - (a.w || 20) || a.f.localeCompare(b.f));
  for (const t of list) { const i = load.indexOf(Math.min(...load)); load[i] += t.w || 20; if (i === k - 1) mine.add(t.f); }
  console.log(`часть ${k} из ${N}: ${[...mine].join(", ")}`);
}
const srv = await serve(8772);
const rows = [];
for (const t of TESTS) {
  if (only.length && !only.includes(t.f)) continue;
  if (sh && !mine.has(t.f)) continue;
  if (t.only && !(t.only === BROWSER && CDP_TOUCH)) { rows.push({ t, skip: true }); continue; }
  let out = "", r = null, tries = 0;
  for (tries = 1; tries <= 2; tries++) {
    out = await runOne(t);
    r = (t.parse || ratio)(out);
    if (r && r.ok === r.n) break;
  }
  const pass = !!(r && r.ok === r.n);
  rows.push({ t, r, pass, retried: tries > 1 && pass, fails: out.split("\n").filter((l) => /^FAIL|✗|Error|ПРЕВЫШЕНО|Timeout|exceeded|at .*\.mjs:\d+/.test(l)).slice(0, 10) });
  console.log(`${pass ? "✅" : "❌"} ${t.f.padEnd(15)} ${r ? `${r.ok}/${r.n}` : "нет итога"}${tries > 1 && pass ? " (со 2-й попытки)" : ""}  ${t.what}`);
  if (!pass) {
    const row = rows[rows.length - 1];
    const detail = row.fails.length ? row.fails : (!r ? out.split("\n").filter(Boolean).slice(-12) : []);
    if (detail.length) for (const l of detail) console.log("     " + l.slice(0, 220));
    else if (!r) console.log("     тест завершился без вывода: браузер не запустился или процесс был завершён");
  }
  // провал — ещё и «аннотацией» к прогону: её видно на странице проверки и через открытый API GitHub
  if (!pass && process.env.GITHUB_ACTIONS) {
    const esc = (v) => String(v).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    const body = (rows[rows.length - 1].fails.length ? rows[rows.length - 1].fails : out.split("\n").slice(-12)).map((l) => l.slice(0, 300)).join("\n");
    console.log(`::error title=${esc(`${BROWSER}: ${t.f}`)}::${esc(body)}`);
  }
}
srv.close();

const bad = rows.filter((x) => !x.skip && !x.pass);
console.log(`\n${BROWSER}${sh ? ` (часть ${sh[1]}/${sh[2]})` : ""}: ${bad.length ? `ПРОВАЛЕНО ${bad.length} из ${rows.filter((x) => !x.skip).length}` : "ВСЁ ПРОШЛО"}`);
// таблица в сводку GitHub Actions
if (process.env.GITHUB_STEP_SUMMARY) {
  let md = `### ${BROWSER === "webkit" ? "WebKit (движок iPhone)" : "Chromium"}${sh ? `, часть ${sh[1]}/${sh[2]}` : ""}: ${bad.length ? `❌ провалено ${bad.length}` : "✅ всё прошло"}\n\n| | Тест | Итог | Что проверяет |\n|---|---|---|---|\n`;
  for (const x of rows) md += `| ${x.skip ? "➖" : x.pass ? "✅" : "❌"} | ${x.t.f} | ${x.skip ? "только в Chromium" : x.r ? `${x.r.ok}/${x.r.n}${x.retried ? " (2-я попытка)" : ""}` : "нет итога"} | ${x.t.what} |\n`;
  for (const x of bad) md += `\n**${x.t.f}**\n\`\`\`\n${x.fails.join("\n")}\n\`\`\`\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
process.exit(bad.length ? 1 : 0);
