import type { CredentialSecret } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowActionContext, WorkflowActionResult } from '../src/define/action.js';
import type { WorkflowRunContext } from '../src/sdk.js';
import { type ContentConfig, contentCreateAction } from '../src/server/actions/content.js';
import { crawlAction } from '../src/server/actions/crawl.js';
import { type HttpConfig, httpAction } from '../src/server/actions/http.js';
import { type TransformConfig, transformAction } from '../src/server/actions/transform.js';
import { render, renderJson, resolvePath } from '../src/server/template.js';

/** Actions against a stubbed fetch; checks the output shape later nodes read. */

let manablox: Manablox;

const run: WorkflowRunContext = {
  event: 'content.created',
  workflow: { id: 'w', name: 'W' },
  space: { id: 's', name: 'Space', machineName: 's', url: 'https://site.test' },
  content: { id: 'c1', title: 'Launch' },
  payload: null,
  headers: null,
  previous: null,
  documents: [],
  actor: null,
  url: null,
  at: '2026-09-06T00:00:00.000Z',
  nodes: {},
};

interface Handled<C> {
  ctx: WorkflowActionContext<C>;
  secrets: string[];
}

function contextFor<C extends Record<string, unknown>>(
  config: C,
  options: {
    fetch?: typeof fetch;
    credential?: CredentialSecret | null;
    nodes?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
  } = {},
): Handled<C> {
  const secrets: string[] = [];
  const context = { ...run, nodes: options.nodes ?? {} };
  const ctx = {
    config,
    node: {
      id: 'n1',
      key: 'node',
      name: '',
      enabled: true,
      continueOnError: false,
      join: 'any',
      ui: { x: 0, y: 0 },
      kind: 'action',
      action: 'test',
      config,
      credentialId: null,
    },
    run: context,
    inputs: options.inputs ?? {},
    workflow: { id: 'w', name: 'W', spaceId: 's' },
    render: (template: string) => render(template, context),
    renderJson: (template: string) => renderJson(template, context),
    resolve: (path: string) => resolvePath(context, path),
    fetch: options.fetch ?? (globalThis.fetch as typeof fetch),
    credential: options.credential ?? null,
    secret: (value: string) => secrets.push(value),
    logger: manablox.logger,
    manablox,
    services: {
      repos: {} as never,
      mailer: null,
      pusher: null,
      content: null,
      limits: { runTimeoutSeconds: 300, maxCrawlPages: 10 },
    },
    signal: new AbortController().signal,
    adminUrl: 'https://admin.test',
  } as unknown as WorkflowActionContext<C>;
  return { ctx, secrets };
}

const answering = (pages: Record<string, { body: string; type?: string; status?: number }>) =>
  (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const page = pages[url];
    if (!page) return new Response('missing', { status: 404 });
    return new Response(page.body, {
      status: page.status ?? 200,
      headers: { 'content-type': page.type ?? 'text/html' },
    });
  }) as typeof fetch;

const ok = (result: WorkflowActionResult) => {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result;
};

beforeAll(() => {
  manablox = new Manablox({
    database: { url: 'postgres://unused/unused' },
    auth: { secret: 'test-secret' },
  });
});

