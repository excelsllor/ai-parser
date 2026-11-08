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
USERNAME="${BOOTSTRAP_ADMIN_USERNAME:-admin}"
PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-}"
if [[ -z "$PASSWORD" ]] && [[ -f data/bootstrap_password.txt ]]; then
  PASSWORD="$(cat data/bootstrap_password.txt)"
fi

echo "1. health"
curl -fsS "$BASE/api/health" | jq .

echo "2. login"
TOKEN="$(curl -fsS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" | jq -r .access_token)"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]]
echo "token ok"

echo "3. sources"
curl -fsS "$BASE/api/sources" -H "Authorization: Bearer $TOKEN" | jq '.[].name'

echo "4. create live run"
RUN_ID="$(curl -fsS -X POST "$BASE/api/runs" -H "Authorization: Bearer $TOKEN" \
  -F "mode=live" -F "control_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | jq -r .id)"
echo "run: $RUN_ID"

for _ in $(seq 1 300); do
  STATUS="$(curl -fsS "$BASE/api/runs/$RUN_ID/status" -H "Authorization: Bearer $TOKEN" | jq -r .run.status)"
  echo "status: $STATUS"
  case "$STATUS" in completed|failed|cancelled) break ;; esac
  sleep 2
done

echo "5. artifacts"
curl -fsS "$BASE/api/runs/$RUN_ID/artifacts/digest.md" -H "Authorization: Bearer $TOKEN" | head -40
