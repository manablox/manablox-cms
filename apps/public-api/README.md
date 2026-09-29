# `@manablox/public-api`

The same code as `apps/api`, booted with a configuration hardened for the open internet.

`src/config.ts` is the entire difference. It sets:

- `server.mode: 'public'`, which removes the draft read path rather than leaving it mounted and unreachable
- the space from `MANABLOX_SPACE_ID` or `MANABLOX_SPACE` when set; without a pin, the space is picked by the API host a request is sent to
- masked error messages, so an error does not describe the internals
- a rate limit keyed by IP address
- no authentication surface at all

It runs from the same Docker image as the management API, with a different entrypoint.

## Depends on

@manablox/server, @manablox/core, @manablox/fields

## Check

```sh
pnpm --filter @manablox/public-api typecheck
```
