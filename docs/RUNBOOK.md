# Runbook

## Контрольный прогон

1. Убедитесь, что заполнен `.env` и поднят стек:
   ```bash
   ./scripts/dev.sh
   ```
2. Проверьте здоровье:
   ```bash
   curl -s http://127.0.0.1:8080/api/health | jq .
   ```
3. Запустите прогон на файловом датасете:
   ```bash
   MODE=file DATASET=/path/to/dataset.zip \
   CONTROL_TIME=2026-11-09T12:00:00+03:00 \
   ./scripts/control_run.sh
   ```
   или живой сбор:
   ```bash
   MODE=live CONTROL_TIME=2026-11-09T12:00:00+03:00 ./scripts/control_run.sh
   ```
4. Артефакты: `runs/<run_id>/digest.md`, `post.md`, `journal.csv`,
   `email.html`, `ai.md`, `run_stats.json`, `check_results.json`.
5. Проверьте `check_results.json`: все проверки должны быть `passed: true`
   либо иметь обоснованное `note`.

## Диагностика

- `GET /api/health` — БД, Redis, Kafka.
- `GET /api/admin/debug/services` — LLM, Kafka, Redis, БД.
- `GET /api/admin/debug/llm-calls` — вызовы модели, токены, стоимость.
- `GET /api/admin/debug/runs/{id}` — этапы, материалы, проверки.
- `GET /api/admin/audit` — действия пользователей.
- `GET /metrics` — Prometheus (в prod нужен `X-Metrics-Token`).

## Типовые проблемы

| Симптом | Действие |
|---|---|
| `/api/health` = degraded | проверить `docker compose ps`, логи postgres/redis/kafka |
| LLM 401/404 | проверить `LLM_BASE_URL`, `LLM_API_KEY`, имя модели |
| LLM таймаут | уменьшить `LLM_CONCURRENCY`, увеличить `LLM_TIMEOUT_SECS` |
| Нет новостей | проверить `LIVE_FETCH_ENABLED`, `ALLOWED_SOURCE_HOSTS`, доступность сайтов |
| Пустой журнал | проверить Kafka-топики и логи normalizer |
| Письмо не отправляется | MailHog `http://127.0.0.1:8025`, `SMTP_HOST/PORT` |
| 429 | сработал rate limit; подождать или изменить лимиты |

## Обновление и деплой

```bash
git pull
docker compose build
docker compose up -d --remove-orphans
```

В production образы публикуются в GHCR и деплоятся через GitHub Actions
(`.github/workflows/ci.yml`).
