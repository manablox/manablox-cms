#!/usr/bin/env bash
# Throughput and latency of the delivery surfaces, for before/after comparison.
#
# Runs autocannon against a running instance (the Docker stack by default). Pass the
# base URL as the first argument to point it elsewhere. Numbers are only comparable
# between runs on the same machine with the same content, so keep a note of both.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

BASE_URL="${1:-http://localhost:3001}"
DURATION="${BENCH_DURATION:-10}"
CONNECTIONS="${BENCH_CONNECTIONS:-20}"

run() {
  local label="$1"; shift
  echo
  echo "== $label"
  pnpm dlx autocannon -d "$DURATION" -c "$CONNECTIONS" "$@"
}

echo "bench: $BASE_URL for ${DURATION}s x ${CONNECTIONS} connections"
echo "bench: db statements per request (x-manablox-db-queries, non-production only):"
for path in /v1/content /v1/content?limit=50; do
  printf '  %-28s %s\n' "$path" "$(curl -si "$BASE_URL$path" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-manablox-db-queries"{print $2}')"
done

run "REST list" "$BASE_URL/v1/content?limit=25"
run "GraphQL list" -m POST -H 'content-type: application/json' \
  -b '{"query":"{ contentsPage(limit: 25) { items { id title } } }"}' "$BASE_URL/graphql"
