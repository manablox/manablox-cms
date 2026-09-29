/** Error detail helpers, separate from `api` so components can import them. */

export interface ApiErrorDetail {
  key: string;
  path?: (string | number)[];
  params?: Record<string, unknown>;
}

/** The error body every API surface sends: oRPC `data`, or `error` of a plain HTTP body. */
export interface ApiError {
  key: string;
  kind: string;
  status: number;
  message: string;
  details: ApiErrorDetail[];
}

/** A failed plain HTTP response, shaped like an oRPC error so `messageFor` reads it the same way. */
export class ApiResponseError extends Error {
  constructor(readonly data: ApiError) {
    super(data.message);
    this.name = 'ApiResponseError';
  }
}

/** The error of a failed `fetch` to a plain HTTP route, from its `{ error }` body. */
export async function responseError(response: Response): Promise<ApiResponseError> {
  return errorFromBody(await response.json().catch(() => null), response.status);
}

/** The error of an already parsed `{ error }` body. */
export function errorFromBody(body: unknown, status: number): ApiResponseError {
  return new ApiResponseError(
    asApiError((body as { error?: unknown } | null)?.error) ?? {
      key: 'internal.error',
      kind: 'internal',
      status,
      message: 'internal.error',
      details: [],
    },
  );
}

function asApiError(value: unknown): ApiError | null {
  const candidate = value as Partial<ApiError> | null | undefined;
  if (typeof candidate?.key !== 'string') return null;
  return {
    key: candidate.key,
    kind: typeof candidate.kind === 'string' ? candidate.kind : 'internal',
    status: typeof candidate.status === 'number' ? candidate.status : 500,
    message: typeof candidate.message === 'string' ? candidate.message : candidate.key,
    details: Array.isArray(candidate.details) ? candidate.details : [],
  };
}

/** The error body of a thrown oRPC or `responseError` error. */
function apiError(error: unknown): ApiError | null {
  return asApiError((error as { data?: unknown } | null)?.data);
}

/** A user-facing sentence for a schema issue, from the params the server keeps. */
function issueMessage(params: Record<string, unknown>): string {
  const origin = params.origin;
  const text = origin === 'string' || origin === 'array';
  const { minimum, maximum } = params;
  switch (params.code) {
    case 'too_small':
      if (text && Number(minimum) <= 1) return 'This is required.';
      if (origin === 'string') return `Use at least ${minimum} characters.`;
      if (origin === 'array') return `Choose at least ${minimum}.`;
      return `The lowest allowed value is ${minimum}.`;
    case 'too_big':
      if (origin === 'string') return `Use at most ${maximum} characters.`;
      if (origin === 'array') return `Choose at most ${maximum}.`;
      return `The highest allowed value is ${maximum}.`;
    case 'invalid_type':
      return /received (undefined|null)/.test(String(params.message ?? ''))
        ? 'This is required.'
        : 'This value has the wrong type.';
    case 'invalid_format':
      return 'This is not in the expected format.';
    case 'invalid_value':
      return 'Pick one of the offered values.';
    default:
      return 'This value is not accepted.';
  }
}

/** The details of a thrown API error; schema issues get a sentence as `params.message`. */
export function errorDetails(error: unknown): ApiErrorDetail[] {
  const details = (error as { data?: { details?: unknown } } | null)?.data?.details;
  if (!Array.isArray(details)) return [];
  return (details as ApiErrorDetail[]).map((detail) =>
    detail.key === 'validation.invalid'
      ? { ...detail, params: { ...detail.params, message: issueMessage(detail.params ?? {}) } }
      : detail,
  );
}

export function errorKey(error: unknown): string {
  return (
    apiError(error)?.key ?? (error as { message?: string } | null)?.message ?? 'internal.error'
  );
}

/** The detail at a field path. */
export function detailAt(
  details: readonly ApiErrorDetail[],
  path: (string | number)[],
): ApiErrorDetail | null {
  const wanted = JSON.stringify(path);
  return details.find((detail) => JSON.stringify(detail.path ?? []) === wanted) ?? null;
}

/** Whether the request failed because the record does not exist. */
export function isNotFound(error: unknown): boolean {
  const data = apiError(error);
  return data?.kind === 'not_found' || data?.status === 404;
}
