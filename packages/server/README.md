# `@manablox/server`

The Manablox CMS server. It connects all Manablox packages into one running app.

When it starts, it reads your config, connects to the database (Postgres or SQLite, and
Valkey or Redis, if configured), registers your content types and plugins, and serves:

- the management API that the admin uses (RPC and REST with an OpenAPI description),
- the GraphQL API and the read-only REST API for your website,
- sign-in, uploads and resized images,
- the admin app itself, when `server.admin` is set, with the screens of your plugins loaded at runtime (no admin rebuild),
- the routes, procedures and jobs your plugins add,
- background jobs like webhooks, scheduled publishing and workflows.

The same server can run in `management` mode (everything) or `public` mode (only the
read-only APIs, hardened for the internet). A plugin can add a mode of its own: the
website plugin (`@manablox/plugin-website`) adds `website`, which renders designed spaces
as websites.

## Install

```sh
npm install @manablox/server
```

Most projects never call this package directly. They use the `manablox start` command
from `@manablox/cli`, which loads `manablox.config.ts` and runs the server.

## Usage in code

```ts
import { loadConfig, run } from '@manablox/server';

const { config } = await loadConfig(undefined); // finds manablox.config.ts
await run(config);                              // starts and listens
```

## Main functions

- `run(config, { mode?, label? })`: prepares everything and starts listening. The simplest way to start a server from code. `mode` overrides `server.mode`, for example `'website'`.
- `bootstrap(config)`: connects the database, registers content types and plugins, and returns the runtime. Does not listen yet.
- `createApp(runtime, { mode? })`: builds the web app (all routes) for a runtime. You can mount it in your own Hono app.
- `startServer(runtime, app, label)`: starts listening with an app you built.
- `loadConfig(file)`: finds and loads `manablox.config.ts` and the `.env` next to it.
- `rateLimit(...)`: the rate limiter middleware the public API uses.
- `pluginServer({ routes, middleware })`: types the `server` part of a plugin: HTTP routes under `/plugins/<id>/` and request middleware. See the docs page "Server routes and middleware".
- `pluginMode({ name, scopes, surface })`: types a plugin's server mode. See the docs page "Server modes".
