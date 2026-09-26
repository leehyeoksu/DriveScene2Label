#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ! -f .local/postgres/password ]]; then echo 'Run bash scripts/local-db.sh first.' >&2; exit 1; fi
export DB_PASSWORD="$(cat .local/postgres/password)"
case "${1:-run}" in
 import) bash gradlew bootRun --args='--spring.main.web-application-type=none --nuscenes.import.enabled=true' ;;
 test) export TEST_DB_PASSWORD="$DB_PASSWORD"; bash gradlew test ;;
 run) bash gradlew bootRun ;;
 *) echo 'Usage: bash scripts/run-local.sh [import|test|run]' >&2; exit 1 ;;
esac
