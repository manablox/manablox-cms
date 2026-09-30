<p align="center"><img src="./apps/admin/public/logo-mark.svg" alt="Manablox" width="96"></p>

# Manablox

A configurable, headless CMS. Headless means it stores your content and serves it over an
API; you build the website or app that shows it. Editors work in the admin interface,
developers model the content and write the frontend.

Content types are defined either in `manablox.config.ts` or at runtime in the admin. Both
feed the same registry, the same storage layer and the same generated APIs: an oRPC
management API, and GraphQL and REST delivery APIs. It runs on Postgres or SQLite, and every
feature can be switched on or off and limited from the outside, so a hosting or billing
system can offer Manablox in plans.

This repository holds the CMS: the packages published to npm as `@manablox/*`, the admin, and
the apps it runs in development. The premium plugins (AI and the website designer), the
license portal, the marketing website and both documentation sites live in their own
repositories and depend on these packages by name.

- **Developer documentation:** <https://dev.manablox.io>
- **User guide:** <https://docs.manablox.io>

## Use it

To run Manablox for a project of your own, install the published packages. The CLI writes
the project:

```sh
pnpm dlx @manablox/cli create my-cms    # asks a few questions, writes the project
cd my-cms
pnpm services:up && pnpm migrate && pnpm dev   # local preset: API and admin on http://localhost:3000
```

`manablox create` asks which features a project gets. Workflows and webhooks are free
plugins from this repository; AI and the website designer are premium plugins installed from
npm (`@manablox/plugin-ai`, `@manablox/plugin-website`); they run without a license key on a
local development instance, and production needs a subscription. `manablox plugin install`,
`uninstall`, `enable` and `disable` change them later.

The same CLI writes a frontend that reads from it:

```sh
pnpm dlx @manablox/cli frontend my-site --framework astro   # or plain, react-ssr, vue-ssr
```

## Packages

| Package | What it does |
| --- | --- |
| `@manablox/core` | The base: the config, content types, field types, plugins, hooks and errors |
| `@manablox/db` | Table definitions, migrations and queries, for Postgres and SQLite |
| `@manablox/services` | The rules of the CMS: every change goes through a service |
| `@manablox/server` | Boots the runtime, mounts the APIs and serves the admin |
| `@manablox/api-rpc` | The management API: everything the admin can do |
| `@manablox/api-graphql` | The GraphQL API for reading content |
| `@manablox/api-public` | The read-only REST API under `/v1` |
| `@manablox/auth` | Sign-in, sessions, two-factor, single sign-on and permissions |
| `@manablox/fields` | The field types Manablox comes with |
| `@manablox/media` | Uploads and on-demand image transforms |
| `@manablox/storage` | Where uploaded files are saved: the local disk or S3 |
| `@manablox/cache` | The response cache of the public APIs |
| `@manablox/jobs` | Background work: image versions, scheduled publishing and more |
| `@manablox/cli` | The `manablox` command: start, migrate, create instances and frontends |
| `@manablox/admin` | The admin, prebuilt; the server serves it |
| `@manablox/admin-plugin` | The contract and build for admin plugins |
| `@manablox/admin-sdk` | The admin's UI kit, stores and API client for admin plugins |
| `@manablox/public-sdk` | Reads content from any website or app |
| `@manablox/live-preview` | Shows editors their changes on the real website while they type |
| `@manablox/nuxt` | The Nuxt module, with live preview built in |
| `@manablox/plugin-workflows` | Automations editors build in the admin |
| `@manablox/plugin-webhooks` | Outgoing calls when content changes, and incoming endpoints |
| `@manablox/plugin-license` | License keys of the premium plugins: activations and signed leases |
| `@manablox/license` | The license key and lease format the license plugin and server share |
| `@manablox/config-typescript` | Shared TypeScript and build settings |
| `@manablox/config-vitest` | Shared vitest settings, for plugin tests too |
| `@manablox/docs-theme` | The Starlight theme of the documentation sites |

