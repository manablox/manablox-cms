/** Typed errors with an i18n key, params and a field path; keys live in `./error-keys.ts`. */

import { type ErrorKey, pluginErrorSpec } from './error-keys.js';
import { issueDetails, type StandardSchemaV1 } from './standard-schema.js';

export type ErrorKind =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'unauthorized'
  | 'bad_request'
  | 'too_large'
  | 'rate_limited'
  | 'locked'
  | 'unavailable'
  | 'internal';

const HTTP_STATUS: Record<ErrorKind, number> = {
  validation: 422,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unauthorized: 401,
  bad_request: 400,
  too_large: 413,
  rate_limited: 429,
  locked: 423,
  unavailable: 503,
  internal: 500,
};

export type TransportCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'PAYLOAD_TOO_LARGE'
  | 'TOO_MANY_REQUESTS'
  | 'LOCKED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_SERVER_ERROR';

/** The oRPC code per kind; the status travels separately, so validation stays 422. */
export const TRANSPORT_CODE: Record<ErrorKind, TransportCode> = {
  validation: 'BAD_REQUEST',
  bad_request: 'BAD_REQUEST',
  too_large: 'PAYLOAD_TOO_LARGE',
  not_found: 'NOT_FOUND',
  conflict: 'CONFLICT',
  forbidden: 'FORBIDDEN',
  unauthorized: 'UNAUTHORIZED',
  rate_limited: 'TOO_MANY_REQUESTS',
  locked: 'LOCKED',
  unavailable: 'SERVICE_UNAVAILABLE',
  internal: 'INTERNAL_SERVER_ERROR',
};

export interface ErrorDetail {
  /** i18n key, e.g. `content.slug.unique` */
  key: string;
  /** Path to the offending value, e.g. `['fields', 2, 'value']` */
  path?: (string | number)[];
  /** Interpolation params for the i18n message. */
  params?: Record<string, unknown>;
}

export interface ManabloxErrorOptions {
  kind?: ErrorKind;
  details?: ErrorDetail[];
  cause?: unknown;
}

export class ManabloxError extends Error {
  readonly kind: ErrorKind;
  readonly key: string;
  readonly details: ErrorDetail[];
  readonly status: number;