describe('the API action', () => {
  it('publishes the whole response, parsed, for later nodes to read', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ items: [{ id: 7, name: 'Ada' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'W/"abc"' },
      })) as typeof fetch;

    const { ctx } = contextFor(
      {
        ...httpAction.defaults(),
        method: 'GET',
        url: 'https://api.test/things',
        body: { mode: 'none', template: '' },
      } satisfies HttpConfig as HttpConfig,
      { fetch: fetchImpl },
    );
    const result = ok(await httpAction.execute(ctx));
    const output = result.output as Record<string, unknown>;

    expect(output).toMatchObject({ ok: true, status: 200 });
    expect((output.body as { items: Array<{ name: string }> }).items[0]?.name).toBe('Ada');
    expect((output.headers as Record<string, string>).etag).toBe('W/"abc"');
    // The log keeps a taste of the answer, not the whole of it.
    expect(String(result.detail?.response).length).toBeLessThanOrEqual(500);
  });

  it('puts a credential on the request rather than in the config', async () => {
    let seen: Headers | null = null;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const { ctx } = contextFor(
      { ...httpAction.defaults(), method: 'GET', url: 'https://api.test/x' } as HttpConfig,
      {
        fetch: fetchImpl,
        credential: {
          id: 'c',
          name: 'Key',
          slug: 'key',
          kind: 'apiKey',
          provider: '',
          data: { header: 'X-Api-Key', key: 'abc123', prefix: '' },
        },
      },
    );
    await httpAction.execute(ctx);
    expect((seen as unknown as Headers).get('x-api-key')).toBe('abc123');
  });

  it('sends an API key that names no header as X-Api-Key, as webhooks do', async () => {
    let seen: Headers | null = null;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const { ctx } = contextFor(
      { ...httpAction.defaults(), method: 'GET', url: 'https://api.test/x' } as HttpConfig,
      {
        fetch: fetchImpl,
        credential: {
          id: 'c',
          name: 'Key',
          slug: 'key',
          kind: 'apiKey',
          provider: '',
          data: { key: 'abc123', prefix: 'Token' },
        },
      },
    );
    await httpAction.execute(ctx);
    expect((seen as unknown as Headers).get('x-api-key')).toBe('Token abc123');
    expect((seen as unknown as Headers).get('authorization')).toBeNull();
  });

  it('can treat an error status as something to branch on', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    const failing = contextFor(
      { ...httpAction.defaults(), method: 'GET', url: 'https://api.test/x' } as HttpConfig,
      { fetch: fetchImpl },
    );
    await expect(httpAction.execute(failing.ctx)).rejects.toThrow(/404/);

    const tolerant = contextFor(
      {
        ...httpAction.defaults(),
        method: 'GET',
        url: 'https://api.test/x',
        allowErrorStatus: true,
      } as HttpConfig,
      { fetch: fetchImpl },
    );
    const result = ok(await httpAction.execute(tolerant.ctx));
    expect(result.output).toMatchObject({ ok: false, status: 404 });
  });
});

describe('the reshape action', () => {
  it('builds a value out of what earlier nodes produced, keeping types', async () => {
    const { ctx } = contextFor(
      {
        template:
          '{"who":"{{ nodes.fetch.body.name }}","count":"{{ nodes.fetch.body.total }}","note":"for {{ content.title }}"}',
      } as TransformConfig,
      { nodes: { fetch: { body: { name: 'Ada', total: 3 } } } },
    );
    const result = ok(await transformAction.execute(ctx));
    expect(result.output).toEqual({ who: 'Ada', count: 3, note: 'for Launch' });
  });

  it('reports a template that is not JSON at save time', () => {
    const problems: string[] = [];
    transformAction.validate?.(
      { template: '{ not json' },
      (...rest) => rest,
      (key) => problems.push(key),
    );
    expect(problems).toEqual(['plugins.workflows.node.transform.templateInvalid']);
  });
});

