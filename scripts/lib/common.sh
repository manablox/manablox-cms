#!/usr/bin/env bash
# Shared helpers for the scripts in this directory. Source it, do not run it:
#
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
#
# It sets ROOT to the repository root and defines the few things every script needs:
# a prefixed logger, a fatal-error helper, a yes/no prompt that refuses to run
# unattended, and the docker compose wrapper that `dev.sh` owns.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT

# The script's own name, for log prefixes: `db-reset: ...`.
SCRIPT_NAME="$(basename "${BASH_SOURCE[1]:-$0}" .sh)"

log() { printf '%s: %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '%s: %s\n' "$SCRIPT_NAME" "$*" >&2; }
die() { warn "$@"; exit "${DIE_STATUS:-1}"; }

# `usage_error "unknown option '$1'"` - prints the message, then the caller's usage(),
# and exits 2, which is what every script here does on a bad flag.
usage_error() {
  warn "$1"
  if declare -F usage >/dev/null; then usage >&2; fi
  exit 2
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is required but not installed"
  docker info >/dev/null 2>&1 || die "docker is installed but the daemon is not reachable"
}

# `confirm "continue?"` - true on yes. Refuses to run without a terminal unless the
# caller set ASSUME_YES=true, so an unattended invocation cannot silently answer yes.
confirm() {
  if [ "${ASSUME_YES:-false}" = true ]; then return 0; fi
  if [ ! -t 0 ]; then die "refusing to run unattended without --yes"; fi
  local reply
  read -r -p "$SCRIPT_NAME: $1 [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# Each app's compose environment is gitignored, so a fresh clone has only the committed
# `.env.example` next to it. Seed the missing ones and leave every existing file alone.
seed_env() {
  local example env
  for example in "$ROOT"/apps/*/.env.example; do
    # No `shopt -s nullglob` here: an unmatched glob arrives as its own literal.
    [ -e "$example" ] || continue
    env="${example%.example}"
    if [ ! -e "$env" ]; then
      cp "$example" "$env"
      log "created ${env#"$ROOT"/} from .env.example"
    fi
  done
}

# The development stack. Compose takes its project directory from the compose file's
# own directory, so without --env-file the repository root's `.env` is never read.
COMPOSE_FILE="$ROOT/docker/compose.dev.yml"
compose() {
  seed_env
  local env_file=()
  if [ -f "$ROOT/.env" ]; then env_file=(--env-file "$ROOT/.env"); fi
  # The workspace containers write `node_modules` into the bind-mounted working copy, so
  # they run as the invoking user. Without this compose falls back to 1000:1000.
  DEV_UID="$(id -u)" DEV_GID="$(id -g)" docker compose "${env_file[@]}" -f "$COMPOSE_FILE" "$@"
}