The apps are what this repository runs in development:

| Path | What lives there |
| --- | --- |
| `apps/api` | The management API: its config, entrypoint and the checkout's scripts |
| `apps/public-api` | The same code with the hardened, published-only configuration |
| `apps/admin` | The admin interface, a Vue single-page app that loads plugin screens at runtime |
| `loadtest/` | A k6 suite for the public API and frontends |

`CONTRIBUTING.md` explains where a given change belongs and how to run the checks.

## Development

Node 24 and pnpm (pinned by `packageManager`), plus Docker for the development stack.

```sh
pnpm install
pnpm test:sqlite          # the tests on SQLite, no database server needed
pnpm check                # lint, dead code, licences, conventions, typecheck, tests on both databases
```

### The development stack

`docker/compose.dev.yml`, driven by `scripts/dev.sh`. The ports are fixed so the stacks of
all Manablox repositories run side by side:

| Service | Port | |
| --- | --- | --- |
| api | 3000 | the management API; `/healthz` |
| public api | 3001 | starts once the instance has a space |
| admin | 3002 | the admin in Vite's dev server |
| postgres | 5432 | `manablox` / `manablox`, database `manablox` |
| valkey | 6379 | |
| minio | 9000, console 9001 | `manablox` / `manablox123` |
| mailpit | SMTP 1025, UI 8025 | |
| verdaccio | 4873 | the local npm registry, on `127.0.0.1` only; `verdaccio:4873` on the docker network `manablox-registry` |

| Command | What it does |
| --- | --- |
| `pnpm dev:up` | Build and start everything, apps included (`pnpm install` and the migrations run in the stack) |
| `pnpm dev:services` | Only postgres, valkey, minio, mailpit and verdaccio, to run the apps on the host with `pnpm dev` |
| `pnpm dev:logs [service]` | Follow the logs |
| `pnpm dev:down` | Stop, keep the data |
| `pnpm dev:reset` | Stop and delete every volume: database, object store, cache and the registry's packages; empty `docker/data/uploads` and `docker/data/media-cache` |
| `pnpm dev:publish` | Build every package and publish it to the local registry |

### The local registry

The other Manablox repositories (the premium plugins, the license portal, the
documentation sites) depend on these packages by name. In development they install them
from the Verdaccio in this stack rather than from npmjs:

```sh
pnpm dev:services        # or pnpm dev:up
pnpm dev:publish         # every package at 0.50.0, tag latest; run it again after a change
pnpm dev:publish --dev   # or as 0.50.0-dev.<timestamp> under the dev tag
npm view @manablox/core --registry http://localhost:4873
```

`dev:publish` builds and packs with `scripts/publish.sh --pack-only` (in the api container
when the stack is up, on the host otherwise), then publishes with npm. A version that is
already on the registry is unpublished and replaced. It only ever publishes to a local
registry; the URL is checked first, and npmjs releases go through
`.github/workflows/release.yml`. Anyone who can reach port 4873 may publish `@manablox/*`
there, so the port is published on `127.0.0.1` only; `@manablox/*` is never fetched from
npmjs, and every other package is proxied.

A consuming repository commits the npmjs setting and keeps the local one out of git. On
the host, its development `.npmrc` (gitignored, or `~/.npmrc`) is one line:

```ini
@manablox:registry=http://localhost:4873/
```

Inside a container of that repository's own dev stack, `localhost` is the container. The
registry also sits on the docker network `manablox-registry`, as `verdaccio`, which this
stack creates; the consumer's containers join it and use that name. The repository is
usually bind-mounted into the container, host `.npmrc` included, and in pnpm 11 that file
wins over a registry set in the environment or a config file. So the container passes the
registry on the command line, which wins over every `.npmrc`:

