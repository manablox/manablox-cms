/**
 * The Standard Schema v1 interface, inlined so plugins can use any compliant validator.
 *
 * @see https://standardschema.dev
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<S extends StandardSchemaV1> = NonNullable<
    S['~standard']['types']
  >['input'];
  export type InferOutput<S extends StandardSchemaV1> = NonNullable<
    S['~standard']['types']
  >['output'];
}

import type { ErrorDetail } from './errors.js';

/** Validates against any Standard Schema and normalises issues into `ErrorDetail[]`. */
export async function validateStandard<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  keyPrefix: string,
): Promise<{ ok: true; value: T } | { ok: false; issues: ErrorDetail[] }> {
  const result = await schema['~standard'].validate(value);

  if (result.issues) {
    return {
      ok: false,
      issues: result.issues.map((issue) => ({
        key: `${keyPrefix}.invalid`,
        path: issuePath(issue),
        params: { message: issue.message },
      })),
    };
  }

  return { ok: true, value: result.value };
}

function issuePath(issue: StandardSchemaV1.Issue): (string | number)[] {
  return (issue.path ?? []).flatMap((segment) => {
    const key = typeof segment === 'object' && segment !== null ? segment.key : segment;
    return typeof key === 'symbol' ? [] : [key as string | number];
  });
}

/** Issue fields kept as params, so a client can word its own sentence. */
const ISSUE_PARAMS = ['code', 'origin', 'expected', 'minimum', 'maximum'] as const;

/** Schema issues as details under one key; keeps the message and the plain issue fields. */
export function issueDetails(
  issues: readonly StandardSchemaV1.Issue[],
  key: string,
): ErrorDetail[] {
  return issues.map((issue) => {
    const params: Record<string, unknown> = { message: issue.message };
    for (const name of ISSUE_PARAMS) {
      const value = (issue as unknown as Record<string, unknown>)[name];
      if (typeof value === 'string' || typeof value === 'number') params[name] = value;
      if (typeof value === 'bigint') params[name] = Number(value);
    }
    return { key, path: issuePath(issue), params };
  });
}
