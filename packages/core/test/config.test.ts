import { describe, expect, it } from 'vitest';
import { type ManabloxConfig, resolveConfig } from '../src/config.js';
import { defineFieldType } from '../src/field-type.js';
import { definePlugin } from '../src/plugin.js';
import type { StandardSchemaV1 } from '../src/standard-schema.js';

const passthrough = <T>(): StandardSchemaV1<unknown, T> => ({
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => ({ value: value as T }),
  },
});

const stringType = defineFieldType({
  name: 'string',
  label: 'Text',
  settingsSchema: passthrough<Record<string, never>>(),
  valueSchema: () => passthrough<string>(),
  defaultValue: () => '',
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'contains'],
  graphql: { type: { kind: 'scalar', name: 'String' } },
  admin: { input: 'string' },
});

const base = (over: Partial<ManabloxConfig> = {}): ManabloxConfig => ({
  database: { url: 'postgres://localhost/test' },
  auth: { secret: 'test-secret' },
  fieldTypes: [stringType],
  ...over,
});

describe('resolveConfig', () => {
  it('does not mutate the input config - the prototype pushed into it in place', () => {
    const plugin = definePlugin({
      name: 'p',
      contentTypes: [{ name: 'article', fields: [{ name: 'body', type: 'string' }] }],
    });
    const config = base({
      contentTypes: [{ name: 'page', fields: [{ name: 'title', type: 'string' }] }],
      plugins: [plugin],
    });

    const first = resolveConfig(config);
    const second = resolveConfig(config);

    expect(config.contentTypes).toHaveLength(1);
    expect(first.contentTypes).toHaveLength(2);
    expect(second.contentTypes).toHaveLength(2);
  });

  it('serves no admin unless asked, and remembers where it comes from', () => {
    expect(resolveConfig(base({})).server.admin).toBe(false);
    expect(resolveConfig(base({ server: { admin: true } })).server.admin).toEqual({ dir: null });
    expect(resolveConfig(base({ server: { admin: { dir: '/srv/admin' } } })).server.admin).toEqual({
      dir: '/srv/admin',
    });
  });

  it('defaults the auth base URL to the public URL', () => {
    const resolved = resolveConfig(base({ server: { publicUrl: 'https://cms.example.com' } }));
    expect(resolved.auth.baseUrl).toBe('https://cms.example.com');
    const explicit = resolveConfig(
      base({ auth: { secret: 's', baseUrl: 'https://auth.example.com' } }),
    );
    expect(explicit.auth.baseUrl).toBe('https://auth.example.com');
  });

  it("adds a plugin's content types after the config's", () => {
    const seo = definePlugin({
      name: 'seo',
      contentTypes: [{ name: 'seo_page', fields: [{ name: 'meta_title', type: 'string' }] }],
    });
    const resolved = resolveConfig(
      base({
        contentTypes: [{ name: 'page', fields: [{ name: 'title', type: 'string' }] }],
        plugins: [seo],
      }),
    );
    expect(resolved.contentTypes.map((type) => type.name)).toEqual(['page', 'seo_page']);
  });

  it("lets a plugin add fields to the config's content types and to other plugins'", () => {
    const shop = definePlugin({
      name: 'shop',
      contentTypes: [{ name: 'product', fields: [{ name: 'price', type: 'string' }] }],
    });
    const seo = definePlugin({
      name: 'seo',
      extend: [
        { name: 'page', fields: [{ name: 'meta_description', type: 'string' }] },
        { name: 'product', label: 'Product', fields: [{ name: 'meta_title', type: 'string' }] },
      ],
    });
    const config = base({
      contentTypes: [{ name: 'page', fields: [{ name: 'title', type: 'string' }] }],
      // `seo` is listed before `shop`: extensions apply once every plugin declared its types.
      plugins: [seo, shop],
    });
    const resolved = resolveConfig(config);
    const fields = (name: string) =>
      resolved.contentTypes.find((type) => type.name === name)?.fields.map((field) => field.name);
    expect(fields('page')).toEqual(['title', 'meta_description']);
    expect(fields('product')).toEqual(['price', 'meta_title']);
    expect(resolved.contentTypes.find((type) => type.name === 'product')?.label).toBe('Product');
    // The config's own declaration stays as written.
    expect(config.contentTypes?.[0]?.fields).toHaveLength(1);
  });

  it('merges settings and admin when two plugins extend the same field', () => {
    const a = definePlugin({
      name: 'a',
      extend: [
        {
          name: 'page',
          fields: [
            { name: 'title', type: 'string', settings: { max: 100 }, admin: { zone: 'sidebar' } },
          ],
        },
      ],
    });
    const b = definePlugin({
      name: 'b',
      extend: [
        {
          name: 'page',
          fields: [{ name: 'title', type: 'string', settings: { min: 3 }, admin: { width: 50 } }],
        },
      ],
    });
    const resolved = resolveConfig(
      base({
        contentTypes: [{ name: 'page', fields: [{ name: 'title', type: 'string' }] }],
        plugins: [a, b],
      }),
    );
    const title = resolved.contentTypes[0]?.fields[0];
    expect(title?.settings).toEqual({ max: 100, min: 3 });
    expect(title?.admin).toMatchObject({ zone: 'sidebar', width: 50 });
  });

  it('refuses to extend a content type that is not declared in code', () => {
    const plugin = definePlugin({ name: 'p', extend: [{ name: 'ghost', fields: [] }] });
    let caught: unknown;
    try {
      resolveConfig(base({ plugins: [plugin] }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      key: 'plugin.extend.contentType.notFound',
      kind: 'not_found',
    });
  });

  it('rejects two content types with the same name', () => {
    const plugin = definePlugin({
      name: 'p',
      contentTypes: [{ name: 'page', fields: [] }],
    });
    expect(() =>
      resolveConfig(base({ contentTypes: [{ name: 'page', fields: [] }], plugins: [plugin] })),
    ).toThrow(/duplicate/);
  });

  it('produces deterministic ids for code-defined types across runs', () => {
    const config = base({
      contentTypes: [{ name: 'page', fields: [{ name: 'title', type: 'string' }] }],
    });
    const a = resolveConfig(config).contentTypes[0];
    const b = resolveConfig(config).contentTypes[0];
    expect(a?.id).toBe(b?.id);
    expect(a?.fields[0]?.id).toBe(b?.fields[0]?.id);
  });
});

describe('plugin server modes', () => {
  // `surface` comes from `@manablox/server`; core reads only names and scopes.
  const mode = { name: 'website', scopes: ['media'] } as never;
  const withMode = (over: Partial<ManabloxConfig> = {}) =>
    base({ plugins: [definePlugin({ name: 'website', modes: [mode] })], ...over });

  it("mounts a plugin mode's scopes", () => {
    const config = resolveConfig(withMode({ server: { mode: 'website' } }));
    expect(config.server.mode).toBe('website');
    expect(config.server.scopes).toEqual(['media']);
  });

  it('refuses an unknown mode, naming the known ones', () => {
    const details = (config: ManabloxConfig) => {
      try {
        resolveConfig(config);
      } catch (error) {
        return (error as { details: unknown[] }).details;
      }
      return [];
    };
    expect(details(withMode({ server: { mode: 'site' } }))).toEqual([
      expect.objectContaining({
        key: 'config.mode.unknown',
        path: ['server', 'mode'],
        params: { mode: 'site', known: 'management, public, website' },
      }),
    ]);
    expect(details(base({ server: { mode: 'website' } }))).toEqual([
      expect.objectContaining({
        key: 'config.mode.unknown',
        params: { mode: 'website', known: 'management, public' },
      }),
    ]);
  });

  it('refuses a mode name taken twice', () => {
    expect(() =>
      resolveConfig(
        withMode({
          plugins: [
            definePlugin({
              name: 'other',
              modes: [{ ...(mode as object), name: 'public' } as never],
            }),
          ],
        }),
      ),
    ).toThrow(expect.objectContaining({ key: 'plugin.key.duplicate' }));
  });

  it("adds plugins' frame origins to a restricted admin frame-src only", () => {
    const framing = definePlugin({
      name: 'framing',
      admin: { frameOrigins: ['https://sites.test/x'] },
    });
    const open = resolveConfig(base({ plugins: [framing] }));
    expect(open.server.csp.frameSrc).toEqual(['*']);
    const restricted = resolveConfig(
      base({ plugins: [framing], server: { csp: { frameSrc: ['https://app.test'] } } }),
    );
    expect(restricted.server.csp.frameSrc).toEqual(['https://app.test', 'https://sites.test']);
  });
});

describe('slugify', () => {
  it('transliterates German umlauts before stripping diacritics', async () => {
    const { slugify } = await import('../src/ids.js');
    expect(slugify('Grüße aus München!')).toBe('gruesse-aus-muenchen');
    expect(slugify('Über uns')).toBe('ueber-uns');
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('  --Hello_World--  ')).toBe('hello-world');
  });
});

