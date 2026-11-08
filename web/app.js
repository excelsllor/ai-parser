const store = {
  token: sessionStorage.getItem("token") || "",
  refresh: sessionStorage.getItem("refresh") || "",
  role: sessionStorage.getItem("role") || "",
  username: sessionStorage.getItem("username") || "",
  run: null,
  runTab: "digest",
  adminTab: "users",
  timer: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  } catch {
    return String(value);
  }
}

function setSession(data) {
  store.token = data.access_token || "";
  store.refresh = data.refresh_token || "";
  store.role = data.role || "";
  store.username = data.username || "";
  sessionStorage.setItem("token", store.token);
  sessionStorage.setItem("refresh", store.refresh);
  sessionStorage.setItem("role", store.role);
  sessionStorage.setItem("username", store.username);
}

function clearSession() {
  store.token = "";
  store.refresh = "";
  store.role = "";
  store.username = "";
  sessionStorage.clear();
}

function safeApiPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 2048) {
    throw new Error("invalid API path");
  }
  if (/[\u0000-\u001F\u007F]/.test(path)) {
    throw new Error("invalid API path");
  }
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error("cross-origin API path");
  }
  if (!url.pathname.startsWith("/api/") || url.pathname.includes("..") || url.pathname.includes("//")) {
    throw new Error("invalid API path");
  }
  return url.pathname + url.search;
}

async function api(path, options = {}) {
  const requestPath = safeApiPath(path);
  const headers = new Headers(options.headers || {});
  if (store.token) headers.set("Authorization", `Bearer ${store.token}`);
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(requestPath, { // NOSONAR - requestPath is validated same-origin /api/ path
    ...options,
    headers,
    body,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 401 && !requestPath.includes("/auth/login")) {
    clearSession();
    location.hash = "#/login";
    throw new Error("Требуется авторизация");
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      message = data?.error?.message || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) return response.json();
  return response.text();
}

async function downloadArtifact(runId, name) {
  const response = await fetch(`/api/runs/${runId}/artifacts/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${store.token}` },
  });
  if (!response.ok) {
    alert(`Не удалось скачать ${name}: HTTP ${response.status}`);
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function shell(content) {
  const isAdmin = store.role === "admin";
  const isWriter = store.role === "admin" || store.role === "analyst";
  $("#app").innerHTML = DOMPurify.sanitize(`
    <div class="layout">
      <aside class="sidebar">
        <h1>NEWS DIGEST</h1>
        <div class="nav">
          <a href="#/runs">Запуски</a>
          ${isWriter ? '<a href="#/new">Новый прогон</a>' : ""}
          ${isAdmin ? '<a href="#/admin">Админ-панель</a>' : ""}
          ${isAdmin ? '<a href="#/debug">Отладка</a>' : ""}
          ${isAdmin ? '<a href="#/audit">Аудит</a>' : ""}
        </div>
        <div style="margin-top:24px" class="pill">
          ${esc(store.username)} · ${esc(store.role)}<br>
          <button class="secondary small" id="logout" style="margin-top:10px">Выйти</button>
        </div>
      </aside>
      <main class="main">${content}</main>
    </div>`);
  $("#logout")?.addEventListener("click", logout);
}

function renderLogin() {
  $("#app").innerHTML = DOMPurify.sanitize(`
    <div style="max-width:420px;margin:10vh auto;padding:24px">
      <div class="card">
        <h1 style="margin-top:0">Дайджест по кибербезопасности</h1>
        <p class="muted">Вход в систему</p>
        <form id="loginForm">
          <label>Логин<input name="username" autocomplete="username" required></label>
          <div style="height:10px"></div>
          <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
          <div id="loginError" class="error"></div>
          <div style="height:12px"></div>
          <button type="submit">Войти</button>
        </form>
      </div>
    </div>`);
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { username: form.get("username"), password: form.get("password") },
      });
      setSession(data);
      location.hash = "#/runs";
    } catch (error) {
      $("#loginError").textContent = error.message;
    }
  });
}

async function logout() {
  try {
    if (store.refresh) {
      await api("/api/auth/logout", { method: "POST", body: { refresh_token: store.refresh } });
    }
  } catch {}
  clearSession();
  location.hash = "#/login";
}

