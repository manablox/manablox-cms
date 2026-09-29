# `@manablox/core`

The base of Manablox. It describes your CMS: the config file, content types, field types,
plugins, hooks and errors. Every other Manablox package builds on it.

Core never talks to a database or the network. It only needs two libraries: pino for
logging and zod for checking data.

## Install

```sh
npm install @manablox/core
```

## Usage

```ts
// manablox.config.ts
import { defineConfig, defineContentType, envNumber, requireEnv } from '@manablox/core';
import { manabloxFields } from '@manablox/fields';

const post = defineContentType({
  name: 'post',
  label: 'Blog post',
  fields: [
    { name: 'summary', type: 'string' },
    { name: 'body', type: 'richtext' },
  ],
});

export default defineConfig({
  database: { url: requireEnv('DATABASE_URL') },
  auth: { secret: requireEnv('AUTH_SECRET') },
  server: { port: envNumber('PORT', 3000), admin: true },
  plugins: [manabloxFields()],
  contentTypes: [post],
});
```

## Main functions

### Config

- `defineConfig(config)`: describes your CMS in `manablox.config.ts`: database, server, auth, storage, mail, cache, content types and plugins.
- `requireEnv(name)`: reads an environment variable and stops with a clear error if it is missing.
- `envString`, `envNumber`, `envBoolean`, `envList`, `envOptional`: read an environment variable with a default value.
- `storageConfigFromEnv()`, `mailConfigFromEnv()`: build the storage or mail settings from the usual environment variables.

### Content model and plugins

- `defineContentType(type)`: describes a kind of content, like "page" or "post": its name, label and fields.
- `defineFieldType(type)`: adds a new kind of field, with its settings, validation and storage.
- `definePlugin(plugin)`: bundles content types, field types, hooks and contributions to other plugins (such as workflow actions) into one reusable plugin. A plugin can also bring its own database tables, permissions, feature flags and limits, management procedures, jobs, server modes, block data, command line options and admin screens.
- `defineCliContribution(contribution)`: describes a plugin's part of the `manablox` command: options for `space create` and `create`, its own commands and files for a new project.

### Runtime

- `Manablox` (from `@manablox/core/node`): the running CMS instance. It holds the config, the registered types and the hooks. `manablox.hooks.on(name, handler)` runs your code at moments like `content:beforeCreate`.
- `ManabloxError`: the error type Manablox throws. Each error has a key that says what went wrong, like `content.notFound`.

## Entry points

- `@manablox/core`: types, config and content type definitions, error keys, permissions and the AI provider list. It has no Node-only code, so it also works in the browser.
- `@manablox/core/node`: server-only code, such as `Manablox`, `createManablox`, the logger (`createLogger`, `createLogging`, `registerLogAdapter`), `runAsActor`, `uuid`, `stableId`, secret encryption. These are not exported from the main entry point. `defineWorkflowAction` is in `@manablox/plugin-workflows/define`.
- `@manablox/core/hook-docs`: `HOOK_DOCS`, every hook of `ManabloxHooks` by section with its payload and context types as text, generated from the hook map at build time. `manablox docs generate` writes the hooks reference from it.
- `@manablox/core/testing`: `fixedId(n)` and `ids`, stable UUIDs for tests.
