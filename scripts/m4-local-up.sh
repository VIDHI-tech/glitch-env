#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./scripts/m4-local-env.sh
docker compose -p glitch-m4-local -f compose.m4-local.yml up -d --wait
pnpm --filter @glitch/api exec tsx src/bucket-init.ts
pnpm --filter @glitch/api exec tsx src/migrate.ts
pnpm --filter @glitch/api exec tsx scripts/seed-m4-qa.ts
nohup pnpm --filter @glitch/api exec tsx src/server.ts >/private/tmp/glitch-m4-api.log 2>&1 & echo $! >/private/tmp/glitch-m4-api.pid
nohup pnpm --filter @glitch/api exec tsx src/hls-worker.ts >/private/tmp/glitch-m4-worker.log 2>&1 & echo $! >/private/tmp/glitch-m4-worker.pid
nohup pnpm --filter @glitch/web dev >/private/tmp/glitch-m4-web.log 2>&1 & echo $! >/private/tmp/glitch-m4-web.pid
printf 'M4 admin UI: http://127.0.0.1:5173\n'
