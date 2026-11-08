#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! docker info >/dev/null 2>&1; then
  echo "Нет доступа к Docker. Добавьте пользователя в группу docker и перезайдите." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "Создайте .env из .env.example и заполните секреты." >&2
  exit 1
fi
docker compose up --build -d
echo "Gateway: http://127.0.0.1:8080"
echo "Mailpit: http://127.0.0.1:8025"
echo "Логи:    docker compose logs -f gateway collector normalizer analyst critic reporter"
