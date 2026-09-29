import { allPermissions } from '@manablox/core';
import { settingsSchemaOf } from '@manablox/fields';
import type { Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { managementRouter } from './plugin-rpc.js';

/**
 * `/llms.txt` and `/llms-full.txt`: the management API described for language models,
 * generated from the running instance so plugins are included. Public, like the OpenAPI doc.
 */
export function mountLlmsGuide(app: Hono, runtime: Runtime): void {
  let short: string | null = null;
  let full: string | null = null;
  const headers = { 'content-type': 'text/markdown; charset=utf-8' };

  app.get('/llms.txt', (c) => {
    short ??= llmsGuide(runtime, false);
    return c.body(short, 200, headers);
  });
  app.get('/llms-full.txt', (c) => {
    full ??= llmsGuide(runtime, true);
    return c.body(full, 200, headers);
  });
}

function llmsGuide(runtime: Runtime, complete: boolean): string {
  const base = runtime.manablox.config.server.publicUrl.replace(/\/+$/, '');
  const api = `${base}/api/v1`;
  const call = callExample(api);
  const sections = [
    ...introSection(base, api, complete),
    ...modelSection(base),
    ...recipesSection(call),
    ...runtime.manablox.config.plugins.flatMap((plugin) =>
      plugin.llms
        ? [
            plugin.llms({
              baseUrl: base,
              complete,
              call,
              plugin: runtime.manablox.plugin(plugin.name),
            }),
            '',
          ]
        : [],
    ),
    ...permissionsSection(),
    ...(complete ? referenceSections(runtime, base, api) : []),
  ];
  return `${sections.join('\n')}\n`;
}

/** A procedure call as an HTTP example. */
const callExample = (api: string) => (procedure: string, body: unknown) =>
  [
    '```http',
    `POST ${api}/${procedure}`,
    'x-api-key: <key>',
    'content-type: application/json',
    '',
    JSON.stringify(body, null, 2),
    '```',
  ].join('\n');

/** The title, the links and how to call the API. */
function introSection(base: string, api: string, complete: boolean): string[] {
  return [
    '# Manablox management API',
    '',
    '> Manablox is a headless CMS. This API creates and changes everything in it: spaces, content types and block types, documents, templates, menus, redirects and assets, and what the configured plugins add. Every admin action is a procedure here.',
    '',
    `- OpenAPI document with the exact input schema of every procedure: ${base}/openapi.json`,
    complete
      ? `- Short version of this guide: ${base}/llms.txt`
      : `- Full version, with every field type's settings schema, the plugins' references and every procedure: ${base}/llms-full.txt`,
    '',
    '## Calling the API',
    '',
    `Every procedure is \`POST ${api}/<namespace>/<procedure>\` with a JSON body, answering JSON. Authenticate with an API key in the \`x-api-key\` header. A key is created in the admin under Settings > API keys, and may be limited to some spaces and some permissions: create one with exactly the permissions the job needs.`,
    '',
    'Almost every procedure takes `spaceId`. Ids are UUIDs. A failure answers with an HTTP status and `{"message": "<error key>", "data": {"key": "<error key>", "details": [{"key", "path", "params"}]}}`; a validation failure lists every problem at once, each with the path to the value, so fix them all and send again.',
    '',
  ];
}

/** Spaces, types, documents, blocks and templates, and how field values are written. */
function modelSection(base: string): string[] {
  return [
    '## The model',
    '',
    '- A **space** is one website or app: its own content, types, users, locales and settings. `spaces.list` lists the spaces the key can see.',
    '- A **content type** is either a document type (`kind: "content"`: a page, an article, a product) or a block type (`kind: "block"`: a section such as a hero or a FAQ, only ever placed inside a document). A type is a list of **fields**, each of a field type (below).',
    '- A **document** is one piece of content of a document type, in one locale: a title, a slug, a status (draft, published) and its field values. Documents form a tree (`parentId`).',
    '- A **block field** (`blocks`) holds a sequence of blocks laid out on a grid: `{"grid": {"desktop": {"columns": 3}}, "blocks": [{"blockId": "<new uuid>", "type": "<block type id>", "fields": {...}, "layout": {"column": 1, "row": 1, "columnSpan": 3, "rowSpan": 1}}]}`. `grid` and `layout` may be left out; the blocks then stack.',
    '- A **template** is a document of the built-in `template` type whose `blocks` field is a starting layout; editors pick one when creating a document.',
    '',
    '## Field values',
    '',
    '- `string`: a string. `number`: a number. `boolean`: true or false. `date`: an ISO date or date-time string. `select`: an option value, or a list of them when `multiple`.',
    '- `richtext`: an HTML string such as `"<h2>Why</h2><p>It is <strong>fast</strong>.</p>"` (p, h1-h6, ul, ol, li, blockquote, pre, hr, br, strong, em, s, code, a). It is stored and returned as a ProseMirror JSON document, which is also accepted.',
    `- \`asset\`: an asset id, or a list of ids when \`multiple\`. Upload a file as multipart form data (field \`file\`) to \`POST ${base}/upload/<spaceId>\`, which answers with the asset.`,
    '- `content`: a document id, or a list when `multiple`. `link`: `{"mode": "internal", "contentId": "<id>"}` or `{"mode": "external", "url": "https://..."}`, with optional `label` and `target`.',
    '- `blocks`: see above. `block`: one block, `{"blockId", "type", "fields"}`.',
    '- `repeater`: a list of items, each `{"itemId": "<new uuid>", "fields": {...}}` with values keyed by the sub-field names declared in `settings.fields` (each `{"name", "type", "settings"}`, any field type). `settings.min` and `settings.max` bound the count.',
    '',
  ];
}

/** Worked calls: a content model, a document, a template. */
function recipesSection(call: ReturnType<typeof callExample>): string[] {
  return [
    '## Recipes',
    '',
    '### Create a content model in one call',
    '',
    '`contentTypes.applyPlan` creates document types and the block types they hold together, referring to each other by machine name: a `blocks` field names block types in `settings.types`, a `block` field in `settings.type`, a `content` or `link` field names document types in `settings.types`, a `databag` field names databag types there. A name may be one in the plan or an existing type. Block types are created first; if any type fails, none is kept.',
    '',
    call('contentTypes/applyPlan', {
      spaceId: '<space id>',
      types: [
        {
          name: 'hero',
          kind: 'block',
          label: 'Hero',
          fields: [
            { name: 'heading', type: 'string', required: true, localized: true },
            { name: 'intro', type: 'richtext', localized: true },
            { name: 'image', type: 'asset', settings: { accept: ['image/*'] } },
          ],
        },
        {
          name: 'landing_page',
          kind: 'content',
          label: 'Landing page',
          fields: [
            { name: 'teaser', type: 'string', localized: true, settings: { max: 200 } },
            { name: 'sections', type: 'blocks', settings: { types: ['hero'] } },
          ],
        },
      ],
    }),
    '',
    'Names are lowercase machine names (`a-z`, `0-9`, `_`, `-`, starting with a letter). Every document already has a title and a slug; do not add fields for them. `contentTypes.list` returns the existing types with their ids; `contentTypes.create` and `contentTypes.update` change one type at a time.',
    '',
    '### Create and publish a document',
    '',
    call('content/create', {
      spaceId: '<space id>',
      typeId: '<landing_page type id>',
      locale: 'en',
      title: 'Spring offers',
      slug: 'spring-offers',
      fields: {
        teaser: 'Everything on sale until May.',
        sections: {
          blocks: [
            {
              blockId: '<new uuid>',
              type: '<hero type id>',
              fields: {
                heading: 'Spring is here',
                intro: '<p>Up to <strong>40%</strong> off.</p>',
              },
            },
          ],
        },
      },
    }),
    '',
    'Then `content.publish` with `{"spaceId", "id"}`. `content.blank` returns a type\'s empty field values; `content.update` takes the same fields as `create` plus `id`; `content.list` and `content.tree` read what is there.',
    '',
    '### Create a template',
    '',
    'Find the type named `template` in `contentTypes.list` (it is a system type), then `content.create` a document of it whose `blocks` field is the layout.',
    '',
  ];
}

function permissionsSection(): string[] {
  return [
    '## Permissions',
    '',
    `A key or a role holds some of: ${allPermissions()
      .map((permission) => `\`${permission}\``)
      .join(', ')}. Creating a space and importing one need a superadmin.`,
  ];
}

/** `llms-full.txt` only: every field type's settings schema and every procedure. */
function referenceSections(runtime: Runtime, base: string, api: string): string[] {
  return [
    '',
    '## Field types',
    '',
    'Each field type with the JSON Schema of its `settings`. Leave out a setting whose default is right.',
    '',
    ...runtime.manablox.fieldTypes.all.map((type) => {
      const schema = settingsSchemaOf(type);
      return `- \`${type.name}\` (${type.label})${type.description ? `: ${type.description}` : ''}${schema ? `\n  settings: \`${schema}\`` : ''}`;
    }),
    '',
    '## Every procedure',
    '',
    `Each is \`POST ${api}/<path>\`; the input schema is in ${base}/openapi.json.`,
    '',
    ...procedures(managementRouter(runtime.manablox.config.plugins)).map((path) => `- \`${path}\``),
  ];
}

/** Every router procedure path, `namespace/procedure`, in declaration order. */
function procedures(node: object, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue;
    const path = prefix ? `${prefix}/${key}` : key;
    if ('~orpc' in value) out.push(path);
    else out.push(...procedures(value, path));
  }
  return out;
}
