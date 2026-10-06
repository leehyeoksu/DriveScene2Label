#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"
action="${1:-up}"
if [[ "$action" == "setup" ]]; then
 if [[ ! -f .env ]]; then
  command -v openssl >/dev/null || { echo 'openssl is required for password generation'; exit 1; }
  cp .env.example .env
  password="$(openssl rand -hex 24)"
  sed -i "s/replace-with-your-own-password/$password/" .env
 fi
 mkdir -p data/nuscenes
 echo 'Setup ready. Run: bash scripts/dev.sh up'
 exit 0
fi
[[ -f .env ]] || { echo 'First run: bash scripts/dev.sh setup'; exit 1; }
compose=(docker compose -f compose.yml -f compose.gpu.yml -f compose.web.yml)
case "$action" in
 up) "${compose[@]}" up --build -d; echo 'Web: http://localhost:3000 (or WEB_PORT from .env)' ;;
 start) "${compose[@]}" up -d ;;
 backend) docker compose -f compose.yml -f compose.gpu.yml up --build -d ;;
 frontend) "${compose[@]}" up --build -d --no-deps frontend; echo 'Web: http://localhost:3000 (or WEB_PORT from .env)' ;;
 frontend-dev) cd frontend; [[ -d node_modules ]] || npm ci; npm run dev -- --host 0.0.0.0 ;;
 stop) "${compose[@]}" stop ;;
 status) "${compose[@]}" ps ;;
 logs) "${compose[@]}" logs -f --tail 100 ;;
 *) echo 'Usage: bash scripts/dev.sh {setup|up|start|backend|frontend|frontend-dev|stop|status|logs}'; exit 2 ;;
esac
