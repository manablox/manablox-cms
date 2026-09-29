import { assertCan, assertSuperadmin, type Permission } from '@manablox/auth';
import {
  ENVIRONMENT_HEADER,
  isExpectedError,
  isUuid,
  ManabloxError,
  type ResolvedScope,
  suspendedRefused,
  TRANSPORT_CODE,
  toTransportError,
} from '@manablox/core';
import { ORPCError, os } from '@orpc/server';
import type { RpcContext } from './context.js';

/** What a suspended instance still answers: the admin's account read and the sign-in check. */
const WHILE_SUSPENDED = new Set(['users.me', 'users.setupNeeded']);

const rpc = os.$context<RpcContext>();

/**
 * Maps `ManabloxError` to the transport in one place. A suspended instance refuses every
 * procedure but `WHILE_SUSPENDED`.
 */
export const stateMiddleware = rpc.middleware(async ({ context, next, path }) => {
  try {
    if (!WHILE_SUSPENDED.has(path.join('.'))) {
      const { state } = await context.manablox.controls.resolved(null);
      if (state.status === 'suspended') throw suspendedRefused(state.message ?? null);
    }
    return await next();
  } catch (error) {
    throw toOrpcError(error);
  }
});

/** Base procedure builder. */
export const base = rpc.use(stateMiddleware);

/** A `ManabloxError` or input validation failure as an oRPC error carrying the transport shape. */
export function toOrpcError(error: unknown): unknown {
  if (!isExpectedError(error)) return error;
  const transport = toTransportError(error);
  return new ORPCError(TRANSPORT_CODE[transport.kind], {
    status: transport.status,
    message: transport.message,
    data: transport,
    cause: error,
  });
}

/** What an account still answers while the two-factor policy asks it to enrol. */
const WHILE_ENROLLING = new Set(['users.me', 'preferences.get', 'preferences.set']);

/** Requires an authenticated principal that is not waiting for two-factor enrolment. */
export const authedMiddleware = rpc.middleware(async ({ context, next, path }) => {
  if (!context.principal) throw ManabloxError.unauthorized();
  if (context.principal.twoFactorPending && !WHILE_ENROLLING.has(path.join('.'))) {
    throw ManabloxError.forbidden('auth.twoFactor.enrolmentRequired');
  }
  return next({ context: { ...context, principal: context.principal } });
});

export const authed = base.use(authedMiddleware);

/** The raw input fields `scoped()` reads; listings nest them in `filter`. */
interface ScopedInput {
  spaceId?: string;
  environment?: string;
  filter?: { spaceId?: string; environment?: string };
}

/** The space a raw input names: `spaceId`, or `filter.spaceId` of listings. */
export function scopedSpaceId(input: unknown): string | null {
  const raw = input as ScopedInput | undefined;
  return raw?.spaceId ?? raw?.filter?.spaceId ?? null;
}

/**
 * Requires a permission in the input's `spaceId` space. Middleware, so no procedure can forget
 * it. Resolves the input's `environment` (or the `x-manablox-environment` header; production
 * when absent) into `context.env`, which is only set when the input names a space. Another
 * environment than production needs the `environments` feature; an API key limited to other
 * environments is refused.
 */
export function scopedMiddleware(permission: Permission, also: readonly Permission[] = []) {
  return rpc.middleware(async ({ context, next, path }, input: unknown) => {
    // Runs before schema parsing.
    const raw = input as ScopedInput | undefined;
    const spaceId = scopedSpaceId(input);
    assertCan(context.principal, spaceId, permission);
    for (const other of also) assertCan(context.principal, spaceId, other);
    const machineName =
      raw?.environment ?? raw?.filter?.environment ?? context.headers.get(ENVIRONMENT_HEADER);
    // The environments router names the environment it manages and resolves it itself.
    const env =
      isUuid(spaceId) && path[0] !== 'environments'
        ? await context.environments.forRequest(
            spaceId,
            typeof machineName === 'string' ? machineName : null,
            context.principal,
          )
        : null;
    if (context.scope) {
      context.scope.spaceId = isUuid(spaceId) ? spaceId : null;
      context.scope.read = permission.endsWith(':read');
    }
    if (!permission.endsWith(':read')) {
      // A malformed id is left to the schema, which refuses it.
      const space = isUuid(spaceId) ? spaceId : null;
      // Deleting a space that is still importing is allowed.
      if (space && permission !== 'space:delete') await context.spaces.assertWritable(space);
      // Exporting only reads. Production writes wait for a running promote.
      if (permission !== 'space:export') {
        await context.manablox.controls.assertWritable(env ?? space);
      }
    }
    return next({ context: { env: env as ResolvedScope } });
  });
}

export function scoped(permission: Permission) {
  return authed.use(scopedMiddleware(permission));
}

/** Requires an instance-wide superadmin. */
export const superadminMiddleware = rpc.middleware(async ({ context, next }) => {
  assertSuperadmin(context.principal);
  return next();
});

/** Refused while the instance is read-only. */
export const instanceWritableMiddleware = rpc.middleware(async ({ context, next }) => {
  await context.manablox.controls.assertWritable(null);
  return next();
});

export const superadmin = authed.use(superadminMiddleware);

/** A superadmin write; refused while the instance is read-only. */
export const superadminWrite = superadmin.use(instanceWritableMiddleware);
