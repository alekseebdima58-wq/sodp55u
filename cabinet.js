(() => {
  "use strict";

  // Личный кабинет собирается из тех же деталей, что и остальное приложение: шапка экрана,
  // карточка с аватаром, блок с кольцом, списки со стрелкой и переход вглубь с кнопкой «назад».
  // Общие помощники приложение отдаёт через window.sodp (index.html).
  const connectionKey = "student-cabinet-connection";
  const keyPattern = /^sc_[\da-f-]{36}\.[\w-]{43}$/;
  const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const pages = [
    // id, название, адрес на сайте вуза, оттенок значка, значок
    ["session", "Сессия", "schedule", 4, "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 15l2 2 4-4"],
    ["grades", "Зачётка", "student/book/list", 150, "M5 4h14v16H5a2 2 0 0 1 0-4h14M5 4a2 2 0 0 0-2 2v12M8 10l2 2 4-4"],
    ["trajectory", "Траектория", "student/trajectory", 32, "M4 18l6-6 4 4 6-9m-5 0h5v5"],
    ["plan", "Учебный план", "student/curriculum", 214, "M8 4h12M8 9h12M8 14h12M8 19h12M4 4h.01M4 9h.01M4 14h.01M4 19h.01"],
    ["group", "Моя группа", "dashboard", 268, "M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m0-17a4 4 0 0 1 0 8m2 3a4 4 0 0 1 3 4v2"],
    ["orders", "Приказы", "student/orders", 338, "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"],
    ["profile", "Профиль", "user/profile", 188, "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"],
  ];
  const listed = ["session", "grades", "trajectory", "plan", "group", "orders"];
  const icons = {
    refresh: svg("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5", 18),
    ext: svg("M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", 18),
    chev: svg("m9 18 6-6-6-6", 18),
    left: svg("m15 18-6-6 6-6", 20),
    out: svg("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9", 20),
    lock: svg("M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4", 28),
    wifi: svg("M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0M2 2l20 20", 28),
    empty: svg("M4 7h16M4 12h10M4 17h7", 28),
    search: svg("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.5-3.5", 18),
    check: svg("m5 12 5 5 9-10", 14),
    copy: svg("M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM16 8V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3", 16),
  };
  const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Samara" });

  let root, request, page = "home", pageArg = "", searchText = "", refreshing = false;
  let connection = readConnection();
  let data = null;
  let reauthenticating = false;

  // ---------- помощники приложения (с запасным вариантом, если кабинет открыт отдельно) ----------
  const app = () => window.sodp || {};
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hue = (name) => (app().hue ? app().hue(name) : 214);
  const initials = (name) => (app().initials ? app().initials(name) : String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
  const haptic = (kind) => { try { app().haptic?.(kind); } catch (e) { /* без вибрации */ } };
  const ago = (iso) => {
    try { if (app().fmtAgo) return app().fmtAgo(iso); } catch (e) { /* ниже — запасной вариант */ }
    const t = Date.parse(iso); return Number.isFinite(t) ? dateFormat.format(t) : "";
  };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const shortDate = (value) => {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value || "").trim());
    return m ? `${+m[1]} ${MONTHS[+m[2] - 1] || ""} ${m[3]}` : String(value || "");
  };
  const dateKey = (value) => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value || "").trim()); return m ? `${m[3]}${m[2].padStart(2, "0")}${m[1].padStart(2, "0")}` : ""; };

  // ---------- подключение к серверу кабинета ----------
  function endpoint(address, method = "snapshot") {
    const url = new URL(address);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
      throw new Error("Укажи HTTPS-адрес сервера подключения.");
    }
    return new URL(`${url.pathname.replace(/\/$/, "")}/cabinet/v1/${method}`, url.origin).href;
  }
  async function configuredServer() {
    const config = await fetch(new URL("cabinet-config.json", document.baseURI), {
      cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(6000),
    });
    if (!config.ok) throw new Error();
    const { server } = await config.json();
    if (!server) throw new Error();
    endpoint(server, "login");
    return server;
  }
  function readConnection() {
    try {
      const saved = JSON.parse(localStorage.getItem(connectionKey));
      if (saved?.key && saved?.address) return { ...saved, url: endpoint(saved.address) };
    } catch (error) { /* вход останется доступен без сохранённого подключения */ }
    return null;
  }
  function setConnection(value) {
    request?.abort();
    request = null;
    data = null;
    connection = value;
    reauthenticating = false;
    try {
      if (value) localStorage.setItem(connectionKey, JSON.stringify({ address: value.address, key: value.key }));
      else localStorage.removeItem(connectionKey);
    } catch (error) { /* хранение ключа может быть отключено в браузере */ }
  }
  async function getSnapshot(config, signal) {
    let response;
    try {
      response = await fetch(config.url, {
        cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${config.key}` }, signal,
      });
    } catch (failure) { throw new Error("Не удалось связаться с сервером.", { cause: failure }); }
    if (response.status === 401) throw new Error("Ключ подключения недействителен.");
    if (!response.ok) throw new Error("Сервер пока не может предоставить данные.");
    const result = await response.json().catch(() => null);
    if (result?.version !== 1) throw new Error("Сервер вернул данные в неизвестном формате.");
    return result;
  }

  // ---------- данные для экранов ----------
  const sections = (id) => (Array.isArray(data?.sections?.[id]) ? data.sections[id] : null);
  const col = (section, name) => section.columns.indexOf(name);
  function markKind(value) {
    const s = String(value || "").trim().toLowerCase();
    if (/^(отлично|5|зачтено|зачет|зачёт)$/.test(s)) return "good";
    if (/^(хорошо|4)$/.test(s)) return "ok";
    if (/^(удовлетворительно|удовл\.?|3)$/.test(s)) return "mid";
    if (/^(неудовлетворительно|неуд\.?|2|не зачтено|незачет|незачёт|неявка|не явился)$/.test(s)) return "bad";
    return s ? "other" : "";
  }
  const SCORE = { good: 5, ok: 4, mid: 3, bad: 2 };
  const markClass = { good: "k-lec", ok: "k-oth", mid: "k-prac", bad: "cab-bad", other: "cab-neutral" };
  function gradeRows() {
    return (sections("grades") || []).flatMap((section) => {
      const [d, f, dt, r, t, h, z] = ["Дисциплина", "Форма контроля", "Дата", "Результат", "Преподаватель", "Часы", "Зач. ед."].map((n) => col(section, n));
      return section.rows.map((row) => ({
        semester: section.title, subject: row[d] || row[0] || "—", form: row[f] || "", date: row[dt] || "", result: row[r] || "",
        teacher: row[t] || "", hours: row[h] || "", units: row[z] || "",
      }));
    });
  }
  function average(rows) {
    const numeric = rows.map((row) => String(row.result).trim().toLowerCase())
      .map((s) => ({ отлично: 5, хорошо: 4, удовлетворительно: 3, неудовлетворительно: 2, 5: 5, 4: 4, 3: 3, 2: 2 }[s])).filter(Boolean);
    return numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
  }
  const fmtAvg = (value) => value.toFixed(1).replace(".", ",");
  // «Имя Фамилия»: сайт в профиле показывает только имя — фамилию берём из ФИО в списке группы,
  // если там ровно один человек с таким именем (ФИО на сайте — «Фамилия Имя Отчество»)
  function fullName(fields) {
    const norm = (v) => String(v || "").toLowerCase().replace(/ё/g, "е").trim();
    const full = (fields.get("ФИО") || [fields.get("Фамилия"), fields.get("Имя"), fields.get("Отчество")].filter(Boolean).join(" ")).trim();
    const words = full.split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    const group = people().map((p) => norm(p.name));
    if (words.length === 1) {
      const same = people().filter((p) => norm(p.name.split(/\s+/)[1]) === norm(words[0]));
      return same.length === 1 ? `${same[0].name.split(/\s+/)[1]} ${same[0].name.split(/\s+/)[0]}` : words[0];
    }
    // «Фамилия Имя Отчество» (как в группе) → «Имя Фамилия»; иначе считаем, что уже «Имя Фамилия»
    const fio = fields.get("Фамилия") || group.some((g) => g.startsWith(norm(`${words[0]} ${words[1]}`)));
    return fio ? `${words[1]} ${words[0]}` : `${words[0]} ${words[1]}`;
  }
  function profileFields() { return new Map((sections("profile") || []).flatMap(({ rows }) => rows)); }
  function profileSummary() {
    const fields = profileFields();
    const name = fullName(fields);
    const group = fields.get("Группа") || fields.get("Учебная группа");
    const course = fields.get("Курс");
    return { name, meta: [group, /^\d+$/.test(course ?? "") ? `${course} курс` : course].filter(Boolean).join(" · ") };
  }
  function trajectoryNow() {
    const list = sections("trajectory") || [];
    const status = (s) => (s.rows.find((r) => r[0] === "Статус семестра") || [])[1] || "";
    const current = list.find((s) => /продолжа/i.test(status(s))) || list[list.length - 1];
    return current ? { title: current.title, status: status(current), count: list.length } : null;
  }
  function statusText() {
    if (refreshing) return "Обновляем с сайта вуза…";
    if (!data) return "Загрузка кабинета…";
    if (data.status === "pending") return "Первое обновление кабинета…";
    const when = Number.isFinite(Date.parse(data.syncedAt)) ? `обновлено ${ago(data.syncedAt)}` : "обновлений пока нет";
    if (data.status === "error") return `Сайт вуза не ответил · ${when}`;
    if (data.status === "partial") return `Часть разделов не обновилась · ${when}`;
    return when[0].toUpperCase() + when.slice(1);
  }
  // ---------- сессия: экзамены, зачёты и консультации из раздела «Расписание» сайта ----------
  const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  function sessionEvents() {
    return (sections("session") || []).flatMap((s) => s.rows.map((r) => {
      const get = (n) => r[col(s, n)] || "";
      const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(get("Дата").trim());
      const day = m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
      return { day, date: get("Дата"), time: get("Время"), subject: get("Дисциплина"), kind: get("Вид"), room: get("Аудитория"), teacher: get("Преподаватель") };
    })).filter((e) => e.day).sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  }
  function daysUntil(day) {
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((day - today) / 864e5);
  }
  const inDays = (n) => n === 0 ? "сегодня" : n === 1 ? "завтра" : n === 2 ? "послезавтра" : `через ${n} ${plural(n, "день", "дня", "дней")}`;
  const isExam = (e) => /экзам|зач/i.test(e.kind);
  function nextExam() { return sessionEvents().find((e) => isExam(e) && daysUntil(e.day) >= 0); }
  const kindClass = (kind) => /экзам/i.test(kind) ? "cab-bad" : /зач/i.test(kind) ? "k-prac" : "k-oth";

  function pageSummary(id) {
    const list = sections(id);
    if (data?.unavailable?.includes(id) && !list) return "Пока не обновился";
    if (!list) return data ? "Нет данных" : "";
    if (id === "grades") {
      const rows = gradeRows().filter((r) => r.result);
      const last = rows.slice().sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))[0];
      return last ? `Последняя: ${last.result.toLowerCase()} · ${last.subject}` : "Оценок пока нет";
    }
    if (id === "session") {
      const next = nextExam();
      if (!next) return sessionEvents().length ? "Все экзамены сданы" : "Расписания сессии пока нет";
      return `${next.kind || "Экзамен"} ${inDays(daysUntil(next.day))} · ${next.subject}`;
    }
    if (id === "trajectory") { const now = trajectoryNow(); return now ? `${now.title} · ${now.status.toLowerCase() || "идёт"}` : "Нет семестров"; }
    const count = list.reduce((sum, s) => sum + s.rows.length, 0);
    if (id === "plan") return `${count} ${plural(count, "дисциплина", "дисциплины", "дисциплин")}`;
    if (id === "group") return `${count} ${plural(count, "человек", "человека", "человек")}`;
    if (id === "orders") { const first = list[0]?.rows[0]; return count ? `${count} · последний: ${first?.[col(list[0], "Название")] || first?.[0] || ""}` : "Приказов нет"; }
    if (id === "profile") { const f = profileFields(); return [f.get("Направление подготовки"), f.get("Форма обучения")].filter(Boolean).join(" · ") || "Сведения о студенте"; }
    return "";
  }

  // ---------- новые оценки ----------
  // Запоминаем, какие оценки уже видели. Появилась новая — событие в «Уведомления», всплывающая
  // подсказка и (если разрешены) системное уведомление. Первую загрузку считаем «уже виденной».
  const knownKey = "cabinet-grades-known", eventsKey = "cabinet-grade-events";
  const gradeId = (r) => [r.semester, r.subject, r.form, r.result].join("|");
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без хранилища */ } };
  let gradeEvents = readJSON(eventsKey, []);
  function noteGrades() {
    if (!data || !sections("grades")) return;
    const rows = gradeRows().filter((r) => r.result);
    const known = readJSON(knownKey, null);
    const ids = rows.map(gradeId);
    if (!known) { writeJSON(knownKey, ids); return; }
    const fresh = rows.filter((r) => !known.includes(gradeId(r)));
    if (!fresh.length) return;
    const ts = new Date().toISOString();
    gradeEvents = gradeEvents.concat(fresh.map((r) => ({ id: gradeId(r), ts, subject: r.subject, result: r.result, form: r.form, semester: r.semester, date: shortDate(r.date) })))
      .filter((e) => Date.now() - Date.parse(e.ts) < 30 * 864e5);
    writeJSON(eventsKey, gradeEvents);
    writeJSON(knownKey, ids);
    const text = fresh.length === 1 ? `Новая оценка: ${fresh[0].subject} — ${fresh[0].result}` : `Новых оценок: ${fresh.length}`;
    try { app().toast?.(text); } catch (e) { /* без подсказки */ }
    try {
      if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
        navigator.serviceWorker.getRegistration().then((reg) => reg && reg.showNotification(fresh.length === 1 ? "Новая оценка" : text,
          { body: fresh.length === 1 ? `${fresh[0].subject} — ${fresh[0].result}` : fresh.map((r) => `${r.subject} — ${r.result}`).join("\n"), tag: "grades", lang: "ru" })).catch(() => {});
      }
    } catch (e) { /* без системного уведомления */ }
  }
  const isNewGrade = (r) => gradeEvents.some((e) => e.id === gradeId(r) && Date.now() - Date.parse(e.ts) < 3 * 864e5);

  // траектория: какие семестры раскрыты/свёрнуты вручную; план: выбранный семестр
  let openSteps = new Set(), closedSteps = new Set(), planSem = null, gradesSem = null, openOrders = new Set();

  // ---------- разметка ----------
  const backButton = () => (app().inTG ? "" : `<button class="btn icon-btn" data-act="back" aria-label="Назад">${icons.left}</button>`);
  const empty = (icon, title, text) => `<div class="empty"><div class="ic">${icon}</div><div class="h">${esc(title)}</div>${text ? `<div class="p">${esc(text)}</div>` : ""}</div>`;
  const iconAv = (h, path) => `<span class="av cab-ic" style="--h:${h}" aria-hidden="true">${svg(path, 20)}</span>`;

  function headerHTML(title, sub) {
    const refresh = "";   // обновление — жестом «потянуть вниз», как во всём приложении
    if (sub) {
      return `<div class="top"><div class="cab-head">${backButton()}<div><div class="eyebrow">Личный кабинет</div><h1>${esc(title)}</h1></div></div>${refresh}</div>`;
    }
    return `<div class="top"><div><div class="eyebrow">ПривГУПС</div><h1>${esc(title)}</h1></div>${refresh}</div>`;
  }

  function heroHTML() {
    const rows = gradeRows().filter((r) => r.result);
    if (!rows.length) return "";
    const avg = average(rows);
    const passed = rows.filter((r) => markKind(r.result) !== "bad").length;
    const kind = avg == null ? "k-lec" : avg >= 4.5 ? "k-lec" : avg >= 3.5 ? "k-oth" : "k-prac";
    const p = avg == null ? Math.round(passed / rows.length * 100) : Math.round((avg - 2) / 3 * 100);
    const last = rows.slice().sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))[0];
    const now = trajectoryNow();
    const exam = nextExam();
    const lines = [
      exam ? `<div class="hn cab-bad"><i></i><span class="x">Сессия · <b>${esc(inDays(daysUntil(exam.day)))}</b> · ${esc(exam.subject)}</span></div>` : "",
      last ? `<div class="hn ${markClass[markKind(last.result)]}"><i></i><span class="x">Последняя · <b>${esc(last.result)}</b> · ${esc(last.subject)}</span></div>` : "",
      now ? `<div class="hn k-prac"><i></i><span class="x">Сейчас · <b>${esc(now.title)}</b>${now.status ? ` · ${esc(now.status.toLowerCase())}` : ""}</span></div>` : "",
    ].join("");
    return `<button class="hero hv-ring ${kind} cab-hero" data-cab="open" data-page="grades" aria-label="Зачётка">
      <div class="ring" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="trk" cx="40" cy="40" r="34" pathLength="100"/>
        <circle class="arc" cx="40" cy="40" r="34" pathLength="100" stroke-dasharray="100" style="stroke-dashoffset:${100 - Math.max(4, Math.min(100, p))}"/></svg>
        <span class="rv"><b>${avg == null ? passed : fmtAvg(avg)}</b><small>${avg == null ? "сдано" : "балл"}</small></span></div>
      <div class="hb"><span class="hl">Успеваемость</span><h3>${passed === rows.length ? `Всё сдано — ${rows.length} ${plural(rows.length, "оценка", "оценки", "оценок")}` : `Сдано ${passed} из ${rows.length}`}</h3>
        <div class="hr"><span>${avg == null ? "зачёты без баллов" : `средний балл за ${new Set(rows.map((r) => r.semester)).size} ${plural(new Set(rows.map((r) => r.semester)).size, "семестр", "семестра", "семестров")}`}</span></div></div>
      ${lines}</button>`;
  }

  function homeHTML() {
    const summary = profileSummary();
    const name = summary.name || (data?.status === "pending" ? "Кабинет подключён" : "");
    const meta = summary.meta;
    const expired = data?.status === "expired";
    const card = `<button class="tcard cab-card" data-cab="open" data-page="profile" aria-label="Профиль">
        <div class="av big" style="--h:${hue(summary.name || "Студент")}" aria-hidden="true">${summary.name ? esc(initials(summary.name)) : icons.check.replace(/width="14" height="14"/, 'width="24" height="24"')}</div>
        <div style="min-width:0"><div class="nm">${esc(name || "Студент")}</div>
        ${meta ? `<div class="sub">${esc(meta)}</div>` : ""}<div class="sub" role="status" data-cabinet-status>${esc(statusText())}</div></div>
        <span class="chev cab-chev">${icons.chev}</span></button>`;
    const warn = expired
      ? `<button class="offline stale cab-warn" data-cab="relogin"><span>Вход в кабинет вуза истёк — показаны сохранённые данные</span><u>Войти снова</u></button>`
      : data?.status === "error" ? `<div class="offline stale cab-warn"><span>Сайт вуза не ответил при последнем обновлении — показаны сохранённые данные</span></div>` : "";
    if (!data) {
      return headerHTML("Личный кабинет") + card + `<div class="sk" style="height:132px;margin-top:22px"></div><div class="sk" style="height:300px;margin-top:22px"></div>`;
    }
    const rows = pages.filter(([id]) => listed.includes(id)).map(([id, label, , h, path]) => `<button class="item" data-cab="open" data-page="${id}">
        ${iconAv(h, path)}<span class="body"><span class="nm">${esc(label)}</span><span class="sub">${esc(pageSummary(id))}</span></span>
        <span class="chev">${icons.chev}</span></button>`).join("");
    const pending = data.status === "pending"
      ? `<div class="list cab-pending">${empty(icons.refresh, "Забираем данные с сайта вуза", "Обычно это занимает меньше минуты. Экран обновится сам.")}</div>` : "";
    return headerHTML("Личный кабинет") + card + warn + (reauthenticating ? "" : "")
      + (data.status === "pending" ? pending : heroHTML() + `<h2 class="sec cab-sec">Разделы</h2><div class="list">${rows}</div>`)
      + `<div class="list cab-actions">
          <button class="item cab-danger" data-cab="disconnect" aria-label="Отключить на этом устройстве">${iconAv(4, "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9")}
            <span class="body"><span class="nm">Отключить кабинет</span><span class="sub">Данные исчезнут с этого устройства</span></span></button></div>`;
  }

  function markHTML(result) {
    const kind = markKind(result);
    return result ? `<span class="cab-mark ${markClass[kind] || "cab-neutral"}">${esc(result)}</span>` : "";
  }

  // Зачётка: семестр — переключателем (сразу последний), сверху сводка, ниже оценки по видам контроля
  function gradesHTML() {
    const rows = gradeRows();
    if (!rows.length) return empty(icons.empty, "Оценок пока нет", "Они появятся после первой сессии.");
    const semNo = (t) => parseInt(t, 10) || 0;
    const sems = [...new Set(rows.map((r) => r.semester))].sort((a, b) => semNo(a) - semNo(b));
    if (!sems.includes(gradesSem)) {
      const withNew = sems.filter((t) => rows.some((r) => r.semester === t && isNewGrade(r)));
      const withMarks = sems.filter((t) => rows.some((r) => r.semester === t && r.result));
      gradesSem = withNew.pop() || withMarks.pop() || sems[sems.length - 1];
    }
    const items = rows.filter((r) => r.semester === gradesSem);
    const tabs = sems.length > 1 ? `<div class="cab-chips" role="tablist">${sems.map((t) => `<button class="cab-chip${t === gradesSem ? " on" : ""}" role="tab" aria-selected="${t === gradesSem}" data-cab="gradesem" data-arg="${esc(t)}">${esc(t || "Без семестра")}${rows.some((r) => r.semester === t && isNewGrade(r)) ? `<i class="cab-dot" aria-label="есть новые"></i>` : ""}</button>`).join("")}</div>` : "";

    // сводка: средний балл и раскладка оценок полоской
    const marked = items.filter((r) => r.result);
    const avg = average(marked);
    const parts = [["good5", "Отлично", (r) => /^(отлично|5)$/i.test(r.result.trim()), "k-lec"], ["ok", "Хорошо", (r) => markKind(r.result) === "ok", "k-oth"],
      ["mid", "Удовл.", (r) => markKind(r.result) === "mid", "k-prac"], ["pass", "Зачтено", (r) => /^(зачтено|зач[её]т)$/i.test(r.result.trim()), "cab-pass"],
      ["bad", "Не сдано", (r) => markKind(r.result) === "bad", "cab-bad"]].map(([id, label, test, tone]) => ({ id, label, tone, n: marked.filter(test).length })).filter((p) => p.n);
    const waiting = items.length - marked.length;
    const bad = marked.filter((r) => markKind(r.result) === "bad").length;
    const status = bad ? `Есть долги: ${bad}` : waiting ? `Сдано ${marked.length} из ${items.length}` : `Всё сдано`;
    const summary = `<div class="cab-gsum">
        <div class="cab-gavg"><b>${avg == null ? marked.length : fmtAvg(avg)}</b><small>${avg == null ? plural(marked.length, "зачёт", "зачёта", "зачётов") : "средний балл"}</small></div>
        <div class="cab-gright"><div class="cab-gstatus${bad ? " cab-bad" : ""}">${esc(status)}</div>
          ${parts.length ? `<div class="cab-gbar" aria-hidden="true">${parts.map((p) => `<i class="${p.tone}" style="flex:${p.n}"></i>`).join("")}</div>
          <div class="cab-glegend">${parts.map((p) => `<span class="${p.tone}"><i></i>${esc(p.label)} ${p.n}</span>`).join("")}</div>` : ""}</div></div>`;

    // по видам контроля: экзамены, диф. зачёты, зачёты, курсовые; внутри — свежие сверху
    const groups = [["Экзамены", (f) => /экзам/i.test(f)], ["Дифференцированные зачёты", (f) => /диф|оценк/i.test(f)], ["Зачёты", (f) => /зач/i.test(f)],
      ["Курсовые работы и проекты", (f) => /курсов/i.test(f)], ["Другое", () => true]];
    const used = new Set();
    const blocks = groups.map(([title, test]) => {
      const list = items.filter((r) => !used.has(r) && test(r.form)).sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || a.subject.localeCompare(b.subject, "ru"));
      list.forEach((r) => used.add(r));
      if (!list.length) return "";
      return `<h2 class="sec cab-sec">${esc(title)}<span class="cab-sec-note">${list.length}</span></h2>
        <div class="list">${list.map((r) => `<div class="item cab-plain cab-tap${isNewGrade(r) ? " cab-fresh" : ""}"${subjectAttrs(r.subject)}>
          <span class="body"><span class="nm cab-wrap">${isNewGrade(r) ? `<span class="cab-new">новая</span>` : ""}${esc(r.subject)}</span>
          <span class="sub cab-wrap">${[esc(shortDate(r.date)), teacherLinks(r.teacher)].filter(Boolean).join(" · ") || "Дата не назначена"}</span>
          ${r.hours || r.units ? `<span class="sub cab-faint">${esc([r.hours && `${r.hours} ч`, r.units && `${r.units} з. е.`].filter(Boolean).join(" · "))}</span>` : ""}</span>
          ${r.result ? markHTML(r.result) : `<span class="cab-mark cab-neutral">ожидается</span>`}${tapChev(r.subject)}</div>`).join("")}</div>`;
    }).join("");
    return tabs + summary + blocks;
  }
  // ---------- карточка дисциплины: всё о предмете из зачётки, плана, траектории и сессии ----------
  const subjectKey = (name) => String(name || "").toLowerCase().replace(/ё/g, "е").replace(/[«»"']/g, "").replace(/\s+/g, " ").trim();
  function allSubjects() {
    const names = new Map();
    const add = (name) => { const k = subjectKey(name); if (k && !names.has(k)) names.set(k, String(name).trim()); };
    gradeRows().forEach((r) => add(r.subject));
    for (const items of planItems().values()) items.forEach((d) => { if (!/^дисциплины \(модули\) по выбору/i.test(d.subject)) add(d.subject); });
    (sections("trajectory") || []).forEach((s) => trajectoryItems(s.rows).forEach((d) => add(d.subject)));
    sessionEvents().forEach((e) => add(e.subject));
    return [...names].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }
  let subjectsCache = null, subjectsFor = null;
  function subjectIndex(name) {
    if (subjectsFor !== data) { subjectsCache = allSubjects(); subjectsFor = data; }
    return subjectsCache.findIndex(([k]) => k === subjectKey(name));
  }
  // строка, по нажатию на которую открывается карточка дисциплины
  const subjectAttrs = (name) => { const i = subjectIndex(name); return i < 0 ? "" : ` role="button" tabindex="0" data-cab="open" data-page="subject" data-arg="${i}"`; };
  const tapChev = (name) => (subjectIndex(name) < 0 ? "" : `<span class="chev cab-tchev">${icons.chev}</span>`);

  // Преподаватель из кабинета («Кузнецов Д. И.», «Кузнецов Д.И.» или полностью) → его страница в «Преподавателях»
  const teacherKey = (name) => { const w = String(name || "").toLowerCase().replace(/ё/g, "е").split(/[\s.]+/).filter(Boolean); return w.length ? `${w[0]}|${w.slice(1, 3).map((x) => x[0]).join("")}` : ""; };
  function findTeacher(name) {
    const list = app().teachers ? app().teachers() : [];
    const k = teacherKey(name);
    const same = k ? list.filter((t) => teacherKey(t.name) === k) : [];
    return same.length === 1 ? same[0] : null;
  }
  // имена через запятую: те, что нашлись в «Преподавателях», — ссылками
  const teacherLinks = (names) => String(names || "").split(/,\s*/).filter(Boolean).map((n) => {
    const t = findTeacher(n);
    return t ? `<button class="cab-tlink" data-cab="teacher" data-arg="${esc(t.id)}">${esc(shortTeacher(n))}</button>` : esc(shortTeacher(n));
  }).join(", ");

  function subjectHTML(index) {
    if (subjectsFor !== data) { subjectsCache = allSubjects(); subjectsFor = data; }
    const entry = subjectsCache[index];
    if (!entry) return headerHTML("Дисциплина", true) + empty(icons.empty, "Дисциплина не найдена", "");
    const [key, name] = entry;
    const same = (n) => subjectKey(n) === key;
    const grades = gradeRows().filter((r) => same(r.subject)).sort((a, b) => (parseInt(a.semester, 10) || 0) - (parseInt(b.semester, 10) || 0));
    const plan = [...planItems()].flatMap(([sem, items]) => items.filter((d) => same(d.subject)).map((d) => ({ ...d, sem })));
    const traj = (sections("trajectory") || []).flatMap((s) => trajectoryItems(s.rows).filter((d) => same(d.subject)).map((d) => ({ ...d, title: s.title })));
    const events = sessionEvents().filter((e) => same(e.subject));
    const kinds = [...new Set([...plan.flatMap((d) => d.kinds), ...traj.flatMap((d) => d.kinds), ...grades.map((g) => g.form).filter(Boolean)].map(kindShort))];
    // часы в плане — на всю дисциплину (строка повторяется в каждом её семестре): считаем по индексу один раз
    const byIndex = new Map(plan.map((d) => [d.index || d.subject, parseInt(d.hours, 10) || 0]));
    const hours = [...byIndex.values()].reduce((a, b) => a + b, 0) || traj.reduce((sum, d) => sum + (parseInt(d.hours, 10) || 0), 0);
    const last = grades.filter((g) => g.result).pop();
    const head = `<div class="tcard cab-subj"><div style="min-width:0;flex:1"><div class="nm cab-wrap">${esc(name)}</div>
        <div class="sub">${esc([plan[0]?.index, hours && `${hours} ч`, plan.length ? `${new Set(plan.map((d) => d.sem)).size} ${plural(new Set(plan.map((d) => d.sem)).size, "семестр", "семестра", "семестров")}` : ""].filter(Boolean).join(" · "))}</div>
        ${kinds.length ? `<div class="cab-kinds cab-kinds-row">${kinds.map((k) => `<span class="cab-mark ${kindTone(k)}">${esc(k)}</span>`).join("")}</div>` : ""}</div>
        ${last ? markHTML(last.result) : ""}</div>`;
    const blocks = [];
    if (events.length) blocks.push(`<h2 class="sec cab-sec">Сессия</h2><div class="list">${events.map((e) => `<div class="item cab-plain cab-exam${daysUntil(e.day) < 0 ? " cab-past" : ""}"><span class="cab-time">${esc((e.time || "—").split(/[–-]/)[0])}</span>
      <span class="body"><span class="nm">${esc(`${e.day.getDate()} ${MONTHS_FULL[e.day.getMonth()]}, ${daysUntil(e.day) < 0 ? "прошло" : inDays(daysUntil(e.day))}`)}</span>
      <span class="sub cab-wrap">${[esc(e.room), teacherLinks(e.teacher)].filter(Boolean).join(" · ")}</span></span>
      <span class="cab-mark ${kindClass(e.kind)}">${esc(e.kind || "Экзамен")}</span></div>`).join("")}</div>`);
    if (grades.length) blocks.push(`<h2 class="sec cab-sec">Оценки</h2><div class="list">${grades.map((g) => `<div class="item cab-plain"><span class="body">
      <span class="nm">${esc([g.semester, g.form].filter(Boolean).join(" · "))}</span>
      <span class="sub cab-wrap">${[esc(shortDate(g.date) || "дата не назначена"), teacherLinks(g.teacher)].filter(Boolean).join(" · ")}</span></span>
      ${g.result ? markHTML(g.result) : `<span class="cab-mark cab-neutral">ожидается</span>`}</div>`).join("")}</div>`);
    if (plan.length) blocks.push(`<h2 class="sec cab-sec">Учебный план</h2><div class="list">${plan.map((d) => `<div class="item cab-plain"><span class="body">
      <span class="nm">${esc(d.sem ? `${d.sem} семестр` : "Без семестра")}</span>${plan.length === 1 && d.hours ? `<span class="sub">${esc(`${d.hours} ч`)}</span>` : ""}</span>${chipsHTML(d.kinds)}</div>`).join("")}</div>`);
    if (traj.length) blocks.push(`<h2 class="sec cab-sec">Траектория</h2><div class="list">${traj.map((d) => `<div class="item cab-plain"><span class="body">
      <span class="nm">${esc(d.title)}</span>${d.hours ? `<span class="sub">${esc(`${d.hours} ч · ${d.units} з. е.`)}</span>` : ""}</span>${chipsHTML(d.kinds)}</div>`).join("")}</div>`);
    // преподаватели предмета — отдельным списком, с переходом к расписанию
    const teachers = [...new Set([...grades.map((g) => g.teacher), ...events.map((e) => e.teacher)].flatMap((t) => String(t || "").split(/,\s*/)).filter(Boolean))];
    if (teachers.length) blocks.push(`<h2 class="sec cab-sec">Преподаватели</h2><div class="list">${teachers.map((n) => {
      const t = findTeacher(n), label = t ? t.name : n;
      return t ? `<button class="item" data-cab="teacher" data-arg="${esc(t.id)}"><span class="av" style="--h:${hue(label)}" aria-hidden="true">${esc(initials(label))}</span>
          <span class="body"><span class="nm">${esc(label)}</span><span class="sub">Расписание преподавателя</span></span><span class="chev">${icons.chev}</span></button>`
        : `<div class="item cab-plain"><span class="av" style="--h:${hue(label)}" aria-hidden="true">${esc(initials(label))}</span><span class="body"><span class="nm">${esc(label)}</span></span></div>`;
    }).join("")}</div>`);
    return headerHTML("Дисциплина", true) + head + (blocks.join("") || empty(icons.empty, "Других сведений нет", ""));
  }

  // «Иванова Мария Сергеевна» → «Иванова М. С.»; уже сокращённое — как есть
  const shortTeacher = (name) => String(name || "").split(/,\s*/).map((n) => {
    const w = n.trim().split(/\s+/);
    return w.length === 3 && w.every((x) => x.length > 2) ? `${w[0]} ${w[1][0]}. ${w[2][0]}.` : n.trim();
  }).filter(Boolean).join(", ");

  function sessionHTML() {
    const events = sessionEvents();
    if (!events.length) return empty(icons.empty, "Расписания сессии пока нет", "Оно появится, когда вуз опубликует экзамены и зачёты.");
    const next = nextExam();
    const grades = gradeRows();
    const head = next ? `<div class="hero hv-ring cab-bad cab-hero cab-session-hero">
        <div class="ring" aria-hidden="true"><svg viewBox="0 0 80 80"><circle class="trk" cx="40" cy="40" r="34" pathLength="100"/>
          <circle class="arc" cx="40" cy="40" r="34" pathLength="100" stroke-dasharray="100" style="stroke-dashoffset:${Math.max(0, Math.min(96, daysUntil(next.day) * 3))}"/></svg>
          <span class="rv"><b>${daysUntil(next.day)}</b><small>${plural(daysUntil(next.day), "день", "дня", "дней")}</small></span></div>
        <div class="hb"><span class="hl">Ближайший ${esc((next.kind || "экзамен").toLowerCase())}</span><h3>${esc(next.subject)}</h3>
          <div class="hr"><span>${esc([`${next.day.getDate()} ${MONTHS_FULL[next.day.getMonth()]}`, next.time, next.room].filter(Boolean).join(" · "))}</span></div></div></div>` : "";
    const byDay = new Map();
    for (const e of events) { const k = e.date; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    return head + [...byDay].map(([, list]) => {
      const d = list[0].day, n = daysUntil(d);
      return `<h2 class="sec cab-sec${n < 0 ? " cab-past" : ""}">${d.getDate()} ${MONTHS_FULL[d.getMonth()]}, ${WD[d.getDay()]}<span class="cab-sec-note">${n < 0 ? "прошло" : esc(inDays(n))}</span></h2>
        <div class="list${n < 0 ? " cab-past" : ""}">${list.map((e) => {
          const grade = grades.find((g) => g.subject === e.subject && g.result && isExam(e));
          return `<div class="item cab-plain cab-exam cab-tap"${subjectAttrs(e.subject)}><span class="cab-time">${esc((e.time || "—").split(/[–-]/)[0])}</span>
            <span class="body"><span class="nm cab-wrap">${esc(e.subject)}</span>
            <span class="sub cab-wrap">${[esc(e.room), teacherLinks(e.teacher)].filter(Boolean).join(" · ")}</span></span>
            ${grade ? markHTML(grade.result) : `<span class="cab-mark ${kindClass(e.kind)}">${esc(e.kind || "Экзамен")}</span>`}</div>`;
        }).join("")}</div>`;
    }).join("");
  }

  // Вид контроля: «Экзамен», «Зачет дифференцированный», «Курсовая работа»…
  const KIND_RE = /(Экзамен|Зач[её]т\s+дифференцированный|Дифференцированный\s+зач[её]т|Зач[её]т\s+с\s+оценкой|Зач[её]т|Курсов(?:ая\s+работа|ой\s+проект)|Расч[её]тно-графическая\s+работа|Контрольная\s+работа|Реферат)/gi;
  const kindsOf = (text) => [...String(text || "").matchAll(KIND_RE)].map((m) => m[1].replace(/\s+/g, " "));
  const kindRank = (kind) => (/экзам/i.test(kind) ? 0 : /диф|оценк/i.test(kind) ? 1 : /зач/i.test(kind) ? 2 : /курсов/i.test(kind) ? 3 : 4);
  const kindShort = (kind) => kind.replace(/Зач[её]т\s+дифференцированный|Дифференцированный\s+зач[её]т|Зач[её]т\s+с\s+оценкой/i, "Диф. зачёт")
    .replace(/Расч[её]тно-графическая работа/i, "РГР").replace(/Контрольная работа/i, "Контрольная").replace(/^Зачет$/i, "Зачёт");
  const kindTone = (kind) => (/экзам/i.test(kind) ? "cab-bad" : /диф|оценк/i.test(kind) ? "k-oth" : /зач/i.test(kind) ? "k-lec" : "cab-neutral");
  const chipsHTML = (kinds) => kinds.length ? `<span class="cab-kinds">${kinds.slice().sort((a, b) => kindRank(a) - kindRank(b)).map((k) => `<span class="cab-mark ${kindTone(k)}">${esc(kindShort(k))}</span>`).join("")}</span>` : "";
  const isLoad = (t) => /\d\s*ч\.?(\s|\/|$)|з\.\s*е/i.test(t);
  const isKindOnly = (t) => t.replace(KIND_RE, "").replace(/[\s·]/g, "") === "";

  // Дисциплины семестра траектории. Строка с сервера — [название, «Зачёт · 72 ч. / 2 з.е»]. Старый сервер
  // склеивал весь семестр в одну строку («Предмет · Зачёт 72 ч. / 2 з.е · Предмет 2 · …») — разбираем и её.
  function trajectoryItems(rows) {
    const tokens = rows.filter((r) => r[0] !== "Статус семестра").flatMap((r) => [r[0], ...String(r[1] || "").split(" · ")]).map((t) => t.trim()).filter(Boolean);
    const items = [];
    for (const t of tokens) {
      if (items.length && (isLoad(t) || isKindOnly(t))) { items[items.length - 1].details.push(t); continue; }
      items.push({ subject: t, details: [] });
    }
    return items.map(({ subject, details }) => {
      const text = details.join(" ");
      const m = /(\d+)\s*ч\.?\s*\/\s*(\d+(?:[.,]\d+)?)\s*з\.?\s*е/i.exec(text) || [];
      return { subject, kinds: kindsOf(text), hours: m[1], units: m[2] };
    });
  }
  function trajectoryHTML() {
    const list = sections("trajectory") || [];
    if (!list.length) return empty(icons.empty, "Траектория пуста", "");
    const now = trajectoryNow();
    return `<div class="cab-tl">${list.map((s, index) => {
      const status = (s.rows.find((r) => r[0] === "Статус семестра") || [])[1] || "";
      const current = now && s.title === now.title && /продолжа/i.test(status);
      const done = /пройден/i.test(status);
      const items = trajectoryItems(s.rows).sort((a, b) => kindRank(a.kinds[0] || "") - kindRank(b.kinds[0] || "") || a.subject.localeCompare(b.subject, "ru"));
      // по умолчанию раскрыт текущий семестр (или последний); остальные — по нажатию
      const open = openSteps.has(index) || (!closedSteps.has(index) && (current || (!now && index === list.length - 1)));
      const exams = items.filter((d) => d.kinds.some((k) => /экзам/i.test(k))).length;
      const summary = [`${items.length} ${plural(items.length, "дисциплина", "дисциплины", "дисциплин")}`, exams && `${exams} ${plural(exams, "экзамен", "экзамена", "экзаменов")}`].filter(Boolean).join(" · ");
      return `<section class="cab-step ${current ? "k-prac now" : done ? "k-lec done" : "k-oth"}${open ? " open" : ""}">
        <div class="cab-rail" aria-hidden="true"><span class="pt">${done ? icons.check : ""}</span></div>
        <div class="cab-stepbody">
          <button class="cab-stephead" data-cab="step" data-arg="${index}" aria-expanded="${open}">
            <span class="body"><span class="nm">${esc(s.title)}</span><span class="sub">${esc([status, summary].filter(Boolean).join(" · "))}</span></span>
            <span class="chev cab-fold">${icons.chev}</span></button>
          ${open ? `<div class="list">${items.length ? items.map((d) => `<div class="item cab-plain cab-tap"${subjectAttrs(d.subject)}><span class="body"><span class="nm cab-wrap">${esc(d.subject)}</span>
            ${d.hours ? `<span class="sub">${esc(`${d.hours} ч · ${d.units} з. е.`)}</span>` : ""}</span>${chipsHTML(d.kinds)}${tapChev(d.subject)}</div>`).join("") : `<div class="nothing">Дисциплин нет</div>`}</div>` : ""}
        </div></section>`;
    }).join("")}</div>`;
  }

  // Номер текущего семестра: по траектории (семестр «обучение продолжается»), иначе по курсу и месяцу
  function currentSemester() {
    const list = sections("trajectory") || [];
    const status = (s) => (s.rows.find((r) => r[0] === "Статус семестра") || [])[1] || "";
    const i = list.findIndex((s) => /продолжа/i.test(status(s)));
    if (i >= 0) return i + 1;
    const course = parseInt(profileFields().get("Курс"), 10);
    if (!course) return 0;
    const m = new Date().getMonth();
    return course * 2 - (m >= 8 || m === 0 ? 1 : 0);
  }
  const semesterNumbers = (text) => {
    const out = new Set();
    for (const m of String(text || "").matchAll(/(\d+)\s*[–-]\s*(\d+)|(\d+)/g)) {
      if (m[3]) out.add(+m[3]); else for (let n = +m[1]; n <= +m[2] && n - m[1] < 12; n++) out.add(n);
    }
    return [...out];
  };
  function planItems() {
    const list = sections("plan") || [];
    const bySem = new Map();
    for (const s of list) for (const r of s.rows) {
      const row = { index: r[col(s, "Индекс")] || "", subject: r[col(s, "Дисциплина")] || "", hours: r[col(s, "Часы")], period: r[col(s, "Период")], control: r[col(s, "Вид контроля")] || "" };
      // «Экзамен (3), Зачет (4)» → по семестрам; без скобок — во все семестры дисциплины
      const kindsBySem = new Map();
      for (const m of row.control.matchAll(/([^,;()]+?)\s*\(([\d,\s–-]+)\)/g)) for (const n of semesterNumbers(m[2])) {
        if (!kindsBySem.has(n)) kindsBySem.set(n, []);
        kindsBySem.get(n).push(...kindsOf(m[1]).length ? kindsOf(m[1]) : [m[1].trim()]);
      }
      const sems = new Set([...semesterNumbers(row.period), ...kindsBySem.keys()]);
      if (!sems.size) sems.add(0);
      for (const n of sems) {
        if (!bySem.has(n)) bySem.set(n, []);
        bySem.get(n).push({ ...row, kinds: kindsBySem.get(n) || (kindsBySem.size ? [] : kindsOf(row.control)) });
      }
    }
    return new Map([...bySem].sort((a, b) => (a[0] || 99) - (b[0] || 99)));
  }
  function planHTML() {
    const bySem = planItems();
    if (!bySem.size) return empty(icons.empty, "Учебный план пуст", "");
    const sems = [...bySem.keys()];
    const now = currentSemester();
    if (!bySem.has(planSem)) planSem = bySem.has(now) ? now : sems[0];
    const items = bySem.get(planSem);
    // Дисциплины по выбору: блок «…ДВ.15» и варианты «…ДВ.15.1», «…ДВ.15.2» — вместе, вариантами
    const children = (parent) => items.filter((d) => d.index.startsWith(parent.index + ".") && d.index !== parent.index);
    const isChild = (d) => items.some((p) => p !== d && /ДВ\.\d+$/.test(p.index) && d.index.startsWith(p.index + "."));
    const top = items.filter((d) => !isChild(d))
      .sort((a, b) => kindRank(a.kinds[0] || (children(a)[0]?.kinds[0]) || "") - kindRank(b.kinds[0] || (children(b)[0]?.kinds[0]) || "") || a.subject.localeCompare(b.subject, "ru"));
    const row = (d, sub) => `<div class="item cab-plain cab-tap${sub ? " cab-option" : ""}"${subjectAttrs(d.subject)}><span class="body"><span class="nm cab-wrap">${esc(d.subject)}</span>
      <span class="sub">${esc([d.hours && `${d.hours} ч`, d.index].filter(Boolean).join(" · "))}</span></span>${chipsHTML(d.kinds)}${tapChev(d.subject)}</div>`;
    const count = top.length;
    const exams = top.filter((d) => d.kinds.some((k) => /экзам/i.test(k))).length;
    const credits = top.filter((d) => d.kinds.some((k) => /зач/i.test(k))).length;
    const tabs = `<div class="cab-chips" role="tablist">${sems.map((n) => `<button class="cab-chip${n === planSem ? " on" : ""}${n === now ? " now" : ""}" role="tab" aria-selected="${n === planSem}" data-cab="plansem" data-arg="${n}">${n ? `${n} семестр` : "Без семестра"}</button>`).join("")}</div>`;
    return tabs + `<h2 class="sec cab-sec">${planSem === now ? "Сейчас" : planSem ? `${planSem} семестр` : "Без семестра"}<span class="cab-sec-note">${esc([`${count} ${plural(count, "дисциплина", "дисциплины", "дисциплин")}`, exams && `${exams} ${plural(exams, "экзамен", "экзамена", "экзаменов")}`, credits && `${credits} ${plural(credits, "зачёт", "зачёта", "зачётов")}`].filter(Boolean).join(" · "))}</span></h2>
      <div class="list">${top.map((d) => {
        const options = /ДВ\.\d+$/.test(d.index) ? children(d) : [];
        if (!options.length) return row(d);
        return `<div class="item cab-plain cab-choice"><span class="body"><span class="nm cab-wrap">По выбору — одна из</span><span class="sub">${esc([d.hours && `${d.hours} ч`, d.index].filter(Boolean).join(" · "))}</span></span>${chipsHTML(d.kinds)}</div>`
          + options.map((o) => row(o, true)).join("");
      }).join("")}</div>`;
  }

  function people() {
    return (sections("group") || []).flatMap((s) => {
      const name = Math.max(0, col(s, "ФИО"));
      return s.rows.filter((r) => r[name]).map((r) => ({
        name: r[name],
        fields: s.columns.map((c, i) => [c, r[i]]).filter(([c, v], i) => i !== name && c && v),
      }));
    });
  }
  function groupHTML() {
    const list = people();
    if (!list.length) return empty(icons.empty, "Список группы пуст", "");
    return `<label class="search">${icons.search}<input data-cab="search" type="search" placeholder="Поиск по фамилии" aria-label="Поиск по группе" autocomplete="off" value="${esc(searchText)}"></label>
      <h2 class="sec cab-sec">${list.length} ${plural(list.length, "человек", "человека", "человек")}</h2>
      <div class="list" data-cab-people>${list.map((p, i) => `<button class="item cab-person" data-cab="open" data-page="group" data-arg="${i}" data-name="${esc(p.name.toLowerCase().replace(/ё/g, "е"))}">
        <span class="av" style="--h:${hue(p.name)}" aria-hidden="true">${esc(initials(p.name))}</span><span class="body"><span class="nm">${esc(p.name)}</span>
        ${p.fields.length ? `<span class="sub">${esc(p.fields.map(([, v]) => v).slice(0, 2).join(" · "))}</span>` : ""}</span>
        <span class="chev">${icons.chev}</span></button>`).join("")}</div>
      <div class="nothing" data-cab-none hidden>Никого не нашлось</div>`;
  }
  function birthday(value) {
    const m = /^(\d{1,2})\.(\d{1,2})/.exec(String(value || ""));
    if (!m) return "";
    const now = new Date(), y = now.getFullYear();
    let next = new Date(y, +m[2] - 1, +m[1]);
    const today = new Date(y, now.getMonth(), now.getDate());
    if (next < today) next = new Date(y + 1, +m[2] - 1, +m[1]);
    const days = Math.round((next - today) / 864e5);
    return days === 0 ? "сегодня 🎉" : days === 1 ? "завтра" : `через ${days} ${plural(days, "день", "дня", "дней")}`;
  }
  function fieldValue(label, value) {
    if (/телефон/i.test(label)) return `<a class="cab-link" href="tel:${esc(String(value).replace(/[^\d+]/g, ""))}">${esc(value)}</a>`;
    if (/почт|e-?mail/i.test(label)) return `<a class="cab-link" href="mailto:${esc(value)}">${esc(value)}</a>`;
    if (/рожден/i.test(label)) { const b = birthday(value); return `${esc(value)}${b ? `<span class="cab-sec-note"> · ${esc(b)}</span>` : ""}`; }
    return esc(value);
  }
  function personHTML(index) {
    const p = people()[index];
    if (!p) return headerHTML("Моя группа", true) + empty(icons.empty, "Человек не найден", "");
    return headerHTML("Моя группа", true)
      + `<div class="tcard"><div class="av big" style="--h:${hue(p.name)}" aria-hidden="true">${esc(initials(p.name))}</div>
          <div style="min-width:0"><div class="nm">${esc(p.name)}</div><div class="sub">${esc(profileSummary().meta.split(" · ")[0] || "Одногруппник")}</div></div></div>`
      + (p.fields.length
        ? `<div class="list cab-gap">${p.fields.map(([k, v]) => `<div class="item cab-plain cab-field"><span class="body"><span class="sub">${esc(k)}</span><span class="nm cab-wrap">${fieldValue(k, v)}</span></span></div>`).join("")}</div>`
        : empty(icons.empty, "Других сведений нет", ""));
  }

  function ordersRows() {
    return (sections("orders") || []).flatMap((s) => s.rows.map((r) => ({ date: r[col(s, "Дата")], number: r[col(s, "Номер приказа")], title: r[col(s, "Название")], text: r[col(s, "Содержание")] })));
  }
  // Приказ: нажатие раскрывает полный текст и кнопку «Скопировать»
  function ordersHTML() {
    const rows = ordersRows();
    if (!rows.length) return empty(icons.empty, "Приказов нет", "Здесь появятся приказы о переводе, стипендии и другие.");
    return `<div class="list cab-gap">${rows.map((r, i) => {
      const open = openOrders.has(i);
      const meta = r.title && r.number && r.title.includes(r.number) ? "" : [r.number && `№ ${r.number}`, shortDate(r.date)].filter(Boolean).join(" · ");
      const more = r.text && r.text !== r.title;
      const tap = more ? ` role="button" tabindex="0" aria-expanded="${open}" data-cab="order" data-arg="${i}"` : "";
      return `<div class="item cab-plain cab-order${more ? " cab-tap" : ""}${open ? " open" : ""}"${tap}><span class="body">
        <span class="nm cab-wrap">${esc(r.title || r.text || "Приказ")}</span>
        ${meta ? `<span class="sub">${esc(meta)}</span>` : ""}
        ${r.text && r.text !== r.title ? `<span class="sub cab-wrap cab-faint cab-otext">${esc(r.text)}</span>` : ""}
        ${open ? `<span class="cab-oacts"><button class="cab-obtn" data-cab="copy" data-arg="${i}">${icons.copy}Скопировать</button></span>` : ""}</span>
        ${more ? `<span class="chev cab-fold">${icons.chev}</span>` : ""}</div>`;
    }).join("")}</div>`;
  }

  function profileHTML() {
    const rows = [...profileFields()].filter(([k]) => k !== "Имя");
    const { name, meta } = profileSummary();
    const head = name ? `<div class="tcard"><div class="av big" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</div>
      <div style="min-width:0"><div class="nm">${esc(name)}</div>${meta ? `<div class="sub">${esc(meta)}</div>` : ""}</div></div>` : "";
    if (!rows.length) return head + empty(icons.empty, "Сведений нет", "");
    return head + `<div class="list cab-gap">${rows.map(([k, v]) => `<div class="item cab-plain cab-field"><span class="body"><span class="sub">${esc(k)}</span><span class="nm cab-wrap">${esc(v)}</span></span></div>`).join("")}</div>`;
  }

  function sectionHTML(id) {
    const [, label] = pages.find(([p]) => p === id);
    let body;
    if (!data) body = `<div class="sk" style="height:220px;margin-top:22px"></div>`;
    else if (data.unavailable?.includes(id) && !sections(id)) body = empty(icons.wifi, "Раздел пока не обновился", "Сервер заберёт его с сайта вуза при следующем обновлении.");
    else if (!sections(id)) body = empty(icons.empty, "Данных пока нет", "");
    else body = { session: sessionHTML, grades: gradesHTML, trajectory: trajectoryHTML, plan: planHTML, group: groupHTML, orders: ordersHTML, profile: profileHTML }[id]();
    const stale = data?.unavailable?.includes(id) && sections(id) ? `<div class="offline stale cab-warn"><span>Раздел не обновился — показана прошлая версия</span></div>` : "";
    return headerHTML(label, true) + stale + body;
  }

  // ---------- форма входа ----------
  function connectionForm(previous = null) {
    const form = document.createElement("form");
    form.className = "list cabinet-form";
    form.innerHTML = `<div class="cab-form-head">${iconAv(previous ? 32 : 214, "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4")}
        <h2>${previous ? "Войти повторно" : "Вход"}</h2></div>
      <label>Логин<input type="text" required maxlength="256" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label>Пароль<input type="password" required maxlength="1024" autocomplete="current-password"></label>
      <button class="btn wide" type="submit" disabled>Войти</button>
      <p class="cabinet-muted" role="alert"></p>
      ${previous ? `<div class="cab-form-foot"><button class="flink" type="button" data-cancel>Отмена</button></div>` : ""}`;
    const [login, password] = form.querySelectorAll("input");
    const submit = form.querySelector("button[type=submit]");
    const error = form.querySelector("[role=alert]");
    form.querySelector("[data-cancel]")?.addEventListener("click", () => { reauthenticating = false; draw(); });
    let address;
    configuredServer().then((server) => {
      if (previous && endpoint(server) !== previous.url) {
        error.textContent = "Это подключение относится к другому серверу. Отключи его и войди снова.";
        return;
      }
      address = server;
      submit.disabled = false;
    }).catch(() => { error.textContent = "Вход пока недоступен. Сервер подключения не настроен или нет сети."; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!address || submit.disabled) return;
      error.textContent = "";
      submit.disabled = true;
      submit.textContent = "Входим…";
      try {
        const body = JSON.stringify({ login: login.value.trim(), password: password.value });
        password.value = "";
        const headers = { "Content-Type": "application/json" };
        if (previous) headers.Authorization = `Bearer ${previous.key}`;
        const response = await fetch(endpoint(address, "login"), {
          method: "POST", headers, body, cache: "no-store", credentials: "omit", redirect: "error",
          referrerPolicy: "no-referrer", signal: AbortSignal.timeout(35000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !keyPattern.test(result?.key || "") || result?.snapshot?.version !== 1) {
          const messages = {
            invalid_credentials: "Проверь логин и пароль ПривГУПС.",
            interaction_required: "Вуз запросил дополнительную проверку. Проверь вход на официальном сайте.",
            rate_limited: "Слишком много попыток. Подожди несколько минут.",
            different_account: "Введи данные того же аккаунта ПривГУПС. Для другого аккаунта отключи текущее подключение.",
            invalid_key: "Текущее подключение отозвано. Отключи его и войди снова.",
            bad_request: "Введи логин и пароль ПривГУПС.",
          };
          if (result?.error === "rate_limited" && result.retryAfter > 0) {
            const min = Math.max(1, Math.ceil(result.retryAfter / 60));
            messages.rate_limited = `Слишком много попыток входа. Попробуй снова через ${min} ${plural(min, "минуту", "минуты", "минут")}.`;
          }
          error.textContent = messages[result?.error] || "Сейчас не удалось войти в кабинет вуза.";
          haptic("heavy");
          return;
        }
        if (!form.isConnected || connection !== previous) return;
        setConnection({ address, key: result.key, url: endpoint(address) });
        data = result.snapshot;
        noteGrades();
        linkNotify();
        haptic("medium");
        draw();
      } catch {
        error.textContent = "Не удалось связаться с сервером входа. Попробуй позже.";
      } finally {
        submit.disabled = false;
        submit.textContent = "Войти";
      }
    });
    return form;
  }

  // ---------- отрисовка ----------
  function draw() {
    if (!root?.isConnected) return;
    if (!connection) {
      root.innerHTML = headerHTML("Личный кабинет") + `<div class="cab-center"></div>`;
      root.querySelector(".cab-center").append(connectionForm());
      return;
    }
    const current = page === "subject" ? "subject" : page !== "home" && pages.some(([id]) => id === page) ? page : "home";
    root.innerHTML = current === "home" ? homeHTML() : current === "subject" ? (data ? subjectHTML(+pageArg) : headerHTML("Дисциплина", true) + `<div class="sk" style="height:220px;margin-top:22px"></div>`)
      : current === "group" && pageArg !== "" ? personHTML(+pageArg) : sectionHTML(current);
    if (current === "home" && reauthenticating && data?.status === "expired") {
      const card = root.querySelector(".cab-warn") || root.querySelector(".tcard");
      card.after(connectionForm(connection));
    }
    if (current === "group" && searchText) filterPeople();
  }
  function filterPeople() {
    const words = searchText.trim().toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean);
    let shown = 0;
    root.querySelectorAll("[data-name]").forEach((row) => {
      const parts = row.dataset.name.split(/\s+/);
      const ok = words.every((w) => parts.some((p) => p.startsWith(w)));
      row.hidden = !ok; if (ok) shown++;
    });
    const none = root.querySelector("[data-cab-none]");
    if (none) none.hidden = shown > 0;
  }

  async function load() {
    if (!connection || !root?.isConnected || request || reauthenticating) return;
    const controller = new AbortController();
    const thisConnection = connection;
    request = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const next = await getSnapshot(thisConnection, controller.signal);
      if (connection === thisConnection && JSON.stringify(data) !== JSON.stringify(next)) { data = next; noteGrades(); draw(); }
      linkNotify();
    } catch (error) {
      const status = root?.querySelector("[data-cabinet-status]");
      if (connection === thisConnection && status) status.textContent = data ? `${error.message} ${statusText()}` : error.message;
    } finally {
      clearTimeout(timer);
      if (request === controller) request = null;
    }
  }

  // Уведомления о новых оценках и сессии — через бота, как изменения расписания. Сообщаем серверу кабинета
  // метку уведомлений (HMAC личного ключа) и канал бота. Повторно — только если что-то поменялось.
  async function linkNotify() {
    const config = connection;
    if (!config) return;
    let label = "", relay = "";
    try { label = (await app().notifyLabel?.()) || ""; relay = app().relay?.() || ""; } catch (e) { return; }
    if (!label || !relay) return;
    const sig = `${config.key.slice(-12)}|${label.slice(0, 12)}|${relay}`;
    if (readJSON("cabinet-notify", "") === sig) return;
    try {
      const response = await fetch(endpoint(config.address, "notify"), {
        method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ label, relay }), cache: "no-store", credentials: "omit", redirect: "error",
        referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000),
      });
      if (response.ok) writeJSON("cabinet-notify", sig);
    } catch (e) { /* в следующий раз */ }
  }

  // «Потянуть вниз»: сервер сразу идёт на сайт вуза (каждый раз), приложение ждёт новую копию.
  // Возвращает true, если запрос принят: крутилка приложения убирается сразу, а данные дорисуются сами.
  const setStatus = () => { const el = root?.querySelector("[data-cabinet-status]"); if (el) el.textContent = statusText(); };
  const say = (text) => { try { app().toast?.(text); } catch (e) { /* без подсказки */ } };
  async function refresh() {
    if (!connection || reauthenticating) { await load(); return false; }
    if (refreshing) return true;
    const config = connection;
    let response;
    try {
      response = await fetch(endpoint(config.address, "refresh"), {
        method: "POST", headers: { Authorization: `Bearer ${config.key}` }, cache: "no-store", credentials: "omit",
        redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000),
      });
    } catch (e) { say("Нет связи с сервером кабинета"); return false; }
    if (response.status === 429) {
      const info = await response.json().catch(() => ({}));
      const min = Math.max(1, Math.ceil((info.retryAfter || 60) / 60));
      say(`Данные свежие. Снова обновить можно через ${min} мин`);
      await load();
      return false;
    }
    if (response.status === 409 || response.status === 404 || response.status === 405) { await load(); return false; }   // вход истёк или старый сервер
    if (response.status !== 202) { say("Сейчас не удалось обновить кабинет"); return false; }
    refreshing = true;
    setStatus();
    const before = data?.syncedAt || "";
    (async () => {
      try {
        for (let i = 0; i < 30 && connection === config; i++) {
          await new Promise((r) => setTimeout(r, i ? 3000 : 1500));
          const next = await getSnapshot(config, AbortSignal.timeout(10000)).catch(() => null);
          if (next && (next.syncedAt !== before || next.status === "expired" || next.status === "error")) {
            refreshing = false;
            data = next;
            noteGrades();
            draw();
            if (next.status === "expired") say("Вход в кабинет вуза истёк — войдите снова");
            else if (next.status === "error") say("Сайт вуза не ответил — показаны прошлые данные");
            else say("Кабинет обновлён");
            return;
          }
        }
        say("Сайт вуза отвечает долго — данные обновятся чуть позже");
      } finally { refreshing = false; setStatus(); }
    })();
    return true;
  }

  function onClick(event) {
    const el = event.target.closest("[data-cab]");
    if (!el || !root.contains(el)) return;
    const act = el.dataset.cab;
    if (act === "open") {
      haptic("light");
      searchText = "";
      const target = `cab:${el.dataset.page}${el.dataset.arg !== undefined ? `:${el.dataset.arg}` : ""}`;
      if (app().go) app().go("cabinet", target, true);
      else { page = el.dataset.page; pageArg = el.dataset.arg ?? ""; draw(); }
    } else if (act === "step") {
      haptic("light");
      const i = +el.dataset.arg, open = el.getAttribute("aria-expanded") === "true";
      if (open) { openSteps.delete(i); closedSteps.add(i); } else { closedSteps.delete(i); openSteps.add(i); }
      draw();
    } else if (act === "teacher") {
      haptic("light");
      if (app().openTeacher) app().openTeacher(el.dataset.arg);
    } else if (act === "order") {
      haptic("light");
      const i = +el.dataset.arg;
      if (openOrders.has(i)) openOrders.delete(i); else openOrders.add(i);
      draw();
    } else if (act === "copy") {
      const r = ordersRows()[+el.dataset.arg];
      const text = r ? [r.title, r.number && !(r.title || "").includes(r.number) && `№ ${r.number} от ${r.date}`, r.text].filter(Boolean).join("\n") : "";
      const done = () => { haptic("light"); say("Скопировано"); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => say("Не удалось скопировать"));
      else say("Не удалось скопировать");
    } else if (act === "gradesem") {
      haptic("light");
      gradesSem = el.dataset.arg;
      draw();
      root.querySelector(".cab-chip.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    } else if (act === "plansem") {
      haptic("light");
      planSem = +el.dataset.arg;
      draw();
      root.querySelector(".cab-chip.on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    } else if (act === "relogin") {
      haptic("light");
      reauthenticating = true;
      draw();
      root.querySelector(".cabinet-form input")?.focus();
    } else if (act === "disconnect") {
      haptic("rigid");
      // уведомления о кабинете больше не нужны — просим сервер не слать (ответ не ждём)
      if (connection) fetch(endpoint(connection.address, "notify"), {
        method: "POST", headers: { Authorization: `Bearer ${connection.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "" }), credentials: "omit", referrerPolicy: "no-referrer", keepalive: true,
      }).catch(() => {});
      setConnection(null);
      gradeEvents = [];
      writeJSON(eventsKey, []);
      try { localStorage.removeItem("cabinet-notify"); } catch (e) { /* нет */ }
      try { localStorage.removeItem(knownKey); } catch (e) { /* нет */ }
      draw();
    }
  }

  window.studentCabinet = {
    refresh,
    reload: () => load(),
    // для ленты «Уведомлений» приложения
    feedItems: () => (connection ? gradeEvents.map((e) => ({ ts: e.ts, date: e.date, subject: e.subject, result: e.result, form: e.form, semester: e.semester })) : []),
    // target — состояние навигации приложения: «cab» — главный экран кабинета, «cab:grades» — раздел
    mount(container, target = "") {
      const match = /^cab:(\w+)(?::(\d+))?$/.exec(String(target));
      const next = match?.[1] || "home", arg = match?.[2] ?? "";
      if (root?.parentNode === container && root.isConnected && next === page && arg === pageArg) return;
      page = next;
      pageArg = arg;
      if (root?.parentNode !== container) {
        root = document.createElement("div");
        root.className = "cabinet";
        root.addEventListener("click", onClick);
        // строки-кнопки (div role="button") — и с клавиатуры
        root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[role="button"][data-cab]')) { e.preventDefault(); e.target.click(); } });
        root.addEventListener("input", (event) => {
          if (event.target.dataset?.cab === "search") { searchText = event.target.value; filterPeople(); }
        });
        container.replaceChildren(root);
      }
      draw();
      load();
    },
  };
  addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== connectionKey) return;
    const next = readConnection();
    if (JSON.stringify(next) === JSON.stringify(connection)) return;
    request?.abort();
    request = null;
    connection = next;
    data = null;
    reauthenticating = false;
    draw();
    load();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  setInterval(() => { if (!document.hidden && data?.status === "pending") load(); }, 4000);
})();
