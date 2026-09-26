#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
pg_home="$PWD/.local/postgres"
export LD_LIBRARY_PATH="$pg_home/runtime/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=drivescene PGDATABASE=drivescene
export PGPASSWORD="$(cat "$pg_home/password")"
exec "$pg_home/runtime/usr/lib/postgresql/16/bin/psql" -v ON_ERROR_STOP=1 "$@"
