import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManabloxError, type RequestServed, usagePeriod } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import {
  bootstrap,
  createApp,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '@manablox/server';
import { withControls } from '@manablox/services/testing';
import type { DesignNode } from '@manablox/site';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type SiteFormForwarder,
  type SiteFormForwardResult,
  type SitePageOptions,
  type SiteRenderer,
  type WebsitePluginOptions,
  websiteMode,
  websitePlugin,
} from '../../src/index.js';
import { httpFormForwarder } from '../../src/server/mode/site-forms.js';
import { type SiteFormSubmission, signSiteFormType } from '../../src/server/services/site/forms.js';
import { websiteOf } from '../helpers/runtime.js';

const FORMS_SECRET = 'forms-secret-0123456789abcdef';
const AUTH_SECRET = 'site-forms-auth-secret';

let db: TestDatabase;
let dir: string;
let site: Runtime;
let api: ManagementRuntime;
let siteApp: Hono;
let apiApp: Hono;
let spaceId: string;
let contactTypeId: string;
let thanksId: string;

/** What the stub forwarder was handed, and what it answers next. */
const forwarded: SiteFormSubmission[] = [];
let answer: SiteFormForwardResult = { ok: true };
const stubForwarder: SiteFormForwarder = async (submission) => {
  forwarded.push(submission);
  return answer;
};

const pageOptions: Array<SitePageOptions | undefined> = [];
const renderer: SiteRenderer = {
  renderPage: async (input, options) => {
    pageOptions.push(options);
    return { html: `<!doctype html><title>${input.document?.title ?? ''}</title>`, status: 200 };
  },
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
};

const SITE = { forms: { secret: FORMS_SECRET, rateLimit: { window: 60_000, max: 3 } } };

/** The site runtime's app with its own renderer and forwarder. */
const websiteApp = (options: WebsitePluginOptions) =>
  createApp(site, { mode: websiteMode({ ...SITE, ...options }) });

const config = (dialectDir: string) => ({
  database: { url: db.url },
  auth: { secret: AUTH_SECRET },
  fieldTypes: builtinFieldTypes,
  contentTypes: [
    { name: 'page', fields: [{ name: 'summary', type: 'string' }] },
    {
      name: 'contact',
      kind: 'data' as const,
      fields: [
        { name: 'name', type: 'string', required: true, settings: { max: 50 } },
        { name: 'email', type: 'string' },
        { name: 'message', type: 'string', settings: { editor: 'textarea' } },
        { name: 'age', type: 'number', settings: { integer: true } },
        { name: 'subscribe', type: 'boolean' },
        {
          name: 'topic',
          type: 'select',
          settings: { options: [{ value: 'sales' }, { value: 'support' }] },
        },
        { name: 'internal', type: 'string', writeRoles: ['admin'] },
      ],
    },
  ],
  logLevel: 'silent',
  cache: { enabled: true, ttl: 300 },
  storage: { driver: 'local' as const, local: { path: join(dialectDir, 'files') } },
});

const fieldId = (name: string) => {
  const field = api.manablox.contentTypes.getByName('contact').fields.find((f) => f.name === name);
  if (!field) throw new Error(name);
  return field.id;
};

const formNode = (id: string, props: Record<string, unknown> = {}): DesignNode => ({
  id,
  el: 'form',
  props: { databagTypeId: contactTypeId, ...props },
  children: [
    ...['name', 'email', 'message', 'age', 'subscribe', 'topic', 'internal'].map((name) => ({
      id: `${id}-${name}`,
      el: 'formField' as const,
      props: { fieldId: fieldId(name) },
    })),
    { id: `${id}-submit`, el: 'formSubmit' },
    { id: `${id}-status`, el: 'formMessage' },
  ],
});

let ipSeq = 0;
/** A client IP of its own, so rate limits do not leak between tests. */
const freshIp = () => `203.0.113.${++ipSeq}`;

const post = (
  path: string,
  fields: Record<string, string | string[]>,
  options: { json?: boolean; ip?: string; headers?: Record<string, string>; app?: Hono } = {},
) => {
  const body = new URLSearchParams();
  const all = { _mb_page: '/about', _mb_locale: 'en', _mb_hp: '', _mb_elapsed: '5000', ...fields };
  for (const [name, value] of Object.entries(all)) {
    for (const entry of Array.isArray(value) ? value : [value]) body.append(name, entry);
  }
  return (options.app ?? siteApp).request(
    new Request(`http://site.test${path}`, {
      method: 'POST',
      body: body.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': options.ip ?? freshIp(),
        ...(options.json === false ? {} : { accept: 'application/json' }),
        ...options.headers,
      },
    }),
  );
};

