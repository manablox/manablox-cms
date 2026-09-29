import type {
  Asset,
  ContentModel,
  ContentNode,
  ListArgs,
  Menu,
  MenuItem,
  MenuItemTarget,
  Page,
  Redirect,
  RequestOptions,
} from './types.js';

/** The contract both transports implement; only methods both can express belong here. */
export interface Transport {
  readonly kind: 'graphql' | 'rest';
  byPermalink(permalink: string, options?: RequestOptions): Promise<ContentNode | null>;
  get(id: string, options?: RequestOptions): Promise<ContentNode | null>;
  list(args?: ListArgs, options?: RequestOptions): Promise<Page<ContentNode>>;
  menu(name: string, options?: RequestOptions): Promise<Menu | null>;
  redirects(options?: RequestOptions): Promise<Redirect[]>;
  asset(id: string, options?: RequestOptions): Promise<Asset | null>;
  types(options?: RequestOptions): Promise<ContentModel>;
}

/** `/about/team/` and `about/team` address the same document. */
export function normalisePermalink(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

export function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** A menu entry as delivered, before `href` is derived. */
export interface RawMenuItem {
  id: string;
  label: string;
  url: string | null;
  /** Absent means `_self`. */
  target?: MenuItemTarget | null;
  content: ContentNode | null;
  children: RawMenuItem[];
}

/** Derives `href` throughout the tree. */
export function toMenuItems(items: RawMenuItem[]): MenuItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    url: item.url,
    target: item.target === '_blank' ? '_blank' : '_self',
    content: item.content,
    href: item.url ?? (item.content?.permalink != null ? `/${item.content.permalink}` : null),
    children: toMenuItems(item.children),
  }));
}
