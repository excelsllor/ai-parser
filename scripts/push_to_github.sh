#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${GITHUB_REMOTE:-origin}"
BRANCH="${GITHUB_BRANCH:-main}"
DEFAULT_USER="${GITHUB_USERNAME:-excelsllor}"

read -r -p "GitHub username [$DEFAULT_USER]: " INPUT_USER
USERNAME="${INPUT_USER:-$DEFAULT_USER}"
read -r -s -p "Personal Access Token: " TOKEN
echo

if [[ -z "$TOKEN" ]]; then
  echo "PAT не задан." >&2
  exit 1
fi

ASKPASS="$(mktemp)"
cleanup() { rm -f "$ASKPASS"; }
trap cleanup EXIT

cat > "$ASKPASS" <<'ASKPASS_EOF'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' "$GIT_USERNAME" ;;
  *Password*) printf '%s\n' "$GIT_TOKEN" ;;
  *) printf '\n' ;;
esac
ASKPASS_EOF
chmod 700 "$ASKPASS"

GIT_TERMINAL_PROMPT=0 \
GIT_ASKPASS="$ASKPASS" \
GIT_USERNAME="$USERNAME" \
GIT_TOKEN="$TOKEN" \
git push -u "$REMOTE" "$BRANCH"
