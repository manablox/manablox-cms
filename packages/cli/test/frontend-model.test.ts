import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { nameTypes } from '../src/frontend/components/codegen-common.js';
import {
  createFrontend,
  defaultFrontendOptions,
  type Framework,
  renderFrontendFiles,
} from '../src/frontend/index.js';
import {
  expandFor,
  type ManagementContentType,
  modelFromDelivery,
  modelFromManagement,
  parseTypes,
  type RenderModel,
  selectTypes,
} from '../src/frontend/model.js';
import { modelRequestFromArgs } from '../src/frontend/options.js';
import { file } from './helpers/files.js';
import { scriptedPrompter } from './helpers/scripted-prompter.js';
import { tempDirs } from './helpers/temp-dir.js';

const FRAMEWORKS = ['plain', 'astro', 'react-ssr', 'vue-ssr'] as const;

const SPACE = { id: ids.space, name: 'Site', machineName: 'site' };
const OTHER = { id: ids.otherSpace, name: 'Blog', machineName: 'blog' };

/** A space's types as the management API lists them. */
const DEFINITIONS: ManagementContentType[] = [
  {
    name: 'article',
    label: 'Article',
    kind: 'content',
    fields: [
      { name: 'summary', label: 'Summary', type: 'string' },
      { name: 'hero', label: 'Hero image', type: 'asset' },
      { name: 'published_on', type: 'date' },
      { name: 'body', label: 'Body', type: 'richtext' },
      { name: 'related', label: 'Related', type: 'content', settings: { multiple: true } },
      { name: 'components', label: 'Components', type: 'blocks', settings: { types: [] } },
      { name: 'cta', label: 'Call to action', type: 'link' },
      { name: 'internal_note', label: 'Note', type: 'string', readRoles: ['editor'] },
      { name: 'location', label: 'Location', type: 'geo-point' },
    ],
  },
  {
    name: 'landing_page',
    label: 'Landing page',
    kind: 'content',
    fields: [{ name: 'sections', label: 'Sections', type: 'template' }],
  },
  {
    name: 'teaser',
    label: 'Teaser',
    kind: 'block',
    fields: [
      { name: 'headline', label: 'Headline', type: 'string' },
      { name: 'image', label: 'Image', type: 'asset' },
      { name: 'tags', label: 'Tags', type: 'select', settings: { multiple: true } },
      { name: 'feature', label: 'Feature', type: 'block' },
      {
        name: 'faq',
        label: 'FAQ',
        type: 'repeater',
        settings: {
          fields: [
            { name: 'question', type: 'string' },
            { name: 'icon', type: 'asset' },
          ],
        },
      },
    ],
  },
  { name: 'folder', label: 'Folder', kind: 'content', isSystem: true, fields: [] },
  {
    name: 'template',
    label: 'Template',
    kind: 'content',
    isSystem: true,
    fields: [{ name: 'blocks', type: 'blocks' }],
  },
];

const tempDir = tempDirs('manablox-frontend-model-');

function silent(): PassThrough {
  const out = new PassThrough();
  out.resume();
  return out;
}

