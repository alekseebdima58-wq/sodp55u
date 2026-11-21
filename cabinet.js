(() => {
  "use strict";

  const connectionKey = "student-cabinet-connection";
  const officialSite = "https://newlk.samgups.ru/";
  const keyPattern = /^sc_[\da-f-]{36}\.[\w-]{43}$/;
  const pages = [
    ["profile", "Профиль", "user/profile", "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"],
    ["grades", "Зачётка", "student/book/list", "M5 4h14v16H5a2 2 0 0 1 0-4h14M5 4a2 2 0 0 0-2 2v12M8 10l2 2 4-4"],
    ["plan", "Учебный план", "student/curriculum", "M8 4h12M8 9h12M8 14h12M8 19h12M4 4h.01M4 9h.01M4 14h.01M4 19h.01"],
    ["group", "Моя группа", "dashboard", "M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m0-17a4 4 0 0 1 0 8m2 3a4 4 0 0 1 3 4v2"],
    ["orders", "Приказы", "student/orders", "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"],
    ["trajectory", "Траектория", "student/trajectory", "M4 18l6-6 4 4 6-9m-5 0h5v5"],
  ];
  const shortFields = { grades: ["Форма контроля", "Дата"], orders: ["Содержание"], trajectory: ["Контроль, нагрузка и статус"], profile: ["Значение"] };
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Samara" });
  let root, request;
  let selected = "grades";
  let connection = readConnection();
  let data = null;
  let reauthenticating = false;

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

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

  function sourceLink(label, path) {
    const link = element("a", "cabinet-source", label);
    link.href = new URL(path, officialSite).href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function connectionForm(previous = null) {
    const form = element("form", "list cabinet-form");
    form.append(element("h2", "", previous ? "Войти повторно" : "Войти в кабинет"));
    const notice = element("p", "cabinet-muted", "Логин и пароль передаются серверу приложения для входа на сайт ПривГУПС.");
    form.append(notice);
    const login = element("input");
    login.type = "text";
    login.required = true;
    login.maxLength = 256;
    login.autocomplete = "username";
    login.autocapitalize = "none";
    login.spellcheck = false;
    const password = element("input");
    password.type = "password";
    password.required = true;
    password.maxLength = 1024;
    password.autocomplete = "current-password";
    for (const [caption, input] of [["Логин ПривГУПС", login], ["Пароль ПривГУПС", password]]) {
      const label = element("label", "", caption);
      label.append(input);
      form.append(label);
    }
    const submit = element("button", "btn", "Войти");
    submit.type = "submit";
    submit.disabled = true;
    const error = element("p", "cabinet-muted");
    error.setAttribute("role", "alert");
    form.append(submit, error, sourceLink("Открыть на сайте вуза", "login"));
    if (previous) {
      const cancel = element("button", "btn", "Отмена");
      cancel.type = "button";
      cancel.addEventListener("click", () => { reauthenticating = false; draw(); });
      form.append(cancel);
    }
    let address;
    configuredServer().then(server => {
      if (previous && endpoint(server) !== previous.url) {
        error.textContent = "Это подключение относится к другому серверу. Отключи его и войди снова.";
        return;
      }
      address = server;
      notice.textContent = `Сервер ${new URL(server).host} получит логин и пароль для входа на сайт ПривГУПС.`;
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
          error.textContent = messages[result?.error] || "Сейчас не удалось войти в кабинет вуза.";
          return;
        }
        if (!form.isConnected || connection !== previous) return;
        setConnection({ address, key: result.key, url: endpoint(address) });
        data = result.snapshot;
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

  function syncStatus() {
    if (!data) return "Загрузка кабинета…";
    const date = Date.parse(data.syncedAt);
    const stamp = Number.isFinite(date) ? `Обновлено ${dateFormat.format(date)}` : "Обновлений пока нет";
    if (data.status === "pending") return "Первое обновление кабинета…";
    if (data.status === "expired") return `Войди в кабинет вуза повторно. ${stamp}.`;
    if (data.status === "error") return `Синхронизация временно недоступна. ${stamp}.`;
    if (data.status === "partial") return `Некоторые разделы пока не обновились. ${stamp}.`;
    return `${stamp}.`;
  }

  function sectionList(section, id) {
    if (!section.columns.length || !section.rows.length) return element("p", "cabinet-muted", "Нет данных для отображения.");
    const wrapper = element("div", "cabinet-semester");
    if (section.title) wrapper.append(element("h3", "sec", section.title));
    const list = element("ul", "list cabinet-list");
    const leadFields = { grades: "Дисциплина", orders: "Название", plan: "Дисциплина", trajectory: "Дисциплина", profile: "Поле", group: "ФИО" };
    const lead = Math.max(0, section.columns.indexOf(leadFields[id]));
    const result = id === "grades" ? section.columns.indexOf("Результат") : -1;
    for (const row of section.rows) {
      const item = element("li", "srow cabinet-row");
      const body = element("div", "body");
      const heading = element("div", "cabinet-row-heading");
      heading.append(element("span", "nm", row[lead] || "—"));
      if (row[result]) {
        const positive = /^(отлично|хорошо|зачтено|[45])$/i.test(row[result]);
        heading.append(element("span", `cabinet-result${positive ? " good" : ""}`, row[result]));
      }
      body.append(heading);
      const fields = element("dl", "cabinet-fields");
      const brief = element("div", "cabinet-brief");
      for (const [index, label] of section.columns.entries()) {
        if (index === lead || index === result || !row[index]) continue;
        if (shortFields[id]?.includes(label)) {
          brief.append(element("span", "", row[index]));
          continue;
        }
        const field = element("div");
        field.append(element("dt", "", label), element("dd", "", row[index]));
        fields.append(field);
      }
      if (fields.childElementCount) body.append(fields);
      if (brief.childElementCount) body.append(brief);
      item.append(body);
      list.append(item);
    }
    wrapper.append(list);
    return wrapper;
  }

  function iconPath(outline, size = 20) {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    for (const [key, value] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) icon.setAttribute(key, value);
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", outline);
    icon.append(path);
    return icon;
  }

  function profileSummary() {
    const fields = new Map(data?.sections?.profile?.flatMap(({ rows }) => rows));
    const name = fields.get("Имя") || fields.get("ФИО");
    const group = fields.get("Группа") || fields.get("Учебная группа");
    const course = fields.get("Курс");
    const meta = [group, /^\d+$/.test(course ?? "") ? `${course} курс` : course].filter(Boolean).join(" · ");
    return { name, meta };
  }

  function draw() {
    if (!root?.isConnected) return;
    const top = element("header", "top");
    const title = element("div");
    title.append(element("div", "eyebrow", "ПривГУПС"), element("h1", "", "Личный кабинет"));
    top.append(title);
    root.replaceChildren(top);
    if (!connection) { root.append(connectionForm()); return; }

    const status = element("p", "cabinet-muted", syncStatus());
    status.setAttribute("role", "status");
    status.dataset.cabinetStatus = "";
    const actions = element("div", "list cabinet-overview");
    const summary = element("div", "cabinet-summary");
    const { name, meta } = profileSummary();
    if (name) {
      const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
      const avatar = element("span", "cabinet-avatar", initials);
      avatar.setAttribute("aria-hidden", "true");
      actions.append(avatar);
      summary.append(element("p", "cabinet-name", name));
    }
    if (meta) summary.append(element("p", "cabinet-study", meta));
    summary.append(status);
    const expired = data?.status === "expired";
    const refresh = element("button", expired ? "btn" : "btn icon-btn", expired ? "Войти снова" : undefined);
    if (expired) refresh.addEventListener("click", () => { reauthenticating = true; draw(); });
    else {
      refresh.setAttribute("aria-label", "Проверить обновление");
      refresh.title = "Проверить обновление";
      refresh.append(iconPath("M20 11a8 8 0 1 0-2 6M20 4v7h-7"));
      refresh.addEventListener("click", () => load());
    }
    const disconnect = element("button", "cabinet-source flink", "Отключить");
    disconnect.setAttribute("aria-label", "Отключить на этом устройстве");
    disconnect.addEventListener("click", () => { setConnection(null); draw(); });
    actions.append(summary, refresh);
    root.append(actions);
    if (expired && reauthenticating) root.append(connectionForm(connection));

    const nav = element("div", "cabinet-pages");
    nav.setAttribute("role", "group");
    nav.setAttribute("aria-label", "Разделы кабинета");
    const section = element("section", "cabinet-content");
    section.setAttribute("aria-live", "polite");
    function drawSection() {
      for (const button of nav.children) button.setAttribute("aria-pressed", String(button.dataset.page === selected));
      const [, label, path] = pages.find(([id]) => id === selected);
      section.replaceChildren(element("h2", "", label));
      const tables = data?.sections?.[selected];
      if (data?.unavailable?.includes(selected)) section.append(element("p", "cabinet-muted", "Раздел пока не обновился."));
      if (Array.isArray(tables)) {
        for (const table of tables) section.append(sectionList(table, selected));
        if (!tables.length) section.append(element("p", "cabinet-muted", "В разделе пока нет записей."));
      } else if (data) section.append(element("p", "cabinet-muted", "Данные этого раздела пока недоступны."));
      const footer = element("div", "cabinet-footer");
      footer.append(sourceLink("Открыть на сайте вуза", path), disconnect);
      section.append(footer);
    }
    for (const [id, label, , outline] of pages) {
      const button = element("button", "btn cabinet-page");
      button.append(iconPath(outline, 19), element("span", "", label));
      button.dataset.page = id;
      button.addEventListener("click", () => { selected = id; drawSection(); });
      nav.append(button);
    }
    drawSection();
    root.append(nav, section);
  }

  async function load() {
    if (!connection || !root?.isConnected || request || reauthenticating) return;
    const controller = new AbortController();
    const thisConnection = connection;
    request = controller;
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const next = await getSnapshot(thisConnection, controller.signal);
      if (connection === thisConnection && JSON.stringify(data) !== JSON.stringify(next)) { data = next; draw(); }
    } catch (error) {
      const status = root?.querySelector("[data-cabinet-status]");
      if (connection === thisConnection && status) status.textContent = data ? `${error.message} ${syncStatus()}` : error.message;
    } finally {
      clearTimeout(timer);
      if (request === controller) request = null;
    }
  }

  window.studentCabinet = {
    mount(container) {
      if (root?.parentNode === container) return;
      root = element("div", "cabinet");
      container.replaceChildren(root);
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