describe('the crawler', () => {
  const site = {
    'https://site.test/': {
      body: `<html><head><title>Home</title><meta name="description" content="The home page"></head>
        <body><script>ignored()</script><p>Hello there</p><a href="/about">About</a>
        <a href="https://elsewhere.test/x">Away</a></body></html>`,
    },
    'https://site.test/about': {
      body: '<html><head><title>About</title></head><body><main><p>About us</p></main></body></html>',
    },
    'https://elsewhere.test/x': { body: '<html><title>Away</title><body>Away</body></html>' },
  };

  it('reads a page as text and follows its links within the site', async () => {
    const { ctx } = contextFor(
      { ...crawlAction.defaults(), url: 'https://site.test/', maxPages: 5, maxDepth: 1 },
      { fetch: answering(site) },
    );
    const result = ok(await crawlAction.execute(ctx));
    const output = result.output as {
      count: number;
      pages: Array<{ url: string; text: string }>;
      text: string;
    };

    expect(output.count).toBe(2);
    expect(output.pages.map((page) => page.url)).toEqual([
      'https://site.test/',
      'https://site.test/about',
    ]);
    expect(output.pages[0]?.text).toContain('Hello there');
    // Script contents are not prose and must not reach a prompt.
    expect(output.text).not.toContain('ignored()');
    // The concatenated text is what the AI action is usually pointed at.
    expect(output.text).toContain('About us');
  });

  it('stays on the site, and stops at the depth and page limits', async () => {
    const shallow = contextFor(
      { ...crawlAction.defaults(), url: 'https://site.test/', maxDepth: 0 },
      { fetch: answering(site) },
    );
    expect((ok(await crawlAction.execute(shallow.ctx)).output as { count: number }).count).toBe(1);

    const capped = contextFor(
      { ...crawlAction.defaults(), url: 'https://site.test/', maxPages: 1, maxDepth: 3 },
      { fetch: answering(site) },
    );
    expect((ok(await crawlAction.execute(capped.ctx)).output as { count: number }).count).toBe(1);

    const roaming = contextFor(
      { ...crawlAction.defaults(), url: 'https://site.test/', maxDepth: 1, sameOrigin: false },
      { fetch: answering(site) },
    );
    expect((ok(await crawlAction.execute(roaming.ctx)).output as { count: number }).count).toBe(3);
  });

  it('reads only the part asked for', async () => {
    const { ctx } = contextFor(
      { ...crawlAction.defaults(), url: 'https://site.test/about', selector: 'main', maxDepth: 0 },
      { fetch: answering(site) },
    );
    const output = ok(await crawlAction.execute(ctx)).output as { pages: Array<{ text: string }> };
    expect(output.pages[0]?.text).toBe('About us');
  });

  it('fails with the reason when nothing could be read', async () => {
    const { ctx } = contextFor(
      { ...crawlAction.defaults(), url: 'https://site.test/gone', maxDepth: 0 },
      { fetch: answering(site) },
    );
    await expect(crawlAction.execute(ctx)).rejects.toThrow(/HTTP 404/);
  });
});

describe('creating a document', () => {
  it('takes the type, title and fields of a written document, its own settings winning', async () => {
    let saved: Record<string, unknown> = {};
    const written = {
      typeId: 'type-page',
      locale: null,
      title: 'TypeScript 6',
      fields: { intro: '<p>New</p>', teaser: 'from the model' },
    };
    const { ctx } = contextFor(
      {
        ...contentCreateAction.defaults(),
        from: '{{ nodes.write }}',
        title: '',
        fields: [{ name: 'teaser', value: 'mine' }],
      } as ContentConfig,
      { nodes: { write: written } },
    );
    (ctx.services as { content: unknown }).content = {
      create: async (input: Record<string, unknown>) => {
        saved = input;
        return { id: 'd1', title: input.title, slug: '', status: 'draft', typeId: '', locale: '' };
      },
    };

    await contentCreateAction.execute(ctx);
    expect(saved).toMatchObject({
      typeId: 'type-page',
      title: 'TypeScript 6',
      fields: { intro: '<p>New</p>', teaser: 'mine' },
    });
  });

  it('needs a type only when nothing brings one', () => {
    const problems: string[] = [];
    const add = (key: string) => problems.push(key);
    contentCreateAction.validate?.({ ...contentCreateAction.defaults() }, (...rest) => rest, add);
    expect(problems).toEqual(['plugins.workflows.node.content.typeRequired']);
    problems.length = 0;
    contentCreateAction.validate?.(
      { ...contentCreateAction.defaults(), from: '{{ nodes.write }}' },
      (...rest) => rest,
      add,
    );
    expect(problems).toEqual([]);
  });
});
