# Contributing

A security problem is not an issue or a pull request: report it privately, as
[`SECURITY.md`](./SECURITY.md) describes.

## Licensing

Everything in this repository is [MIT licensed](./LICENSE). Contributions are accepted
under the [Contributor Licence Agreement](./CLA.md): a contribution is licensed under MIT,
and the maintainer may relicense it. You keep the copyright in what you wrote.

Accepting it is one flag: sign off every commit with `git commit -s`, which appends

```
Signed-off-by: Your Name <your.email@example.com>
```

A pull request whose commits are signed off is your acceptance for those commits. If your
employer holds the rights to your work, say so in the pull request before the first merge.

Per-package `LICENSE` files and `license` fields are generated from `LICENSES/MIT.txt`.
After editing it, run `pnpm licenses` and commit the result; `pnpm check` runs
`pnpm licenses:check` and fails if they drift.

Third-party code needs its licence named in the pull request. Anything not MIT, ISC, BSD
or Apache-2.0 needs a conversation first.

## Setup

Everything runs in Docker, so the only prerequisite is Docker:

```sh
pnpm dev:up        # the whole stack: api 3000, public api 3001, admin 3002 (README.md has every port)
pnpm dev:logs api  # follow one service
pnpm dev:down      # stop it; pnpm dev:reset also deletes the volumes
```

To run the apps on the host instead - the faster loop for backend work - start only the
backing services and use the workspace directly:

```sh
pnpm install
pnpm dev:services  # postgres, valkey, minio, mailpit, verdaccio
pnpm db:migrate
pnpm dev           # every app, through turbo
```

To try a change in another Manablox repository, publish the packages to the stack's local
registry with `pnpm dev:publish` (or `pnpm dev:publish --dev` for a new prerelease version
each time) and install them there; README.md, "The local registry", has the `.npmrc` lines.
`pnpm docker:build` builds the production images.

Node 24 (`.node-version`) and pnpm (pinned by `packageManager`). VS Code users get the
recommended extensions prompt; Biome formats on save.

The premium plugins (AI and the website) live in their own repositories and install from
npm by name. To work on licensing here, run the API with a test license:
`pnpm --filter @manablox/api dev:licensed`. It swaps the license plugin for
`testLicensePlugin()` from `@manablox/plugin-license/testing`, which grants itself leases
signed with a key pair generated at startup that only that process trusts, and calls no
license server. The admin e2e starts the API this way.

If the dev containers or their network disappear (a Docker Desktop reset, a prune, a
deleted network), run `pnpm dev:up` again. It removes containers still attached to a
network that no longer exists and recreates what is missing; volumes, and with them the
database, are kept. `pnpm dev:reset` is the last resort: it deletes the volumes too.

## The map

| Path | What lives there |
| --- | --- |
| `packages/core` | The instance, registries, hooks, config, errors. No I/O. |
| `packages/db` | Schema, migrations, repositories, query builder, test databases. |
| `packages/services` | Domain rules: content, content types, spaces, loaders, public queries. |
| `packages/api-rpc` - `api-graphql` - `api-public` | Transports. Input schemas, permissions, one call each. |
| `packages/fields` - `media` - `storage` - `cache` - `jobs` - `auth` | One concern per package. |
| `packages/server` | The composition root: `bootstrap`, `createApp`, one file per surface. Published, so a project can depend on it. |
| `packages/cli` | The `manablox` command: `start`, `migrate`, `push-keys`, and the scaffolders behind `create` and `frontend`. |
| `apps/api` | The repository's management instance: its config and entrypoint, booting `@manablox/server`. |
| `apps/admin` | The admin SPA. `features/<name>/` per feature, `components/ui/` for presentational controls, `components/` for the shell and the field set. `pnpm admin:layout` checks the boundaries. |
| `apps/public-api` | The same code as `apps/api` with the hardened configuration. |
| `packages/plugin-workflows` - `plugin-webhooks` - `plugin-license` | The first-party plugins that live here. `pnpm plugins:boundary` keeps the core from importing them. |
| `packages/admin-plugin` - `admin-sdk` | What admin plugins build on. |
| `packages/docs-theme` | The Starlight theme the documentation sites install. |
| `loadtest/` | The k6 suite for the public API and frontends. |

