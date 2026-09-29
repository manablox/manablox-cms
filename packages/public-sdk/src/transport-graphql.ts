import {
  type GraphQLErrorShape,
  ManabloxGraphQLError,
  ManabloxHttpError,
  parseGraphQLErrors,
} from './errors.js';
import type { Http } from './http.js';
import { type NormaliseOptions, normaliseFields } from './normalise.js';
import {
  normalisePermalink,
  type RawMenuItem,
  type Transport,
  toMenuItems,
  trimBaseUrl,
} from './transport.js';
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

/** The fields every content type has; `typeName` is aliased to `type` to match REST. */
const BASE_SELECTION = `
  id
  type: typeName
  title
  slug
  permalink
  locale
  publishedAt
  updatedAt
  tags { name slug }
`;

const ASSET_SELECTION = `
  id
  url
  filename
  mimeType
  size
  width
  height
  alt
  title
  tags { name slug }
`;

export class GraphQLTransport implements Transport {
  readonly kind = 'graphql' as const;

  constructor(
    private readonly http: Http,
    private readonly baseUrl: string,
    private readonly options: {
      path?: string;
      locale?: string;
      spaceId?: string;
      environment?: string;
      headers?: Record<string, string>;
      blockExtensions?: readonly string[];
    } = {},
  ) {}

  private normalise(node: ContentNode | null): ContentNode | null {
    return normalise(
      node,
      this.options.blockExtensions ? { blockExtensions: this.options.blockExtensions } : {},
    );
  }

  /** Runs an arbitrary query. */
  async query<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const payload = (await this.http
      .request({
        url: `${trimBaseUrl(this.baseUrl)}${this.options.path ?? '/graphql'}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // GraphQL over HTTP: a refused request answers its 4xx status.
          accept: 'application/graphql-response+json, application/json;q=0.9',
          // Ignored by public instances, which pin their space.
          ...(this.options.spaceId ? { 'x-manablox-space': this.options.spaceId } : {}),
          ...(this.options.environment
            ? { 'x-manablox-environment': this.options.environment }
            : {}),
          ...this.options.headers,
        },
        body: JSON.stringify({ query, variables }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
      .catch((error: unknown) => {
        const errors = error instanceof ManabloxHttpError ? parseGraphQLErrors(error.body) : null;
        throw errors
          ? new ManabloxGraphQLError(errors, (error as ManabloxHttpError).status)
          : error;
      })) as { data?: T; errors?: GraphQLErrorShape[] };

    if (payload.errors?.length) throw new ManabloxGraphQLError(payload.errors);
    return payload.data as T;
  }

  async byPermalink(permalink: string, options: RequestOptions = {}): Promise<ContentNode | null> {
    const data = await this.query<{ contentByPermalink: ContentNode | null }>(
      `query ByPermalink($permalink: String!, $locale: String) {
         contentByPermalink(permalink: $permalink, locale: $locale) { ${this.selection(options)} }
       }`,
      { permalink: normalisePermalink(permalink), locale: this.locale(options) },
      options,
    );
    return this.normalise(data.contentByPermalink);
  }

  async get(id: string, options: RequestOptions = {}): Promise<ContentNode | null> {
    const data = await this.query<{ content: ContentNode | null }>(
      `query Content($id: String!) { content(id: $id) { ${this.selection(options)} } }`,
      { id },
      options,
    );
    return this.normalise(data.content);
  }

  async list(args: ListArgs = {}, options: RequestOptions = {}): Promise<Page<ContentNode>> {
    const limit = args.limit ?? 25;
    const offset = args.offset ?? 0;

    const data = await this.query<{ contentsPage: Page<ContentNode> }>(
      `query List($type: String, $parentId: String, $under: String, $search: String,
                  $tags: String, $limit: Int, $offset: Int, $locale: String) {
         contentsPage(type: $type, parentId: $parentId, under: $under, search: $search,
                      tags: $tags, limit: $limit, offset: $offset, locale: $locale) {
           total limit offset items { ${this.selection(options)} }
         }
       }`,
      {
        type: args.type ?? null,
        parentId: args.parentId ?? null,
        under: args.under ?? null,
        search: args.search ?? null,
        tags: args.tags?.length ? args.tags.join(',') : null,
        limit,
        offset,
        locale: this.locale(options),
      },
      options,
    );

    const page = data.contentsPage;
    return { ...page, items: page.items.map((item) => this.normalise(item) as ContentNode) };
  }

  async menu(name: string, options: RequestOptions = {}): Promise<Menu | null> {
    // The query must name each level; six stays inside the complexity limit.
    const entry = (depth: number): string =>
      `id label url target content { ${this.selection(options)} }${depth > 0 ? ` children { ${entry(depth - 1)} }` : ' children { id }'}`;
    const data = await this.query<{ menu: RawGraphQLMenu | null }>(
      `query Menu($name: String!, $locale: String) {
         menu(name: $name, locale: $locale) { id name machineName items { ${entry(5)} } }
       }`,
      { name, locale: this.locale(options) },
      options,
    );
    if (!data.menu) return null;
    const toRaw = (item: RawGraphQLMenuItem): RawMenuItem => ({
      id: item.id,
      label: item.label,
      url: item.url,
      target: item.target === '_blank' ? '_blank' : '_self',
      content: this.normalise(item.content),
      children: (item.children ?? []).map(toRaw),
    });
    return { ...data.menu, items: toMenuItems(data.menu.items.map(toRaw)) };
  }

  async redirects(options: RequestOptions = {}): Promise<Redirect[]> {
    const data = await this.query<{ redirects: Redirect[] }>(
      `query Redirects($locale: String) {
         redirects(locale: $locale) { locale fromPath toPath status contentId }
       }`,
      { locale: this.locale(options) },
      options,
    );
    return data.redirects;
  }

  async asset(id: string, options: RequestOptions = {}): Promise<Asset | null> {
    const data = await this.query<{ asset: Asset | null }>(
      `query Asset($id: String!) { asset(id: $id) { ${ASSET_SELECTION} } }`,
      { id },
      options,
    );
    return data.asset;
  }

  /** Read over REST, since public instances disable introspection. */
  async types(options: RequestOptions = {}): Promise<ContentModel> {
    return (await this.http.request({
      url: `${trimBaseUrl(this.baseUrl)}/v1/types`,
      method: 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    })) as ContentModel;
  }

  private selection(options: RequestOptions): string {
    return options.selection ? `${BASE_SELECTION}\n${options.selection}` : BASE_SELECTION;
  }

  private locale(options: RequestOptions): string | null {
    return options.locale ?? this.options.locale ?? null;
  }
}

interface RawGraphQLMenuItem {
  id: string;
  label: string;
  url: string | null;
  target?: string | null;
  content: ContentNode | null;
  children?: RawGraphQLMenuItem[];
}

interface RawGraphQLMenu {
  id: string;
  name: string;
  machineName: string;
  items: RawGraphQLMenuItem[];
}

/** Mirrors the node's field values under `fields`. */
function normalise(node: ContentNode | null, options: NormaliseOptions): ContentNode | null {
  if (!node) return null;
  const { id, type, title, slug, permalink, locale, publishedAt, updatedAt, ...rest } = node;
  const fields = normaliseFields(rest as Record<string, unknown>, options);

  return {
    id,
    type,
    title,
    slug,
    permalink,
    locale,
    publishedAt,
    updatedAt,
    ...fields,
    fields,
  };
}
