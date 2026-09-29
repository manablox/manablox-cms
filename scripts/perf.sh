#!/usr/bin/env bash
# Before/after measurements for the performance work: delivery throughput and the Redis
# commands and database transactions behind each request, boot time, and the management
# operations that grow with the data (session with many spaces, tree, export, promote).
#
#   ./scripts/perf.sh seed            migrate and fill a template database (once; slow)
#   ./scripts/perf.sh run [label]     clone the template, boot the management and public
#                                     processes from source, run every case, stop them
#                                     and drop the clone; prints a table, writes JSON
#   ./scripts/perf.sh media [label]   20 parallel downloads of a large original and the
#                                     management process's peak RSS (seed with
#                                     PERF_BIG_ASSET_MB=200)
#   ./scripts/perf.sh admin [label]   the prebuilt admin's first load in Chromium: bytes, FCP,
#                                     LCP, time to plugin routes (scripts/perf/admin-boot.mjs;
#                                     its own throwaway database, no seed needed)
#   ./scripts/perf.sh clean           drop the template database
#
# Needs the dev services (`pnpm services:up`): Postgres on DATABASE_URL's server and Valkey.
# Redis database PERF_REDIS_DB (12) is flushed. The seed's size comes from PERF_* (see
# apps/api/scripts/seed-perf.mts). Numbers are only comparable on the same machine against
# the same template, so seed once and run before and after a change.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SERVER_URL="${DATABASE_URL:-postgres://manablox:manablox@localhost:5432/manablox}"
TEMPLATE="${PERF_TEMPLATE:-manablox_perf_seed}"
CLONE="${PERF_DATABASE:-manablox_perf}"
REDIS_DB="${PERF_REDIS_DB:-12}"
REDIS_BASE="${PERF_REDIS_URL:-redis://localhost:6379}"
SCRATCH="${PERF_SCRATCH:-${TMPDIR:-/tmp}/manablox-perf}"
OUT_DIR="${PERF_OUT:-$ROOT/loadtest/results}"
MGMT_PORT="${PERF_MGMT_PORT:-3290}"
PUBLIC_PORT="${PERF_PUBLIC_PORT:-3291}"
# The public API with the response cache off, for reads.
PUBLIC_NOCACHE_PORT="${PERF_PUBLIC_NOCACHE_PORT:-3294}"
# The public API with a three-second cache, for the tag set soak.
PUBLIC_SHORT_PORT="${PERF_PUBLIC_SHORT_PORT:-3295}"

url_for() { printf '%s' "$SERVER_URL" | sed -E "s#/[^/?]*(\?.*)?\$#/$1\1#"; }

# psql on the server: the local client when there is one, else the dev stack's container.
psql_server() {
  if command -v psql >/dev/null 2>&1; then
    psql "$(url_for postgres)" -v ON_ERROR_STOP=1 -qtA "$@"
  else
    docker exec -i manablox-cms-dev-postgres-1 psql -U manablox -d postgres -v ON_ERROR_STOP=1 -qtA "$@"
  fi
}
# psql on one database of the server.
psql_db() {
  local db="$1"; shift
  if command -v psql >/dev/null 2>&1; then
    psql "$(url_for "$db")" -v ON_ERROR_STOP=1 -qtA "$@"
  else
    docker exec -i manablox-cms-dev-postgres-1 psql -U manablox -d "$db" -v ON_ERROR_STOP=1 -qtA "$@"
  fi
}
export -f psql_server psql_db url_for
export SERVER_URL

redis_url() { printf '%s/%s' "$REDIS_BASE" "$REDIS_DB"; }

drop_db() { psql_server -c "drop database if exists $1 with (force)" >/dev/null; }

# Environment every process shares.
common_env() {
  export AUTH_SECRET=perf-auth-secret-0123456789abcdef0123456789
  export STORAGE_DRIVER=local STORAGE_LOCAL_PATH="$SCRATCH/uploads" MEDIA_CACHE_PATH="$SCRATCH/media-cache"
  export FILE_MAX_SIZE_MB="${FILE_MAX_SIZE_MB:-400}"
  export MAIL_DRIVER=none LOG_LEVEL="${LOG_LEVEL:-warn}" RATE_LIMIT=off
  export NET_ALLOW_PRIVATE_NETWORK=true
}

cmd_seed() {
  common_env
  mkdir -p "$SCRATCH"
  drop_db "$TEMPLATE"
  psql_server -c "create database $TEMPLATE" >/dev/null
  export DATABASE_URL; DATABASE_URL="$(url_for "$TEMPLATE")"
  export REDIS_URL; REDIS_URL="$(redis_url)"
  export NODE_ENV=development
  log "migrating $TEMPLATE"
  (cd "$ROOT" && pnpm --silent db:migrate >/dev/null)
  log "seeding (PERF_SPACES=${PERF_SPACES:-1000} PERF_DOCUMENTS=${PERF_DOCUMENTS:-20000})"
  (cd "$ROOT/apps/api" && node --import tsx scripts/seed-perf.mts) | tee "$SCRATCH/seed.log"
  grep '^perf-seed: ' "$SCRATCH/seed.log" | sed 's/^perf-seed: //' > "$SCRATCH/seed.json"
  log "template $TEMPLATE ready; ids in $SCRATCH/seed.json"
}