async function renderRuns() {
  shell(`<div class="topbar"><h2>Запуски</h2><button id="refreshRuns" class="secondary">Обновить</button></div>
    <div id="runsBox" class="card">Загрузка…</div>`);
  const load = async () => {
    try {
      const runs = await api("/api/runs");
      if (!runs.length) {
        $("#runsBox").innerHTML = DOMPurify.sanitize('<p class="muted">Запусков пока нет.</p>');
        return;
      }
      $("#runsBox").innerHTML = DOMPurify.sanitize(`<table><thead><tr><th>Дата</th><th>Режим</th><th>Контрольное время</th><th>Статус</th><th>Модель</th><th></th></tr></thead><tbody>
        ${runs.map((run) => `<tr>
          <td>${esc(fmt(run.created_at))}</td>
          <td>${esc(run.mode)}</td>
          <td>${esc(fmt(run.control_time))}</td>
          <td><span class="badge ${run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "warn"}">${esc(run.status)}</span></td>
          <td>${esc(run.model)}</td>
          <td><a href="#/runs/${run.id}">Открыть</a></td>
        </tr>`).join("")}
      </tbody></table>`);
    } catch (error) {
      $("#runsBox").innerHTML = DOMPurify.sanitize(`<div class="error">${esc(error.message)}</div>`);
    }
  };
  $("#refreshRuns").addEventListener("click", load);
  await load();
}

async function renderNewRun() {
  let sources = [];
  try {
    sources = await api("/api/sources");
  } catch {}
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  shell(`<div class="topbar"><h2>Новый прогон</h2></div>
    <div class="card">
      <form id="runForm">
        <div class="grid">
          <label>Контрольное время (МСК)<input name="control_time" type="datetime-local" value="${esc(now)}" required></label>
          <label>Режим<select name="mode" id="mode"><option value="live">Живой сбор</option><option value="file">Файлы датасета</option></select></label>
          <label>Модель<input name="model" placeholder="из конфигурации"></label>
          <label>Версия промптов<input name="prompt_version" placeholder="v1"></label>
        </div>
        <div id="liveBox" style="margin-top:14px">
          <div class="pill">Источники для живого сбора</div>
          <div class="grid" style="margin-top:8px">
            ${sources.map((s, index) => `<label class="badge"><input type="checkbox" name="sources" value="${esc(s.id)}" style="width:auto;margin-right:6px" ${index < 5 ? "checked" : ""}> ${esc(s.name)} (${esc(s.kind)})</label>`).join("") || '<span class="muted">Нет включённых источников</span>'}
          </div>
        </div>
        <div id="fileBox" class="hidden" style="margin-top:14px">
          <label>Файлы датасета (JSON, CSV, HTML, TXT, ZIP)<input type="file" name="files" multiple></label>
        </div>
        <div id="runError" class="error"></div>
        <div style="height:12px"></div>
        <button type="submit">Запустить</button>
      </form>
    </div>`);
  $("#mode").addEventListener("change", (event) => {
    const live = event.target.value === "live";
    $("#liveBox").classList.toggle("hidden", !live);
    $("#fileBox").classList.toggle("hidden", live);
  });
  $("#runForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const run = await api("/api/runs", { method: "POST", body: form });
      location.hash = `#/runs/${run.id}`;
    } catch (error) {
      $("#runError").textContent = error.message;
    }
  });
}

async function renderRun(runId) {
  const isWriter = store.role === "admin" || store.role === "analyst";
  const content = `
    <div class="topbar">
      <h2>Выпуск</h2>
      <div class="row">
        <button id="backRuns" class="secondary">К списку</button>
        ${isWriter ? '<button id="rerun" class="secondary">Перезапустить</button>' : ""}
      </div>
    </div>
    <div id="runMeta" class="card">Загрузка…</div>
    <div id="runBody"></div>`;
  shell(content);
  $("#backRuns").addEventListener("click", () => (location.hash = "#/runs"));
  $("#rerun")?.addEventListener("click", async () => {
    try {
      const run = await api(`/api/runs/${runId}/rerun`, { method: "POST" });
      location.hash = `#/runs/${run.id}`;
    } catch (error) {
      alert(error.message);
    }
  });

  const load = async () => {
    try {
      const detail = await api(`/api/runs/${runId}`);
      store.run = detail;
      renderRunMeta(detail);
      renderRunBody(detail);
      if (["queued", "running"].includes(detail.run.status)) {
        clearTimeout(store.timer);
        store.timer = setTimeout(load, 3000);
      }
    } catch (error) {
      $("#runMeta").innerHTML = DOMPurify.sanitize(`<div class="error">${esc(error.message)}</div>`);
    }
  };
  await load();
}

