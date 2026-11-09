# News Digest — Rust microservices backend

[cyber-bug.duckdns.org](https://cyber-bug.duckdns.org/)

ИИ-сервис подготовки дайджеста новостей по кибербезопасности. Бэкенд на Rust:
6 микросервисов, Kafka, Redis, PostgreSQL, vLLM (OpenAI-совместимый API),
React/vanilla SPA, Docker Compose, CI/CD и security-by-default.

## Быстрый старт (Docker)

Требуется доступ к Docker daemon (пользователь в группе `docker`; после
добавления перезайдите в сессию).

```bash
cp .env.example .env
# заполните JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD,
# BOOTSTRAP_ADMIN_PASSWORD, LLM_BASE_URL, LLM_MODEL
./scripts/dev.sh
```

- UI и API: http://127.0.0.1:8080
- Mailpit (тестовая почта): http://127.0.0.1:8025
- Логин: `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`.
  Если пароль не задан, он генерируется в томе: `docker compose exec gateway cat /data/bootstrap_password.txt`.

## Быстрый старт (локально, без Docker)

Нужны PostgreSQL, Redis, Kafka, Rust 1.99+, `cmake`, `pkg-config`, `libssl-dev`, `libcurl4-openssl-dev`.

```bash
export DATABASE_URL=postgres://news:news@localhost:5432/news
export REDIS_URL=redis://localhost:6379/0
export KAFKA_BROKERS=localhost:9092
export JWT_SECRET=$(openssl rand -hex 48)
cargo run --bin gateway &
cargo run --bin collector &
cargo run --bin normalizer &
cargo run --bin analyst &
cargo run --bin critic &
cargo run --bin reporter &
```

Контрольный прогон:

```bash
MODE=file DATASET=/path/to/dataset.zip CONTROL_TIME=2026-11-09T12:00:00+03:00 ./scripts/control_run.sh
```

## Что умеет

- живой сбор RSS/HTML с 3–5 согласованных сайтов;
- загрузка файлового датасета (JSON/CSV/HTML/TXT/ZIP) для контрольного прогона;
- фильтрация по теме и периоду (24 часа, МСК);
- дедупликация и объединение сообщений об одном событии;
- отбор до пяти событий с обоснованием;
- дайджест до 4 000 знаков, пост до 2 000 знаков, предпросмотр письма;
- журнал `journal.csv` на каждый материал;
- обязательные проверки (дубли, <5 событий, пустой период, обрывки,
  противоречия, ошибки источников, prompt injection);
- админ-панель, debug-панель, аудит, выгрузка артефактов, отправка тестового письма;
- Telegram-бот: токен и канал задаются в админке, отправка поста в один клик,
  список пользователей, которые написали боту.

## Сервисы

| Сервис | Назначение |
|---|---|
| `gateway` | REST API, JWT-аутентификация, UI, выгрузка, отправка письма и Telegram |
| `collector` | живой RSS/HTML-сбор и файловый датасет |
| `normalizer` | кодировки, даты МСК, период, тема, дедупликация |
| `analyst` | vLLM: анализ, кластеризация, ранжирование, тексты |
| `critic` | фактчекинг, противоречия, лимиты, проверка ссылок |
| `reporter` | digest.md, post.md, email.html, email.md, journal.csv, AI.md, run_stats.json |

При работе за reverse proxy включите `TRUST_PROXY_HEADERS=true` и задайте
`CORS_ORIGINS` с внешним HTTPS-origin.

## API

- `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me`
- `GET/POST /api/runs`, `GET /api/runs/{id}`, `GET /api/runs/{id}/status`
- `GET /api/runs/{id}/artifacts/{name}`, `GET /api/runs/{id}/journal.csv`
- `POST /api/runs/{id}/email/send`, `POST /api/runs/{id}/items`
- `GET /api/runs/{id}/checks`, `GET /api/sources`
- `GET/POST/PUT/DELETE /api/admin/*` — пользователи, источники, ключевые слова
- `POST /api/runs/{id}/telegram/send` — отправить пост в Telegram
- `GET/POST /api/admin/telegram/*` — настройки бота, синхронизация и список пользователей
- `GET /api/admin/debug/*`, `GET /api/admin/audit`
- `GET /api/health`, `GET /api/ready`, `GET /metrics`

## Тесты и качество

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
python3 scripts/check_digest.py runs/<run_id>
```

CI/CD: `.github/workflows/ci.yml` — fmt, clippy, tests, frontend lint/build,
сборка и публикация образа в GHCR, деплой по SSH.

## Документация

- `docs/ARCHITECTURE.md` — архитектура, Kafka, Redis, PostgreSQL.
- `docs/SECURITY.md` — модель угроз, меры защиты, аудит, остаточные риски.
- `docs/SECURITY_AUDIT_2026-11-07.md` — аудит работающего стека.
- `docs/AI.md` — модель, промпты, проверка фактов, ограничения.
- `docs/CHECKS.md` — обязательные проверки и результаты.
- `docs/SOURCES.md` — все 28 источников и способы подключения.
- `docs/RUNBOOK.md` — контрольный прогон и диагностика.
- `docs/CI_CD.md` — пайплайн и секреты.
- `Caddyfile.public` / `Caddyfile.internal` — TLS reverse proxy для домена/IP.
