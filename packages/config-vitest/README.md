# `@manablox/config-vitest`

The vitest settings the Manablox packages share, for the plugin repositories and your own
Manablox packages, so their tests run the same way.

```sh
pnpm add -D @manablox/config-vitest vitest
```

```ts
// vitest.config.ts
import { sharedConfig } from '@manablox/config-vitest';

export default sharedConfig;
```

- `sharedConfig`: `test/**/*.test.ts` in Node with `NODE_ENV=test`, generous timeouts, stubbed
  globals and environment variables reset after each test, the `vmThreads` pool and a module
  cache in the package's own `node_modules/.vitest-cache`. Under turbo each package gets a
  quarter of the cores. Extend it with `mergeConfig` from `vitest/config`.
- `pluginTestConfig(base = sharedConfig)`: a plugin's server tests, without `test/admin`, with
  a minute per test for suites that seed a real database.
- `pluginAdminTestConfig(plugins)`: a plugin's admin tests, only `test/admin/**/*.test.ts`, in
  happy-dom (add `happy-dom` to your dev dependencies). `plugins` is usually `[vue()]`. When
  your package installs `@manablox/admin-plugin`, it adds that package's `adminSfcTypes()`, so
  the Vue SFC compiler resolves imported prop types with TypeScript 5.9 even when your project
  has TypeScript 7.
- `graphqlTestConfig(import.meta.url, via?)`: `sharedConfig` with one graphql build for every
  importer, since `instanceof` fails across its CommonJS and ESM builds. Pass your config's
  `import.meta.url`; `via` names the package graphql is resolved through when you do not
  depend on graphql yourself, e.g. `'@manablox/api-graphql'`.

A plugin repository's two configs:

```ts
// vitest.config.ts
import { graphqlTestConfig, pluginTestConfig } from '@manablox/config-vitest';

export default pluginTestConfig(graphqlTestConfig(import.meta.url, '@manablox/api-graphql'));
```

```ts
// vitest.admin.config.ts
import { pluginAdminTestConfig } from '@manablox/config-vitest';
import vue from '@vitejs/plugin-vue';

export default pluginAdminTestConfig([vue()]);
```

Every path is resolved from the package running the tests, never from this package, so it
works the same from the npm registry and inside a workspace.

## License

MIT, see `LICENSE`.
