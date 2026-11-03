#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for service in api worker web; do
  file="/private/tmp/glitch-m4-${service}.pid"
  if [ -f "$file" ]; then kill "$(cat "$file")" 2>/dev/null || true; rm -f "$file"; fi
done
docker compose -p glitch-m4-local -f compose.m4-local.yml down
