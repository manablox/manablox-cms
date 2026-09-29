import { assetUrl } from './assets.js';
import { type CacheOptions, cacheKey, RequestCache } from './cache.js';
import { Http, type HttpOptions } from './http.js';
import type { Transport } from './transport.js';
import { GraphQLTransport } from './transport-graphql.js';
import { RestTransport } from './transport-rest.js';
import type {
  Asset,
  ContentModel,
  ContentNode,
  ListArgs,
  Menu,
  Page,
  Redirect,
  RequestOptions,
} from './types.js';

export interface ManabloxClientOptions extends HttpOptions {
  /** Base URL of the Manablox delivery API, e.g. `https://cms.example.com`. */
  url: string;
  /** `graphql` is richer; `rest` needs no selection sets. Defaults to `graphql`. */
  transport?: 'graphql' | 'rest';
  locale?: string;
  /** Space to read from; only a management instance honours it. */
  spaceId?: string;
  /** Environment of that space by machine name, e.g. `staging`; production when absent. */
  environment?: string;
  /** GraphQL endpoint path, if it was moved. */
  graphqlPath?: string;
  /**
   * Block keys plugins deliver, such as the website's `design`. GraphQL sends them next to a
   * block's fields; naming them keeps them out of `fields`, as over REST.
   */
  blockExtensions?: readonly string[];
  cache?: CacheOptions | false;
}

/**
 * The transport-agnostic delivery client. Holds no credentials; preview lives in
 * `@manablox/public-sdk/preview` so API keys stay out of browser bundles.
 */
export class ManabloxClient {
  readonly transport: Transport;
  private readonly cache: RequestCache | null;

  constructor(private readonly options: ManabloxClientOptions) {
    const http = new Http(options);

    this.transport =
      options.transport === 'rest'
        ? new RestTransport(http, options.url, options.locale)
        : new GraphQLTransport(http, options.url, {
            ...(options.graphqlPath ? { path: options.graphqlPath } : {}),
            ...(options.locale ? { locale: options.locale } : {}),
            ...(options.spaceId ? { spaceId: options.spaceId } : {}),
            ...(options.environment ? { environment: options.environment } : {}),
            ...(options.headers ? { headers: options.headers } : {}),
            ...(options.blockExtensions ? { blockExtensions: options.blockExtensions } : {}),
          });

    this.cache = options.cache === false ? null : new RequestCache(options.cache ?? {});
  }

  /** Resolves a URL path to a document. */
  byPermalink<T extends ContentNode = ContentNode>(
    permalink: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    return this.dedupe('byPermalink', [permalink, options], options, () =>
      this.transport.byPermalink(permalink, options),
    ) as Promise<T | null>;
  }

  get<T extends ContentNode = ContentNode>(
    id: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    return this.dedupe('get', [id, options], options, () =>
      this.transport.get(id, options),
    ) as Promise<T | null>;
  }

  list<T extends ContentNode = ContentNode>(
    args: ListArgs = {},
    options: RequestOptions = {},
  ): Promise<Page<T>> {
    return this.dedupe('list', [args, options], options, () =>
      this.transport.list(args, options),
    ) as Promise<Page<T>>;
  }

  /** A named menu (e.g. `main`) with nested entries. */
  menu<T extends ContentNode = ContentNode>(
    name: string,
    options: RequestOptions = {},
  ): Promise<Menu<T> | null> {
    return this.dedupe('menu', [name, options], options, () =>
      this.transport.menu(name, options),
    ) as Promise<Menu<T> | null>;
  }

  /** Every redirect of the locale, its own before shared ones, for a frontend's router. */
  redirects(options: RequestOptions = {}): Promise<Redirect[]> {
    return this.dedupe('redirects', [options], options, () => this.transport.redirects(options));
  }

  asset(id: string, options: RequestOptions = {}): Promise<Asset | null> {
    return this.dedupe('asset', [id], options, () =>
      this.transport.asset(id, options),
    ) as Promise<Asset | null>;
  }

  /** The space's content model. Used by `manablox-sdk types`. */
  types(options: RequestOptions = {}): Promise<ContentModel> {
    return this.dedupe('types', [], options, () =>
      this.transport.types(options),
    ) as Promise<ContentModel>;
  }

  /** An arbitrary GraphQL query, when the typed methods are not enough. */
  query<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    if (!(this.transport instanceof GraphQLTransport)) {
      throw new Error('client.query() requires the graphql transport');
    }
    return this.transport.query<T>(query, variables, options);
  }

  assetUrl = assetUrl;

  withLocale(locale: string): ManabloxClient {
    return new ManabloxClient({ ...this.options, locale });
  }

  clearCache(): void {
    this.cache?.clear();
  }

  private dedupe<T>(
    operation: string,
    args: unknown[],
    options: RequestOptions,
    load: () => Promise<T>,
  ): Promise<T> {
    if (!this.cache) return load();
    // Per-call options are left out of the key so identical calls share a request.
    const key = cacheKey(`${this.transport.kind}:${operation}`, stripSignal(args));
    return this.cache.resolve(key, load, options.fresh ?? false);
  }
}

function stripSignal(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (!arg || typeof arg !== 'object') return arg;
    const { signal: _signal, fresh: _fresh, ...rest } = arg as RequestOptions;
    return rest;
  });
}

export function createClient(options: ManabloxClientOptions): ManabloxClient {
  return new ManabloxClient(options);
}