function renderRunMeta(detail) {
  const run = detail.run;
  $("#runMeta").innerHTML = DOMPurify.sanitize(`
    <div class="row" style="justify-content:space-between">
      <div>
        <h3 style="margin:0">${esc(run.mode === "live" ? "Живой сбор" : "Файловый датасет")}</h3>
        <div class="pill">ID: ${esc(run.id)}</div>
      </div>
      <span class="badge ${run.status === "completed" ? "ok" : run.status === "failed" ? "bad" : "warn"}">${esc(run.status)}</span>
    </div>
    <div class="grid" style="margin-top:12px">
      <div><span class="muted">Период</span><br>${esc(fmt(run.period_start))} — ${esc(fmt(run.period_end))}</div>
      <div><span class="muted">Контрольное время</span><br>${esc(fmt(run.control_time))}</div>
      <div><span class="muted">Модель</span><br>${esc(run.model)}</div>
      <div><span class="muted">Промпты</span><br>${esc(run.prompt_version)}</div>
    </div>
    ${run.error ? `<div class="error">${esc(run.error)}</div>` : ""}
    <div class="row" style="margin-top:12px">
      ${["digest.md", "post.md", "journal.csv", "email.html", "ai.md", "run_stats.json", "check_results.json"]
        .map((name) => `<button class="secondary small" data-download="${name}">Скачать ${name}</button>`).join("")}
      ${store.role === "viewer" ? "" : '<button class="small" id="sendEmail">Отправить тестовое письмо</button>'}
    </div>`);
  $$("[data-download]").forEach((button) => {
    button.addEventListener("click", () => downloadArtifact(run.id, button.dataset.download));
  });
  $("#sendEmail")?.addEventListener("click", async () => {
    try {
      const result = await api(`/api/runs/${run.id}/email/send`, { method: "POST", body: {} });
      alert(`Письмо отправлено: ${result.to}`);
    } catch (error) {
      alert(error.message);
    }
  });
}

function renderRunBody(detail) {
  const run = detail.run;
  const tabs = ["digest", "post", "email", "journal", "checks", "events"];
  if (store.role === "admin" || store.role === "analyst") tabs.push("add");
  if (!tabs.includes(store.runTab)) store.runTab = "digest";
  const labels = {
    digest: "Дайджест",
    post: "Пост",
    email: "Письмо",
    journal: "Журнал",
    checks: "Проверки",
    events: "События",
    add: "Добавить публикацию",
  };
  $("#runBody").innerHTML = DOMPurify.sanitize(`
    <div class="tabs">${tabs.map((tab) => `<button data-tab="${tab}" class="${store.runTab === tab ? "active" : ""}">${labels[tab]}</button>`).join("")}</div>
    <div id="runTab" class="card">Загрузка…</div>`);
  $$("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      store.runTab = button.dataset.tab;
      renderRunBody(detail);
    });
  });
  void renderRunTab(detail);
}

