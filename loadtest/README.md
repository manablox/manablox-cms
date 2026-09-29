# Load testing

A standalone [Grafana k6](https://k6.io) suite for the public delivery API and any number
of frontends. It runs from Docker Compose, builds nothing and starts none of the
application: point it at a running instance, whether the dev stack, staging or
production.

## Quick start

```sh
cd loadtest
cp .env.example .env        # set PUBLIC_API_URL and FRONTEND_URLS
./run.sh api smoke          # one user, 30 seconds: is it reachable at all?
./run.sh api                # the `load` profile from .env
./run.sh frontends stress
./run.sh all spike
```

`run.sh` is a thin wrapper over `docker compose run --rm k6 run <script>`; the same
commands work without it:

```sh
docker compose run --rm --service-ports k6                                # public API, PROFILE from .env
docker compose run --rm --service-ports -e PROFILE=soak k6 run /loadtest/scripts/frontends.js
docker compose run --rm --service-ports k6 run /loadtest/scripts/all.js
```

`--service-ports` publishes the live dashboard port; `docker compose run` drops the
mapping without it.

Anything after the profile goes to `k6 run`. `--vus 5 --duration 30s` replaces the
profile with a flat run, `-e LOCALE=de` overrides one variable.

## What is tested

| Suite | Script | What a virtual user does |
| --- | --- | --- |
| `api` | `scripts/public-api.js` | Two scenarios side by side. **REST**: menu, then the home page or a permalink, a pause, then a list, a document by id, a search or a deliberate miss. **GraphQL**: one page query (document plus menu), a pause, then a list, a document or a search. |
| `frontends` | `scripts/frontends.js` | Picks a site by weight, visits two to four of its paths with pauses, and fetches each page's same-origin scripts and stylesheets the way a browser would. |
| `all` | `scripts/all.js` | All at once, sharing one profile: the frontends' server-side requests land on the same API the direct visitors are hitting. |

The API suite discovers its request mix at setup: `/v1/types` for the content types,
two pages of `/v1/content` for ids and permalinks, and the menus named in
`config/targets.json`. An empty space still gets a run; it just answers 404 a lot.

## Configuration

Two files, both gitignored except their templates:

- `.env` holds the targets, the profile and the thresholds. Every variable is documented
  in `.env.example`.
- `config/targets.json` holds what cannot be a flat string: per-frontend paths, weights
  and Host headers, the menus and search terms to try, and the GraphQL field lists.

### The public API

`PUBLIC_API_URL` is the base URL of a public instance, the one that answers
`GET /v1/content` and `POST /graphql` without a space header. From inside the runner the
host machine is `host.docker.internal`.

The public preset rate limits per IP at 300 requests a minute. A load test from one
address reaches that within seconds, so either start the target with `RATE_LIMIT=off` or
read the `rate_limited` counter in the report. By default a 429 counts as neither a
success nor a failure; `FAIL_ON_RATE_LIMIT=true` makes it a failure.

### Frontends

`FRONTEND_URLS` is a comma separated list of base URLs. Each takes its paths, weight and
Host header from the `frontends` entry in `targets.json` whose `url` matches, or
`defaultFrontendPaths` when none does. With the variable empty, the file alone defines
the list.

A path may contain `{permalink}`, replaced at run time by a permalink discovered from the
public API, so `"/blog/{permalink}"` visits real articles.

Dev servers (Vite, Nuxt) answer 403 to any Host but their own. The `host` field on an
entry sets the header, so an entry pointing at one carries `localhost:<port>`. A
production build behind a proxy does not need it.

### Profiles

| Profile | Shape | Question it answers |
| --- | --- | --- |
| `smoke` | 1 VU for 30 s | Does it work at all? |
| `load` | ramp to 20 VUs, hold 3 min | What are p95 and error rate at expected traffic? |
| `stress` | 20, 50, 100, 200 VUs in steps | Where is the knee? |
| `spike` | 5 to 200 VUs in 10 s, then back | Does it recover from a burst? |
| `soak` | 30 VUs for 30 min | Does anything leak or fill up? |
| `breakpoint` | 50 to 5000 req/s over 10 min, no pauses | What is the maximum request rate? |

`VU_SCALE` multiplies every target, so the same names fit a laptop and a CI runner. The
exact stages are in `scripts/lib/profiles.js`.

The first five model visitors: each virtual user pauses half a second to two seconds
between requests, so even `stress` at 200 users is only around 150 requests a second.
They answer "what happens to latency with this many people on the site", not "how much
can it take". That is what `breakpoint` is for.

### Finding the maximum request rate

```sh
./run.sh api breakpoint
```

`breakpoint` uses k6's arrival-rate executor rather than virtual users: it sends the
requested number of requests per second regardless of how slowly they are answered, and
ramps that rate linearly from `BREAKPOINT_START_RPS` to `BREAKPOINT_MAX_RPS` over
`BREAKPOINT_RAMP`. There is no think time and every iteration is exactly one request
(one page for a frontend), so the rate the executor reports is the request rate the
instance is being asked for.

Every threshold becomes an abort condition. The moment p95, p99 or the error rate stays
over its limit for `BREAKPOINT_ABORT_DELAY`, or k6 starts dropping iterations because
every VU is stuck waiting, the run stops and the summary ends with a report:

```
== breakpoint
   stopped after 231s of a 10m ramp: http_req_duration{surface:rest} crossed
   requested rate at stop   1955 req/s (target across all scenarios)
   rate where trouble began 1790 req/s (one abort delay of 20s earlier)
   achieved over the run    987.4 req/s average, 228092 requests
   ...
```

The sustainable maximum is around the rate where trouble began. To confirm it, run the
`load` profile scaled to sit just under that rate and check the thresholds hold for
minutes, not seconds. If the full ramp completes without an abort, the instance takes
more than the maximum rate: raise `BREAKPOINT_MAX_RPS` and go again.

What shapes the number:

- The public instance's rate limiter (300 requests a minute per IP) must be off, or you
  measure the limiter.
- k6 and the target on the same machine compete for CPU. Past a few thousand requests a
  second the runner is often the bottleneck; run it from another host for real figures.
- The API caches reads, so a small content set yields a cache-hit number. More documents
  and search terms in the mix give a lower, more honest one.
- `BREAKPOINT_MAX_VUS` caps concurrency. If dropped iterations are what stopped the run
  while p95 was still fine, the cap was too low, not the server.
- Per-surface figures are in the summary under `http_reqs{surface:...}`; a list with
  `expand` costs far more than a permalink lookup, so a blended number hides a lot.

### With controls set

Controls (feature flags, usage limits, rate rules; see the
[control API](https://dev.manablox.io/reference/control-api/)) are resolved on every delivery request, and
usage is counted whether or not any are set. To measure what resolving and enforcing them
costs, run the same suite twice, once without control values and once with them:

```sh
# in .env: CONTROL_API_URL=http://<management process>:<port>, CONTROL_API_KEY=<its key>
./run.sh api smoke --vus 20 --duration 60s                   # baseline
./run.sh api smoke --vus 20 --duration 60s -e CONTROLS=on    # with controls
```

With `CONTROLS=on` the setup stores a set of controls at `CONTROLS_SCOPE` (default
`instance`) through the control API: a few feature flags (the delivery APIs explicitly on,
webhooks, workflows and SSO off), soft usage limits on `apiRequests` and `bandwidthBytes`,
and the `delivery.ip` and `delivery.space` rate rules with limits no run reaches, so every
request takes the rate limiter's path without being refused. It waits
`CONTROLS_SETTLE_SECONDS` (6) for every process to pick them up, and the teardown puts back
what the scope held before. `controls.settings` in `targets.json`, a settings body as
`PUT /control/v1/settings` takes it, replaces the built-in set. Without `CONTROLS=on` and
with `CONTROL_API_URL` set, the setup only logs which scopes store values, so a baseline
can confirm it has none. Results of a run with controls are named
`<suite>-<profile>-controls-<time>.json`.

The control API is served by a management process with the `control` scope, not by the
public instance under test. Point it at the same database and Redis as the public instance,
so the public instance picks the values up; a public instance with `RATE_LIMIT=off` still
applies the rate rules once they are set.

For a fair comparison, use a fixed `--vus` and `--duration`, alternate baseline and
controls runs against the same processes (three each), and compare the median of the p95
values per surface. Run once with the response cache on and once with the public instance
started with `CACHE_ENABLED=false` at fewer VUs: cached answers take a millisecond or two,
so they show a per-request cost most clearly. The budget is under 1 ms p95 per request.

### Thresholds

The run fails (non-zero exit) when any of these is crossed:

- p95 and p99 of `http_req_duration` per surface (`rest`, `graphql`, `frontend`) and per
  frontend site, against `API_P95_MS`, `API_P99_MS`, `FRONTEND_P95_MS` and `FRONTEND_P99_MS`
- error rate per surface and per site, against `MAX_ERROR_RATE`
- `check_failures`, the rate of responses whose body did not look right

Setup probes are tagged `surface:setup` and excluded from all of them.

## Reading the results

Every run prints k6's summary and writes `results/<suite>-<profile>-<time>.json` with the
full metrics, so two runs can be diffed. Numbers are only comparable between runs on the
same machine against the same content.

`K6_WEB_DASHBOARD=true` (the default in `.env.example`) serves k6's live dashboard on
`http://localhost:5665` while a run is going and writes an HTML report to `results/`
when it ends. It appears a few seconds after the run starts, once k6 has loaded the
script and finished setup.

For a persistent dashboard across runs:

```sh
./run.sh dashboard up          # InfluxDB + Grafana on http://localhost:3300
# in .env: K6_OUT=influxdb=http://influxdb:8086/k6
./run.sh api stress
./run.sh dashboard down
```

Grafana is provisioned with the datasource and a dashboard (requests per second, VUs,
error rate, p95 per API request and per frontend site) and needs no login.

## Reaching the targets

By default the runner is on its own network and reaches the host as
`host.docker.internal`. To join an existing Docker network instead, set
`LOADTEST_NETWORK`; `run.sh` then adds `compose.network.yml`:

```sh
LOADTEST_NETWORK=manablox-cms-dev_default ./run.sh api load
```

with `PUBLIC_API_URL=http://public-api:3001` and `FRONTEND_URLS` set to service names on that network in `.env`. For a remote target, plain `https://` URLs work as they are.

## Layout

```
loadtest/
  compose.yml              the k6 runner and the optional dashboard stack
  compose.network.yml      overlay to join an existing network
  run.sh                   suite and profile selection
  .env.example             every variable, documented
  config/targets.json      per-frontend paths and weights, menus, search terms, GraphQL fields
  scripts/public-api.js    suite: REST + GraphQL
  scripts/frontends.js     suite: frontends
  scripts/all.js           suite: all of them
  scripts/lib/             config, profiles, request helpers, the visitor models, controls, summary
  grafana/                 provisioning and the dashboard
  results/                 one JSON per run (gitignored)
```