function render(framework: Framework, model: RenderModel = modelFromManagement(DEFINITIONS)) {
  return renderFrontendFiles({
    ...defaultFrontendOptions('/tmp/my-site', framework, '0.6.0'),
    model,
  });
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Both APIs from fixtures; with `key`, other keys are refused so a retry can be scripted. */
function fakeApi(options: { spaces?: (typeof SPACE)[]; key?: string } = {}) {
  const calls: Call[] = [];
  const spaces = options.spaces ?? [SPACE];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });

    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/v1/types') && !url.includes('/api/')) {
      return json({
        types: [
          {
            name: 'page',
            label: 'Page',
            kind: 'content',
            fields: [
              { name: 'summary', type: 'string', required: false, list: false, kind: 'scalar' },
              {
                name: 'components',
                type: 'blocks',
                required: false,
                list: true,
                kind: 'block',
                blockTypes: ['hero'],
              },
            ],
          },
          {
            name: 'hero',
            label: 'Hero',
            kind: 'block',
            fields: [
              { name: 'title', type: 'string', required: true, list: false, kind: 'scalar' },
              {
                name: 'picture',
                type: 'asset',
                required: false,
                list: false,
                kind: 'ref',
                target: 'asset',
              },
            ],
          },
        ],
      });
    }
    if (options.key && headers['x-api-key'] !== options.key) return json({}, 401);
    if (url.endsWith('/api/v1/spaces/list')) return json(spaces);
    if (url.endsWith('/api/v1/contentTypes/list')) return json(DEFINITIONS);
    return json({}, 404);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe('manablox frontend: the content model', () => {
  it('reads the management definitions into what a component needs', () => {
    const model = modelFromManagement(DEFINITIONS);

    // Content types first, then blocks; neither of the two system types.
    expect(model.types.map((type) => `${type.kind}:${type.name}`)).toEqual([
      'content:article',
      'content:landing_page',
      'block:teaser',
    ]);

    const article = model.types[0];
    const renders = Object.fromEntries(
      (article?.fields ?? []).map((field) => [field.name, field.render]),
    );
    expect(renders).toEqual({
      summary: 'text',
      hero: 'asset',
      published_on: 'date',
      body: 'richtext',
      related: 'content',
      components: 'blocks',
      cta: 'link',
      // A plugin's field type shows what it holds rather than nothing.
      location: 'json',
    });
    // Role-gated fields never reach a delivery surface, so no component waits for one.
    expect(renders).not.toHaveProperty('internal_note');
    // A field without a label gets one from its name.
    expect(article?.fields.find((field) => field.name === 'published_on')?.label).toBe(
      'Published on',
    );

    const teaser = model.types.find((type) => type.name === 'teaser');
    expect(teaser?.fields.find((field) => field.name === 'tags')).toMatchObject({
      render: 'text',
      list: true,
    });
    // A template field delivers blocks where it sits.
    expect(model.types[1]?.fields[0]?.render).toBe('blocks');
    // A repeater carries its sub-fields.
    expect(teaser?.fields.find((field) => field.name === 'faq')).toMatchObject({
      render: 'items',
      list: false,
      fields: [
        { name: 'question', label: 'Question', render: 'text' },
        { name: 'icon', label: 'Icon', render: 'asset' },
      ],
    });
  });

  it('reads the delivery description the same way', () => {
    const model = modelFromDelivery([
      {
        name: 'event',
        label: 'Event',
        kind: 'content',
        fields: [
          {
            name: 'starts',
            type: 'date',
            required: false,
            list: false,
            kind: 'scalar',
            scalar: 'DateTime',
          },
          {
            name: 'venue',
            type: 'venue-ref',
            required: false,
            list: false,
            kind: 'ref',
            target: 'content',
          },
          {
            name: 'meta',
            type: 'json-blob',
            required: false,
            list: false,
            kind: 'scalar',
            scalar: 'JSON',
          },
          { name: 'rows', type: 'blocks', required: false, list: true, kind: 'block' },
          {
            name: 'steps',
            type: 'steps-plugin',
            required: false,
            list: true,
            kind: 'items',
            fields: [
              {
                name: 'label',
                type: 'string',
                required: false,
                list: false,
                kind: 'scalar',
                scalar: 'String',
              },
            ],
          },
        ],
      },
      { name: 'folder', label: 'Folder', kind: 'content', fields: [] },
    ]);
    expect(model.types.map((type) => type.name)).toEqual(['event']);
    expect(model.types[0]?.fields.map((field) => [field.name, field.render, field.list])).toEqual([
      ['starts', 'date', false],
      ['venue', 'content', false],
      ['meta', 'json', false],
      ['rows', 'blocks', false],
      ['steps', 'items', false],
    ]);
    expect(model.types[0]?.fields[4]?.fields).toEqual([
      { name: 'label', label: 'Label', render: 'text', list: false },
    ]);
  });

  it('picks types by name, and names the ones that do not exist', () => {
    const model = modelFromManagement(DEFINITIONS);
    expect(selectTypes(model, ['teaser']).types.map((type) => type.name)).toEqual(['teaser']);
    expect(selectTypes(model, 'all')).toBe(model);
    expect(() => selectTypes(model, ['teaser', 'banner'])).toThrow(
      /no type 'banner'; it has article, landing_page, teaser/,
    );
    expect(parseTypes('all')).toBe('all');
    expect(parseTypes(' article, teaser ')).toEqual(['article', 'teaser']);
    expect(() => parseTypes(',')).toThrow(/--types/);
  });

  it('expands every relation a component shows, and nothing else', () => {
    expect(expandFor(modelFromManagement(DEFINITIONS))).toEqual(['hero', 'image', 'related']);
  });

  it('infers where the model comes from when --model is not given', () => {
    expect(modelRequestFromArgs({})).toEqual({});
    expect(modelRequestFromArgs({ 'api-key': 'k' }).source).toBe('management');
    expect(modelRequestFromArgs({ space: 'site' }).source).toBe('management');
    expect(modelRequestFromArgs({ types: 'all' }).source).toBe('delivery');
    expect(modelRequestFromArgs({ model: 'none', 'api-key': 'k' }).source).toBe('none');
    expect(() => modelRequestFromArgs({ model: 'graphql' })).toThrow(/--model must be one of/);
    expect(() => modelRequestFromArgs({ 'api-url': 'nope' })).toThrow(/--api-url/);
  });
});