const CONTACT = '/_manablox/forms/page/PAGE/contact';
const contactPath = () => CONTACT.replace('PAGE', pageTypeId());
const pageTypeId = () => api.manablox.contentTypes.getByName('page').id;

beforeAll(async () => {
  db = await createTestDatabase('server_site_forms', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-site-forms-'));
  api = requireManagement(
    await bootstrap({
      ...config(dir),
      server: { rateLimit: false },
      plugins: [websitePlugin({ forms: { secret: FORMS_SECRET } })],
    }),
  );
  site = await bootstrap({
    ...config(dir),
    server: { mode: 'website', rateLimit: false },
    plugins: [websitePlugin({ ...SITE, renderer, forwarder: stubForwarder })],
  });
  apiApp = await createApp(api);
  siteApp = await createApp(site);
  contactTypeId = api.manablox.contentTypes.getByName('contact').id;

  const space = await api.repos.spaces.create({
    name: 'Forms',
    machineName: 'forms',
    url: 'http://unused.test',
    defaultLocale: 'en',
    locales: ['en', 'de'],
  });
  spaceId = space.id;
  await websiteOf(api).settings.set(spaceId, { mode: 'designed' });
  await websiteOf(api).domains.create(spaceId, { hostname: 'site.test' });

  const pageType = pageTypeId();
  for (const [title, slug] of [
    ['About', 'about'],
    ['Thanks', 'thanks'],
  ] as const) {
    const row = await api.content.create({ spaceId, typeId: pageType, title, slug, fields: {} });
    const published = await api.content.publish(spaceId, row.id);
    if (slug === 'thanks') thanksId = published.id;
  }

  const row = await websiteOf(api).designs.saveDraft(spaceId, {
    kind: 'page',
    key: pageType,
    draft: {
      root: {
        id: 'root',
        el: 'stack',
        children: [
          formNode('contact'),
          formNode('consenting', { consent: true, redirectContentId: thanksId }),
          {
            id: 'picked',
            el: 'form',
            bind: { field: 'summary' },
            children: [
              { id: 'picked-input', el: 'formField' },
              { id: 'picked-submit', el: 'formSubmit' },
            ],
          },
          { id: 'intro', el: 'text', props: { text: { en: 'Hi' } } },
        ],
      },
    },
  });
  await websiteOf(api).designs.publish(spaceId, row.id);
}, 60_000);

afterAll(async () => {
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('site form endpoint', () => {
  it('forwards a valid submission with typed values', async () => {
    forwarded.length = 0;
    const response = await post(contactPath(), {
      name: 'Ada',
      email: 'ada@example.test',
      age: '36',
      subscribe: 'true',
      topic: 'support',
      internal: 'sneaky',
      unknown: 'dropped',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true });
    expect(forwarded).toHaveLength(1);
    const [sent] = forwarded as [SiteFormSubmission];
    expect(sent).toMatchObject({
      spaceId,
      databagTypeId: contactTypeId,
      locale: 'en',
      page: '/about',
      origin: 'site.test',
      form: `page:${pageTypeId()}:contact`,
    });
    expect(sent.values).toEqual({
      name: 'Ada',
      email: 'ada@example.test',
      message: null,
      age: 36,
      subscribe: true,
      topic: 'support',
    });
    expect(sent.ipHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('redirects back without JavaScript and shows the result on the page', async () => {
    const response = await post(contactPath(), { name: 'Ada' }, { json: false });
    expect(response.status).toBe(303);
    const location = response.headers.get('location') as string;
    expect(location).toMatch(/^\/about\?_mb_form=[\w-]+\.[\w-]+$/);

    pageOptions.length = 0;
    const page = await siteApp.request(new Request(`http://site.test${location}`));
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(pageOptions.at(-1)?.formResult).toEqual({
      form: `page:${pageTypeId()}:contact`,
      ok: true,
    });

    // A forged result is ignored and the page renders as usual.
    await site.cache.clear();
    await siteApp.request(new Request('http://site.test/about?_mb_form=abc.def'));
    expect(pageOptions.at(-1)?.formResult).toBeUndefined();

    // The real renderer shows the success message in the form.
    const real = await websiteApp({ forwarder: stubForwarder });
    const html = await (await real.request(new Request(`http://site.test${location}`))).text();
    expect(html).toMatch(/data-state="success"[^>]*>Thank you!</);
    const plain = await (await real.request(new Request('http://site.test/about'))).text();
    expect(plain).not.toContain('data-state="success"');
  }, 60_000);

  it('pretends a honeypot submission went through and drops it', async () => {
    forwarded.length = 0;
    const response = await post(contactPath(), { name: 'Bot', _mb_hp: 'http://spam.test' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(forwarded).toHaveLength(0);
  });

  it('refuses a form sent too fast', async () => {
    forwarded.length = 0;
    const fast = await post(contactPath(), { name: 'Ada', _mb_elapsed: '400' });
    expect(fast.status).toBe(400);
    expect((await fast.json()).ok).toBe(false);

    // Without the island's count the render time decides.
    const now = String(Date.now());
    const byTs = await post(contactPath(), { name: 'Ada', _mb_elapsed: [], _mb_ts: now });
    expect(byTs.status).toBe(400);
    const old = String(Date.now() - 10_000);
    const slow = await post(contactPath(), { name: 'Ada', _mb_elapsed: [], _mb_ts: old });
    expect(slow.status).toBe(200);
    const none = await post(contactPath(), { name: 'Ada', _mb_elapsed: [] });
    expect(none.status).toBe(400);
    expect(forwarded).toHaveLength(1);

    // Without JavaScript it redirects back with a failed result.
    const back = await post(contactPath(), { name: 'Ada', _mb_elapsed: '1' }, { json: false });
    expect(back.status).toBe(303);
  });

  it('limits submissions per IP', async () => {
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      expect((await post(contactPath(), { name: 'Ada' }, { ip })).status).toBe(200);
    }
    const limited = await post(contactPath(), { name: 'Ada' }, { ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await post(contactPath(), { name: 'Ada' })).status).toBe(200);
  });

  it('reports invalid values by field name', async () => {
    forwarded.length = 0;
    const response = await post(contactPath(), {
      name: '',
      age: 'many',
      topic: 'other',
      email: 'x'.repeat(20_000),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(Object.keys(body.errors).sort()).toEqual(['age', 'email', 'name', 'topic']);
    expect(forwarded).toHaveLength(0);

    const tooLong = await post(contactPath(), { name: 'x'.repeat(51) });
    expect(Object.keys((await tooLong.json()).errors)).toEqual(['name']);
  });

  it('carries field errors to the page after a post without JavaScript', async () => {
    const response = await post(
      contactPath(),
      { name: '', age: 'many', email: 'x'.repeat(20_000) },
      { json: false },
    );
    expect(response.status).toBe(303);
    const location = response.headers.get('location') as string;
    expect(location.length).toBeLessThan(4200);
    pageOptions.length = 0;
    await siteApp.request(new Request(`http://site.test${location}`));
    const result = pageOptions.at(-1)?.formResult;
    expect(result?.ok).toBe(false);
    expect(result?.message).toBeTruthy();
    expect(Object.keys(result?.errors ?? {}).sort()).toEqual(['age', 'email', 'name']);
  });

  it('only redirects back to a path of the same site', async () => {
    for (const page of ['/.//evil.test', '//evil.test', '/\\evil.test', 'https://evil.test/']) {
      const response = await post(contactPath(), { name: 'Ada', _mb_page: page }, { json: false });
      expect(response.headers.get('location'), page).toMatch(/^\/(?![/\\])/);
    }
  });

  it('requires consent when the form asks for it and answers with the redirect target', async () => {
    const path = CONTACT.replace('PAGE', pageTypeId()).replace('contact', 'consenting');
    const missing = await post(path, { name: 'Ada' });
    expect(missing.status).toBe(422);
    expect(Object.keys((await missing.json()).errors)).toEqual(['_mb_consent']);

    const given = await post(path, { name: 'Ada', _mb_consent: 'true' });
    expect(await given.json()).toEqual({ ok: true, redirect: '/thanks' });
    const plain = await post(path, { name: 'Ada', _mb_consent: 'true' }, { json: false });
    expect(plain.status).toBe(303);
    expect(plain.headers.get('location')).toBe('/thanks');
  });

  it('passes on field errors from the management API', async () => {
    answer = { ok: false, status: 422, errors: { email: 'Please check this value.' } };
    try {
      const response = await post(contactPath(), { name: 'Ada' });
      expect(response.status).toBe(422);
      expect((await response.json()).errors).toEqual({ email: 'Please check this value.' });
      answer = { ok: false, status: 500 };
      expect((await post(contactPath(), { name: 'Ada' })).status).toBe(502);
    } finally {
      answer = { ok: true };
    }
  });

  it('answers 404 for anything that is not a published form', async () => {
    const type = pageTypeId();
    for (const path of [
      `/_manablox/forms/page/${type}/intro`,
      `/_manablox/forms/page/${type}/missing`,
      `/_manablox/forms/menu/main/contact`,
      `/_manablox/forms/block/${type}/contact`,
    ]) {
      expect((await post(path, { name: 'Ada' })).status, path).toBe(404);
    }
    const unknownHost = await siteApp.request(
      new Request(`http://nobody.test${contactPath()}`, { method: 'POST' }),
    );
    expect(unknownHost.status).toBe(404);
  });

  it('refuses cross-origin posts, other encodings and oversized bodies', async () => {
    const foreign = await post(
      contactPath(),
      { name: 'Ada' },
      {
        headers: { origin: 'https://evil.test' },
      },
    );
    expect(foreign.status).toBe(403);
    const same = await post(
      contactPath(),
      { name: 'Ada' },
      {
        headers: { origin: 'http://site.test' },
      },
    );
    expect(same.status).toBe(200);

    const multipart = await siteApp.request(
      new Request(`http://site.test${contactPath()}`, {
        method: 'POST',
        body: new FormData(),
        headers: { accept: 'application/json' },
      }),
    );
    expect(multipart.status).toBe(415);
    const huge = await post(contactPath(), { name: 'Ada', padding: 'x'.repeat(70_000) });
    expect(huge.status).toBe(413);

    // A body without a length is cut off while it streams in.
    const chunk = new TextEncoder().encode(`padding=${'x'.repeat(16_000)}`);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent++;
        if (sent > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const streamed = await siteApp.request(
      new Request(`http://site.test${contactPath()}`, {
        method: 'POST',
        body: stream,
        duplex: 'half',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'transfer-encoding': 'chunked',
          accept: 'application/json',
        },
      } as RequestInit),
    );
    expect(streamed.status).toBe(413);
    expect(sent).toBeLessThan(100);
  });

  it('takes the databag type of a bound form from the token signed at render', async () => {
    const ref = `page:${pageTypeId()}:picked`;
    const path = `/_manablox/forms/page/${pageTypeId()}/picked`;
    const values = { name: 'Ada', age: '36', internal: 'sneaky' };

    // Unsigned, forged or signed for another form: not a form.
    expect((await post(path, values)).status).toBe(404);
    expect((await post(path, { ...values, _mb_databag: `${contactTypeId}.forged` })).status).toBe(
      404,
    );
    const other = signSiteFormType(AUTH_SECRET, `page:${pageTypeId()}:contact`, contactTypeId);
    expect((await post(path, { ...values, _mb_databag: other })).status).toBe(404);

    forwarded.length = 0;
    const token = signSiteFormType(AUTH_SECRET, ref, contactTypeId);
    const response = await post(path, { ...values, _mb_databag: token });
    expect(response.status).toBe(200);
    const [sent] = forwarded as [SiteFormSubmission];
    expect(sent).toMatchObject({ databagTypeId: contactTypeId, form: `${ref}@${contactTypeId}` });
    // Every fillable field is asked for; role-gated ones are not.
    expect(sent.values).toEqual({
      name: 'Ada',
      email: null,
      message: null,
      age: 36,
      subscribe: false,
      topic: null,
    });

    // Pages render with the signer.
    await site.cache.clear();
    pageOptions.length = 0;
    await siteApp.request(new Request('http://site.test/about'));
    expect(pageOptions.at(-1)?.formToken?.(ref, contactTypeId)).toBe(token);
  });

  it('reports served site pages through request:served, cached ones marked', async () => {
    await site.cache.clear();
    const seen: RequestServed[] = [];
    const off = site.manablox.hooks.on('request:served', (payload) => {
      seen.push(payload);
    });
    try {
      const first = await siteApp.request(new Request('http://site.test/about'));
      const body = await first.arrayBuffer();
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({
        surface: 'website',
        spaceId,
        status: 200,
        bytes: body.byteLength,
        cached: false,
      });

      await (await siteApp.request(new Request('http://site.test/about'))).arrayBuffer();
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      expect(seen[1]).toMatchObject({ surface: 'website', spaceId, cached: true });

      await (await siteApp.request(new Request('http://unknown.test/about'))).arrayBuffer();
      await vi.waitFor(() => expect(seen).toHaveLength(3));
      expect(seen[2]).toMatchObject({ surface: 'website', spaceId: null, status: 404 });
    } finally {
      off();
    }
  });

  it('answers 503 while forms are not configured', async () => {
    const off = await websiteApp({ renderer, forwarder: null });
    const response = await post(contactPath(), { name: 'Ada' }, { app: off });
    expect(response.status).toBe(503);
    expect((await response.json()).message).toContain('not available');
  });
});

describe('internal form route', () => {
  const submission = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    spaceId,
    databagTypeId: contactTypeId,
    values,
    locale: 'de',
    page: '/about',
    origin: 'site.test',
    form: `page:${pageTypeId()}:contact`,
    ipHash: 'abcdef0123456789',
    ...extra,
  });
  const submit = (
    body: unknown,
    secret: string | null = FORMS_SECRET,
    space = (body as { spaceId?: string }).spaceId,
  ) =>
    apiApp.request(
      new Request('http://api.test/plugins/website/forms/submit', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          ...(space ? { 'x-manablox-space': space } : {}),
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
      }),
    );

  it('refuses calls without the shared secret', async () => {
    expect((await submit(submission({ name: 'Ada' }), null)).status).toBe(401);
    expect((await submit(submission({ name: 'Ada' }), 'wrong-secret-0123456789')).status).toBe(401);
  });

  it('creates the record as the site form actor, firing content hooks', async () => {
    const created: string[] = [];
    const off = api.manablox.hooks.on('content:afterCreate', (row) => {
      if (row.typeId === contactTypeId) created.push(row.id);
    });
    try {
      const response = await submit(
        submission({ name: 'Grace\nHopper', email: 'grace@example.test', internal: 'x' }),
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      await vi.waitFor(() => expect(created).toContain(id));

      const row = await api.content.get(spaceId, id);
      if (!row) throw new Error('record missing');
      expect(row.title).toBe('Grace');
      expect(row.locale).toBe('de');
      expect(row.fields.email).toBe('grace@example.test');
      expect(row.fields.internal).not.toBe('x');

      await vi.waitFor(async () => {
        const audit = await api.repos.audit.pageByTarget({ kind: 'content', id });
        const entry = audit.items.find((item) => item.action === 'content.create');
        expect(entry?.actorKind).toBe('system');
        expect(entry?.actorLabel).toBe('Site form');
        expect(entry?.actorDetail).toMatchObject({ origin: 'site.test', page: '/about' });
      });
    } finally {
      off();
    }
  });

  it('lets form:beforeSubmit refuse a submission before any record is made', async () => {
    const seen: unknown[] = [];
    const created: string[] = [];
    const offRefuse = api.manablox.hooks.on('website:beforeFormSubmit', (payload) => {
      seen.push(payload);
      throw ManabloxError.forbidden('auth.forbidden');
    });
    const offCreated = api.manablox.hooks.on('content:afterCreate', (row) => {
      created.push(row.id);
    });
    try {
      const response = await submit(submission({ name: 'Refused' }));
      expect(response.status).toBe(403);
    } finally {
      offRefuse();
      offCreated();
    }
    expect(seen).toEqual([
      {
        spaceId,
        databagTypeId: contactTypeId,
        form: `page:${pageTypeId()}:contact`,
        locale: 'de',
        page: '/about',
      },
    ]);
    expect(created).toEqual([]);
  });

  it('answers field errors from validation', async () => {
    const response = await submit(submission({ email: 'ada@example.test' }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      errors: { name: 'This field is required.' },
    });
  });

  it('refuses types that are not data types and malformed payloads', async () => {
    const page = await submit(submission({ name: 'Ada' }, { databagTypeId: pageTypeId() }));
    expect(page.status).toBe(404);
    expect((await submit({ spaceId: 'nope' })).status).toBe(400);
    expect((await submit(submission({ name: 'Ada' }, { spaceId: 'not-a-uuid' }))).status).toBe(400);
    // The space header must name the submission's space.
    const other = '00000000-0000-4000-8000-000000000000';
    expect((await submit(submission({ name: 'Ada' }), FORMS_SECRET, other)).status).toBe(400);
  });

  it('runs the create hooks for the record, as automations listen to them', async () => {
    const created: Array<{ typeId: string; name: unknown }> = [];
    const off = api.manablox.hooks.on('content:afterCreate', (record) => {
      created.push({ typeId: record.typeId, name: record.fields.name });
    });
    try {
      const response = await submit(submission({ name: 'Lin' }));
      expect(response.status).toBe(201);
      await vi.waitFor(() =>
        expect(created).toContainEqual({ typeId: contactTypeId, name: 'Lin' }),
      );
    } finally {
      off();
    }
  });
});

describe('site to management, in process', () => {
  it('turns a site form post into a record', async () => {
    const forwarder = httpFormForwarder({
      apiUrl: 'http://api.internal/',
      secret: FORMS_SECRET,
      fetch: async (input, init) => apiApp.request(String(input), init),
    });
    const wired = await websiteApp({ renderer, forwarder });
    const response = await post(
      contactPath(),
      { name: 'End to end', topic: 'sales', subscribe: 'on' },
      { app: wired },
    );
    expect(response.status).toBe(200);
    const page = await api.content.list(
      { spaceId, typeIds: [contactTypeId] },
      { limit: 100, offset: 0 },
    );
    const row = page.items.find((item) => item.title === 'End to end');
    expect(row?.fields).toMatchObject({ topic: 'sales', subscribe: true });

    // Required on the type but not checked by the site: the API's answer reaches the visitor.
    const invalid = await post(contactPath(), { name: 'x', age: '1.5' }, { app: wired });
    expect(invalid.status).toBe(422);
    expect(Object.keys((await invalid.json()).errors)).toEqual(['age']);

    const wrongSecret = httpFormForwarder({
      apiUrl: 'http://api.internal',
      secret: 'another-secret-0123456789',
      fetch: async (input, init) => apiApp.request(String(input), init),
    });
    const refused = await websiteApp({ renderer, forwarder: wrongSecret });
    expect((await post(contactPath(), { name: 'Ada' }, { app: refused })).status).toBe(502);
  });
});

describe('usage limits', () => {
  it('answers a friendly "form unavailable" while formSubmissions is used up', async () => {
    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceId },
      values: { 'usage.plugins.website.formSubmissions': { max: 1, mode: 'hard' } },
    });
    const key = {
      scope: { kind: 'space' as const, id: spaceId },
      metric: 'plugins.website.formSubmissions',
      period: usagePeriod(new Date()).label,
    };
    const before = await api.repos.usageCounters.get(key);
    await api.repos.usageCounters.set(key, 1);
    site.controlStore.forget(null);
    await site.controlStore.usageState?.evaluate();
    forwarded.length = 0;
    try {
      const response = await post(contactPath(), { name: 'Ada' });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        message: 'This form is unavailable right now. Please try again later.',
      });
      const back = await post(contactPath(), { name: 'Ada' }, { json: false });
      expect(back.status).toBe(303);
      expect(forwarded).toEqual([]);
    } finally {
      await restore();
      await api.repos.usageCounters.set(key, before);
      site.controlStore.forget(null);
      await site.controlStore.usageState?.evaluate();
    }
    expect((await post(contactPath(), { name: 'Ada' })).status).toBe(200);
  });

  it('shows the same message when the management API refuses for usage', async () => {
    answer = { ok: false, status: 429 };
    try {
      const response = await post(contactPath(), { name: 'Ada' });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, message: /unavailable/ });
    } finally {
      answer = { ok: true };
    }
  });
});

describe('state', () => {
  it('answers a friendly "form unavailable" while the space is read-only', async () => {
    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceId },
      values: { state: { status: 'readOnly' } },
    });
    site.controlStore.forget(null);
    forwarded.length = 0;
    try {
      const response = await post(contactPath(), { name: 'Ada' });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, message: /unavailable/ });
      expect(forwarded).toEqual([]);
    } finally {
      await restore();
      site.controlStore.forget(null);
    }
    expect((await post(contactPath(), { name: 'Ada' })).status).toBe(200);
  });
});
