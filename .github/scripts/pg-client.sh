#!/usr/bin/env bash
set -euo pipefail
# Installed under pg_dump / pg_restore by CI. Use the official PostgreSQL
# clients without changing the runner's apt repositories or installing a server.
tool="${0##*/}"
case "$tool" in
  pg_dump|pg_restore) ;;
  *) echo "Expected executable name pg_dump or pg_restore" >&2; exit 2 ;;
esac
exec docker run --rm --network host \
  --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD \
  --volume "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE" \
  --workdir "$GITHUB_WORKSPACE" \
  postgres:18 "$tool" "$@"
