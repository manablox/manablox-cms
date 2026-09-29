# __NAME__

A Manablox CMS instance run from the published npm packages. {{#if sqlite}}Docker runs Valkey; the CMS
itself runs on this machine with Node 24 and keeps its database in a SQLite file.{{#else}}Docker runs Postgres and
Valkey; the CMS itself runs on this machine with Node 24.{{/if}}

```
package.json                the four packages a CMS needs, plus the manablox CLI
pnpm-workspace.yaml         install-script allowlist (sharp, argon2, esbuild)
content-model.ts            plugins and code-defined content types, shared by every config
manablox.config.ts          the management instance: API + admin at /
{{#if publicApi}}
manablox.public.config.ts   the hardened public delivery instance
{{/if}}
compose.yml                 {{#if sqlite}}valkey{{#else}}postgres and valkey{{/if}}
{{#if !sqlite}}
postgres/init/              creates the database roles on the first start
{{/if}}
.env                        connection strings and secrets; never commit it
.env.example                every variable, commented
data/                       {{#if sqlite}}the SQLite database, uploads and media cache{{#else}}uploads and media cache{{/if}}, created on first use
```
{{#if !sqlite}}

Postgres gets two roles on its first start (`postgres/init/10-roles.sh`): `manablox_owner`
owns the schema and runs the migrations (`MIGRATION_DATABASE_URL`), `manablox_app` is what
the CMS logs in as (`DATABASE_URL`). The app role reads and writes rows but cannot change
tables or delete audit entries; every `pnpm migrate` grants it its rights.
{{/if}}
{{#if sqlite}}

The database is the file `data/manablox.db`{{#if publicApi}}, shared by both instances{{/if}}. SQLite has one
writer, so run a single management instance, never several against one file.
{{/if}}

## First start

```sh
pnpm install            # skip if manablox create already did it
pnpm services:up        # {{#if !sqlite}}postgres on :__POSTGRES_PORT__, {{/if}}valkey on :__VALKEY_PORT__{{#if mailpit}}, mailpit on :8025{{/if}}
pnpm migrate            # applies the schema{{#if !sqlite}} as the owner role{{/if}}
pnpm dev                # the management API and the admin at __ADMIN_URL__, restarts on change
```

Open <__ADMIN_URL__>. The first account you create becomes the instance superadmin; sign-up
closes after it. Create a space.
{{#if publicApi}}

In a second terminal, `pnpm dev:public` starts the public delivery API at <__PUBLIC_API_URL__>. Until
it can pin exactly one space it answers 503 and checks again every ten seconds; with exactly one
space it pins that one automatically. With
several, set `MANABLOX_SPACE` in `.env` to the technical name of the one to serve.
{{/if}}

{{slot readme.sections}}

## Commands

| Task | Command |
| --- | --- |
| Start the services | `pnpm services:up` |
| Stop the services (data is kept in Docker volumes) | `pnpm services:down` |
| Migrate | `pnpm migrate` |
| Run the management instance | `pnpm dev` (restart on change) or `pnpm start` |
{{#if publicApi}}
| Run the public instance | `pnpm dev:public` or `pnpm start:public` |
{{/if}}
{{#if sqlite}}
| Back up the database | `pnpm exec manablox backup backups/$(date +%F).db`, a consistent copy taken while the CMS runs |
{{/if}}
| Web Push keys | `pnpm push-keys`, then paste into `.env` |
| Typecheck the configs | `pnpm typecheck` |

__MAIL_SECTION__
## Changing the content model

`content-model.ts` is imported by every config. Add content types, plugins or field
types there; `pnpm dev` restarts on save. Content types created in the admin at runtime
live in the database and need no code.

## Going to production

{{#if sqlite}}
Run `manablox create --preset docker --database sqlite` in a new folder for a compose
stack that runs every process in containers, or deploy this folder as an ordinary Node
service: install, then `manablox migrate` and `manablox start` with the variables from
`.env.example` set.
{{#else}}
Run `manablox create --preset docker` in a new folder for a compose stack that runs every
process in containers, or deploy this folder as an ordinary Node service: install, then
`manablox migrate` and `manablox start` with the variables from `.env.example` set.
{{/if}}
