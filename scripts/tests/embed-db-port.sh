#!/usr/bin/env bash
# Regression check for embed.sh DB_PORT precedence (caller env > ENV_FILE > 55433).
# Runs the REAL scripts/embed.sh (byte copy) inside a throwaway project dir with docker/python stubs.
# No DB connection, no Docker, no pip, no model. Prints PASS/FAIL per case.
set -uo pipefail
REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
W=$(mktemp -d "${TMPDIR:-/tmp}/embedport.XXXXXX")
mkdir -p "$W/scripts" "$W/embedding" "$W/.venv/bin" "$W/bin"
cp "$REPO/scripts/embed.sh" "$W/scripts/embed.sh"
cmp -s "$REPO/scripts/embed.sh" "$W/scripts/embed.sh" || { echo "copy differs"; exit 2; }
echo "stub-reqs" > "$W/embedding/requirements.txt"; cp "$W/embedding/requirements.txt" "$W/.venv/.requirements.txt"
cat > "$W/.venv/bin/python" <<'PY'
#!/usr/bin/env bash
echo "PY PGHOST=$PGHOST PGPORT=$PGPORT PGDATABASE=$PGDATABASE ARGS=$*" >> "$STUB_LOG"
PY
cat > "$W/bin/docker" <<'DK'
#!/usr/bin/env bash
echo "DOCKER DB_PORT=${DB_PORT-<unset>} PROJECT=${COMPOSE_PROJECT_NAME-<unset>} ARGS=$*" >> "$STUB_LOG"
case "$*" in *" ps "*) echo stub-container-id;; *" exec "*) echo t;; esac
DK
chmod +x "$W/.venv/bin/python" "$W/bin/docker"
pass=0; fail=0
run() { # name expected_port env_file_db_port(or -) caller_db_port(or -)
  local name=$1 exp=$2 filep=$3 callp=$4 log="$W/log.$RANDOM"
  { echo "POSTGRES_DB=stubdb"; echo "POSTGRES_USER=stubuser"; echo "POSTGRES_PASSWORD=stub-not-secret"; [[ $filep != - ]] && echo "DB_PORT=$filep"; } > "$W/env.case"
  ( cd /; if [[ $callp != - ]]; then export DB_PORT=$callp; else unset DB_PORT; fi
    PATH="$W/bin:$PATH" STUB_LOG="$log" ENV_FILE="$W/env.case" bash "$W/scripts/embed.sh" --limit 1 >/dev/null 2>"$log.err"; echo "exit=$?" >> "$log" )
  local py dk; py=$(grep -o 'PGPORT=[^ ]*' "$log" | head -1); dk=$(grep '^DOCKER' "$log" | grep -o 'DB_PORT=[^ ]*' | sort -u | tr '\n' ' ')
  if [[ "$py" == "PGPORT=$exp" && "$dk" == "DB_PORT=$exp " ]]; then echo "PASS $name -> python $py, docker ${dk% }"; pass=$((pass+1)); else echo "FAIL $name -> python ${py:-<not run>}, docker ${dk:-<none>} (expected $exp) $(cat "$log.err" | head -2)"; fail=$((fail+1)); fi
}
run "caller DB_PORT=55434 wins over env file DB_PORT=55433" 55434 55433 55434
run "no caller DB_PORT: env file DB_PORT=55435 is used"     55435 55435 -
run "neither set: default 55433"                            55433 -     -
run "caller DB_PORT=55436, env file without DB_PORT"        55436 -     55436
run_bad() { local log="$W/log.bad"; echo "POSTGRES_PASSWORD=x" > "$W/env.case"
  ( cd /; PATH="$W/bin:$PATH" STUB_LOG="$log" ENV_FILE="$W/env.case" DB_PORT=abc bash "$W/scripts/embed.sh" >/dev/null 2>"$log.err"; echo "exit=$?" >> "$log" )
  if grep -q "exit=1" "$log" && grep -q "Invalid DB_PORT" "$log.err" && ! grep -q -E "^(PY|DOCKER)" "$log"; then echo "PASS invalid DB_PORT=abc stops before docker/python"; pass=$((pass+1)); else echo "FAIL invalid DB_PORT"; fail=$((fail+1)); fi; }
run_bad
grep -h "^PY" "$W"/log.* | grep -c "embed_images.py --limit 1" | sed 's/^/python stub invocations with passthrough args: /'
rm -rf "$W"
echo "=== $pass passed, $fail failed"; [[ $fail -eq 0 ]]
