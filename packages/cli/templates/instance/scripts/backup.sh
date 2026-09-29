#!/usr/bin/env bash
{{#if sqlite}}
# Copies the database while the api runs (a consistent snapshot, restorable with
# restore.sh) and archives the uploads volume into ./backups/<timestamp>/. The api must be
# running. Run it from a host cron, for example nightly:
{{#else}}
# Dumps the database (custom format, restorable with restore.sh) and archives the uploads
# volume into ./backups/<timestamp>/. Run it from a host cron, for example nightly:
{{/if}}
#   0 3 * * * cd /srv/__COMPOSE_NAME__ && ./scripts/backup.sh >> backups/backup.log 2>&1
# With STORAGE_DRIVER=s3 the uploads live in your bucket; use its own versioning.
set -euo pipefail
cd "$(dirname "$0")/.."

stamp=$(date +%Y-%m-%d_%H-%M-%S)
dir="backups/$stamp"
mkdir -p "$dir"

{{#if sqlite}}
# `manablox backup` writes the copy into the volume as the api's user; it is removed there
# once copied out.
snapshot="/data/db/backup-$stamp.db"
docker compose exec -T api /app/node_modules/.bin/manablox backup "$snapshot"
trap 'docker compose exec -T api rm -f "$snapshot"' EXIT
docker compose cp "api:$snapshot" "$dir/database.db"
{{#else}}
user=${POSTGRES_USER:-manablox}
db=${POSTGRES_DB:-manablox}

docker compose exec -T postgres pg_dump -U "$user" -Fc "$db" > "$dir/database.dump"
{{/if}}
docker compose run --rm --no-deps --user root -v "$PWD/$dir:/backup" --entrypoint sh api \
  -c 'tar -czf /backup/uploads.tar.gz -C /data uploads'

echo "backup written to $dir"

# Keep the last 14.
ls -1d backups/*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf
