# `@manablox/db`

Everything that talks to the database: the table definitions, the migrations that create
and update the tables, and all the queries the CMS runs. It works with Postgres and with
SQLite (a local file, or a hosted libSQL database such as Turso).

It uses Drizzle ORM. The other packages never write SQL themselves; they call the
functions of this package.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Choosing a database

The scheme of the database URL picks the database:

- `postgres://user:pass@host:5432/manablox`: Postgres. Best for production and for more than one server process.
- `file:./data/manablox.db`: a SQLite file next to your project. Nothing to install or run; the folder is created on first start. `sqlite:./data/manablox.db` means the same.
- `libsql://your-db.turso.io`: a hosted SQLite database; pass the token as `authToken`.

Both databases behave the same for the CMS. SQLite runs one writer at a time, so run a
single management instance on it.

## Main exports

- `createDatabase(config)`: connects to the database in `{ url, max, ssl, authToken }` and returns a handle. It is async, because the SQLite driver is only loaded when a SQLite URL is used.
- `runMigrations(handle, plugins?)`: creates or updates the tables to the latest version, then the tables of the given plugins, each with its own migration record. The `manablox migrate` command calls it.
- `migrationStatus(handle, plugins?)`: which migrations are shipped and which are applied, for the CMS and per plugin.
- `Repository`, `buildTables`, `databaseContextOf`: what a plugin needs to write its own queries over its own tables, also inside a CMS transaction.
- `createRepositories(handle, registry)`: all ready-made queries, grouped by topic: content, content types, assets, spaces, users, API keys, menus, credentials and more. Plugins bring their own (the workflows, webhooks, AI and website plugins).
- `backupSqlite(handle, file)`: writes a consistent copy of a SQLite database while it is in use. The `manablox backup` command calls it.
- `buildContentWhere`, `buildOrderBy`: turn a content filter (field, operator, value) into a safe SQL condition and sort order.
- `rethrowUniqueViolation(error, mapping)`: turns a "this value already exists" database error into a clear validation error, on either database.

```ts
import { createDatabase, createRepositories, runMigrations } from '@manablox/db';

const handle = await createDatabase({ url: 'file:./data/manablox.db' });
await runMigrations(handle);
const repos = createRepositories(handle, registry);
console.log(handle.kind); // 'sqlite'
await handle.close();
```

## Other entry points

- `@manablox/db/schema`: the table definitions, one per entity.
- `@manablox/db/definitions`: the building blocks to describe a table once for both databases, the CMS tables to point at, and `postgresTable` / `sqliteTable` to turn a description into a table. Plugins with their own tables use it.
- `@manablox/db/testing`, for tests of plugins and of the Manablox packages: `createTestDatabase()` gives each test its own fresh, migrated database. Set `TEST_DATABASE_DIALECT=sqlite` to use SQLite files instead of a Postgres server; `TEST_DATABASE_URL` (else `DATABASE_URL`) names the Postgres server whose databases it creates and drops.

The package ships the SQL migration files in `migrations/` (Postgres) and
`migrations-sqlite/` (SQLite).
