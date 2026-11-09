# Безопасность: модель угроз, меры и аудит

## 1. Границы доверия

```
Интернет / пользователь
        │ HTTPS (TLS 1.3 на reverse proxy)
        ▼
[gateway] ── внутренняя сеть Docker ── [PostgreSQL] [Redis] [Kafka] [worker-сервисы]
        │
        └── внешние источники RSS/HTML и vLLM API
```

- Наружу опубликован только `gateway` (и Mailpit UI в демо-режиме).
- PostgreSQL, Redis и Kafka доступны только внутри Docker-сети.
- Все сервисы работают от `uid 10001`, root FS `read-only`, `cap_drop: ALL`,
  `no-new-privileges: true`.
- Данные и артефакты — в named volume `news_data`; БД — в `pgdata`.

## 2. Аутентификация и авторизация

- Пароли: Argon2id (`argon2` 0.5, параметры по умолчанию), минимум 10 символов,
  обязательны буква и цифра.
- Access token: JWT HS256, TTL 60 минут, секрет ≥ 32 символов (в prod обязателен).
- Refresh token: 48 случайных байт, в БД хранится только SHA-256, ротация при
  каждом refresh, отзыв при logout, очистка просроченных токенов.
- Роли: `admin`, `user`; проверка на каждом запросе, включая
  `is_active` пользователя.
- Анти-брутфорс: 10 попыток логина в минуту на IP; общий лимит API 600 запросов
  в минуту на IP+path.
- Ошибки логина не раскрывают, существует ли пользователь.
- Все действия пишутся в `audit_log` (кто, когда, что, IP).

## 3. Транспорт и заголовки

Пример TLS 1.3 reverse proxy: `Caddyfile.public` (домен) или `Caddyfile.internal` (IP).

- Внешний контур: TLS 1.3 на reverse proxy (Caddy/nginx), HTTP/2, HSTS.
- Gateway отдаёт: CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP/CORP.
- CSP запрещает inline-скрипты и сторонние источники; статический UI собирается Vite и отдаётся gateway из `/app/web`.
- CORS — только явный allowlist из `CORS_ORIGINS`.
- gRPC между сервисами работает по h2c внутри Docker-сети; порты 50051 не
  публикуются. Для production включите TLS/mTLS для gRPC.
- Внутренние сервисы не публикуют порты. Kafka-клиент поддерживает `SASL_SSL`
  (`KAFKA_SECURITY_PROTOCOL`, `KAFKA_SASL_*`, `KAFKA_SSL_CA_FILE`); в compose
  по умолчанию PLAINTEXT внутри изолированной сети. Для production включите
  SASL_SSL/mTLS, Redis TLS (`rediss://`), PostgreSQL TLS, mTLS между сервисами.

## 4. Ввод и SSRF

- Лимиты: 20 МБ на файл, 64 МБ на загрузку, 20 файлов, 64 МБ тело запроса.
- Имена файлов санитизируются; путь проверяется на выход за `DATA_DIR`.
- Архивы читаются вручную, без `extract`, с лимитами на количество и размер
  записей; `..` в именах отклоняется. `zip` обновлён до 9.4.1 из-за
  RUSTSEC-2026-0367/0368/0369/0429.
- Живой сбор: только `http/https`, порты 80/443, запрет credentials в URL,
  запрет localhost/private/link-local/loopback, DNS-резолв проверяется,
  каждый редирект валидируется отдельно, не более 5 редиректов.
- Таймауты, ограничение размера ответа, User-Agent, rate limit на хост.
- SQL — только параметризованные запросы `sqlx`.
- Все тексты экранируются при выводе в HTML; URL в письме допускаются только
  `http/https`.

## 5. Prompt injection и галлюцинации

- Статья передаётся в LLM как недоверенные данные в `<article>...</article>`.
- Системный промпт запрещает выполнять инструкции из статьи, менять правила,
  получателей и выводить промпт.
- Детектор подозрительных конструкций (`ignore previous instructions`,
  «игнорируй инструкции», «выведи промпт», «измени получателей» и т.п.);
  факт обнаружения пишется в журнал.
- JSON-схема ответа, парсинг с извлечением JSON, проверка типов и диапазонов.
- Critic сверяет числа с текстом источников, проверяет ссылки по реестру
  материалов, удаляет источники, которых нет в наборе.
- Получатели письма задаются конфигурацией и не могут быть изменены текстом
  новости; отправка разрешена только на `TEST_RECIPIENT`.
