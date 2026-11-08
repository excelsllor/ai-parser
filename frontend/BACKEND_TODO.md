# Frontend features waiting for backend

Состояние: фронт готов, backend не менялся. Всё ниже — заглушки или ограничения, которые нужно закрыть API.

## 1. Удаление сессии / запуска

Кнопки уже есть:
- в списке сессий — `src/components/workspace/WorkspaceLayout.tsx`;
- на странице запуска — `src/pages/workspace/RunPage.tsx`;
- обработчик-заглушка — `src/pages/workspace/WorkspacePage.tsx`.

Сейчас кнопка показывает notice «будет доступно после подключения backend».

Нужно:
- `DELETE /api/runs/{id}`;
- проверка прав (`require_write` или admin);
- каскадное удаление из БД (`runs` уже связан с items/events/stages/journal/artifacts через `ON DELETE CASCADE`);
- удаление файлов запуска (`Config::run_dir(id)`);
- audit-запись `run.deleted`.

## 2. Профиль

Файл: `src/pages/profile/ProfilePage.tsx`.

Уже работает:
- `GET /api/auth/me` — username, role, is_active, created_at.

Не подключено:
- смена email — в `users` нет email и кода подтверждения;
- смена пароля — нет endpoint;
- полное имя / подразделение — нет полей в БД;
- список активных сессий и их завершение — нет endpoint, UI показывает только текущий браузер;
- «Завершить все другие сессии» — заглушка.

Ориентировочные endpoints:
- `PATCH /api/auth/me` — `{ display_name?, department?, email? }`;
- `POST /api/auth/email/request` + `POST /api/auth/email/confirm`;
- `POST /api/auth/password` — `{ current_password, new_password }`;
- `GET /api/auth/sessions` → список refresh-сессий;
- `DELETE /api/auth/sessions/{id}`;
- `DELETE /api/auth/sessions` — все кроме текущей.

## 3. Параметры создания запроса

Файл: `src/pages/workspace/WorkspacePage.tsx`.

Ограничения:
- интервал 12/48 часов отключён: backend всегда считает `period_start = control_time - 24h` в `crates/gateway/src/handlers/runs.rs`;
- количество новостей 3/7/10 отключено: нет per-run поля, лимит задаётся регламентом/конфигом;
- переключатели «Склейка дубликатов», «Prompt Injection», «Без оценок» включены жёстко: нет per-run флагов;
- новый UI работает только в live-режиме. Backend уже принимает `mode=file` и файлы (`files`), нужен UI загрузки;
- `control_time`, `model`, `prompt_version` не выведены, хотя backend их принимает;
- оценка времени на фронте приблизительная, по числу источников/новостей/интервалу.

Нужно:
- `interval_hours` в multipart create run и использование в pipeline;
- `max_items` / `news_count` и учёт в reporter;
- флаги политик, если их нужно менять per-run;
- UI файлового режима;
- (опционально) выбор модели и prompt version.

## 4. Результаты запуска

Файл: `src/pages/workspace/RunPage.tsx`.

Работает на существующих endpoint'ах:
- `GET /api/runs/{id}`;
- `GET /api/runs/{id}/status`;
- `GET /api/runs/{id}/checks`;
- `GET /api/runs/{id}/artifacts/{name}`;
- `POST /api/runs/{id}/rerun`;
- `POST /api/runs/{id}/email/send`;
- артефакты: `digest.md`, `post.md`, `email.html`, `email_subject.txt`, `journal.csv`, `check_results.json`, `run_stats.json`.

Модалка «Перегенерировать дайджест»:
- для live-запуска создаёт новый run через `POST /api/runs` с выбранными источниками и `control_time`;
- для file-запуска использует `POST /api/runs/{id}/rerun`, параметры игнорируются;
- интервал 12/48 и лимит 3/7 в модалке — UI-only, backend их пока не принимает;
- фильтры нормализации/безопасности — UI-only, применяются всегда.

Версии запусков:
- UI строит цепочку версий по `parent_run_id`-подобной связи, но хранит её только в `localStorage` (`cd_run_versions`), поэтому версии видны лишь в том браузере, где создавались;
- стрелки в футере переключают только связанные через модалку запуски;
- backend должен добавить `parent_run_id` (или `session_id`) в `runs` и отдавать его в `GET /api/runs`.

Не подключено:
- версии/сравнение запусков — backend версий не хранит;
- отправка письма на произвольный адрес: UI отправляет только на тестовый адрес из конфига, хотя backend принимает `to`;
- полноценный просмотр вложений/скачивание ZIP — нет;
- удаление запуска (см. п.1).

## 5. Админ-панель

Файлы: `src/pages/admin/*`, `src/api/admin.ts`, роуты `/admin`, `/admin/sources`, `/admin/llm`, `/admin/users`, `/admin/services`.

Работает на существующих endpoint'ах:
- `GET/POST /api/admin/users`, `PUT/DELETE /api/admin/users/{id}`;
- `GET/POST /api/admin/sources`, `PUT/DELETE /api/admin/sources/{id}`;
- `GET/POST/DELETE /api/admin/keywords`;
- `GET/PUT /api/admin/settings`;
- `GET /api/admin/audit`;
- `GET /api/admin/debug/llm-calls`, `GET /api/admin/debug/services`.

Ограничения:
- `DELETE /api/admin/users/{id}` фактически деактивирует пользователя, а не удаляет; UI так и подписан;
- в `users` нет email, подразделения, 2FA, истории входов и сессий;
- метрики обзора считаются на клиенте из `GET /api/runs?limit=50`, последних 200 `llm_calls` и audit; отдельного aggregate endpoint нет;
- у источников нет расписания синхронизации, статистики последнего парсинга и ошибок; UI показывает только конфиг;
- квота токенов, тариф и стоимость заданы на фронте/в конфиге; `llm_calls.cost` приходит нулевым;
- здоровье сервисов — только live-снимок `debug/services`, истории healthcheck нет;
- настройки `weights` только читаются; редактируются `model` и `prompt_version`.

Нужно:
- aggregate endpoint `GET /api/admin/metrics?window=24h` (runs, tokens, cost, durations, status counts);
- `GET /api/admin/health/history` для журнала проверок;
- реальное удаление пользователя или отдельный `disable`;
- поля профиля/2FA/сессии для админки;
- статистика источников: `last_synced_at`, `last_error`, `items_collected`.

## 6. Прочие заглушки

- Пункты меню профиля «Инциденты», «Разведка угроз», «Журнал аудита» — notice «пока не подключено».
- Кнопка «Завершить все другие сессии» — notice.
- В сайдбаре показывается только дата сессии; режим/количество событий не выводятся.
- Счётчик просмотров/реакций в Telegram-посте — локальная декоративная генерация, не из БД.

## Быстрый чек-лист для backend-агента

1. `DELETE /api/runs/{id}` + файлы + audit.
2. Профиль: email, password, display_name/department, sessions.
3. `interval_hours` и `max_items` в создании запуска и пайплайне.
4. UI файлового режима (после п.3 можно не менять API — multipart уже есть).
5. Версионирование запусков, если нужно сравнение.
6. Админ-метрики, healthcheck-история, реальное удаление пользователей, статистика источников.
