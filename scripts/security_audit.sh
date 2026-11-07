#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== cargo audit =="
cargo audit

echo "== clippy =="
cargo clippy --workspace --all-targets -- -D warnings

echo "== compose config =="
docker compose config >/dev/null
echo "compose config ok"

echo "== secrets in tracked sources =="
if command -v git >/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    echo ".env is tracked by git!" >&2
    exit 1
  fi
fi
if grep -RInE '(JWT_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD|LLM_API_KEY|BOOTSTRAP_ADMIN_PASSWORD)=[^[:space:]]+' \
    --include='*.rs' --include='*.yml' --include='*.yaml' --include='*.toml' --include='*.sh' \
    . 2>/dev/null | grep -vE '\.env\.example|docs/|scripts/security_audit\.sh' ; then
  echo "possible hardcoded secret found" >&2
  exit 1
fi
echo "no hardcoded secrets"

echo "== .env permissions =="
if [ -f .env ]; then
  perm=$(stat -c '%a' .env)
  if [ "$perm" != "600" ] && [ "$perm" != "640" ]; then
    echo "warning: .env permissions are $perm (recommend 600)" >&2
  else
    echo ".env permissions: $perm"
  fi
fi

echo "== dependency tree check =="
cargo tree --workspace -e features >/dev/null
echo "dependency tree ok"

if command -v trivy >/dev/null 2>&1; then
  echo "== trivy fs =="
  trivy fs --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
fi

echo "security audit completed"