async function renderRunTab(detail) {
  const run = detail.run;
  const tab = store.runTab;
  const box = $("#runTab");
  if (tab === "add" && store.role === "viewer") {
    box.innerHTML = DOMPurify.sanitize('<p class="muted">Недостаточно прав.</p>');
    return;
  }
  try {
    if (tab === "digest" || tab === "post") {
      const text = await api(`/api/runs/${run.id}/artifacts/${tab}.md`);
      box.innerHTML = DOMPurify.sanitize(`<pre>${esc(text)}</pre>`);
    } else if (tab === "email") {
      const html = await api(`/api/runs/${run.id}/artifacts/email.html`);
      box.innerHTML = `<iframe id="emailFrame"></iframe>`;
      $("#emailFrame").srcdoc = html;
    } else if (tab === "journal") {
      const rows = detail.journal || [];
      box.innerHTML = DOMPurify.sanitize(rows.length ? `<table><thead><tr><th>ID</th><th>Статус</th><th>Группа</th><th>Причина</th><th>Ошибка</th></tr></thead><tbody>
        ${rows.map((row) => `<tr>
          <td>${esc(row.external_id || row.item_id)}</td>
          <td><span class="badge ${row.status === "включён" ? "ok" : row.status === "объединён" ? "warn" : "bad"}">${esc(row.status)}</span></td>
          <td>${esc(row.group_key || "")}</td>
          <td>${esc(row.reason)}</td>
          <td>${esc(row.error || "")}</td>
        </tr>`).join("")}</tbody></table>` : '<p class="muted">Журнал пуст.</p>');
    } else if (tab === "checks") {
      const checks = await api(`/api/runs/${run.id}/checks`);
      box.innerHTML = DOMPurify.sanitize(checks.length ? `<table><thead><tr><th>Проверка</th><th>Результат</th><th>Комментарий</th></tr></thead><tbody>
        ${checks.map((check) => `<tr>
          <td>${esc(check.scenario)}</td>
          <td><span class="badge ${check.passed ? "ok" : "bad"}">${check.passed ? "пройдена" : "не пройдена"}</span></td>
          <td>${esc(check.note)}</td>
        </tr>`).join("")}</tbody></table>` : '<p class="muted">Проверки ещё не выполнены.</p>');
    } else if (tab === "events") {
      const events = detail.events || [];
      box.innerHTML = DOMPurify.sanitize(events.length ? events.map((event) => `
        <div class="card" style="background:var(--panel-2)">
          <h3>${esc(event.rank)}. ${esc(event.title)}</h3>
          <p><strong>Суть:</strong> ${esc(event.summary)}</p>
          <p><strong>Последствия:</strong> ${esc(event.consequences)}</p>
          <p><strong>Обоснование:</strong> ${esc(event.justification)}</p>
        </div>`).join("") : '<p class="muted">Событий нет.</p>');
    } else if (tab === "add") {
      box.innerHTML = DOMPurify.sanitize(`
        <h3>Добавить публикацию и перезапустить анализ</h3>
        <form id="addItemForm">
          <div class="grid">
            <label>Заголовок<input name="title" required></label>
            <label>Источник<input name="source" value="manual"></label>
            <label>URL<input name="url" placeholder="https://..."></label>
            <label>Дата публикации<input name="published_at" type="datetime-local"></label>
          </div>
          <div style="height:10px"></div>
          <label>Текст<textarea name="text" required></textarea></label>
          <div id="addError" class="error"></div>
          <div style="height:10px"></div>
          <button type="submit">Добавить и обработать</button>
        </form>`);
      $("#addItemForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        try {
          await api(`/api/runs/${run.id}/items`, {
            method: "POST",
            body: {
              title: form.get("title"),
              text: form.get("text"),
              source: form.get("source"),
              url: form.get("url"),
              published_at: form.get("published_at") ? new Date(form.get("published_at")).toISOString() : null,
            },
          });
          $("#addError").textContent = "";
          alert("Публикация добавлена, конвейер запущен.");
          location.reload();
        } catch (error) {
          $("#addError").textContent = error.message;
        }
      });
    }
  } catch (error) {
    box.innerHTML = DOMPurify.sanitize(`<div class="error">${esc(error.message)}</div>`);
  }
}

