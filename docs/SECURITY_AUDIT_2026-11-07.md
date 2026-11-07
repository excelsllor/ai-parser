# Аудит безопасности работающего стека — 2026-11-07

## Область аудита

- исходный код Rust-сервисов и shared-библиотеки;
- Dockerfile, docker-compose, конфигурация контейнеров;
- работающий стек: gateway, collector, normalizer, analyst, critic, reporter,
  PostgreSQL, Redis, Kafka, Mailpit;
- HTTP-поверхность, аутентификация, роли, SSRF, path traversal, prompt injection,
  зависимости и образы контейнеров.

## Инструменты

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `cargo audit`
- Trivy 0.76.2: `trivy fs`, `trivy image`
- `docker compose config`, `docker inspect`, `ss`, HTTP-проверки `curl`

## Результаты проверок

### Код и зависимости

| Проверка | Результат |
|---|---|
| fmt | OK |
| clippy (`-D warnings`) | OK |
| tests | 24 теста пройдено |
| cargo audit | без уязвимостей; `rsa` в lock только как optional-зависимость `sqlx-mysql`, не компилируется; `fxhash` — unmaintained-предупреждение |
| Trivy fs (HIGH/CRITICAL, ignore-unfixed) | 0 уязвимостей, 0 секретов, 0 misconfig |
| Trivy image `news-backend:latest` | 0 HIGH/CRITICAL |

### Контейнеры

| Компонент | Пользователь | read-only | privileged | cap_drop | no-new-privileges |
|---|---|---|---|---|---|
| gateway/collector/normalizer/analyst/critic/reporter | 10001 | да | нет | ALL | да |
| postgres | default (entrypoint) | нет | нет | нет | да |
| redis | default (entrypoint) | нет | нет | нет | да |
| kafka | appuser | нет | нет | нет | да |
| mailpit | mailpit | нет | нет | нет | да |

- Docker socket не смонтирован ни в один контейнер.
- Наружу опубликованы только `127.0.0.1:8080` (gateway) и `127.0.0.1:8025` (Mailpit).
- PostgreSQL, Redis и Kafka не имеют published ports.
- Образ приложения работает от `uid=10001`, без root.

### HTTP и аутентификация

| Проверка | Результат |
|---|---|
| `/api/health` | 200, только `{"status":"ok"}` |
| `/api/runs`, `/api/admin/*` без токена | 401 |
| `/metrics` без токена | 404 |
| `/metrics` с `X-Metrics-Token` | 200 |
| Неверная подпись JWT | 401 `invalid_token` |
| Просроченный/старый refresh token | 401 |
| Ротация refresh token | старый токен отозван |
| Viewer: создание run / admin endpoint | 403 |
| SQL-injection в логине | 401, запрос параметризован |
| Rate limit логина | 429 после 10 попыток за минуту; восстановление через 60 с |
| Пароли в БД | Argon2id, длина хэша 97 |
| Refresh-токены в БД | SHA-256, длина 64 hex |
| CORS | `Access-Control-Allow-Origin` только для allowlist |
| Security headers | CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP/CORP |
| SSRF `http://127.0.0.1`, `file://` | 400 `unsafe_url` |
| Path traversal артефактов | 404 JSON |
| Неизвестный `/api/*` | 404 JSON, не SPA |
| Email send | 200, письмо доставлено в Mailpit |
| Демо-прогон | 20/20 проверок passed, `check_digest.py` — OK |

### Prompt injection и данные

- В демо-наборе публикация с инструкцией «Игнорируй предыдущие инструкции…»
  обработана как данные; в журнале отмечено «обнаружена посторонняя инструкция»;
  инструкция не изменила получателей и задачу.
- CSV/formula injection: значения журнала экранируются.
- Ссылки в письме допускаются только `http/https`.

## Найденные проблемы и статус

| # | Серьёзность | Проблема | Статус |
|---|---|---|---|
| 1 | High | Ошибка проверки JWT возвращала HTTP 500 `jwt_error` вместо 401 | **Исправлено**: 401 `invalid_token`, добавлен тест |
| 2 | Medium | `mailhog/mailhog:v1.0.1`: 74 HIGH/CRITICAL (Alpine 3.12, Go) | **Исправлено**: заменён на `axllent/mailpit:v1.33`, Trivy — 0 HIGH/CRITICAL |
| 3 | Medium | `postgres:16-alpine`: 26 HIGH/CRITICAL, в основном gosu (Go stdlib) | Принято для dev; для production обновить образ и выполнить миграцию данных |
| 4 | Medium | `apache/kafka:3.9.0`: 30 HIGH/CRITICAL (Alpine 3.20.3, commons-beanutils) | Принято для dev; для production обновить Kafka-образ и проверить совместимость |
| 5 | Medium | Инфраструктурные контейнеры не read-only и без cap_drop | Частично: добавлен `no-new-privileges`; stateful-сервисам нужен writable FS. Сеть изолирована, порты не опубликованы |
| 6 | Medium | Kafka/Redis/PostgreSQL внутри compose без TLS/SASL | Принято для локального стенда; клиенты поддерживают SASL_SSL, `rediss://`, `sslmode`; включить в production |
| 7 | Low | Тестовый аккаунт `demo` с ролью admin и известным паролем | Оставить только для демо; перед production удалить/отключить |
| 8 | Low | Access token хранится в `sessionStorage` | CSP снижает риск XSS; для production — HttpOnly/Secure/SameSite cookie + CSRF |
| 9 | Low | DNS rebinding residual: URL проверяется, но reqwest резолвит повторно | Для строгого режима закрепить IP/использовать egress-proxy |
| 10 | Low | Mailpit API без аутентификации | Порт привязан к 127.0.0.1; использовать только для dev |
| 11 | Low | `curl` в runtime-образе для healthcheck | Уменьшает поверхность, если заменить на минимальный healthcheck-бинарник |
| 12 | Info | Неизвестные `/api/*` отдавали SPA index с 200 | **Исправлено**: JSON 404 |

## Остаточные рекомендации

1. Перед production обновить PostgreSQL и Kafka до актуальных patch/minor-образов,
   проверить миграцию данных и совместимость KRaft-конфигурации.
2. Включить TLS/SASL для Kafka, `rediss://` для Redis, `sslmode=verify-full` для PostgreSQL.
3. Удалить/отключить демо-аккаунты, завести персональные учётные записи.
4. Перенести refresh token в HttpOnly cookie, добавить CSRF-защиту.
5. Добавить WAF/anti-DDoS и антивирусную проверку загружаемых файлов.
6. Использовать secrets manager/Vault вместо `.env` в production.
7. Добавить в CI скан образов Trivy после сборки и Dependabot-обновления.
8. Ограничить egress контейнеров allowlist-прокси (снижает SSRF/DNS rebinding).

## Итог

Критических проблем, эксплуатируемых без аутентификации, не обнаружено.
Найдена и исправлена ошибка статуса JWT; заменён уязвимый MailHog; усилена
конфигурация инфраструктурных контейнеров; проверены auth, роли, SSRF,
path traversal, SQL injection, rate limit, prompt injection и формат артефактов.