describe('validateConfig', () => {
  it('reports every problem at once, with paths', () => {
    expect(() =>
      resolveConfig(
        base({
          server: { scopes: ['graphql', 'nope' as never], mode: 'weird' as never, port: 70_000 },
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        key: 'config.invalid',
        details: expect.arrayContaining([
          expect.objectContaining({ key: 'config.scope.unknown', path: ['server', 'scopes', 1] }),
          expect.objectContaining({ key: 'config.mode.unknown', path: ['server', 'mode'] }),
          expect.objectContaining({ key: 'config.port.invalid', path: ['server', 'port'] }),
        ]),
      }),
    );
  });
});

describe('mail config', () => {
  it('has no transport without one, and keeps the sender', () => {
    expect(resolveConfig(base()).mail).toEqual({ transport: null });
    const transport = { driver: 'smtp' as const, url: 'smtp://mail:25' };
    expect(resolveConfig(base({ mail: { transport, from: 'a@b.test' } })).mail).toEqual({
      transport,
      from: 'a@b.test',
    });
  });

  it('takes a ready-made transport as it is', () => {
    const transport = { name: 'mine', send: async () => ({ id: null }) };
    expect(resolveConfig(base({ mail: { transport } })).mail.transport).toBe(transport);
  });

  it('refuses an unknown driver and a missing option at boot, with paths', () => {
    expect(() =>
      resolveConfig(base({ mail: { transport: { driver: 'pigeon' } as never } })),
    ).toThrow(
      expect.objectContaining({
        details: [
          expect.objectContaining({
            key: 'config.mail.driverUnknown',
            path: ['mail', 'transport', 'driver'],
          }),
        ],
      }),
    );
    expect(() =>
      resolveConfig(base({ mail: { transport: { driver: 'mailgun', apiKey: 'k' } as never } })),
    ).toThrow(
      expect.objectContaining({
        details: [
          expect.objectContaining({
            key: 'config.mail.optionMissing',
            path: ['mail', 'transport', 'domain'],
          }),
        ],
      }),
    );
    expect(() => resolveConfig(base({ mail: { transport: { driver: 'smtp' } } }))).toThrow(
      expect.objectContaining({
        details: [
          expect.objectContaining({
            key: 'config.mail.optionMissing',
            path: ['mail', 'transport', 'url'],
          }),
        ],
      }),
    );
  });
});

describe('resolveConfig storage', () => {
  it('defaults to the local driver', () => {
    expect(resolveConfig(base()).storage).toEqual({
      driver: 'local',
      local: { path: './data/uploads' },
    });
  });
});
