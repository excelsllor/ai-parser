# Архитектура

## Схема

```
[React/vanilla SPA]
        │ HTTPS (TLS 1.3 на reverse proxy), JWT
        ▼
[gateway :8080] ── PostgreSQL (runs, items, events, journal, audit, users)
        │                 │
        │                 └── Redis (кэш LLM, rate limit, блокировки, статусы)
        │
        └── Kafka ──► [collector] ──► [normalizer] ──► [analyst] ──► [critic] ──► [reporter]
                          │              │               │              │            │
                          └── live RSS   └── даты/дедуп  └── vLLM       └── факты    └── артефакты
                              + files
```

## Сервисы и ответственность

| Сервис | Вход | Выход | Состояние |
|---|---|---|---|
| gateway | HTTP | Kafka `news.run.started` | PostgreSQL, Redis |
| collector | `news.run.started` | `news.items.collected` | PostgreSQL, Redis |
| normalizer | `news.items.collected` | `news.items.normalized` | PostgreSQL |
| analyst | `news.items.normalized` | `news.digest.draft` | PostgreSQL, Redis (кэш LLM) |
| critic | `news.digest.draft` | `news.digest.verified` | PostgreSQL |
| reporter | `news.digest.verified` | `news.artifacts.ready` | PostgreSQL, файлы |

## Kafka

Топики:

- `news.run.started`
- `news.items.collected`
- `news.items.normalized`
- `news.items.analyzed` (резерв)
- `news.events.clustered` (резерв)
- `news.events.selected` (резерв)
- `news.digest.draft`
- `news.digest.verified`
- `news.artifacts.ready`
- `news.run.failed` (DLQ)
- `news.audit.events` (резерв для вынесенного аудита)

Ключ сообщения — `run_id`. В dev одна партиция, at-least-once, идемпотентность
по `run_id + content_hash`. При ошибке обработчик делает 3 попытки с
экспоненциальной задержкой, затем публикует сообщение в `news.run.failed`.

## Redis

| Ключ | Назначение |
|---|---|
| `run:{id}:status` | прогресс для UI |
| `run:{id}:lock` | защита от параллельного запуска |
| `dedupe:url:{run}` | канонические URL |
| `llm:cache:{hash}` | кэш ответов vLLM (7 дней) |
| `ratelimit:{host}` | ограничение частоты сбора |
| `ratelimit:login:{ip}` | анти-брутфорс |
| `ratelimit:api:{ip}:{path}` | общий лимит API |
| `idempotency:{run}:{hash}` | повторная обработка |

## PostgreSQL

Основные таблицы:

- `users`, `refresh_tokens`, `audit_log`, `settings`
- `sources`, `keywords`
- `runs`, `run_stages`
- `items`, `events`, `event_sources`, `claims`
- `journal`, `llm_calls`, `check_results`, `artifacts`

Миграции лежат в `crates/shared/migrations`, применяются при старте каждого
сервиса через `sqlx::migrate!`.

## Пайплайн

1. Gateway создаёт `run`, сохраняет файлы в `DATA_DIR/runs/<id>/input`,
   публикует `RunStartedEvent`.
2. Collector читает файлы или собирает RSS/HTML, сохраняет `items`.
3. Normalizer чистит текст, парсит даты в МСК, проверяет период, помечает
   дубликаты и недостаточные тексты, пишет журнал.
4. Analyst вызывает vLLM по каждой публикации, группирует события, считает
   score, выбирает до пяти, сохраняет `events`.
5. Critic проверяет числа и ссылки по исходникам, удаляет неподтверждённые
   источники, чистит стиль, пишет `verification`.
6. Reporter рендерит артефакты, проверяет лимиты, сохраняет файлы и
   `check_results`, завершает run.

## Безопасность

- Gateway — единственная точка входа; Postgres/Redis/Kafka не публикуются наружу.
- Все контейнеры работают от непривилегированного пользователя, root FS read-only,
  `cap_drop: ALL`, `no-new-privileges`.
- JWT access + rotating refresh, Argon2id, rate limit, audit log.
- SSRF-защита для живого сбора: только http/https, порты 80/443, проверка
  DNS-резолва, запрет private/loopback/link-local, проверка каждого редиректа.
- Prompt injection: статья передаётся как недоверенные данные в делимитерах,
  системный guard, JSON-only, получатели почты задаются отдельно.
- Секреты только через `.env`/секреты CI; в коде и логах их нет.
- Каждый сервис пишет heartbeat в `data/registry/<name>.json`; gateway
  показывает живость процессов в `/api/admin/debug/services`.
- Kafka поддерживает `SASL_SSL`/SCRAM; compose по умолчанию использует
  PLAINTEXT только внутри изолированной сети без опубликованных портов.
