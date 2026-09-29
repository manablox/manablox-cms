import { type ErrorKey, ManabloxError, toTransportError } from '@manablox/core';
import {
  type ASTNode,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  GraphQLError,
  Kind,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';
import type { Plugin } from 'graphql-yoga';

/** A refusal with its code and the Manablox error extensions. */
function refusal(
  message: string,
  node: ASTNode | null,
  options: {
    code: string;
    key: ErrorKey;
    params?: Record<string, number>;
    /** Answers the status whatever the client accepts. */
    fixedStatus?: boolean;
  },
): GraphQLError {
  const { message: _key, ...extensions } = toTransportError(
    ManabloxError.badRequest(options.key, options.params),
  );
  return new GraphQLError(message, {
    ...(node ? { nodes: [node] } : {}),
    extensions: {
      code: options.code,
      ...options.params,
      ...extensions,
      ...(options.fixedStatus ? { http: { status: extensions.status } } : {}),
    },
  });
}

/** A fixed limit, or one read from the request's context (`server` of `yoga.handle`). */
export type ContextLimit = number | ((context: Record<string, unknown>) => number);

/** Named after its limit, since validation results are cached per rule names. */
function named<T extends (context: ValidationContext) => object>(name: string, rule: T): T {
  Object.defineProperty(rule, 'name', { value: name });
  return rule;
}

/** Rejects queries deeper than `maxDepth`, following fragment spreads. */
export function depthLimitPlugin(limit: ContextLimit): Plugin {
  return {
    onValidate({ context: request, addValidationRule }) {
      const maxDepth = typeof limit === 'number' ? limit : limit(request);
      addValidationRule(
        named(`depthLimit${maxDepth}`, (context: ValidationContext) => ({
          Document(document: DocumentNode) {
            const fragments = new Map<string, FragmentDefinitionNode>();
            for (const definition of document.definitions) {
              if (definition.kind === Kind.FRAGMENT_DEFINITION) {
                fragments.set(definition.name.value, definition);
              }
            }

            for (const definition of document.definitions) {
              if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
              const depth = measure(definition, fragments, new Set(), 0);
              if (depth > maxDepth) {
                context.reportError(
                  refusal(`Query exceeds the maximum depth of ${maxDepth}`, definition, {
                    code: 'QUERY_TOO_DEEP',
                    key: 'graphql.query.tooDeep',
                    params: { maxDepth },
                  }),
                );
                return;
              }
            }
          },
        })),
      );
    },
  };
}

function measure(
  node: ASTNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visiting: Set<string>,
  depth: number,
): number {
  if (depth > 100) return depth;

  if (node.kind === Kind.FRAGMENT_SPREAD) {
    const name = node.name.value;
    // A cyclic fragment always trips the limit.
    if (visiting.has(name)) return Number.POSITIVE_INFINITY;
    const fragment = fragments.get(name);
    if (!fragment) return depth;
    return measure(fragment.selectionSet, fragments, new Set([...visiting, name]), depth);
  }

  const selections =
    'selectionSet' in node && node.selectionSet
      ? node.selectionSet.selections
      : node.kind === Kind.SELECTION_SET
        ? node.selections
        : null;

  if (!selections) return depth;

  const nextDepth = node.kind === Kind.FIELD ? depth + 1 : depth;
  let max = nextDepth;
  for (const selection of selections) {
    max = Math.max(max, measure(selection, fragments, visiting, nextDepth));
  }
  return max;
}

/**
 * Rejects queries costing more than `maxComplexity`. A field costs one; a `limit`
 * multiplies its subtree, or `defaultListSize` when the limit is a variable.
 */
export function complexityLimitPlugin(limit: ContextLimit, defaultListSize = 25): Plugin {
  return {
    onValidate({ context: request, addValidationRule }) {
      const maxComplexity = typeof limit === 'number' ? limit : limit(request);
      addValidationRule(
        named(`complexityLimit${maxComplexity}`, (context: ValidationContext) => ({
          Document(document: DocumentNode) {
            const fragments = new Map<string, FragmentDefinitionNode>();
            for (const definition of document.definitions) {
              if (definition.kind === Kind.FRAGMENT_DEFINITION) {
                fragments.set(definition.name.value, definition);
              }
            }

            for (const definition of document.definitions) {
              if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
              const cost = estimate(definition.selectionSet, fragments, new Set(), defaultListSize);
              if (cost > maxComplexity) {
                context.reportError(
                  refusal(
                    `Query exceeds the maximum complexity of ${maxComplexity} (estimated ${Math.round(cost)})`,
                    definition,
                    {
                      code: 'QUERY_TOO_COMPLEX',
                      key: 'graphql.query.tooComplex',
                      params: { maxComplexity },
                    },
                  ),
                );
                return;
              }
            }
          },
        })),
      );
    },
  };
}

function estimate(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visiting: Set<string>,
  defaultListSize: number,
  /** Inside a connection, whose `limit` already sized `items`. */
  paged = false,
): number {
  let total = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      // A cyclic fragment is unbounded, so fragments cannot bypass either limit.
      if (visiting.has(name)) return Number.POSITIVE_INFINITY;
      const fragment = fragments.get(name);
      if (!fragment) continue;
      total += estimate(
        fragment.selectionSet,
        fragments,
        new Set([...visiting, name]),
        defaultListSize,
        paged,
      );
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      total += estimate(selection.selectionSet, fragments, visiting, defaultListSize, paged);
      continue;
    }

    total += 1;
    if (!selection.selectionSet) continue;

    const name = selection.name.value;
    const child = estimate(
      selection.selectionSet,
      fragments,
      visiting,
      defaultListSize,
      CONNECTIONS.has(name),
    );
    total += child * (paged && name === 'items' ? 1 : listMultiplier(selection, defaultListSize));
  }

  return total;
}

