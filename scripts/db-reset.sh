#!/usr/bin/env bash
# Drop the development database and migrate it back to an empty instance.
#
# Narrower than `dev:reset`, which throws away every volume: this keeps the object store,
# the cache and the installed dependencies, and only takes the database back to the state
# a fresh clone starts in - no content, no users, so the next account you create is the
# instance superadmin again.
#
# Everything goes through `scripts/dev.sh`, which owns the compose invocation.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
DEV="$ROOT/scripts/dev.sh"

# Emptied alongside the database with --uploads: the rows that referenced them are gone.
UPLOAD_DIRS=(docker/data/uploads docker/data/media-cache)

assume_yes=false
clear_uploads=false
run_migrate=true

usage() {
  cat <<'USAGE'
Usage: scripts/db-reset.sh [options]

  (no options)     drop the database, recreate it, and apply every migration
  --uploads        also empty docker/data/uploads and docker/data/media-cache
  --no-migrate     leave the database empty rather than migrating it
  -y, --yes        do not ask for confirmation
  -h, --help       this message

To throw away the object store and the cache as well, use `pnpm dev:reset`.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --uploads) clear_uploads=true ;;
    --no-migrate) run_migrate=false ;;
    -y|--yes) assume_yes=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown option '$1'" ;;
  esac
  shift
done

log "this deletes every user, space and content item in the development database."
if [ "$clear_uploads" = true ]; then
  log "and every uploaded file in ${UPLOAD_DIRS[*]}."
fi

ASSUME_YES="$assume_yes" confirm "continue?" || die "cancelled"

# Postgres has to be up to be dropped, and healthy before the migration connects.
log "starting postgres"
"$DEV" up postgres --wait

# The names live in the postgres service's own environment, so this cannot drift from
# compose. FORCE terminates the API's open pool connections, which a plain DROP would
# refuse to do.
log "recreating the database"
"$DEV" exec -T postgres sh -c '
  set -eu
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""
'

if [ "$clear_uploads" = true ]; then
  log "emptying uploads"
  for dir in "${UPLOAD_DIRS[@]}"; do
    # Contents, not the directory: the API expects the path to exist.
    rm -rf "${ROOT:?}/$dir"/*
  done
fi

if [ "$run_migrate" = true ]; then
  log "applying migrations"
  # With the dependencies installed, skip the `install` service: its pnpm, on a store of
  # its own, would want to purge a host install and refuses to without a terminal.
  if [ -f "$ROOT/node_modules/.modules.yaml" ]; then
    "$DEV" run --rm --no-deps migrate
  else
    "$DEV" run --rm migrate
  fi
fi

# The API pooled connections to a database that no longer exists. Restart only what is
# already running; a stopped stack stays stopped.
running="$("$DEV" ps --services --filter status=running 2>/dev/null || true)"
restart=()
for svc in api public-api; do
  if printf '%s\n' "$running" | grep -qx "$svc"; then restart+=("$svc"); fi
done
if [ ${#restart[@]} -gt 0 ]; then
  log "restarting ${restart[*]}"
  "$DEV" restart "${restart[@]}"
fi

log "done - the next account you create is the instance superadmin"
