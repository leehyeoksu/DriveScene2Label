#!/usr/bin/env bash
# Project-local PostgreSQL for Ubuntu/WSL. No system service or sudo required.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
pg_home="$project_dir/.local/postgres"
pg_prefix="$pg_home/runtime"
pg_bin="$pg_prefix/usr/lib/postgresql/16/bin"
export LD_LIBRARY_PATH="$pg_prefix/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=drivescene PGDATABASE=drivescene
if [[ "${1:-start}" == "stop" ]]; then
 "$pg_bin/pg_ctl" -D "$pg_home/data" stop -m fast
 exit
fi
mkdir -p "$pg_home/packages" "$pg_prefix"
if [[ ! -x "$pg_bin/postgres" ]]; then
 (cd "$pg_home/packages" && apt-get download postgresql-16 postgresql-client-16 libpq5)
 for package in "$pg_home/packages/"*.deb; do dpkg-deb -x "$package" "$pg_prefix"; done
fi
if [[ ! -f "$pg_home/password" ]]; then
 if [[ -d "$pg_home/data" ]]; then echo 'Existing database has no password file; restore the original password file.' >&2; exit 1; fi
 (umask 077; od -An -N24 -tx1 /dev/urandom | tr -d ' \n' > "$pg_home/password")
fi
export PGPASSWORD="$(cat "$pg_home/password")"
if [[ ! -f "$pg_home/data/PG_VERSION" ]]; then
 "$pg_bin/initdb" -D "$pg_home/data" -U drivescene --pwfile="$pg_home/password" --auth=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
 cat >> "$pg_home/data/postgresql.conf" <<'CONF'
listen_addresses = '127.0.0.1'
port = 55432
unix_socket_directories = ''
CONF
fi
# Optional LLVM JIT is unnecessary for this catalog and needs extra system libraries.
if ! grep -q '^jit = off$' "$pg_home/data/postgresql.conf"; then
 printf '\njit = off\n' >> "$pg_home/data/postgresql.conf"
fi
if ! "$pg_bin/pg_ctl" -D "$pg_home/data" status >/dev/null 2>&1; then
 "$pg_bin/pg_ctl" -D "$pg_home/data" -l "$pg_home/server.log" start
fi
"$pg_bin/pg_ctl" -D "$pg_home/data" reload >/dev/null
if [[ "$("$pg_bin/psql" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='drivescene'")" != "1" ]]; then
 "$pg_bin/createdb" drivescene
fi
if [[ "$("$pg_bin/psql" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='drivescene_test'")" != "1" ]]; then
 "$pg_bin/createdb" drivescene_test
fi
echo 'PostgreSQL ready: 127.0.0.1:55432 / drivescene (test DB: drivescene_test)'
