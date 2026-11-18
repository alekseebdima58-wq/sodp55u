(() => {
  "use strict";

  const connectionKey = "student-cabinet-connection";
  const officialSite = "https://newlk.samgups.ru/";
  const pages = [
    ["grades", "Зачётка", "student/book/list"],
    ["orders", "Приказы", "student/orders"],
    ["plan", "Учебный план", "student/curriculum"],
    ["trajectory", "Траектория", "student/trajectory"],
    ["profile", "Профиль", "user/profile"],
    ["group", "Моя группа", "dashboard"],
  ];
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Samara" });
  let root, request;
  let selected = pages[0][0];
  let connection = readConnection();
  let data = null;

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function endpoint(address) {
    const url = new URL(address);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
      throw new Error("Укажи HTTPS-адрес сервера подключения.");
    }
    return new URL(`${url.pathname.replace(/\/$/, "")}/cabinet/v1/snapshot`, url.origin).href;
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

  function connectionForm() {
    const form = element("form", "cabinet-card cabinet-form");
    form.append(element("h2", "", "Подключить кабинет"));
    form.append(element("p", "cabinet-muted", "Введи адрес сервера и свой ключ подключения."));
    const address = element("input");
    address.type = "url";
    address.placeholder = "https://";
    address.required = true;
    address.autocapitalize = "none";
    const key = element("input");
    key.type = "password";
    key.required = true;
    key.autocomplete = "off";
    for (const [caption, input] of [["Адрес сервера", address], ["Ключ подключения", key]]) {
      const label = element("label", "", caption);
      label.append(input);
      form.append(label);
    }
    const submit = element("button", "btn", "Подключить");
    submit.type = "submit";
    const error = element("p", "cabinet-muted");
    error.setAttribute("role", "alert");
    form.append(submit, error, sourceLink("Открыть на сайте вуза", "login"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      let url;
      try { url = endpoint(address.value.trim()); }
      catch { error.textContent = "Укажи HTTPS-адрес сервера подключения."; return; }
      const next = { address: address.value.trim(), key: key.value.trim(), url };
      if (!/^sc_[\da-f-]{36}\.[\w-]{43}$/i.test(next.key)) {
        error.textContent = "Проверь ключ подключения.";
        return;
      }
      error.textContent = "";
      submit.disabled = true;
      try {
        const response = await getSnapshot(next, AbortSignal.timeout(12000));
        if (!form.isConnected) return;
        setConnection(next);
        data = response;
        draw();
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        submit.disabled = false;
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
    if (data.status === "expired") return `Войди в кабинет вуза повторно. ${stamp}.`;
    if (data.status === "error") return `Синхронизация временно недоступна. ${stamp}.`;
    return `${stamp}.`;
  }

  function sectionTable(section) {
    const wrapper = element("div", "cabinet-card cabinet-table");
    if (!section.columns.length || !section.rows.length) return element("p", "cabinet-muted", "Нет данных для отображения.");
    const table = element("table");
    if (section.title) table.append(element("caption", "", section.title));
    const header = element("tr");
    for (const column of section.columns) {
      const cell = element("th", "", column);
      cell.scope = "col";
      header.append(cell);
    }
    table.createTHead().append(header);
    const body = table.createTBody();
    for (const row of section.rows) {
      const line = element("tr");
      for (const cell of row) line.append(element("td", "", cell));
      body.append(line);
    }
    wrapper.append(table);
    return wrapper;
  }

  function draw() {
    if (!root?.isConnected) return;
    const top = element("header", "top");
    top.append(element("h1", "", "Личный кабинет"));
    root.replaceChildren(top);
    if (!connection) { root.append(connectionForm()); return; }

    const status = element("p", "cabinet-muted", syncStatus());
    status.setAttribute("role", "status");
    status.dataset.cabinetStatus = "";
    const actions = element("div", "cabinet-actions");
    const refresh = element("button", "btn", "Проверить обновление");
    refresh.addEventListener("click", () => load());
    const disconnect = element("button", "btn", "Отключить на этом устройстве");
    disconnect.addEventListener("click", () => { setConnection(null); draw(); });
    actions.append(refresh, disconnect);
    root.append(status, actions);

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
      if (Array.isArray(tables) && tables.length) {
        for (const table of tables) section.append(sectionTable(table));
      } else if (data) section.append(element("p", "cabinet-muted", "Данные этого раздела пока недоступны."));
      section.append(sourceLink("Открыть раздел на сайте вуза", path));
    }
    for (const [id, label] of pages) {
      const button = element("button", "btn", label);
      button.dataset.page = id;
      button.addEventListener("click", () => { selected = id; drawSection(); });
      nav.append(button);
    }
    drawSection();
    root.append(nav, section);
  }

  async function load() {
    if (!connection || !root?.isConnected || request) return;
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
    draw();
    load();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, 60000);
})();
