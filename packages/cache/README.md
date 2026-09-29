# `@manablox/cache`

Makes the public APIs faster by remembering answers.

Every answer is saved together with a list of the documents, content types and spaces
that went into it. When an editor publishes a document, only the answers that used that
document are removed. Everything else stays cached.

Where the cache lives:

- **Valkey or Redis**, when you set a `REDIS_URL`. Shared by all servers.
- **Memory**, when you run a single server without Redis.
- **Off**, when caching is disabled in the config.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `createCache(config)`: creates the cache that fits your config.
- `attachCache(manablox, cache)`: listens for content changes and removes the answers that used the changed content.
- `attachRegistrySync(manablox, source)`: keeps the content types of every process on one database in step. With Redis the process that saved a type tells the others at once; without it each process checks the database every `cache.syncInterval` seconds (5 by default, `0` turns it off).
- `TaggedCache`: the interface all caches share: `get`, `set` (with tags), `purge(tags)`, `clear()` and `close()`.