describe('manablox frontend: components from a content model', () => {
  it('names components with the SDK rule', () => {
    const type = (name: string) => ({ name, label: name, kind: 'block' as const, fields: [] });
    const { blocks } = nameTypes({ types: [type('hero.banner'), type('2col')] });
    expect(blocks.map((block) => [block.component, block.file])).toEqual([
      ['HeroBannerBlock', 'hero-banner'],
      ['T2colBlock', 't2col'],
    ]);
  });

  it('writes one component per type, and the registries that find them', () => {
    const expected: Record<Framework, string[]> = {
      plain: ['src/blocks/teaser.ts', 'src/content/article.ts', 'src/content/landing-page.ts'],
      astro: [
        'src/components/blocks/TeaserBlock.astro',
        'src/components/content/ArticleContent.astro',
        'src/components/content/LandingPageContent.astro',
        // The preview canvas runs in the browser, where `.astro` components cannot.
        'src/lib/preview/blocks/teaser.ts',
        'src/lib/preview/content/article.ts',
      ],
      'react-ssr': [
        'src/components/blocks/TeaserBlock.tsx',
        'src/components/content/ArticleContent.tsx',
      ],
      'vue-ssr': [
        'src/components/blocks/TeaserBlock.vue',
        'src/components/content/ArticleContent.vue',
      ],
    };

    for (const framework of FRAMEWORKS) {
      const files = render(framework);
      const paths = files.map((entry) => entry.path);
      for (const path of expected[framework]) expect(paths, framework).toContain(path);
      // The example teaser gives way to the model's own blocks.
      expect(
        paths.some((path) => /\/Teaser\.(astro|tsx|vue)$/.test(path)),
        framework,
      ).toBe(false);
      expect(new Set(paths).size, framework).toBe(paths.length);

      const contents = files.map((entry) => entry.content).join('\n');
      // Registered by the name a delivered document or block carries as its type.
      expect(contents, framework).toMatch(/teaser: (render)?TeaserBlock,/);
      expect(contents, framework).toMatch(/article: (render)?ArticleContent,/);
      expect(contents, framework).toMatch(/landing_page: (render)?LandingPageContent,/);
      // The page asks for the relations the components show.
      expect(contents, framework).toContain("expand: ['hero', 'image', 'related']");
      // Rich text goes through the escaping helper, never straight into the markup.
      expect(contents, framework).toContain('html(');
    }
  });

  it('leaves no placeholder unfilled and keeps the paths the editor clicks through', () => {
    for (const framework of FRAMEWORKS) {
      const files = render(framework);
      for (const entry of files) {
        const left = entry.content.match(/__(?!STATE__)[A-Z_]+__/g);
        expect(left, `${framework}/${entry.path}`).toBe(null);
      }
      const contents = files.map((entry) => entry.content).join('\n');
      // A block field's path continues from the block; a content field's starts at the root.
      expect(contents, framework).toContain("[...path, 'headline']");
      expect(contents, framework).toContain("['summary']");
      expect(contents, framework).toContain("['title']");
    }
  });

  it('renders each field by what it holds', () => {
    const vue = file(render('vue-ssr'), 'src/components/blocks/TeaserBlock.vue');
    // The first title-like text field is the heading.
    expect(vue).toContain('<h2 v-if="headline"');
    expect(vue).toContain('v-for="asset in image"');
    // A single block goes through the registry, like one entry of a list.
    expect(vue).toContain(':is="blockRenderers[feature.type]"');

    const react = file(render('react-ssr'), 'src/components/content/ArticleContent.tsx');
    expect(react).toContain('<time dateTime={publishedOn.iso}>');
    expect(react).toContain('<Blocks blocks={blocksOf(components)}');
    expect(react).toContain("path={['components']}");
    expect(react).toContain('related.map((entry)');
    expect(react).toContain("cta.newTab ? '_blank' : undefined");

    const astro = file(render('astro'), 'src/components/content/ArticleContent.astro');
    expect(astro).toContain('set:html={body}');
    expect(astro).toContain(
      "import { assets, date, documents, href, html, json, link, text } from '../../lib/fields';",
    );
    expect(astro).toContain('const location = json(fields.location);');

    const plain = file(render('plain'), 'src/content/landing-page.ts');
    expect(plain).toContain("renderBlocks(sections, ['sections'])");
  });

  it('loops a repeater, text sub-fields as text and the rest as JSON', () => {
    const vue = file(render('vue-ssr'), 'src/components/blocks/TeaserBlock.vue');
    expect(vue).toContain('const faq = computed(() => items(props.block.faq));');
    expect(vue).toContain('<li v-for="(item, index) in faq" :key="item.itemId">');
    expect(vue).toContain(
      `<p v-if="text(item.fields.question)" v-bind="fieldAttribute([...path, 'faq', index, 'question'])">`,
    );
    expect(vue).toContain('{{ json(item.fields.icon) }}');

    const react = file(render('react-ssr'), 'src/components/blocks/TeaserBlock.tsx');
    expect(react).toContain('{faq.map((item, index) => (');
    expect(react).toContain('<li key={item.itemId}>');
    expect(react).toContain("fieldAttribute([...path, 'faq', index, 'icon'])");

    const astro = file(render('astro'), 'src/components/blocks/TeaserBlock.astro');
    expect(astro).toContain('const faq = items(block.faq);');
    expect(astro).toContain('{text(item.fields.question) && <p');

    const plain = file(render('plain'), 'src/blocks/teaser.ts');
    expect(plain).toContain('...faq.map((item, index) =>');
    expect(plain).toMatch(/import \{[^}]*\bitems\b[^}]*\} from/);
    expect(file(render('plain'), 'src/fields.ts')).toContain('export function items(');
  });

  it('keeps generated code valid for awkward names', () => {
    const model = modelFromManagement([
      {
        name: '2col-grid',
        label: 'Two columns',
        kind: 'block',
        fields: [
          { name: 'class', type: 'string' },
          { name: 'hero-image', type: 'asset' },
          { name: 'path', type: 'string' },
        ],
      },
    ]);
    const react = file(render('react-ssr', model), 'src/components/blocks/T2colGridBlock.tsx');
    // A reserved word or a prop name is never a local; a name with a dash is read by key.
    expect(react).toContain('const classValue = text(block.class);');
    expect(react).toContain("const heroImage = assets(block['hero-image']);");
    expect(react).toContain('const pathValue = text(block.path);');
    expect(file(render('react-ssr', model), 'src/components/blocks/index.ts')).toContain(
      "'2col-grid': T2colGridBlock,",
    );
  });

  it('writes the example teaser when there is no model', () => {
    for (const framework of FRAMEWORKS) {
      const files = renderFrontendFiles(defaultFrontendOptions('/tmp/my-site', framework, '0.6.0'));
      const contents = files.map((entry) => entry.content).join('\n');
      expect(contents, framework).toContain("expand: ['image']");
      expect(contents, framework).toMatch(/teaser: (render)?Teaser,/);
      expect(
        files.some((entry) => entry.path.endsWith('fields.ts')),
        framework,
      ).toBe(false);
    }
  });
});

