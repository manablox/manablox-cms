import { ManabloxHttpError } from './errors.js';
import type { Http } from './http.js';
import { normaliseFields } from './normalise.js';
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

interface RestContent {
  id: string;
  type: string;
  title: string;
  slug: string;
  permalink: string | null;
  locale: string;
  parentId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  fields: Record<string, unknown>;
  tags?: { name: string; slug: string }[];
}

interface RestMenuItem {
  id: string;
  label: string;
  url: string | null;
  target?: '_self' | '_blank';
  content: RestContent | null;
  children: RestMenuItem[];
}

interface RestMenu {
  id: string;
  name: string;
  machineName: string;
  items: RestMenuItem[];
}

/** The `/v1/*` transport; documents arrive whole, no selection sets. */
export class RestTransport implements Transport {
  readonly kind = 'rest' as const;

  constructor(
    private readonly http: Http,
    private readonly baseUrl: string,
    private readonly defaultLocale?: string,
  ) {}

  async byPermalink(permalink: string, options: RequestOptions = {}): Promise<ContentNode | null> {
    const path = normalisePermalink(permalink);
    // The home page has its own route; `{+path}` cannot match an empty path.
    return this.maybe<RestContent>(
      path ? `/permalink/${path}` : '/permalink',
      this.query(options),
      options,
    ).then((row) => (row ? toNode(row) : null));
  }

  async get(id: string, options: RequestOptions = {}): Promise<ContentNode | null> {
    const row = await this.maybe<RestContent>(`/content/${id}`, this.query(options), options);
    return row ? toNode(row) : null;
  }

  async list(args: ListArgs = {}, options: RequestOptions = {}): Promise<Page<ContentNode>> {
    const page = await this.get_<{
      items: RestContent[];
      total: number;
      limit: number;
      offset: number;
    }>('/content', { ...this.query(options), ...definedOnly(args) }, options);

    return { ...page, items: page.items.map(toNode) };
  }

  async menu(name: string, options: RequestOptions = {}): Promise<Menu | null> {
    const menu = await this.maybe<RestMenu>(
      `/menus/${encodeURIComponent(name)}`,
      this.query(options),
      options,
    );
    if (!menu) return null;
    const toRaw = (item: RestMenuItem): RawMenuItem => ({
      id: item.id,
      label: item.label,
      url: item.url,
      target: item.target ?? '_self',
      content: item.content ? toNode(item.content) : null,
      children: item.children.map(toRaw),
    });
    return { ...menu, items: toMenuItems(menu.items.map(toRaw)) };
  }

  async redirects(options: RequestOptions = {}): Promise<Redirect[]> {
    const locale = options.locale ?? this.defaultLocale;
    const body = await this.get_<{ items: Redirect[] }>(
      '/redirects',
      locale ? { locale } : {},
      options,
    );
    return body.items;
  }

  async asset(id: string, options: RequestOptions = {}): Promise<Asset | null> {
    return this.maybe<Asset>(`/assets/${id}`, {}, options);
  }

  types(options: RequestOptions = {}): Promise<ContentModel> {
    return this.get_<ContentModel>('/types', {}, options);
  }

  // -------------------------------------------------------------------------

  private query(options: RequestOptions): Record<string, string> {
    const locale = options.locale ?? this.defaultLocale;
    return {
      ...(locale ? { locale } : {}),
      ...(options.expand?.length ? { expand: options.expand.join(',') } : {}),
    };
  }

  private async get_<T>(
    path: string,
    query: Record<string, unknown>,
    options: RequestOptions,
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search}` : '';

    return (await this.http.request({
      url: `${trimBaseUrl(this.baseUrl)}/v1${path}${suffix}`,
      method: 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    })) as T;
  }

  /** Maps not-found to `null`; other errors still throw. */
  private async maybe<T>(
    path: string,
    query: Record<string, unknown>,
    options: RequestOptions,
  ): Promise<T | null> {
    try {
      return await this.get_<T>(path, query, options);
    } catch (error) {
      if (error instanceof ManabloxHttpError && error.isNotFound) return null;
      throw error;
    }
  }
}

/** Flattens field values onto the node, keeping `fields` too. */
function toNode(row: RestContent): ContentNode {
  const fields = normaliseFields(row.fields);
  return { ...fields, ...row, fields };
}

function definedOnly(args: ListArgs): Record<string, unknown> {
  const { tags, ...rest } = args;
  return {
    ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    // The endpoint takes one comma-separated list.
    ...(tags?.length ? { tags: tags.join(',') } : {}),
  };
}
