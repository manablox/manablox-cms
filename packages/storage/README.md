# `@manablox/storage`

Decides where uploaded files are saved.

There are two built-in storages:

- **local**: a folder on the server's disk. Simple, good for one server.
- **s3**: any S3-compatible bucket, like AWS S3, MinIO, Cloudflare R2 or DigitalOcean Spaces. Good when you run several servers or want backups by your provider.

Both have the same interface (`StorageDriver` with `put`, `get`, `stream`, `exists`,
`delete` and `url`), so the rest of the CMS does not care which one you use. A plugin can add another storage.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Usage

```ts
// manablox.config.ts
import { defineConfig, storageConfigFromEnv } from '@manablox/core';

export default defineConfig({
  // ...
  storage: storageConfigFromEnv(), // STORAGE_DRIVER=local or s3, plus its settings
});
```

## Main exports

- `createStorageDriver(config)`: gives you the storage your config asks for.
- `LocalStorageDriver`, `S3StorageDriver`: the two built-in storages.
- `registerStorageDriver(name, factory)`: adds your own storage under a new name.
- `buildStorageKey(spaceId, filename)`: the path a new file is saved under.
