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
        └── gRPC (primary) ──► [collector] ──► [normalizer] ──► [analyst] ──► [critic] ──► [reporter]
                                │              │               │              │            │
                                └── live RSS   └── даты/дедуп  └── vLLM       └── факты    └── артефакты
                                    + files
        Kafka — опциональный резервный транспорт (PIPELINE_TRANSPORT=kafka).
```

## Сервисы и ответственность

| Сервис | Вход | Выход | Состояние |
|---|---|---|---|
| gateway | HTTP | gRPC-вызовы стадий | PostgreSQL, Redis |
| collector | gRPC `ProcessRun` (RunStartedEvent) | gRPC-ответ (ItemsCollectedEvent) | PostgreSQL, Redis |
| normalizer | gRPC `ProcessRun` (ItemsCollectedEvent) | gRPC-ответ (ItemsNormalizedEvent) | PostgreSQL |
| analyst | gRPC `ProcessRun` (ItemsNormalizedEvent) | gRPC-ответ (DigestDraftEvent) | PostgreSQL, Redis (кэш LLM) |
| critic | gRPC `ProcessRun` (DigestDraftEvent) | gRPC-ответ (DigestVerifiedEvent) | PostgreSQL |
| reporter | gRPC `ProcessRun` (DigestVerifiedEvent) | gRPC-ответ (ArtifactsReadyEvent) | PostgreSQL, файлы |

## gRPC

Основной транспорт между сервисами:

- контракт: `crates/proto/proto/pipeline.proto`;
- сервис `news.pipeline.v1.Pipeline`;
- методы `Health` и `ProcessRun`;
- каждый воркер слушает `GRPC_ADDR` (по умолчанию `0.0.0.0:50051`);
- gateway вызывает стадии последовательно: collector → normalizer → analyst → critic → reporter,
  передавая JSON-событие стадии в `payload_json` и получая JSON следующего события;
- адреса: `COLLECTOR_GRPC_URL`, `NORMALIZER_GRPC_URL`, `ANALYST_GRPC_URL`,
  `CRITIC_GRPC_URL`, `REPORTER_GRPC_URL`;
- таймаут одного вызова: `GRPC_TIMEOUT_SECS`;
- в gRPC-режиме Kafka-консьюмеры не запускаются.

## Kafka (опционально)

Если задать `PIPELINE_TRANSPORT=kafka`, gateway публикует события в Kafka, а воркеры
используют консьюмеры. Топики:

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
   запускает gRPC-оркестрацию (в фоне) и возвращает `queued`.
2. Gateway вызывает `collector.ProcessRun` с `RunStartedEvent`; collector читает
   файлы или собирает RSS/HTML, сохраняет `items`, возвращает `ItemsCollectedEvent`.
3. Gateway вызывает `normalizer.ProcessRun`; normalizer чистит текст, парсит даты
   в МСК, проверяет период, помечает дубликаты и недостаточные тексты, пишет журнал.
4. Gateway вызывает `analyst.ProcessRun`; analyst вызывает vLLM, группирует события,
   считает score, выбирает до пяти, сохраняет `events`.
5. Gateway вызывает `critic.ProcessRun`; critic проверяет числа и ссылки, удаляет
   неподтверждённые источники, чистит стиль, пишет `verification`.
6. Gateway вызывает `reporter.ProcessRun`; reporter рендерит артефакты, проверяет
   лимиты, сохраняет файлы и `check_results`, завершает run.

## Безопасность

- Gateway — единственная точка входа; Postgres/Redis/Kafka не публикуются наружу.
- Все контейнеры работают от непривилегированного пользователя, root FS read-only,
  `cap_drop: ALL`, `no-new-privileges`.
- JWT access + rotating refresh, Argon2id, rate limit, audit log.
- SSRF-защита для живого сбора: только http/https, порты 80/443, проверка
  DNS-резолва, запрет private/loopback/link-local, проверка каждого редиректа.
- Prompt injection: статья передаётся как недоверенные данные в делимитерах,
  системный guard, JSON-only, получатели почты задаются отдельно.
- gRPC внутри Docker-сети использует h2c (без TLS); для production включите TLS/mTLS.
- Секреты только через `.env`/секреты CI; в коде и логах их нет.
- Каждый сервис пишет heartbeat в `data/registry/<name>.json`; gateway
  показывает живость процессов в `/api/admin/debug/services`.
- Kafka поддерживает `SASL_SSL`/SCRAM; compose по умолчанию использует
  PLAINTEXT только внутри изолированной сети без опубликованных портов.