stop_all() {
  for port in "$MGMT_PORT" "$PUBLIC_PORT" "$PUBLIC_NOCACHE_PORT" "$PUBLIC_SHORT_PORT"; do fuser -k "$port/tcp" >/dev/null 2>&1 || true; done
}

# `start name port entry [env...]`: boots one process; its boot time in ms lands in BOOT_MS.
start() {
  local name="$1" port="$2" entry="$3"; shift 3
  local begin; begin=$(date +%s%N)
  (cd "$ROOT/$(dirname "$(dirname "$entry")")" && env PORT="$port" PUBLIC_URL="http://localhost:$port" "$@" \
    node --import tsx "src/$(basename "$entry")" < /dev/null > "$SCRATCH/$name.log" 2>&1 &)
  local path=/readyz
  for _ in $(seq 1 1200); do
    if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port$path" | grep -qE '^(200|503)$'; then
      BOOT_MS=$(( ($(date +%s%N) - begin) / 1000000 ))
      return 0
    fi
    sleep 0.05
  done
  die "$name did not come up; see $SCRATCH/$name.log"
}

boot_all() {
  common_env
  export DATABASE_URL; DATABASE_URL="$(url_for "$CLONE")"
  export REDIS_URL; REDIS_URL="$(redis_url)"
  export NODE_ENV="${PERF_NODE_ENV:-production}"
  start management "$MGMT_PORT" apps/api/src/main.ts CORS_ORIGINS="http://localhost:$MGMT_PORT"
  BOOT_MGMT=$BOOT_MS
  start public "$PUBLIC_PORT" apps/public-api/src/main.ts
  BOOT_PUBLIC=$BOOT_MS
  start public-nocache "$PUBLIC_NOCACHE_PORT" apps/public-api/src/main.ts CACHE_ENABLED=false
  start public-short "$PUBLIC_SHORT_PORT" apps/public-api/src/main.ts CACHE_TTL=3
  export BOOT_MGMT BOOT_PUBLIC
  log "boot ms: management $BOOT_MGMT, public $BOOT_PUBLIC"
}

prepare_clone() {
  [ -f "$SCRATCH/seed.json" ] || die "no seed; run ./scripts/perf.sh seed first"
  drop_db "$CLONE"
  psql_server -c "create database $CLONE template $TEMPLATE" >/dev/null
  # The checkout's own migrations (new indexes), so a template seeded once serves both sides.
  (cd "$ROOT" && DATABASE_URL="$(url_for "$CLONE")" pnpm --silent db:migrate >/dev/null)
  psql_db "$CLONE" -c "analyze" >/dev/null
  node "$ROOT/scripts/perf/redis.mjs" "$(redis_url)" flushdb >/dev/null
}

cases() {
  PERF_REDIS="$(redis_url)" PERF_SEED="$SCRATCH/seed.json" PERF_PROBES="$SCRATCH/probes.json" \
    PERF_MGMT="http://localhost:$MGMT_PORT" PERF_PUBLIC="http://localhost:$PUBLIC_PORT" \
    PERF_PUBLIC_NOCACHE="http://localhost:$PUBLIC_NOCACHE_PORT" \
    PERF_PUBLIC_SHORT="http://localhost:$PUBLIC_SHORT_PORT" env "$@" node "$ROOT/scripts/perf/cases.mjs"
}

cmd_run() {
  local label="${1:-run}"
  mkdir -p "$OUT_DIR"
  trap 'stop_all; drop_db "$CLONE"' EXIT
  # Pass 1, development: statements per warm request from `x-manablox-db-queries`.
  prepare_clone
  PERF_NODE_ENV=development boot_all
  cases PERF_PASS=probe
  stop_all
  # Pass 2, production, on a fresh clone: throughput, latency, Redis commands, boot time.
  prepare_clone
  boot_all
  cases PERF_LABEL="$label" PERF_JSON="$OUT_DIR/perf-$label-$(date +%Y%m%d-%H%M%S).json"
}

cmd_media() {
  local label="${1:-media}"
  trap 'stop_all; drop_db "$CLONE"' EXIT
  prepare_clone
  boot_all
  PERF_SEED="$SCRATCH/seed.json" PERF_MGMT="http://localhost:$MGMT_PORT" PERF_LABEL="$label" \
    PERF_MGMT_PORT="$MGMT_PORT" node "$ROOT/scripts/perf/media.mjs"
}

# The admin's first load; its own throwaway database, created here and dropped after.
cmd_admin() {
  ADMIN_DB="${PERF_ADMIN_DATABASE:-manablox_perf_admin}"
  trap 'drop_db "$ADMIN_DB"' EXIT
  drop_db "$ADMIN_DB"
  psql_server -c "create database $ADMIN_DB" >/dev/null
  DATABASE_URL="$(url_for "$ADMIN_DB")" node "$ROOT/scripts/perf/admin-boot.mjs" "$@"
}

case "${1:-}" in
  seed) cmd_seed ;;
  run) shift; cmd_run "$@" ;;
  media) shift; cmd_media "$@" ;;
  admin) shift; cmd_admin "$@" ;;
  clean) drop_db "$TEMPLATE"; drop_db "$CLONE"; rm -rf "$SCRATCH"; log "dropped $TEMPLATE" ;;
  *) echo "usage: $0 seed | run [label] | media [label] | admin [label] | clean" >&2; exit 2 ;;
esac