async function renderAdmin() {
  const tabs = ["users", "sources", "keywords", "settings"];
  shell(`
    <div class="topbar"><h2>Админ-панель</h2></div>
    <div class="tabs">${tabs.map((tab) => `<button data-admin-tab="${tab}" class="${store.adminTab === tab ? "active" : ""}">${
      { users: "Пользователи", sources: "Источники", keywords: "Ключевые слова", settings: "Настройки" }[tab]
    }</button>`).join("")}</div>
    <div id="adminBody" class="card">Загрузка…</div>`);
  $$("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      store.adminTab = button.dataset.adminTab;
      void renderAdmin();
    });
  });
  const box = $("#adminBody");
  try {
    if (store.adminTab === "users") {
      const users = await api("/api/admin/users");
      box.innerHTML = DOMPurify.sanitize(`
        <h3>Пользователи</h3>
        <table><thead><tr><th>Логин</th><th>Роль</th><th>Активен</th><th></th></tr></thead><tbody>
          ${users.map((u) => `<tr>
            <td>${esc(u.username)}</td>
            <td>${esc(u.role)}</td>
            <td>${u.is_active ? "да" : "нет"}</td>
            <td>
              <button class="secondary small" data-role="${u.id}" data-user="${u.username}">Сменить роль</button>
              <button class="danger small" data-disable="${u.id}">Отключить</button>
            </td>
          </tr>`).join("")}
        </tbody></table>
        <h4>Создать пользователя</h4>
        <form id="createUser"><div class="grid">
          <label>Логин<input name="username" required></label>
          <label>Пароль<input name="password" type="password" required></label>
          <label>Роль<select name="role"><option value="viewer">viewer</option><option value="analyst">analyst</option><option value="admin">admin</option></select></label>
        </div><div style="height:10px"></div><button>Создать</button></form>`);
      $$("[data-disable]").forEach((button) => button.addEventListener("click", async () => {
        if (!confirm("Отключить пользователя?")) return;
        await api(`/api/admin/users/${button.dataset.disable}`, { method: "DELETE" });
        void renderAdmin();
      }));
      $$("[data-role]").forEach((button) => button.addEventListener("click", async () => {
        const role = prompt("Новая роль: admin, analyst или viewer", "viewer");
        if (!role) return;
        await api(`/api/admin/users/${button.dataset.role}`, { method: "PUT", body: { role } });
        void renderAdmin();
      }));
      $("#createUser").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        try {
          await api("/api/admin/users", { method: "POST", body: { username: form.get("username"), password: form.get("password"), role: form.get("role") } });
          void renderAdmin();
        } catch (error) {
          alert(error.message);
        }
      });
    } else if (store.adminTab === "sources") {
      const sources = await api("/api/admin/sources");
      box.innerHTML = DOMPurify.sanitize(`
        <h3>Источники</h3>
        <table><thead><tr><th>Название</th><th>Тип</th><th>URL</th><th>Доверие</th><th>Включён</th><th></th></tr></thead><tbody>
          ${sources.map((s) => `<tr>
            <td>${esc(s.name)}</td><td>${esc(s.kind)}</td><td>${esc(s.url)}</td><td>${esc(s.trust)}</td><td>${s.enabled ? "да" : "нет"}</td>
            <td><button class="secondary small" data-toggle="${s.id}" data-enabled="${s.enabled}">${s.enabled ? "Отключить" : "Включить"}</button>
            <button class="danger small" data-delete="${s.id}">Удалить</button></td>
          </tr>`).join("")}
        </tbody></table>
        <h4>Добавить источник</h4>
        <form id="createSource"><div class="grid">
          <label>Название<input name="name" required></label>
          <label>Тип<select name="kind"><option value="rss">rss</option><option value="html">html</option></select></label>
          <label>URL<input name="url" required></label>
          <label>Доверие<select name="trust"><option value="unknown">unknown</option><option value="primary">primary</option><option value="reprint">reprint</option></select></label>
        </div><div style="height:10px"></div><button>Добавить</button></form>`);
      $$("[data-toggle]").forEach((button) => button.addEventListener("click", async () => {
        await api(`/api/admin/sources/${button.dataset.toggle}`, { method: "PUT", body: { enabled: button.dataset.enabled !== "true" } });
        void renderAdmin();
      }));
      $$("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
        if (!confirm("Удалить источник?")) return;
        await api(`/api/admin/sources/${button.dataset.delete}`, { method: "DELETE" });
        void renderAdmin();
      }));
      $("#createSource").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        try {
          await api("/api/admin/sources", { method: "POST", body: { name: form.get("name"), kind: form.get("kind"), url: form.get("url"), trust: form.get("trust") } });
          void renderAdmin();
        } catch (error) {
          alert(error.message);
        }
      });
    } else if (store.adminTab === "keywords") {
      const keywords = await api("/api/admin/keywords");
      box.innerHTML = DOMPurify.sanitize(`
        <h3>Ключевые слова</h3>
        <div class="row" style="flex-wrap:wrap">
          ${keywords.map((k) => `<span class="badge">${esc(k.word)} <button class="danger small" data-delete-keyword="${k.id}">×</button></span>`).join("")}
        </div>
        <h4>Добавить слово</h4>
        <form id="createKeyword" class="row"><input name="word" required style="max-width:320px"><button>Добавить</button></form>`);
      $$("[data-delete-keyword]").forEach((button) => button.addEventListener("click", async () => {
        await api(`/api/admin/keywords/${button.dataset.deleteKeyword}`, { method: "DELETE" });
        void renderAdmin();
      }));
      $("#createKeyword").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        await api("/api/admin/keywords", { method: "POST", body: { word: form.get("word") } });
        void renderAdmin();
      });
    } else {
      const settings = await api("/api/admin/settings");
      box.innerHTML = DOMPurify.sanitize(`<h3>Настройки</h3><pre>${esc(JSON.stringify(settings, null, 2))}</pre>
        <h4>Изменить настройку</h4>
        <div class="grid">
          <label>Ключ<select id="settingKey"><option value="weights">weights</option><option value="model">model</option><option value="prompt_version">prompt_version</option><option value="selection">selection</option></select></label>
        </div>
        <div style="height:10px"></div>
        <label>JSON-значение<textarea id="settingValue">{"impact":0.35,"scale":0.25,"urgency":0.2,"relevance":0.15,"confidence":0.05,"uncertainty_penalty":0.15}</textarea></label>
        <div style="height:10px"></div>
        <button id="saveSetting">Сохранить</button>`);
      $("#saveSetting").addEventListener("click", async () => {
        try {
          const value = JSON.parse($("#settingValue").value);
          await api("/api/admin/settings", {
            method: "PUT",
            body: { key: $("#settingKey").value, value },
          });
          void renderAdmin();
        } catch (error) {
          alert(error.message);
        }
      });
    }
  } catch (error) {
    box.innerHTML = DOMPurify.sanitize(`<div class="error">${esc(error.message)}</div>`);
  }
}