describe('manablox frontend: reading a live model', () => {
  it('reads a space from the management API without asking anything', async () => {
    const cwd = tempDir();
    const api = fakeApi({ spaces: [SPACE, OTHER], key: 'mbx_secret' });

    const code = await createFrontend(
      {
        framework: 'vue-ssr',
        'api-url': 'http://cms.test:3000/',
        'api-key': 'mbx_secret',
        space: 'site',
        types: 'article,teaser',
      },
      { 'no-install': true, 'no-git': true, yes: true },
      ['site'],
      { cwd, prompter: null, out: silent(), cliVersion: '0.6.0', fetch: api.fetch },
    );
    expect(code).toBe(0);

    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST http://cms.test:3000/api/v1/spaces/list',
      'POST http://cms.test:3000/api/v1/contentTypes/list',
    ]);
    expect(api.calls[0]?.headers['x-api-key']).toBe('mbx_secret');
    expect(api.calls[1]?.body).toEqual({ spaceId: SPACE.id });

    const dir = join(cwd, 'site');
    expect(readdirSync(join(dir, 'src/components/content')).sort()).toEqual([
      'ArticleContent.vue',
      'index.ts',
    ]);
    expect(readdirSync(join(dir, 'src/components/blocks')).sort()).toEqual([
      'TeaserBlock.vue',
      'index.ts',
    ]);
    // The space the components were written for is the one the site reads.
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(`MANABLOX_SPACE_ID=${SPACE.id}`);
  });

  it('reads the delivery API the site points at', async () => {
    const cwd = tempDir();
    const api = fakeApi();

    await createFrontend(
      { framework: 'astro', url: 'http://public.test', model: 'delivery' },
      { 'no-install': true, 'no-git': true, yes: true },
      ['site'],
      { cwd, prompter: null, out: silent(), cliVersion: '0.6.0', fetch: api.fetch },
    );

    expect(api.calls.map((call) => call.url)).toEqual(['http://public.test/v1/types']);
    const dir = join(cwd, 'site');
    const hero = readFileSync(join(dir, 'src/components/blocks/HeroBlock.astro'), 'utf8');
    expect(hero).toContain('const picture = assets(block.picture);');
    expect(readFileSync(join(dir, 'src/pages/[...slug].astro'), 'utf8')).toContain(
      "expand: ['picture']",
    );
  });

  it('says what is missing when nobody can be asked', async () => {
    const context = {
      cwd: tempDir(),
      prompter: null,
      out: silent(),
      cliVersion: '0.6.0',
      fetch: fakeApi({ spaces: [SPACE, OTHER] }).fetch,
    };
    const flags = { 'no-install': true, 'no-git': true, yes: true };

    await expect(createFrontend({ model: 'management' }, flags, ['a'], context)).rejects.toThrow(
      /--api-key is required/,
    );
    await expect(createFrontend({ 'api-key': 'k' }, flags, ['b'], context)).rejects.toThrow(
      /several spaces; pick one with --space: blog, site/,
    );
    await expect(
      createFrontend({ 'api-key': 'k', space: 'shop' }, flags, ['c'], context),
    ).rejects.toThrow(/--space 'shop' is not one of/);
    // Nothing is written before the model is settled.
    expect(readdirSync(context.cwd)).toEqual([]);
  });

  it('asks for the key, the space and the types, and tries again after a refusal', async () => {
    const api = fakeApi({ spaces: [SPACE, OTHER], key: 'right' });
    const prompter = scriptedPrompter([
      'vue-ssr', // framework
      'site', // folder
      '', // name
      '', // delivery url
      '', // editor origin
      'management',
      '', // management url, the default
      'wrong',
      'retry',
      'http://localhost:3000',
      'right',
      SPACE.id,
      'pick',
      'landing_page,teaser',
      '', // space id: the one picked
      '', // port
      'n',
      'n',
    ]);
    const cwd = tempDir();

    const code = await createFrontend({}, {}, [], {
      cwd,
      prompter,
      out: silent(),
      cliVersion: '0.6.0',
      fetch: api.fetch,
    });
    expect(code).toBe(0);
    expect(prompter.asked()).toContain('Which types should get a component?');

    const keys = api.calls.map((call) => call.headers['x-api-key']);
    expect(keys).toEqual(['wrong', 'right', 'right']);

    const dir = join(cwd, 'site');
    expect(readdirSync(join(dir, 'src/components/content')).sort()).toEqual([
      'LandingPageContent.vue',
      'index.ts',
    ]);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain(`MANABLOX_SPACE_ID=${SPACE.id}`);
  });

  it('offers every type at once', async () => {
    const api = fakeApi();
    const prompter = scriptedPrompter([
      'plain',
      'site',
      '',
      '',
      '',
      'management',
      '',
      'key',
      'all',
      '',
      '',
      'n',
      'n',
    ]);
    const cwd = tempDir();

    await createFrontend({}, {}, [], { cwd, prompter, out: silent(), fetch: api.fetch });

    // One space: nothing to pick.
    expect(prompter.asked()).not.toContain('Which space should the components be written for?');
    expect(readdirSync(join(cwd, 'site/src/content')).sort()).toEqual([
      'article.ts',
      'index.ts',
      'landing-page.ts',
      'render.ts',
    ]);
  });
});
