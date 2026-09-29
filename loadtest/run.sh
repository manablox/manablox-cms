#!/usr/bin/env bash
# One entry point for the suite.
#
#   ./run.sh api [profile] [k6 args...]         public API (REST + GraphQL)
#   ./run.sh frontends [profile] [k6 args...]   the configured frontends
#   ./run.sh all [profile] [k6 args...]         all of them together
#   ./run.sh dashboard up|down                   the optional Grafana + InfluxDB stack
#
# profile: smoke | load | stress | spike | soak | breakpoint (default: PROFILE from .env,
# else load). `breakpoint` finds the maximum request rate; see README.
# Anything after the profile goes to `k6 run`, e.g. `--vus 5 --duration 20s` to override
# the profile entirely, or `-e LOCALE=de`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "run.sh: created .env from .env.example; edit PUBLIC_API_URL and FRONTEND_URLS" >&2
fi

compose=(docker compose -f compose.yml)
if [[ -n "${LOADTEST_NETWORK:-}" ]]; then
  compose+=(-f compose.network.yml)
fi

suite="${1:-api}"; shift || true

case "$suite" in
  dashboard)
    action="${1:-up}"
    if [[ "$action" == "up" ]]; then
      "${compose[@]}" --profile dashboard up -d
      echo "grafana: http://localhost:${GRAFANA_PORT:-3300}  (set K6_OUT=influxdb=http://influxdb:8086/k6 in .env to stream)"
    else
      "${compose[@]}" --profile dashboard down
    fi
    exit 0
    ;;
  api) script=/loadtest/scripts/public-api.js ;;
  frontends) script=/loadtest/scripts/frontends.js ;;
  all) script=/loadtest/scripts/all.js ;;
  *) echo "run.sh: unknown suite '$suite' (api | frontends | all | dashboard)" >&2; exit 2 ;;
esac

profile_args=()
if [[ $# -gt 0 && "$1" =~ ^(smoke|load|stress|spike|soak|breakpoint)$ ]]; then
  profile_args=(-e "PROFILE=$1"); shift
fi

# `run` publishes no ports unless told to; without `--service-ports` the live dashboard
# on 5665 is only reachable from inside the container.
exec "${compose[@]}" run --rm --service-ports "${profile_args[@]}" k6 run "$script" "$@"
