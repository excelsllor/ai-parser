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
| `DEPLOY_HOST` | хост деплоя (без порта) |
| `DEPLOY_PORT` | SSH-порт, по умолчанию 22 |
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
Файл конфигурации выбирается переменной `TLS_MODE`:

| `TLS_MODE` | Сертификат | Когда использовать |
|---|---|---|
| `internal` (по умолчанию) | локальный CA Caddy | сервер без домена, доступ по IP |
| `public` | Let's Encrypt (`shortlived`) | IP или домен, указывающий на сервер |

В `.env`: `COMPOSE_PROFILES=tls`, `TLS_MODE=<режим>`, `DOMAIN=<IP или домен>`,
`TRUST_PROXY_HEADERS=true`, `CORS_ORIGINS=https://<IP или домен>`.

Для `TLS_MODE=internal` браузер будет предупреждать о недоверенном
сертификате. Чтобы убрать предупреждение, импортируй корневой CA Caddy:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Для `TLS_MODE=public` `DOMAIN` может быть и доменом, и голым IP. Let's
Encrypt выдаёт сертификаты на IP только в профиле `shortlived` (~6 дней),
поэтому в `Caddyfile.public` он выбран явно; Caddy обновляет сертификат
автоматически. Нужны открытые 80/443 и чтобы `DOMAIN` указывал на сервер.

На сервере рядом с `docker-compose.yml` и `.env` должны лежать
`Caddyfile.internal` и `Caddyfile.public`.

## OAuth

Вход через Яндекс ID и VK ID выполняется на сервере: браузер получает только
URL авторизации, `client_secret` остаётся в `.env`.

```bash
PUBLIC_URL=https://1.2.3.4
YANDEX_CLIENT_ID=...
YANDEX_CLIENT_SECRET=...
VK_CLIENT_ID=...
VK_CLIENT_SECRET=...
```

`PUBLIC_URL` должен совпадать с адресом, по которому открыт сайт. Redirect URI
регистрируются в кабинетах провайдеров ровно так:

- Яндекс ID: `{PUBLIC_URL}/auth/yandex/token`
- VK ID: `{PUBLIC_URL}/auth/vk/callback`

Провайдер без пары ID/секрет просто не показывается на странице входа.
Первый вход создаёт локального пользователя с ролью `viewer`; пароль не
используется. Повторный вход находит пользователя по `provider_user_id`.



```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
docker compose config
```
