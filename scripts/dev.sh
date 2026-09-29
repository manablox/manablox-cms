#!/usr/bin/env bash
# Control the development docker compose stack.
#
# Every command is a thin wrapper around `docker compose -f docker/compose.dev.yml`, so
# the stack can be driven without node or pnpm on the host. Arguments after the command
# are passed straight through to docker compose (e.g. `dev.sh logs api -n 100`).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

# Started and stopped on their own so the apps can run on the host against them. The
# registry is one of them: the other repositories install from it with or without the apps.
INFRA_SERVICES=(postgres valkey minio mailpit verdaccio)

# Emptied by `reset`: the uploads and media cache of the API's local storage driver.
DATA_DIRS=(docker/data/uploads docker/data/media-cache)

usage() {
  cat <<'USAGE'
Usage: scripts/dev.sh <command> [docker compose args...]

  up               build and start the whole stack in the background
  down             stop the stack, keep volumes
  logs             follow the logs of all services
  reset            stop the stack and delete its volumes: the database, the object
                   store, the cache and the local registry's packages; and empty
                   docker/data/uploads and docker/data/media-cache
  services:up      start only postgres, valkey, minio, mailpit and verdaccio
  services:down    stop the stack (same as `down`)
  publish          build every publishable package and publish it to the local
                   registry (scripts/dev-publish.sh; `publish --help` for its options)
  <other>          any other docker compose command, forwarded as-is

  -h, --help       this message

Ports: api 3000, public api 3001, admin 3002, postgres 5432, valkey 6379,
minio 9000 (console 9001), mailpit 1025 (ui 8025), verdaccio 4873.
USAGE
}

if [ $# -eq 0 ]; then
  usage >&2
  exit 2
fi

command="$1"
shift

case "$command" in
  -h|--help) usage; exit 0 ;;
  # Its own script: it needs node, which the rest of this file does not.
  publish) exec "$ROOT/scripts/dev-publish.sh" "$@" ;;
esac

# A container still attached to a deleted network cannot start; remove it so `up` recreates it.
drop_stale_containers() {
  local id net stale=()
  for id in $(compose ps -aq); do
    for net in $(docker inspect -f '{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}' "$id"); do
      if ! docker network inspect "$net" >/dev/null 2>&1; then
        stale+=("$id")
        break
      fi
    done
  done
  if [ ${#stale[@]} -gt 0 ]; then
    log "recreating ${#stale[@]} container(s) whose network is gone"
    docker rm -f "${stale[@]}" >/dev/null
  fi
}

where() {
  cat <<'WHERE'

  api          http://localhost:3000   (health: /healthz)
  public api   http://localhost:3001   (starts once the instance has a space)
  admin        http://localhost:3002
  mailpit      http://localhost:8025
  minio        http://localhost:9001   (manablox / manablox123)
  verdaccio    http://localhost:4873   (pnpm dev:publish fills it)
WHERE
}

require_docker

case "$command" in
  up|services:up|services-up) drop_stale_containers ;;
esac

case "$command" in
  up)
    # `up -d` returns once every service's `depends_on` condition holds, and the admin
    # waits for a healthy API, so the stack answers when this returns.
    compose up -d --build "$@"
    where
    ;;
  down) compose down "$@" ;;
  logs) compose logs -f "$@" ;;
  reset)
    compose down -v --remove-orphans "$@"
    # The tarballs of the last `dev:publish`; the registry they went to is gone.
    rm -rf "$ROOT/docker/data/dev-publish"
    # The API's local storage and media cache (apps/api/.env), which the database rows
    # that referenced them took with them. Their contents only: the paths stay.
    for dir in "${DATA_DIRS[@]}"; do
      if [ -d "$ROOT/$dir" ]; then
        find "$ROOT/$dir" -mindepth 1 ! -name .gitkeep -delete
      fi
    done
    ;;
  services:up|services-up) compose up -d --wait "${INFRA_SERVICES[@]}" "$@" ;;
  services:down|services-down) compose down "$@" ;;
  *) compose "$command" "$@" ;;
esac
