#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BASE="${BASE:-http://127.0.0.1:8080}"
MODE="${MODE:-live}"
CONTROL_TIME="${CONTROL_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
DATASET="${DATASET:-}"
OUT_DIR="${OUT_DIR:-./runs}"

USERNAME="${BOOTSTRAP_ADMIN_USERNAME:-admin}"
PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-}"
if [[ -z "$PASSWORD" ]] && [[ -f data/bootstrap_password.txt ]]; then
  PASSWORD="$(cat data/bootstrap_password.txt)"
fi
if [[ -z "$PASSWORD" ]]; then
  echo "Задайте BOOTSTRAP_ADMIN_PASSWORD или сгенерируйте data/bootstrap_password.txt" >&2
  exit 1
fi

TOKEN="$(curl -fsS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)"
if [[ -z "$TOKEN" || "$TOKEN" = "null" ]]; then
  echo "Не удалось авторизоваться" >&2
  exit 1
fi

ARGS=(-sS -X POST "$BASE/api/runs" -H "Authorization: Bearer $TOKEN" \
  -F "mode=$MODE" -F "control_time=$CONTROL_TIME")

if [[ "$MODE" = "file" ]]; then
  if [[ -z "$DATASET" || ! -e "$DATASET" ]]; then
    echo "Для режима file укажите DATASET=/path/to/file-or-zip" >&2
    exit 1
  fi
  if [[ -d "$DATASET" ]]; then
    while IFS= read -r file; do
      ARGS+=(-F "files=@$file")
    done < <(find "$DATASET" -maxdepth 1 -type f)
  else
    ARGS+=(-F "files=@$DATASET")
  fi
fi

RUN_JSON="$(curl "${ARGS[@]}")"
RUN_ID="$(echo "$RUN_JSON" | jq -r .id)"
if [[ -z "$RUN_ID" || "$RUN_ID" = "null" ]]; then
  echo "Не удалось создать запуск: $RUN_JSON" >&2
  exit 1
fi
echo "Run ID: $RUN_ID"

for _ in $(seq 1 300); do
  STATUS="$(curl -fsS "$BASE/api/runs/$RUN_ID/status" -H "Authorization: Bearer $TOKEN" | jq -r .run.status)"
  echo "status: $STATUS"
  case "$STATUS" in
    completed|failed|cancelled) break ;;
  esac
  sleep 2
done

mkdir -p "$OUT_DIR/$RUN_ID"
for name in digest.md post.md journal.csv email.html ai.md run_stats.json check_results.json vulnerabilities.json; do
  curl -fsS "$BASE/api/runs/$RUN_ID/artifacts/$name" -H "Authorization: Bearer $TOKEN" \
    -o "$OUT_DIR/$RUN_ID/$name" || true
done
echo "Артефакты: $OUT_DIR/$RUN_ID"
python3 scripts/check_digest.py "$OUT_DIR/$RUN_ID" || true
