# __NAME__

A Manablox CMS instance run from the published npm packages. Everything runs in Docker:
fill in `.env`, build, start.

```
package.json                the four packages a CMS needs, plus the manablox CLI
pnpm-workspace.yaml         install-script allowlist (sharp, argon2, esbuild)
content-model.ts            plugins and code-defined content types, shared by every config
manablox.config.ts          the management instance: API + admin at /
{{#if publicApi}}
manablox.public.config.ts   the hardened public delivery instance
{{/if}}
Dockerfile                  one image, every process
compose.yml                 the services below
{{#if caddy}}
caddy/Caddyfile             TLS and routing
{{/if}}
{{#if nginx}}
nginx/templates/            TLS and routing; nginx/certs/ holds the certificate
{{/if}}
{{#if !sqlite}}
postgres/init/              creates the database roles on the first start
{{/if}}
scripts/                    lockfile, backup, restore
.env                        the secrets and origins of this instance; never commit it
.env.example                every variable, commented
```

## What runs

| Service | Role | Reached at |
| --- | --- | --- |
{{#if !sqlite}}
| `postgres` | The database. The only state that matters. `migrate` connects as the owner role, the CMS as the app role | internal |
{{/if}}
| `valkey` | Shared response cache and job queue | internal |
| `migrate` | `manablox migrate`, one-shot, before `api` starts | exits |
| `api` | `manablox start`: management API and the admin, one process | `__ADMIN_URL__`{{#if !byDomain}} (host port `$ADMIN_PORT`){{/if}} |
{{#if publicApi}}
| `public` | `manablox start --config manablox.public.config.ts`: delivery API pinned to one space, {{#if sqlite}}read-only surfaces{{#else}}read-only DB role{{/if}} | `__PUBLIC_API_URL__`{{#if !byDomain}} (host port `$PUBLIC_PORT`){{/if}} |
{{/if}}
{{#if mailpit}}
| `mailpit` | Catches every mail the CMS sends | `http://127.0.0.1:8025` |
{{/if}}
{{#if caddy}}
| `caddy` | TLS termination, automatic certificates, routing. The only published ports | 80, 443 |
{{/if}}
{{#if nginx}}
| `nginx` | TLS termination with your certificates, routing. The only published ports | 80{{#if tls}}, 443{{/if}} |
{{/if}}

The admin is served by the `api` process at `/`, same origin as the API, so it needs no
CORS entry and no proxy rules. Uploads live in the `uploads` volume, mounted read-only into every process that only reads.
{{#if sqlite}}

The database is SQLite, the only state that matters: the file `manablox.db` in the
`database` volume, mounted into {{#if publicApi}}`migrate`, `api` and `public`{{#else}}`migrate` and `api`{{/if}}. SQLite has one writer, so
run a single management instance: never scale `api` to several replicas.
{{/if}}

## First start

1. Make sure `pnpm-lock.yaml` exists. The Dockerfile installs with `--frozen-lockfile`.
   `manablox create` wrote it if you let it install; otherwise run `./scripts/lockfile.sh`,
   which runs pnpm in a `node:24` container. Rerun it after every change to `package.json`.

2. Check `.env`. The secrets were generated for you. {{#if caddy}}Both domains must resolve to this host so
   Caddy can obtain certificates. For a plain-http trial on your own machine set
   `ADMIN_DOMAIN=http://cms.localhost`{{#if publicApi}} and `PUBLIC_DOMAIN=http://content.localhost`{{/if}} with matching
   `PUBLIC_URL`{{#if publicApi}} and `PUBLIC_API_URL`{{/if}}.{{/if}}{{#if nginx}}The domains must resolve to this host.{{#if tls}} Put the certificate into
   `nginx/certs/fullchain.pem` and `nginx/certs/privkey.pem` (one certificate covering every
   TLS domain), or run `./scripts/selfsigned-certs.sh` for a trial.{{/if}}{{/if}}{{#if ports}}Set `PUBLIC_URL`{{#if publicApi}} and `PUBLIC_API_URL`{{/if}} to the
   origins your proxy serves, and keep forwarding `X-Forwarded-Proto` and `X-Forwarded-Host`.{{/if}}

3. Build and start.

   ```sh
   docker compose build
   docker compose up -d
   docker compose logs -f __LOG_SERVICES__
   ```

4. Open <__ADMIN_URL__>. The first account you create becomes the instance
   superadmin; sign-up closes after it. Create a space.
{{#if publicApi}}

5. Pin the public instance. Until it can pin exactly one space `public` answers 503
   `publicApi.space.unresolved` and checks again every ten seconds; with exactly one
   space it pins that one automatically. With several, set `MANABLOX_SPACE` to the
   technical name of the one to serve and `docker compose up -d public`.
{{/if}}

{{slot readme.sections}}

## Day two

| Task | Command |
| --- | --- |
| Deploy a new version | `docker compose build && docker compose up -d` (migrations run first, `api` waits for them) |
| Migrate only | `docker compose run --rm migrate` |
| Web Push keys | `docker compose run --rm --no-deps api push-keys`, then paste into `.env` |
| Logs | `docker compose logs -f __LOG_SERVICES__{{#if caddy}} caddy{{/if}}{{#if nginx}} nginx{{/if}}` |
| Backup | `./scripts/backup.sh` writes `backups/<timestamp>/` with {{#if sqlite}}a `manablox backup` copy of the database (while `api` runs){{#else}}a `pg_dump`{{/if}} and the uploads; keeps the last 14 |
| Restore | `./scripts/restore.sh backups/<timestamp>` |
| Typecheck the configs | `pnpm install && pnpm typecheck` on a workstation with Node 24 |

__MAIL_SECTION__
## Changing the content model

`content-model.ts` is imported by every config. Add content types, plugins or field
types there, rebuild the image and `docker compose up -d`. The image carries the whole
project except what `.dockerignore` lists, so plugins may live in subfolders. Content
types created in the admin at runtime live in the database and need no code.

## Health

Every process answers `GET /healthz` (liveness) and `GET /readyz` (readiness: checks the
database, reports the schema version). The image declares a `HEALTHCHECK` on `/readyz`.

## Security notes

{{#if !sqlite}}
- Postgres has two roles for the CMS, created by `postgres/init/10-roles.sh` on the first start of an empty data volume: `manablox_owner` owns the schema and runs the migrations, `manablox_app` is what `api` logs in as. The app role reads and writes rows but cannot change tables or delete audit entries; every migration run grants it its rights. `POSTGRES_PASSWORD` is the superuser's, for administration and backups only.
{{/if}}
- {{#if byDomain}}Only {{#if caddy}}Caddy{{#else}}nginx{{/if}} publishes ports. The API and the {{#if sqlite}}cache{{#else}}database{{/if}} are reachable on the compose network alone.{{#else}}Only the API ports are published. {{#if sqlite}}The cache is{{#else}}The database and the cache are{{/if}} reachable on the compose network alone.{{/if}}
{{#if publicApi}}
{{#if sqlite}}
- SQLite has no read-only role: the public instance opens the same database file. Its isolation is the public server mode: no auth, no RPC, no uploads, no drafts, one pinned space.
{{#else}}
- The public instance connects as `manablox_public`, a role that can only `select`. It is created by `postgres/init/20-public-role.sh` on the first start of an empty data volume.
{{/if}}
{{/if}}
- `AUTH_SECRET` signs sessions and media transform URLs and encrypts the stored credentials and AI provider keys. Rotating it signs everyone out, invalidates every image URL a CDN holds and leaves those stored secrets unreadable until they are entered again.
- `api` and `migrate` read all of `.env`; the processes that only read get only the variables `compose.yml` lists{{#if !sqlite}}, never the owner password{{/if}}.
- The containers run as a non-root user; the application directory is not writable.
- GraphQL introspection is off in production{{#if publicApi}} on both instances. `PUBLIC_GRAPHQL_INTROSPECTION=true` turns it on for the public instance only{{/if}}.
{{slot readme.security}}