- Модель не вызывает инструменты и не имеет доступа к файлам/сети.

## 6. Секреты и логи

- Секреты только в `.env` или секретах CI; `.env` в `.gitignore`.
- `.env.example` содержит только плейсхолдеры.
- Bootstrap-пароль при генерации пишется в `data/bootstrap_password.txt` с правами `0600`.
- JWT/пароли/API-ключи не логируются.
- В аудит попадают только метаданные действий, без тел документов и секретов.
- LLM-вызовы логируются хэшем промпта, токенами, стоимостью и латентностью,
  без полного текста статьи.

## 7. Контейнеры и CI/CD

- Multi-stage Dockerfile, runtime на `debian:bookworm-slim`, non-root.
- `read_only`, `tmpfs /tmp`, `cap_drop: ALL`, `no-new-privileges`.
- Healthcheck gateway, healthcheck Postgres/Redis/Kafka.
- CI: `cargo fmt`, `cargo clippy -D warnings`, `cargo test`, frontend lint/build,
  сборка образа с SBOM и provenance, публикация в GHCR.
- Деплой только из `main` через защищённое окружение `production` и SSH-ключ.

## 8. Результаты аудита (2026-11-07)

| Проверка | Результат |
|---|---|
| `cargo clippy --workspace --all-targets -- -D warnings` | без предупреждений |
| `cargo test --workspace` | 25 тестов пройдено |
| `cargo audit` | `zip` обновлён до 9.4.1; `rsa` остаётся в lock только как optional-зависимость `sqlx-mysql` и не компилируется; `fxhash` — unmaintained, без известных уязвимостей |
| `docker compose config` | конфигурация валидна |
| Ручной обзор | секретов в коде нет; SQL параметризован; SSRF-проверки есть; path traversal закрыт; HTML экранируется; получатели почты ограничены |

### Исправлено в ходе аудита

- `zip` 2.6.1 → 9.4.1 (symlink/path traversal и DoS-уязвимости).
- Добавлена проверка схемы URL при ручном добавлении публикации.
- Добавлена проверка `http/https` для ссылок в письме.
- Журнал фиксирует обнаруженные prompt injection.
- Добавлена защита от CSV/formula injection в `journal.csv`.
- Проверки стали содержательными: полнота журнала, дубли, период, обрывки,
  injection, ссылки, согласованность поста и письма, подтверждение фактов.
- Убраны неиспользуемые зависимости/предупреждения, включён `-D warnings` в CI.

## 9. Остаточные риски и рекомендации

1. **Kafka внутри compose без SASL/TLS.** Сеть изолирована и порты не
   публикуются, но для production включите `KAFKA_SECURITY_PROTOCOL=SASL_SSL`,
   `KAFKA_SASL_*`, `KAFKA_SSL_CA_FILE` и ACL по топикам. Клиент уже поддерживает
   эти настройки (rdkafka собран с SSL).
2. **Redis без TLS.** Клиент поддерживает `rediss://`; включите TLS и ACL-пользователей.
3. **PostgreSQL без TLS.** Включите `sslmode=verify-full` и сертификаты.
4. **LLM API по HTTP внутри сети.** Для production — HTTPS/mTLS, ограничение
   по IP, отдельный прокси с лимитами.
5. **DNS rebinding.** Проверка резолва выполняется, но reqwest резолвит повторно.
   Для строгого режима закрепите IP через `resolve`/eBPF-фильтр.
6. **Токены в `sessionStorage`.** CSP снижает риск XSS, но для production
   перенесите refresh token в HttpOnly/Secure/SameSite cookie и добавьте CSRF-токен.
7. **Нет WAF и антивируса.** Добавьте ModSecurity/Coraza и проверку загружаемых
   файлов (ClamAV) на периметре.
8. **Нет secrets manager.** Используйте Vault/SOPS/облачный KMS.
9. **Ограничение получателей.** Сейчас разрешён только `TEST_RECIPIENT`;
   для реальной рассылки нужен явный список подписчиков и подтверждение.
10. **Аудит зависимостей.** `cargo audit` локально, регулярное обновление
    зависимостей через Dependabot, SBOM при сборке образа.

Подробный отчёт по работающему стеку: `docs/SECURITY_AUDIT_2026-11-07.md`.

## 10. Команды проверки

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
docker compose config
./scripts/security_audit.sh
```
