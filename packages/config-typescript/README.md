# `@manablox/config-typescript`

Shared TypeScript and build settings for the Manablox packages and repositories, so every
package does not repeat them.

```sh
pnpm add -D @manablox/config-typescript
```

```json
{ "extends": "@manablox/config-typescript/library.json", "include": ["src", "test"] }
```

- `base.json`: the base TypeScript settings.
- `library.json`: for a package that ships type declarations.
- `@manablox/config-typescript/drizzle`: `pluginDrizzleConfig()`, a plugin's drizzle-kit config for Postgres or SQLite.
- `@manablox/config-typescript/tsdown`: `libraryConfig()`, the build every published package uses: minified ESM JavaScript plus `.d.ts` type declarations, without source maps.
