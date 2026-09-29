# `@manablox/api`

The management API this repository runs in development, and the model for how you boot
Manablox in a project of your own.

There are only three files worth reading:

- `config.ts` builds the configuration, mostly from environment variables
- `plugins.ts` lists the plugins (the fields, licenses, workflows and webhooks); the migrate command reads it without the rest of the config
- `main.ts` hands that config to `run()` from `@manablox/server`

Everything else is in the packages. This app also carries the scripts that only make
sense inside a checkout: `docs.config.ts` (the instance the root `pnpm docs:generate` hands
to `manablox docs generate`), the repository version of `push:keys`, `dev:licensed` (the API
with a test license) and the instances the admin e2e runs against (`serve:core-only`,
`serve:runtime-plugins`).

## Exports

- Everything `@manablox/server` exports, re-exported
- `config`, the configuration this checkout boots with

## Depends on

@manablox/server, @manablox/core, @manablox/fields, @manablox/plugin-license,
@manablox/plugin-workflows, @manablox/plugin-webhooks

## Test

The tests for the HTTP surface live next to the code that serves it, in
`packages/server/test`.
