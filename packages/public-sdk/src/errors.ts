/** Base class of the SDK's typed errors. */
export class ManabloxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManabloxError';
  }
}

/** One problem in an error: its key, where in the input, and message params. */
export interface ErrorDetail {
  key: string;
  path?: (string | number)[];
  params?: Record<string, unknown>;
}

/** The error body the server sends: `{ error }` over REST, `extensions` in GraphQL. */
export interface TransportError {
  /** Stable identifier to match on or translate, e.g. `content.notFound`. */
  key: string;
  /** `validation`, `not_found`, `conflict`, `forbidden`, `unauthorized`, `bad_request`, `too_large`, `rate_limited`, `unavailable` or `internal`. */
  kind: string;
  status: number;
  message: string;
  details: ErrorDetail[];
}

export class ManabloxHttpError extends ManabloxError {
  /** The parsed `{ error }` body, when the server sent one. */
  readonly error: TransportError | undefined;

  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
    readonly body?: string,
  ) {
    const error = parseErrorBody(body);
    super(
      `Manablox request failed: ${status} ${statusText} (${url})${error ? `: ${error.key}` : ''}`,
    );
    this.name = 'ManabloxHttpError';
    this.error = error;
  }

  /** The error key, e.g. `content.notFound`. */
  get key(): string | undefined {
    return this.error?.key;
  }

  get details(): ErrorDetail[] {
    return this.error?.details ?? [];
  }

  /** True for 404 and 410. */
  get isNotFound(): boolean {
    return this.status === 404 || this.status === 410;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** The `error` of a JSON error body, or undefined for anything else. */
export function parseErrorBody(body: string | undefined): TransportError | undefined {
  if (!body) return undefined;
  try {
    const error = (JSON.parse(body) as { error?: Partial<TransportError> } | null)?.error;
    if (!error || typeof error.key !== 'string') return undefined;
    return {
      key: error.key,
      kind: typeof error.kind === 'string' ? error.kind : 'internal',
      status: typeof error.status === 'number' ? error.status : 0,
      message: typeof error.message === 'string' ? error.message : error.key,
      details: Array.isArray(error.details) ? error.details : [],
    };
  } catch {
    return undefined;
  }
}

/** The `errors` of a GraphQL response body, or undefined for anything else. */
export function parseGraphQLErrors(body: string | undefined): GraphQLErrorShape[] | undefined {
  if (!body) return undefined;
  try {
    const errors = (JSON.parse(body) as { errors?: unknown } | null)?.errors;
    if (!Array.isArray(errors) || errors.length === 0) return undefined;
    return errors.every((error) => typeof error?.message === 'string') ? errors : undefined;
  } catch {
    return undefined;
  }
}

export interface GraphQLErrorShape {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

export class ManabloxGraphQLError extends ManabloxError {
  constructor(
    readonly errors: GraphQLErrorShape[],
    /** The HTTP status: 200 for field errors, 4xx or 5xx when the whole request was refused. */
    readonly status = 200,
  ) {
    super(errors.map((error) => error.message).join('; '));
    this.name = 'ManabloxGraphQLError';
  }

  /** The server's error code, e.g. `QUERY_TOO_DEEP`. */
  get code(): string | undefined {
    const code = this.errors[0]?.extensions?.code;
    return typeof code === 'string' ? code : undefined;
  }

  /**
   * The first error's key, e.g. `contentType.notFound` or `graphql.query.tooDeep`;
   * unset for masked unexpected errors.
   */
  get key(): string | undefined {
    const key = this.errors[0]?.extensions?.key;
    return typeof key === 'string' ? key : undefined;
  }
}

export class ManabloxTimeoutError extends ManabloxError {
  constructor(
    readonly url: string,
    readonly timeout: number,
  ) {
    super(`Manablox request timed out after ${timeout}ms (${url})`);
    this.name = 'ManabloxTimeoutError';
  }
}

/** The caller's `AbortSignal` fired (not a timeout). */
export class ManabloxAbortError extends ManabloxError {
  constructor(readonly url: string) {
    super(`Manablox request aborted (${url})`);
    this.name = 'ManabloxAbortError';
  }
}
