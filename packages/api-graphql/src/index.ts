import type { TypeScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { GraphQLSchema } from 'graphql';
import { createYoga, type Plugin, type YogaServerInstance } from 'graphql-yoga';
import type { GraphQLContext } from './context.js';
import { manabloxErrorsPlugin } from './errors.js';
import {
  type ContextLimit,
  complexityLimitPlugin,
  depthLimitPlugin,
  disableIntrospectionPlugin,
  persistedOperationsPlugin,
} from './limits.js';
import { type BuildSchemaOptions, buildSchema } from './schema.js';

export type { Builder } from './builder.js';
export * from './context.js';
export * from './errors.js';
export * from './limits.js';
export * from './response-cache.js';
export * from './schema.js';

/** Spaces and environments whose schemas are kept; the least recently used go first. */
const SCHEMAS_KEPT = 500;

/**
 * One built schema per space environment, rebuilt when a type it holds changes; another
 * environment's type change leaves it alone.
 */
export class SchemaCache {
  private readonly schemas = new Map<string, { version: string; schema: GraphQLSchema }>();

  constructor(
    private readonly manablox: Manablox,
    private readonly options: BuildSchemaOptions = {},
    private readonly kept = SCHEMAS_KEPT,
  ) {}

  get(spaceId?: TypeScope | undefined): GraphQLSchema {
    const registry = this.manablox.contentTypes;
    // `undefined` (all spaces) and `null` (global only) are different schemas.
    const key = schemaKey(spaceId);
    const version =
      spaceId === undefined ? String(registry.schemaVersion) : registry.schemaVersionOf(spaceId);
    const cached = this.schemas.get(key);
    if (cached?.version === version) {
      // Most recently used last.
      this.schemas.delete(key);
      this.schemas.set(key, cached);
      return cached.schema;
    }

    const schema = buildSchema(this.manablox, { ...this.options, spaceId });
    this.schemas.delete(key);
    this.schemas.set(key, { version, schema });
    while (this.schemas.size > this.kept) {
      const oldest = this.schemas.keys().next().value;
      if (oldest === undefined) break;
      this.schemas.delete(oldest);
    }
    this.manablox.logger.debug({ schemaVersion: version, spaceId: key }, 'graphql schema built');
    return schema;
  }
}

function schemaKey(scope: TypeScope | undefined): string {
  if (scope === undefined) return '*';
  if (scope === null) return 'global';
  if (typeof scope === 'string') return scope;
  return scope.production ? scope.spaceId : `${scope.spaceId}:${scope.environmentId}`;
}

export interface YogaOptions {
  manablox: Manablox;
  /** `server` is what the host passed to `handle` next to the request. */
  buildContext: (request: Request, server: Record<string, unknown>) => Promise<GraphQLContext>;
  /** Public-instance overrides; undefined falls back to `manablox.config.graphql`. */
  introspection?: boolean;
  maxDepth?: ContextLimit;
  maxComplexity?: ContextLimit;
  /** Always mask on a public instance, whatever `NODE_ENV` says. */
  maskedErrors?: boolean;
  /** Removes the `spaceId` argument from root fields. */
  pinnedSpace?: boolean;
  /**
   * The space whose schema answers, read from the request (and what the host passed to
   * `handle`) because it is needed before parsing. `undefined` serves every space's types,
   * collisions dropped.
   */
  schemaSpaceId?: (request: Request, server: Record<string, unknown>) => TypeScope | undefined;
  persistedOperations?: {
    manifest: Record<string, string>;
    rejectUnknown?: boolean;
  };
  /** Response caching and anything else the host process wants to layer on. */
  plugins?: Plugin[];
}

export function createGraphQLServer(
  options: YogaOptions,
): YogaServerInstance<Record<string, unknown>, GraphQLContext> {
  const { manablox, buildContext } = options;
  const config = manablox.config.graphql;

  const introspection = options.introspection ?? config.introspection;
  const maxDepth = options.maxDepth ?? config.maxDepth;
  const maxComplexity = options.maxComplexity ?? config.maxComplexity;
  const cache = new SchemaCache(manablox, { pinnedSpace: options.pinnedSpace ?? false });

  const maskedErrors = options.maskedErrors ?? process.env.NODE_ENV === 'production';

  const plugins: Plugin[] = [
    depthLimitPlugin(maxDepth),
    complexityLimitPlugin(maxComplexity),
    manabloxErrorsPlugin({ mask: maskedErrors }),
  ];

  // `graphiql: false` alone leaves `__schema` queryable.
  if (!introspection) plugins.push(disableIntrospectionPlugin());

  if (options.persistedOperations) {
    plugins.push(
      persistedOperationsPlugin({
        manifest: options.persistedOperations.manifest,
        ...(options.persistedOperations.rejectUnknown !== undefined
          ? { rejectUnknown: options.persistedOperations.rejectUnknown }
          : {}),
        onUnknown: (hash) => manablox.logger.warn({ hash }, 'unknown persisted operation'),
      }),
    );
  }

  plugins.push(...(options.plugins ?? []));

  return createYoga<Record<string, unknown>, GraphQLContext>({
    schema: ({ request, ...server }) => cache.get(options.schemaSpaceId?.(request, server)),
    context: ({ request, ...server }) => buildContext(request, server),
    graphqlEndpoint: config.path,
    graphiql: introspection,
    landingPage: false,
    // Masks everything but the errors `manabloxErrorsPlugin` already mapped.
    maskedErrors,
    plugins,
  });
}