Read the [architecture reference](https://dev.manablox.io/reference/architecture/) before a
change that crosses a package boundary.

A package's `README.md` is its npm page, written for a newcomer: what the package does,
how to install and use it, and its main functions and options in plain words. The CLI's
README lists every option of every command, so update it with `usage()`. Maintainer notes go into `DEVELOPMENT.md` beside it
(`packages/cli` and `apps/admin` have one), which is not published.

## Where a change goes

**Move logic down, not sideways.** A rule that needs the database goes in `services`; one
that does not goes in `core`. A transport validates input, checks a permission and calls
one method - if a handler grows an `if`, the `if` belongs in a service. The admin follows
the same shape: a page lays out feature components; a feature owns its queries, mutations
and messages; `lib/` holds what every feature shares.

Recipes:

- **A field type**: one `defineFieldType()` file in `packages/fields/src/`, a line in
  `builtinFieldTypes`, an input component keyed by `admin.input` in
  `apps/admin/src/lib/field-components.ts`. See
  [Custom field types](https://dev.manablox.io/extending/custom-field-types/).
- **A management procedure**: a schema from `packages/api-rpc/src/schemas.ts`, a
  permission via `scoped()`, a service method. Add a contract test in
  `packages/api-rpc/test/`. The HTTP reference is generated from the router
  (`pnpm docs:generate`).
- **A migration**: edit the table definition in `packages/db/src/definitions/` (one
  description builds both the Postgres and the SQLite table), then `pnpm db:generate`,
  which writes `migrations/` and `migrations-sqlite/`; review both.
  `pnpm db:generate` must produce nothing after a refactor that only moves code.
- **A query**: a repository method in `packages/db/src/repositories/`, reading tables from
  `this.t`. SQL that only one database understands goes behind a method of the `Dialect`
  in `packages/db/src/dialect.ts`, implemented for both. `pnpm test:sqlite` runs every
  suite on SQLite.
- **A hook**: add it to `ManabloxHooks` in `packages/core/src/hook-map.ts` and run it from
  the service that owns the moment, then run `pnpm --filter @manablox/core hooks` (the build
  does it too; a test fails while it is stale). It writes `src/hook-docs.ts`, the
  `@manablox/core/hook-docs` entry the hooks reference is generated from (`pnpm docs:generate`).
- **An error**: add the key to `packages/core/src/error-keys.ts` (the compiler insists),
  raise it with a `ManabloxError` factory, and give the admin a sentence for it in
  `apps/admin/src/lib/messages.ts`.
- **An environment variable**: read it with the `env*` helpers from `@manablox/core` in the
  app's `config.ts`, and document it in the app's `.env.example` and in the developer
  documentation's environment page.

The developer documentation (dev.manablox.io) and the user guide (docs.manablox.io) live in
their own repositories. A change that needs a documentation page goes there too.

## Checks

```sh
pnpm check          # lint, dead code, licences, plugin boundary, docs wording, typecheck, admin style and layout, SDK surface, tests on both databases - what CI runs first
pnpm knip           # unused files, exports and dependencies; configured in knip.jsonc
pnpm typecheck      # tsc four packages at a time, then the vue-tsc projects (`typecheck:vue`) two at a time
pnpm docs:generate  # manablox docs generate for this repository's plugins, into apps/api/generated (--out <dir>)
pnpm bench          # delivery throughput against a running instance, for before/after
pnpm perf seed      # once: a template database with 20k documents and 1,000 spaces
pnpm perf run x     # boots the processes from source; throughput, Redis and SQL per request,
                    # boot time, session/tree/export/promote timings (scripts/perf.sh)
pnpm admin:budget   # the built admin against apps/admin/bundle-budget.json (gzip)
pnpm licenses       # rewrite the per-package LICENSE files after editing LICENSES/MIT.txt
```

To try a change against a full instance rather than an empty one, fill the dev stack with
`pnpm --filter @manablox/api seed:testing`; the knobs are in
[Testing](https://dev.manablox.io/reference/testing/).

The pre-commit hook runs Biome on staged files. The tiers of tests and how to write one
are in [Testing](https://dev.manablox.io/reference/testing/); the end-to-end smoke test
runs on `main`.

## Conventions

- Comments explain *why*, next to the code. When code moves, its comment moves with it; a
  comment that describes a fixed bug becomes a test name.
- No `as unknown as`. If a cast repeats, the type is wrong - fix the type.
- Every error is a `ManabloxError` with a catalogued key. Never throw a bare string.
- Behaviour changes and refactors go in separate commits. A refactor's tests do not change.
- Commit messages: `type(scope): what` - `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`,
  `test`. The body says why.
- A decision that a newcomer would otherwise reverse is written down where the reader
  will meet it: the [architecture reference](https://dev.manablox.io/reference/architecture/)
  for one that shapes the packages, the `DEVELOPMENT.md` beside the code for one that shapes a
  single package, and a comment for one that shapes a single file.

## The Manablox repositories

The CMS is one of several repositories. They share one set of conventions:

- Every package and app has the same version; a release bumps them together.
- Dependencies between the repositories go through npm package names (`@manablox/*`) only:
  npmjs in CI and production, a local registry in development. No repository reaches into
  another's folders.
- pnpm workspace, Node 24, Biome, TypeScript through `@manablox/config-typescript`, Vitest
  through `@manablox/config-vitest`.
- Each repository has a `README.md`, `LICENSE`, `CHANGELOG.md`, `.editorconfig`,
  `.gitignore` and `.env.example` files; the public ones also `CONTRIBUTING.md` and
  `CLA.md`.
- A development docker setup in `docker/compose.dev.yml`, driven by `scripts/dev.sh` as
  `pnpm dev:up`, `dev:down`, `dev:logs`, `dev:reset` (which deletes the volumes) and
  `dev:services`, on ports of its own so every repository's stack runs side by side:

  | Repository | Ports |
  | --- | --- |
  | manablox-cms | api 3000, public api 3001, admin 3002, postgres 5432, valkey 6379, minio 9000/9001, mailpit 1025/8025, verdaccio 4873 |
  | manablox-plugin-website | site 3003, instance api 3100, admin 3102, postgres 5442 |
  | manablox-plugin-ai | instance api 3200, admin 3202, postgres 5452 |
  | manablox-license-portal | license server 3110, portal 5174, postgres 5462, mailpit 8026 |
  | manablox-website | 3005 |
  | manablox-dev-docs | 3004 |
  | manablox-user-docs | 3008 |

- `@manablox/*` comes from the CMS stack's Verdaccio in development (`pnpm dev:publish`
  there; README.md, "The local registry") and from npmjs in CI and production.
- `scripts/docker-build.sh [--tag <tag>] [--push] [image...]` builds the production images
  from `docker/Dockerfile.*`, as `pnpm docker:build`.
- `.github/workflows/ci.yml` runs lint, typecheck, tests, the build and the image builds;
  a repository that publishes has a manually dispatched `release.yml` (npm with provenance
  through trusted publishing, images to `ghcr.io/manablox`).
- No compatibility shims, deprecated APIs or dead files: each repository passes lint, knip,
  typecheck and its tests from a fresh clone.
