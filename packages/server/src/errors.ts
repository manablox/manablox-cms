import {
  isExpectedError,
  isTransportError,
  ManabloxError,
  TRANSPORT_CODE,
  type TransportError,
  type TransportErrorOptions,
  toTransportError,
} from '@manablox/core';
import { ORPCError } from '@orpc/server';
import type { Context, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set on the GraphQL endpoint, so errors answer in the GraphQL response shape. */
    graphql?: boolean;
  }
}

/** Answers `{ error }` in the transport shape at its status; `{ errors }` on the GraphQL endpoint. */
export function errorResponse(
  c: Context,
  error: unknown,
  options: TransportErrorOptions = {},
): Response {
  const transport = toTransportError(error, options);
  const status = transport.status as ContentfulStatusCode;
  const retryAfter = transport.details.find(
    (detail) => typeof detail.params?.retryAfter === 'number',
  )?.params?.retryAfter;
  if (status === 429 && typeof retryAfter === 'number') c.header('retry-after', String(retryAfter));
  if (!c.get('graphql')) return c.json({ error: transport }, status);
  const { message, ...extensions } = transport;
  const spec = c.req.header('accept')?.includes('application/graphql-response+json');
  return c.json({ errors: [{ message, extensions }] }, status, {
    'content-type': `${spec ? 'application/graphql-response+json' : 'application/json'}; charset=utf-8`,
  });
}

/** API paths, which answer JSON unless the client asks for HTML. */
const API_PATH = /^\/(v1|api|rpc|graphql|control|plugins)(\/|$)/;

/** True when a 404 should carry the JSON error body rather than plain text. */
function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept') ?? '';
  if (accept.includes('json')) return true;
  return API_PATH.test(c.req.path) && !accept.includes('text/html');
}

/** A 404: the error body for JSON clients, plain text for browsers and media loads. */
export function notFoundResponse(c: Context, error: ManabloxError): Response {
  return wantsJson(c) ? errorResponse(c, error) : c.text('404 Not Found', 404);
}

/** The app's handler for unmatched routes. */
export const notFound: NotFoundHandler = (c) =>
  notFoundResponse(c, ManabloxError.notFound('route.notFound', { path: c.req.path }));

/** REST error bodies: `{ error }` in the transport shape, whatever oRPC raised. */
export function restErrorBody(error: ORPCError<string, unknown>): { error: TransportError } {
  if (isTransportError(error.data)) return { error: error.data };
  if (error.status >= 500) return { error: toTransportError(error) };
  // Refused before a procedure ran: malformed body, unsupported method or media type.
  return {
    error: {
      key: 'request.invalid',
      kind: 'bad_request',
      status: error.status,
      message: error.message,
      details: [],
    },
  };
}

interface ErrorLogger {
  error(object: object, message: string): void;
}

/**
 * An oRPC client interceptor that answers every procedure failure in the transport shape;
 * unexpected errors are logged and become `internal.error`.
 */
export function transportErrors(logger: ErrorLogger, options: TransportErrorOptions = {}) {
  return async ({ next, path }: { next: () => Promise<unknown>; path: readonly string[] }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof ORPCError && (error.status < 500 || isTransportError(error.data))) {
        throw error;
      }
      if (!isExpectedError(error)) {
        logger.error({ err: error, procedure: path.join('.') }, 'unhandled error');
      }
      const transport = toTransportError(error, options);
      throw new ORPCError(TRANSPORT_CODE[transport.kind], {
        status: transport.status,
        message: transport.message,
        data: transport,
        cause: error,
      });
    }
  };
}