  constructor(key: ErrorKey, options: ManabloxErrorOptions = {}) {
    super(key, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ManabloxError';
    this.key = key;
    this.kind = options.kind ?? 'internal';
    this.details = options.details ?? [];
    this.status = HTTP_STATUS[this.kind];
  }

  toJSON(): TransportError {
    return toTransportError(this);
  }

  static validation(details: ErrorDetail[], key: ErrorKey = 'validation.failed'): ManabloxError {
    return new ManabloxError(key, { kind: 'validation', details });
  }

  static notFound(key: ErrorKey, params?: Record<string, unknown>): ManabloxError {
    return new ManabloxError(key, {
      kind: 'not_found',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static conflict(key: ErrorKey, params?: Record<string, unknown>): ManabloxError {
    return new ManabloxError(key, {
      kind: 'conflict',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static forbidden(
    key: ErrorKey = 'auth.forbidden',
    params?: Record<string, unknown>,
  ): ManabloxError {
    return new ManabloxError(key, {
      kind: 'forbidden',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static unauthorized(key: ErrorKey = 'auth.unauthorized'): ManabloxError {
    return new ManabloxError(key, { kind: 'unauthorized', details: [{ key }] });
  }

  static badRequest(key: ErrorKey, params?: Record<string, unknown>): ManabloxError {
    return new ManabloxError(key, {
      kind: 'bad_request',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static tooLarge(key: ErrorKey, params?: Record<string, unknown>): ManabloxError {
    return new ManabloxError(key, {
      kind: 'too_large',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static rateLimited(
    key: ErrorKey = 'rateLimit.exceeded',
    params?: Record<string, unknown>,
  ): ManabloxError {
    return new ManabloxError(key, {
      kind: 'rate_limited',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static locked(key: ErrorKey, params?: Record<string, unknown>): ManabloxError {
    return new ManabloxError(key, {
      kind: 'locked',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static unavailable(key: ErrorKey, params?: Record<string, unknown>): ManabloxError {
    return new ManabloxError(key, {
      kind: 'unavailable',
      details: [{ key, ...(params ? { params } : {}) }],
    });
  }

  static is(error: unknown): error is ManabloxError {
    return error instanceof ManabloxError;
  }
}

/**
 * A failure of a step a plugin runs, such as a workflow node: an English `message` for its
 * log, plus a key the admin translates.
 */
export class RunError extends Error {
  readonly key: ErrorKey;
  readonly params: Record<string, unknown>;
  /** Facts for the node's log line, such as the HTTP status. */
  readonly detail: Record<string, unknown> | undefined;

  constructor(
    key: ErrorKey,
    params: Record<string, unknown>,
    message: string,
    options: { cause?: unknown; detail?: Record<string, unknown> } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RunError';
    this.key = key;
    this.params = params;
    this.detail = options.detail;
  }
}

/** A failure as a run log keeps it; `key` is absent for untranslated errors. */
export interface RunFailure {
  message: string;
  key?: string | undefined;
  params?: Record<string, unknown> | undefined;
}

export const runFailure = (
  key: ErrorKey,
  params: Record<string, unknown>,
  message: string,
): RunFailure => ({ message, key, params });

/** A thrown value as a run failure; a `ManabloxError` is keyed by its own key. */
export function runFailureOf(error: unknown): RunFailure {
  if (error instanceof RunError) {
    return { message: error.message, key: error.key, params: error.params };
  }
  if (ManabloxError.is(error)) {
    const params = error.details.find((detail) => detail.key === error.key)?.params;
    return { message: error.message, key: error.key, ...(params ? { params } : {}) };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/** The one error body every surface sends: `{ error }` over HTTP, oRPC `data`, GraphQL `extensions`. */
export interface TransportError {
  key: string;
  kind: ErrorKind;
  status: number;
  /** The key; a plugin key's sentence; a fixed English sentence for unexpected errors. */
  message: string;
  details: ErrorDetail[];
}

export interface TransportErrorOptions {
  /** Drops the details of `internal` errors, for anonymous surfaces. */
  mask?: boolean;
}

/** Maps any thrown value to the transport shape; unexpected errors become `internal.error`. */
export function toTransportError(
  error: unknown,
  options: TransportErrorOptions = {},
): TransportError {
  const issues = schemaIssues(error);
  if (issues)
    return toTransportError(ManabloxError.validation(issueDetails(issues, 'validation.invalid')));
  if (!ManabloxError.is(error)) {
    return {
      key: 'internal.error',
      kind: 'internal',
      status: 500,
      message: 'Internal server error.',
      details: [],
    };
  }
  const masked = options.mask === true && error.kind === 'internal';
  return {
    key: error.key,
    kind: error.kind,
    status: error.status,
    message: pluginMessage(error) ?? error.key,
    details: masked ? [] : error.details,
  };
}

/** A plugin key's sentence with the params of its detail filled in. */
function pluginMessage(error: ManabloxError): string | null {
  const template = pluginErrorSpec(error.key)?.message;
  if (!template) return null;
  const params = error.details.find((detail) => detail.key === error.key)?.params ?? {};
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined || params[name] === null ? whole : String(params[name]),
  );
}

/** True for a `ManabloxError` or a schema failure, the errors that keep their key on the wire. */
export function isExpectedError(error: unknown): boolean {
  return ManabloxError.is(error) || schemaIssues(error) !== null;
}

/** The issues of a thrown input validation failure (oRPC puts them in `data.issues`). */
function schemaIssues(error: unknown): readonly StandardSchemaV1.Issue[] | null {
  const issues = (error as { data?: { issues?: unknown } } | null)?.data?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues.every((issue) => typeof issue?.message === 'string') ? issues : null;
}

/** True for a value already in the transport shape. */
export function isTransportError(value: unknown): value is TransportError {
  const candidate = value as Partial<TransportError> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.key === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.status === 'number' &&
    Array.isArray(candidate.details)
  );
}

/** Collects validation details so every problem is reported at once. */
export class ValidationCollector {
  private readonly details: ErrorDetail[] = [];

  add(key: ErrorKey, path?: (string | number)[], params?: Record<string, unknown>): this {
    this.details.push({ key, ...(path ? { path } : {}), ...(params ? { params } : {}) });
    return this;
  }

  addIf(condition: boolean, key: ErrorKey, path?: (string | number)[]): this {
    if (condition) this.add(key, path);
    return this;
  }

  merge(other: ErrorDetail[], pathPrefix: (string | number)[] = []): this {
    for (const detail of other) {
      this.details.push({ ...detail, path: [...pathPrefix, ...(detail.path ?? [])] });
    }
    return this;
  }

  get isEmpty(): boolean {
    return this.details.length === 0;
  }

  get all(): readonly ErrorDetail[] {
    return this.details;
  }

  throwIfAny(key: ErrorKey = 'validation.failed'): void {
    if (this.details.length > 0) throw ManabloxError.validation(this.details, key);
  }
}
