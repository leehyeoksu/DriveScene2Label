#!/usr/bin/env bash
# Runs the Gradle tests in Docker: a throwaway pgvector PostgreSQL (drivescene_test) plus a JDK 21 container.
# Needs only Docker; does not touch the Compose db or its volume. Everything it starts is removed on exit.
# Arguments pass through to Gradle, e.g. bash scripts/docker-test.sh --tests '*similarImages*'
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"
db_image=pgvector/pgvector:pg16-trixie   # same image as the db service in compose.yml
jdk_image=eclipse-temurin:21-jdk         # same JDK as the Dockerfile build stage
name="ds2l-test-$$"
cleanup() { docker rm -f "$name-db" >/dev/null 2>&1 || true; docker network rm "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$name" >/dev/null
docker run -d --name "$name-db" --network "$name" \
 -e POSTGRES_DB=drivescene_test -e POSTGRES_USER=drivescene -e POSTGRES_PASSWORD=test "$db_image" >/dev/null
echo 'Waiting for test PostgreSQL...'
for _ in $(seq 60); do
 # -h 127.0.0.1: the image's init phase only listens on the Unix socket, so this waits for the real server.
 docker exec "$name-db" pg_isready -q -h 127.0.0.1 -U drivescene -d drivescene_test && break
 sleep 1
done
docker exec "$name-db" pg_isready -q -h 127.0.0.1 -U drivescene -d drivescene_test || { echo 'Test PostgreSQL did not start.' >&2; exit 1; }
# Runs as the host user so build/ and .gradle/ stay owned by you on Linux. The Gradle cache lives in the
# git- and docker-ignored .gradle/ folder and is reused across runs.
docker run --rm --network "$name" --user "$(id -u):$(id -g)" \
 -v "$project_dir":/workspace -w /workspace -e HOME=/tmp -e GRADLE_USER_HOME=/workspace/.gradle/docker-home \
 -e TEST_DB_URL="jdbc:postgresql://$name-db:5432/drivescene_test" -e TEST_DB_USERNAME=drivescene -e TEST_DB_PASSWORD=test \
 "$jdk_image" sh ./gradlew test --no-daemon "$@"
