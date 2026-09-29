#!/usr/bin/env bash
# Restores a backup made by backup.sh: ./scripts/restore.sh backups/<timestamp>
# Stops the CMS processes, replaces the database {{#if sqlite}}file{{#else}}contents{{/if}} and the uploads, then starts
# them again. Media caches regenerate on demand.
set -euo pipefail
cd "$(dirname "$0")/.."

dir=${1:?usage: restore.sh backups/<timestamp>}
# The processes that use the database, stopped while it is replaced.
processes=(__PROCESSES__)
{{slot restore.processes}}
{{#if sqlite}}
[ -f "$dir/database.db" ] || { echo "no database.db in $dir" >&2; exit 1; }

docker compose stop "${processes[@]}"
# A stale -wal or -shm file would be replayed onto the restored database.
docker compose run --rm --no-deps --user root -v "$PWD/$dir:/backup:ro" --entrypoint sh api \
  -c 'cd /data/db && rm -f manablox.db-wal manablox.db-shm && cp /backup/database.db manablox.db && chown manablox:manablox manablox.db'
{{#else}}
[ -f "$dir/database.dump" ] || { echo "no database.dump in $dir" >&2; exit 1; }

user=${POSTGRES_USER:-manablox}
db=${POSTGRES_DB:-manablox}

docker compose stop "${processes[@]}"
docker compose exec -T postgres pg_restore -U "$user" -d "$db" --clean --if-exists < "$dir/database.dump"
{{/if}}
if [ -f "$dir/uploads.tar.gz" ]; then
  docker compose run --rm --no-deps --user root -v "$PWD/$dir:/backup:ro" --entrypoint sh api \
    -c 'rm -rf /data/uploads/* && tar -xzf /backup/uploads.tar.gz -C /data'
fi
docker compose up -d "${processes[@]}"

echo "restored from $dir"
