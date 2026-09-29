#!/usr/bin/env bash
# Build every publishable package and publish it to the dev stack's local registry
# (Verdaccio, http://localhost:4873), where the other Manablox repositories install
# `@manablox/*` from in development. It never publishes to npmjs.com: the registry URL
# must be a local one, which scripts/dev-publish.mjs checks before anything is sent.
#
# The build and the packing are `scripts/publish.sh --pack-only`, the same tarballs a
# release uploads. They run in the dev stack's api container when the stack is up, like
# publish.sh, and on the host otherwise.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$ROOT"

# Inside the repository, gitignored, and removed by `dev:reset`.
PACK_DIR=docker/data/dev-publish

version=""
dev=false
tag=""
mode=auto

usage() {
  cat <<'USAGE'
Usage: scripts/dev-publish.sh [options]

  (no options)      build, pack and publish every package at the workspace version
                    (0.50.0) under the `latest` tag, replacing what is there
  --dev             publish as <version>-dev.<UTC timestamp> under the `dev` tag instead,
                    so a consumer's lockfile sees a new version every time
  --version <v>     publish as this version
  --tag <name>      the dist-tag (default: latest, or dev with --dev)
  --host            build on the host even when the dev stack is running
  --container       build in the dev stack's api container (it has to be running)
  -h, --help        this message

The registry is http://localhost:4873 (http://verdaccio:4873 from the container);
`pnpm dev:services` or `pnpm dev:up` starts it.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dev) dev=true ;;
    --version) version="${2:?--version needs a version}"; shift ;;
    --tag) tag="${2:?--tag needs a name}"; shift ;;
    --host) mode=host ;;
    --container) mode=container ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown option '$1'" ;;
  esac
  shift
done

require_docker

if [ -z "$version" ]; then
  version="$(sed -nE 's/^  "version": "([^"]+)",?$/\1/p' packages/core/package.json | head -n1)"
  [ -n "$version" ] || die "could not read the version from packages/core/package.json"
fi
if [ "$dev" = true ]; then
  version="$version-dev.$(date -u +%Y%m%d%H%M%S)"
  tag="${tag:-dev}"
fi
tag="${tag:-latest}"

if [ "$mode" = auto ]; then
  if compose ps --status running --services 2>/dev/null | grep -qx api; then
    mode=container
  else
    mode=host
  fi
fi

# The registry has to be up whichever side builds.
log "starting the local registry"
compose up -d --wait verdaccio

log "building and packing on the $mode"
pack_args=(--pack-only "$PACK_DIR" --skip-checks --no-git-checks)
if [ "$mode" = host ]; then pack_args+=(--host); fi
"$ROOT/scripts/publish.sh" "${pack_args[@]}"

publish_args=(--dir "$PACK_DIR" --version "$version" --tag "$tag")
if [ "$mode" = host ]; then
  command -v node >/dev/null || die "node is required on the host; start the stack with 'pnpm dev:up' to publish from its container"
  node scripts/dev-publish.mjs "${publish_args[@]}" --registry http://localhost:4873/
else
  compose exec -T api node scripts/dev-publish.mjs "${publish_args[@]}" \
    --registry http://verdaccio:4873/
fi

cat <<DONE

$SCRIPT_NAME: $version is on http://localhost:4873 under '$tag'. Check it with

  npm view @manablox/core --registry http://localhost:4873
DONE