/** A literal `limit` is the multiplier; a variable one is worst-cased. */
function listMultiplier(field: FieldNode, defaultListSize: number): number {
  const limit = field.arguments?.find((argument) => argument.name.value === 'limit');
  if (!limit) return isListish(field.name.value) ? defaultListSize : 1;
  if (limit.value.kind === Kind.INT) return Math.max(1, Number(limit.value.value));
  return defaultListSize;
}

/** Root fields whose `limit` sizes their `items`. */
const CONNECTIONS = new Set(['contentsPage']);

/** Fields known to return lists. */
function isListish(name: string): boolean {
  return name === 'items' || name === 'children' || CONNECTIONS.has(name);
}

/** Refuses introspection. Yoga's `graphiql: false` hides the IDE but leaves `__schema` queryable. */
export function disableIntrospectionPlugin(): Plugin {
  return {
    onValidate({ addValidationRule }) {
      addValidationRule((context: ValidationContext) => ({
        Field(node: FieldNode) {
          if (node.name.value !== '__schema' && node.name.value !== '__type') return;
          context.reportError(
            refusal('Introspection is disabled on this endpoint.', node, {
              code: 'INTROSPECTION_DISABLED',
              key: 'graphql.introspection.disabled',
            }),
          );
        },
      }));
    },
  };
}

export interface PersistedOperationsOptions {
  /** hash -> query text. Ships with the frontend build. */
  manifest: Record<string, string>;
  /** When false, an unknown hash is logged and the request proceeds. */
  rejectUnknown?: boolean;
  onUnknown?: (hash: string | null) => void;
}

/**
 * Allowlist mode: only manifest queries run, by `documentId` or
 * `extensions.persistedQuery.sha256Hash`. Raw `query` text is rejected.
 */
export function persistedOperationsPlugin(options: PersistedOperationsOptions): Plugin {
  const reject = options.rejectUnknown ?? true;

  return {
    onParams({ params, setParams }) {
      const hash = readHash(params);

      if (hash === null) {
        if (!reject) return;
        throw refusal('This endpoint only accepts persisted operations.', null, {
          code: 'PERSISTED_QUERY_REQUIRED',
          key: 'graphql.persisted.required',
          fixedStatus: true,
        });
      }

      const query = options.manifest[hash];
      if (query) {
        setParams({ ...params, query });
        return;
      }

      // Logged so a manifest lagging a deploy is visible.
      options.onUnknown?.(hash);
      if (!reject) return;

      throw refusal('Unknown persisted operation.', null, {
        code: 'PERSISTED_QUERY_NOT_FOUND',
        key: 'graphql.persisted.notFound',
        fixedStatus: true,
      });
    },
  };
}

function readHash(params: { query?: string; extensions?: Record<string, unknown> }): string | null {
  const extensions = params.extensions ?? {};
  const documentId = extensions.documentId;
  if (typeof documentId === 'string') return documentId;

  const persisted = extensions.persistedQuery;
  if (persisted && typeof persisted === 'object') {
    const sha = (persisted as { sha256Hash?: unknown }).sha256Hash;
    if (typeof sha === 'string') return sha;
  }
  return null;
}
