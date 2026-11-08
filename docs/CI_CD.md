# CI/CD

## Пайплайн

`.github/workflows/ci.yml`:

1. **fmt** — `cargo fmt --all -- --check`.
2. **clippy** — `cargo clippy --workspace --all-targets -- -D warnings`.
3. **test** — `cargo test --workspace` с сервисами PostgreSQL и Redis.
4. **security** — `rustsec/audit-check`, Trivy filesystem scan
   (`HIGH,CRITICAL`, `ignore-unfixed`).
5. **docker** — сборка образа, SBOM и provenance, публикация в GHCR:
   - `ghcr.io/<owner>/<repo>:latest`
   - `ghcr.io/<owner>/<repo>:<sha>`
6. **deploy** — по SSH на сервер:
   ```bash
   cd $DEPLOY_PATH
   docker compose pull
   docker compose up -d --remove-orphans
   ```

## Секреты GitHub

| Секрет | Назначение |
|---|---|
| `DEPLOY_HOST` | хост деплоя |
| `DEPLOY_USER` | SSH-пользователь |
| `DEPLOY_SSH_KEY` | приватный SSH-ключ |
| `DEPLOY_PATH` | каталог с `docker-compose.yml` |
| `GITHUB_TOKEN` | автоматически, для GHCR |

## Окружение

- На сервере выполните `docker login ghcr.io` (или настройте pull-секрет),
  если пакет приватный.

- GitHub Environment `production` — добавьте required reviewers.
- На сервере: `.env` с секретами и `IMAGE=ghcr.io/<owner>/<repo>:latest`,
  доступный только деплой-пользователю.
- Образы запускаются non-root, read-only, без capabilities.
- Откат: `docker compose up -d <previous-sha>` или тег предыдущего образа.

## HTTPS

Сервис `caddy` включается профилем `tls` и терминирует TLS для gateway
на портах 80/443 (`HTTP_PORT`/`HTTPS_PORT` можно переопределить).

1. В `.env`: `COMPOSE_PROFILES=tls`, `DOMAIN=<hostname>`, `TRUST_PROXY_HEADERS=true`,
   `CORS_ORIGINS=https://<hostname>`.
2. `DOMAIN` должен резолвиться на сервер. Без своего домена подойдёт
   `1-2-3-4.sslip.io` (имя кодирует IP).
3. На сервере рядом с `docker-compose.yml` и `.env` должен лежать `Caddyfile`.
4. `docker compose up -d` — Caddy сам получит и обновит сертификат Let's
   Encrypt (нужны открытые 80/443). Для `DOMAIN=localhost` используется
   локальный CA, браузер будет предупреждать.

## Локальная проверка

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
docker compose config
```
