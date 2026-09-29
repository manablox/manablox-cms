# `@manablox/api-rpc`

The management API: everything the admin can do, like editing content, uploading files,
managing content types, users and menus.

It is built with oRPC. Each procedure has an input schema, a permission check and one
service call. The server offers the same procedures in two ways:

- as RPC under `/rpc`, which the admin uses with a fully typed client,
- as REST with an OpenAPI description, for your own scripts and tools.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `router`: all API procedures, grouped by topic: `content`, `contentTypes`, `spaces`, `assets`, `users`, `menus`, `roles`, `redirects`, `audit` and `notifications`. The procedures of plugins sit under `plugins.<plugin id>`, for example `plugins.website.design`, `plugins.ai.*`, `plugins.workflows.*` and `plugins.webhooks.*`.
- `ManabloxRouter`: the type of the router. Import it with `import type` to get a typed client without generating code.
- `base`, `authed`, `scoped(permission)`, `superadmin`: building blocks for procedures. `authed` needs a signed-in user, `scoped` also a permission in the space, `superadmin` the instance owner.
- `schemas`: reusable input checks like `uuid`, `locale`, `machineName` and `pagination()`.
- `@manablox/api-rpc/plugin`: `pluginRpcKit(plugin)` and its types, the same building blocks for the procedures of a plugin, with the plugin's own services in the context.
