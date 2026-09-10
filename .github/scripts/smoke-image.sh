#!/usr/bin/env bash
set -euo pipefail
cleanup() {
  docker rm -f gfbg-smoke-app gfbg-smoke-db >/dev/null 2>&1 || true
  docker network rm gfbg-smoke >/dev/null 2>&1 || true
}
trap cleanup EXIT
password="$(openssl rand -hex 24)"
echo "::add-mask::$password"
export POSTGRES_PASSWORD="$password"
export DATABASE_URL="postgresql://postgres:$password@gfbg-smoke-db:5432/gfbg_ci"
echo "::add-mask::$DATABASE_URL"
export PUBLIC_URL="https://ci.example.test"
docker network create gfbg-smoke >/dev/null
docker run -d --name gfbg-smoke-db --network gfbg-smoke \
  --env POSTGRES_PASSWORD --env POSTGRES_DB=gfbg_ci postgres:18 >/dev/null
ready=false
for attempt in {1..30}; do
  if docker exec gfbg-smoke-db pg_isready -h 127.0.0.1 -U postgres -d gfbg_ci >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "PostgreSQL did not become ready" >&2
  exit 1
fi
docker run --rm --network gfbg-smoke --env DATABASE_URL --env PUBLIC_URL \
  gfbg:ci node dist/server/migrate.js
# Repeat to verify that startup migrations remain idempotent.
docker run --rm --network gfbg-smoke --env DATABASE_URL --env PUBLIC_URL \
  gfbg:ci node dist/server/migrate.js
docker run -d --name gfbg-smoke-app --network gfbg-smoke \
  --publish 127.0.0.1:3000:3000 --env DATABASE_URL --env PUBLIC_URL \
  --read-only --tmpfs /tmp:size=16m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true gfbg:ci >/dev/null
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health | grep -q '"status":"ok"'; then
    curl --fail --silent http://127.0.0.1:3000/ | grep -q '古楓桌遊 GFBG'
    echo "Container health and frontend verified"
    exit 0
  fi
  sleep 2
done
docker logs gfbg-smoke-app
echo "Application did not become healthy" >&2
exit 1