```yaml
# its docker/compose.dev.yml, on every service that runs pnpm install
services:
  install:
    image: node:24
    working_dir: /app
    volumes:
      - ..:/app
    command: >-
      sh -c "corepack enable &&
      pnpm install --config.@manablox:registry=http://verdaccio:4873/"
    networks: [default, manablox-registry]

networks:
  manablox-registry:
    external: true
```

The same flag goes on every other pnpm command in the container that resolves packages
(`pnpm add`, `pnpm update`, `pnpm dlx`).

The network exists while this stack is up (`pnpm dev:services` is enough), so bring it up
before the consumer's.

pnpm's `minimumReleaseAge` holds back packages published minutes ago, which every local
package is. A consumer's `pnpm-workspace.yaml` therefore excludes the scope (pnpm adds the
entries itself on a `pnpm add` otherwise):

```yaml
minimumReleaseAgeExclude:
  - '@manablox/*'
```

After `pnpm dev:publish` replaces `0.50.0`, the tarball has a new checksum under the same
version, and pnpm keeps what its metadata cache and lockfile already hold. A consumer picks
up the new build with

```sh
pnpm cache delete '@manablox/*' && pnpm update '@manablox/*'
```

With `--dev` every publish is a new version under the `dev` tag, so nothing is cached:
`pnpm add @manablox/core@dev` takes the newest. CI and releases of those
repositories install `0.50.0` from npmjs.

### Docker images

`pnpm docker:build` builds the production images from `docker/Dockerfile.api` (the
management API, the public API with `node apps/public-api/dist/main.js`, and the migrations
with `node apps/api/dist/migrate.js`) and `docker/Dockerfile.admin` (the admin behind nginx).

```sh
pnpm docker:build                        # ghcr.io/manablox/cms-api:0.50.0 and ghcr.io/manablox/cms-admin:0.50.0
pnpm docker:build --tag test admin       # one image, another tag
pnpm docker:build --prefix my.registry/me --push
```

`docker/compose.yml` runs them in production. CI builds both on every change to them and
pushes `main` and tags to ghcr.io; `release.yml` pushes the version tags.

### Other commands

| Command | What it does |
| --- | --- |
| `pnpm test` | Every test (the db and services suites need Postgres) |
| `pnpm test:sqlite` | The same tests with SQLite files instead of Postgres |
| `pnpm typecheck` | Every package and app |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm knip` | Unused files, exports and dependencies |
| `pnpm build` | Every package and the admin |
| `pnpm db:generate` | Generate a migration from the schema, for Postgres and SQLite |
| `pnpm db:migrate` | Apply migrations |
| `pnpm docs:generate` | The reference pages generated from the code (`manablox docs generate`), into `apps/api/generated` |
| `pnpm licenses` | Rewrite the per-package `LICENSE` files from the root licence sources |
| `pnpm publish:npm` | Dry run of the npm release; releases run from `.github/workflows/release.yml` |

## Stack

| Layer | Choice |
| --- | --- |
| Server | Hono 4 on Node 24 |
| Database | Postgres 18 or SQLite, with Drizzle |
| Management API | oRPC |
| Delivery API | Pothos + GraphQL Yoga, and REST |
| Auth | better-auth + Argon2id |
| Admin | Vite 8 + Vue 3.5 + Reka UI + Tailwind 4 |
| Media | sharp |

## Licence

Manablox is open source under the [MIT licence](./LICENSE): the CMS, the admin, the CLI,
the SDKs, the workflows, webhooks and license plugins, and the projects the CLI scaffolds.
The premium plugins (AI and the website) live in their own repositories under a commercial
license.

[`TRADEMARKS.md`](./TRADEMARKS.md) covers the name and logo, which the MIT licence does not.
Contributions are accepted under the [CLA](./CLA.md). Release notes are in
[CHANGELOG.md](./CHANGELOG.md). Security problems are reported privately, as
[`SECURITY.md`](./SECURITY.md) describes.
