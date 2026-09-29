import { isExpectedError, toTransportError } from '@manablox/core';
import { GraphQLError } from 'graphql';
import type { Plugin } from 'graphql-yoga';

export interface ErrorsPluginOptions {
  /** Drops the details of `internal` errors, as on a masked server. */
  mask?: boolean;
}

/**
 * Turns a thrown `ManabloxError` into a `GraphQLError` with `extensions: { key, kind, status,
 * details }`. Runs inside execution, so Yoga's masking only hides the other errors.
 */
export function manabloxErrorsPlugin(options: ErrorsPluginOptions = {}): Plugin {
  return {
    onExecute({ executeFn, setExecuteFn }) {
      setExecuteFn(async (args) => {
        const result = await executeFn(args);
        if (Symbol.asyncIterator in result || !result.errors?.length) return result;
        return {
          ...result,
          errors: result.errors.map((error: GraphQLError) => toGraphQLError(error, options)),
        };
      });
    },
  };
}

/** The error unchanged unless it wraps a `ManabloxError` or schema failure. */
export function toGraphQLError(
  error: GraphQLError,
  options: ErrorsPluginOptions = {},
): GraphQLError {
  if (!isExpectedError(error.originalError)) return error;
  const { message, ...extensions } = toTransportError(error.originalError, options);
  return new GraphQLError(message, {
    nodes: error.nodes ?? null,
    source: error.source ?? null,
    positions: error.positions ?? null,
    path: error.path ?? null,
    extensions: { ...error.extensions, ...extensions },
  });
}
