#!/usr/bin/env bash
# CLIP image embeddings for camera files -> image_embedding table (pgvector).
# Runs on the host in a Python venv (.venv) so it can use the local GPU; the DB is the Docker Compose db service,
# reached on 127.0.0.1:55433 (ports in compose.yml). Needs: .env, docker compose up -d db, and one Docker import.
# All arguments pass through to embedding/embed_images.py (see --help).
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"
env_file="${ENV_FILE:-.env}"
if [[ ! -f "$env_file" ]]; then echo "$env_file not found. Run: cp .env.example .env (and set POSTGRES_PASSWORD)." >&2; exit 1; fi
# Same file Compose reads: POSTGRES_DB/USER/PASSWORD and NUSCENES_HOST_PATH.
set -a; source "$env_file"; set +a
export PGHOST=127.0.0.1 PGPORT=55433 PGUSER="${POSTGRES_USER:-drivescene}" PGDATABASE="${POSTGRES_DB:-drivescene}"
export PGPASSWORD="${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in $env_file}"
compose=(docker compose --env-file "$env_file")
if [[ -z "$("${compose[@]}" ps --status running -q db 2>/dev/null)" ]]; then
 echo "Docker db is not running. Run: docker compose --env-file $env_file up -d db" >&2; exit 1
fi
if [[ "$("${compose[@]}" exec -T db psql -U "$PGUSER" -d "$PGDATABASE" -Atc "SELECT to_regclass('public.image_embedding') IS NOT NULL")" != "t" ]]; then
 echo 'image_embedding table is missing. Start the app or run the Docker import once (applies Flyway V2).' >&2; exit 1
fi
# Dataset on the host: NUSCENES_ROOT, else the folder Compose mounts (NUSCENES_HOST_PATH), else ./v1.0-mini.
if [[ -z "${NUSCENES_ROOT:-}" ]]; then
 if [[ -n "${NUSCENES_HOST_PATH:-}" && -d "$NUSCENES_HOST_PATH" ]]; then export NUSCENES_ROOT="$NUSCENES_HOST_PATH"
 elif [[ -d v1.0-mini/v1.0-mini ]]; then export NUSCENES_ROOT="$PWD/v1.0-mini"; fi
fi
venv=.venv
if [[ ! -x "$venv/bin/python" ]]; then
 echo 'Creating Python environment in .venv (first run only; torch is large)...'
 "${PYTHON:-python3}" -m venv "$venv"
 "$venv/bin/pip" install -q --upgrade pip
fi
# Reinstall only when requirements change. A CUDA torch installed beforehand (README) satisfies the torch pin.
if ! cmp -s embedding/requirements.txt "$venv/.requirements.txt"; then
 "$venv/bin/pip" install -q -r embedding/requirements.txt
 cp embedding/requirements.txt "$venv/.requirements.txt"
fi
exec "$venv/bin/python" embedding/embed_images.py "$@"
