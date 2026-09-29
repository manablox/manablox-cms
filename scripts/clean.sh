#!/usr/bin/env bash
# Remove generated directories from the workspace.
#
# It walks the workspace roots declared in pnpm-workspace.yaml (apps/*, packages/*) plus
# the repository root, and deletes only known-generated paths by name. Nothing is matched
# recursively, so a `dist` directory that is actually source is never at risk.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
shopt -s nullglob

BUILD_DIRS=(dist .output .nuxt .astro .turbo .vite coverage .tmp)
MODULE_DIRS=(node_modules)

clean_build=true
clean_modules=false
dry_run=false

usage() {
  cat <<'USAGE'
Usage: scripts/clean.sh [options]

  (no options)     remove build output: dist, .output, .nuxt, .astro, .turbo, .vite,
                   coverage, .tmp and *.tsbuildinfo, in every workspace package
  --node-modules   remove node_modules instead
  --all            remove both
  --dry-run        list what would be removed, delete nothing
  -h, --help       this message
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --node-modules) clean_build=false; clean_modules=true ;;
    --all) clean_build=true; clean_modules=true ;;
    -n|--dry-run) dry_run=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown option '$1'" ;;
  esac
  shift
done

# The repository root is a workspace package too - it holds the root node_modules and
# turbo's cache.
workspace_dirs() {
  printf '%s\n' "$ROOT"
  for dir in "$ROOT"/apps/*/ "$ROOT"/packages/*/; do
    [ -d "$dir" ] && printf '%s\n' "${dir%/}"
  done
}

removed=0
remove() {
  local path="$1"
  [ -e "$path" ] || return 0
  printf '  %s\n' "${path#"$ROOT"/}"
  if [ "$dry_run" = false ]; then rm -rf "$path"; fi
  removed=$((removed + 1))
}

targets=()
[ "$clean_build" = true ] && targets+=("${BUILD_DIRS[@]}")
[ "$clean_modules" = true ] && targets+=("${MODULE_DIRS[@]}")

if [ "$dry_run" = true ]; then
  log "dry run, nothing will be deleted"
fi
log "removing ${targets[*]}"

while IFS= read -r pkg; do
  for name in "${targets[@]}"; do
    remove "$pkg/$name"
  done
  if [ "$clean_build" = true ]; then
    # tsc writes these next to the tsconfig that produced them.
    for info in "$pkg"/*.tsbuildinfo; do
      remove "$info"
    done
    # Astro's content-layer cache. It survives a deleted `dist` and `.astro`, and a stale
    # one keeps rendering markdown with a remark plugin that has since changed.
    remove "$pkg/node_modules/.astro"
  fi
done < <(workspace_dirs)

if [ "$removed" -eq 0 ]; then
  log "nothing to remove"
elif [ "$dry_run" = true ]; then
  log "$removed path(s) would be removed"
else
  log "removed $removed path(s)"
fi

if [ "$clean_modules" = true ] && [ "$dry_run" = false ]; then
  log "run 'pnpm install' before the next build"
fi
