import { RunError } from '@manablox/core';
import { defineWorkflowAction, type WorkflowActionContext } from '../../define/action.js';
import {
  extractBySelector,
  htmlToText,
  metaContent,
  pageBody,
  pageLinks,
  pageTitle,
} from '../html.js';
import { clamp, isHttpUrl, withDeadline } from './shared.js';

export interface CrawlConfig extends Record<string, unknown> {
  url: string;
  maxPages: number;
  maxDepth: number;
  /** Follow links only within the start page's origin. */
  sameOrigin: boolean;
  /** A URL must contain this to be followed; empty follows everything. */
  include: string;
  /** A URL containing this is never followed. */
  exclude: string;
  /** A simple selector such as `main`, `.article` or `#content`. */
  selector: string;
  /** Characters kept per page. */
  maxCharsPerPage: number;
  timeoutMs: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  description: string;
  text: string;
  links: string[];
}

export const crawlAction = defineWorkflowAction<CrawlConfig>({
  type: 'crawl.site',
  label: 'Read a website',
  description: 'Fetches a page and, optionally, the pages it links to. Feeds the AI action.',
  icon: 'globe',
  tone: 'violet',
  group: 'data',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'The pages read', type: 'pages' },
  outputPaths: [
    { path: 'text', type: 'text', hint: 'Every page as one block of text' },
    { path: 'pages', type: 'pages', hint: 'The pages, each with url, title and text' },
    { path: 'pages.0.text', type: 'text', hint: 'The first page' },
    { path: 'count', type: 'number', hint: 'How many pages were read' },
  ],
  credential: { kinds: ['apiKey', 'bearer', 'basic'], required: false },
  fields: [
    { name: 'url', label: 'Start at', kind: 'template', required: true, placeholder: 'https://' },
    {
      name: 'maxPages',
      label: 'At most this many pages',
      kind: 'number',
      min: 1,
      max: 200,
      width: 'half',
    },
    {
      name: 'maxDepth',
      label: 'Follow links this deep',
      kind: 'number',
      min: 0,
      max: 5,
      width: 'half',
    },
    { name: 'sameOrigin', label: 'Stay on the same site', kind: 'switch' },
    { name: 'include', label: 'Only URLs containing', kind: 'text', width: 'half' },
    { name: 'exclude', label: 'Never URLs containing', kind: 'text', width: 'half' },
    {
      name: 'selector',
      label: 'Read only this part',
      kind: 'text',
      hint: 'A tag, .class or #id - the part of the page worth reading. Empty reads the body.',
    },
    {
      name: 'maxCharsPerPage',
      label: 'Characters kept per page',
      kind: 'number',
      min: 200,
      max: 100_000,
      width: 'half',
    },
    {
      name: 'timeoutMs',
      label: 'Give up on a page after',
      kind: 'number',
      min: 1000,
      max: 60_000,
      width: 'half',
      hint: 'Milliseconds.',
    },
  ],
  defaults: () => ({
    url: '',
    maxPages: 5,
    maxDepth: 1,
    sameOrigin: true,
    include: '',
    exclude: '',
    selector: '',
    maxCharsPerPage: 20_000,
    timeoutMs: 15_000,
  }),
  validate: (config, at, add) => {
    const url = config.url?.trim() ?? '';
    if (!url.includes('{{') && !isHttpUrl(url))
      add('plugins.workflows.node.crawl.urlInvalid', at('url'));
    return {
      url,
      maxPages: clamp(Math.round(config.maxPages ?? 5), 1, 200),
      maxDepth: clamp(Math.round(config.maxDepth ?? 1), 0, 5),
      sameOrigin: config.sameOrigin ?? true,
      include: config.include?.trim() ?? '',
      exclude: config.exclude?.trim() ?? '',
      selector: config.selector?.trim() ?? '',
      maxCharsPerPage: clamp(Math.round(config.maxCharsPerPage ?? 20_000), 200, 100_000),
      timeoutMs: clamp(config.timeoutMs ?? 15_000, 1_000, 60_000),
    };
  },
  execute: async (ctx: WorkflowActionContext<CrawlConfig>) => {
    const { config } = ctx;
    const start = new URL(ctx.render(config.url));
    // The instance ceiling always wins; editors must not spend unbounded bandwidth.
    const budget = Math.min(config.maxPages, ctx.services.limits.maxCrawlPages);

    const pages: CrawledPage[] = [];
    const seen = new Set<string>([start.href]);
    const failures: Array<{ url: string; reason: string }> = [];
    let queue: Array<{ url: string; depth: number }> = [{ url: start.href, depth: 0 }];

    while (queue.length && pages.length < budget) {
      const next: Array<{ url: string; depth: number }> = [];
      for (const entry of queue) {
        if (pages.length >= budget) break;
        try {
          const page = await readPage(ctx, entry.url, config);
          pages.push(page);
          if (entry.depth < config.maxDepth) {
            for (const link of page.links) {
              if (seen.has(link) || !wanted(link, start, config)) continue;
              seen.add(link);
              next.push({ url: link, depth: entry.depth + 1 });
            }
          }
        } catch (error) {
          failures.push({
            url: entry.url,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      queue = next;
    }

    if (pages.length === 0) {
      const reason = failures[0]?.reason ?? '';
      throw new RunError(
        'plugins.workflows.run.crawlEmpty',
        { url: start.href, reason },
        `Nothing could be read from ${start.href}${reason ? `: ${reason}` : ''}`,
      );
    }

    const text = pages
      .map((page) => `# ${page.title || page.url}\n${page.text}`)
      .join('\n\n---\n\n');
    return {
      kind: 'ok',
      message: `Read ${pages.length} page${pages.length === 1 ? '' : 's'}`,
      detail: { start: start.href, pages: pages.map((page) => page.url), failures },
      output: { start: start.href, count: pages.length, pages, text },
    };
  },
});

function wanted(link: string, start: URL, config: CrawlConfig): boolean {
  const url = new URL(link);
  if (config.sameOrigin && url.origin !== start.origin) return false;
  if (config.include && !link.includes(config.include)) return false;
  if (config.exclude && link.includes(config.exclude)) return false;
  return true;
}

async function readPage(
  ctx: WorkflowActionContext<CrawlConfig>,
  url: string,
  config: CrawlConfig,
): Promise<CrawledPage> {
  const response = await ctx.fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Manablox-Workflow/1.0' },
    signal: withDeadline(ctx.signal, config.timeoutMs),
  });
  if (!response.ok) {
    throw new RunError(
      'plugins.workflows.run.pageStatus',
      { url, status: response.status },
      `${url} answered HTTP ${response.status}`,
    );
  }
  const type = response.headers.get('content-type') ?? '';
  if (type && !/html|xml|text\/plain/i.test(type)) {
    const mime = type.split(';')[0];
    throw new RunError(
      'plugins.workflows.run.notAPage',
      { url, type: mime },
      `${url} is ${mime}, not a page`,
    );
  }

  const html = await response.text();
  const region = config.selector ? extractBySelector(html, config.selector) : null;
  const text = htmlToText(region ?? pageBody(html)).slice(0, config.maxCharsPerPage);
  return {
    url,
    title: pageTitle(html),
    description: metaContent(html, 'description') || metaContent(html, 'og:description'),
    text,
    links: pageLinks(html, url),
  };
}