async function renderDebug() {
  shell(`<div class="topbar"><h2>Отладка</h2></div>
    <div class="card"><h3>Сервисы</h3><pre id="services">Загрузка…</pre></div>
    <div class="card"><h3>Вызовы LLM</h3><div id="llmCalls">Загрузка…</div></div>`);
  try {
    const services = await api("/api/admin/debug/services");
    $("#services").textContent = JSON.stringify(services, null, 2);
    const calls = await api("/api/admin/debug/llm-calls");
    $("#llmCalls").innerHTML = DOMPurify.sanitize(calls.length ? `<table><thead><tr><th>Время</th><th>Назначение</th><th>Модель</th><th>Токены</th><th>Стоимость</th><th>мс</th><th>OK</th></tr></thead><tbody>
      ${calls.map((c) => `<tr>
        <td>${esc(fmt(c.created_at))}</td><td>${esc(c.purpose)}</td><td>${esc(c.model)}</td>
        <td>${esc(c.input_tokens)} / ${esc(c.output_tokens)}</td><td>${esc(c.cost)}</td><td>${esc(c.latency_ms)}</td>
        <td>${c.ok ? "да" : "нет"}</td>
      </tr>`).join("")}</tbody></table>` : '<p class="muted">Вызовов пока нет.</p>');
  } catch (error) {
    $("#services").textContent = error.message;
  }
}

async function renderAudit() {
  shell(`<div class="topbar"><h2>Аудит</h2></div><div class="card" id="auditBox">Загрузка…</div>`);
  try {
    const rows = await api("/api/admin/audit?limit=200");
    $("#auditBox").innerHTML = DOMPurify.sanitize(rows.length ? `<table><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Ресурс</th><th>IP</th><th>Детали</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td>${esc(fmt(r.created_at))}</td><td>${esc(r.actor_username)}</td><td>${esc(r.action)}</td>
        <td>${esc(r.resource)}</td><td>${esc(r.ip)}</td><td><code>${esc(JSON.stringify(r.detail))}</code></td>
      </tr>`).join("")}</tbody></table>` : '<p class="muted">Записей нет.</p>');
  } catch (error) {
    $("#auditBox").innerHTML = DOMPurify.sanitize(`<div class="error">${esc(error.message)}</div>`);
  }
}

async function route() {
  clearTimeout(store.timer);
  const hash = location.hash.replace(/^#/, "") || "/runs";
  const parts = hash.split("/").filter(Boolean);
  if (!store.token) {
    renderLogin();
    return;
  }
  if (parts[0] === "runs" && parts[1]) {
    await renderRun(parts[1]);
  } else if (parts[0] === "new") {
    await renderNewRun();
  } else if (parts[0] === "admin") {
    if (store.role !== "admin") return (location.hash = "#/runs");
    await renderAdmin();
  } else if (parts[0] === "debug") {
    if (store.role !== "admin") return (location.hash = "#/runs");
    await renderDebug();
  } else if (parts[0] === "audit") {
    if (store.role !== "admin") return (location.hash = "#/runs");
    await renderAudit();
  } else {
    await renderRuns();
  }
}

window.addEventListener("hashchange", route);
void route();
