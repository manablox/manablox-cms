import { afterEach, describe, expect, it } from 'vitest';
import type { ManabloxConfig } from '../src/config.js';
import { defineContentType } from '../src/content-type.js';
import { FieldTypeRegistry } from '../src/field-type.js';
import { Manablox } from '../src/manablox.node.js';
import { ContentTypeRegistry, type TypeScope } from '../src/registry.js';
import type { ContentTypeDefinition } from '../src/types.js';

const runtime = (input: Parameters<typeof defineContentType>[0]): ContentTypeDefinition => ({
  ...defineContentType(input),
  source: 'runtime',
});

const instances: Manablox[] = [];

function instance(contentTypes: ContentTypeDefinition[] = []): Manablox {
  const manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: [],
    contentTypes,
    logging: { adapters: [{ name: 'discard', stream: { write() {} } }] },
  } as unknown as ManabloxConfig);
  instances.push(manablox);
  return manablox;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((manablox) => manablox.stop()));
});

/** What `forSpace` answered before the per-space index: every type filtered, in order. */
const scanned = (registry: ContentTypeRegistry, scope: TypeScope) =>
  registry.all.filter((type) => registry.inScope(type, scope));

const scopes: TypeScope[] = [
  null,
  's1',
  's2',
  { spaceId: 's1', environmentId: 'p1', production: true },
  { spaceId: 's1', environmentId: 'e1', production: false },
];

describe('the per-space index', () => {
  it('answers forSpace like a scan of every type, in registry order', () => {
    const registry = new ContentTypeRegistry(new FieldTypeRegistry());
    registry.setAll([
      runtime({ name: 'a', spaceId: 's1', fields: [] }),
      defineContentType({ name: 'folder', fields: [] }),
      runtime({ name: 'b', spaceId: 's2', fields: [] }),
      runtime({ name: 'c', spaceId: 's1', environmentId: 'e1', fields: [] }),
      defineContentType({ name: 'coded', spaceId: 's1', fields: [] }),
      runtime({ name: 'd', fields: [] }),
    ]);
    for (const scope of scopes) expect(registry.forSpace(scope)).toEqual(scanned(registry, scope));

    registry.replace(
      [runtime({ name: 'a', spaceId: 's1', fields: [] }).id],
      [
        runtime({ name: 'b', spaceId: 's2', label: 'B again', fields: [] }),
        runtime({ name: 'e', spaceId: 's1', fields: [] }),
      ],
    );
    for (const scope of scopes) expect(registry.forSpace(scope)).toEqual(scanned(registry, scope));
    // A replaced type keeps its place, a new one comes last.
    expect(registry.all.map((type) => type.name)).toEqual(['folder', 'b', 'c', 'coded', 'd', 'e']);
    expect(registry.tryGetByName('b', 's2')?.label).toBe('B again');
    expect(registry.tryGetByName('a', 's1')).toBeUndefined();
  });

  it('digests the same types the same, however they were loaded', () => {
    const types = [
      runtime({ name: 'a', spaceId: 's1', fields: [] }),
      runtime({ name: 'b', spaceId: 's1', fields: [] }),
    ];
    const one = new ContentTypeRegistry(new FieldTypeRegistry());
    const two = new ContentTypeRegistry(new FieldTypeRegistry());
    one.setAll(types);
    two.setAll([...types].reverse());
    expect(one.schemaVersionOf('s1')).toBe(two.schemaVersionOf('s1'));
  });

  it('refuses a GraphQL name clash a replacement brings in', () => {
    const registry = new ContentTypeRegistry(new FieldTypeRegistry());
    registry.setAll([runtime({ name: 'post_2', spaceId: 's1', fields: [] })]);
    expect(() =>
      registry.replace([], [runtime({ name: 'post2', spaceId: 's2', fields: [] })]),
    ).toThrow('contentType.graphqlName.duplicate');
  });
});

describe('reloading one space', () => {
  it("swaps that space's runtime types and leaves the others alone", async () => {
    const manablox = instance();
    const s1 = runtime({ name: 'article', spaceId: 's1', fields: [] });
    const s2 = runtime({ name: 'page', spaceId: 's2', fields: [] });
    await manablox.init([s1, s2]);
    const other = manablox.contentTypes.tryGet(s2.id);
    const version = manablox.contentTypes.schemaVersionOf('s2');

    const promo = runtime({ name: 'promo', spaceId: 's1', fields: [] });
    await manablox.reloadSpace('s1', [promo]);
    const own = manablox.contentTypes.forSpace('s1').filter((type) => type.spaceId === 's1');
    expect(own.map((type) => type.name)).toEqual(['promo']);
    expect(manablox.contentTypes.tryGet(s2.id)).toBe(other);
    expect(manablox.contentTypes.schemaVersionOf('s2')).toBe(version);

    // A full reload afterwards sees the same.
    const full = instance();
    await full.init([s2, promo]);
    for (const scope of scopes) {
      expect(
        manablox.contentTypes
          .forSpace(scope)
          .map((type) => type.id)
          .sort(),
      ).toEqual(
        full.contentTypes
          .forSpace(scope)
          .map((type) => type.id)
          .sort(),
      );
    }
  });

  it('brings a code type back when the runtime copy that replaced it goes', async () => {
    const coded = defineContentType({ name: 'coded', spaceId: 's1', label: 'Code', fields: [] });
    const manablox = instance([coded]);
    await manablox.init([{ ...coded, label: 'Stored', source: 'runtime' }]);
    expect(manablox.contentTypes.get(coded.id).label).toBe('Stored');
    await manablox.reloadSpace('s1', []);
    expect(manablox.contentTypes.get(coded.id).label).toBe('Code');
  });

  it("stages a transaction's types of one space until it ends", async () => {
    const manablox = instance();
    await manablox.init([runtime({ name: 'page', spaceId: 's2', fields: [] })]);
    const key = {};
    const draft = runtime({ name: 'draft', spaceId: 's1', fields: [] });
    expect(await manablox.stage(key, 's1', [draft])).toBe(true);
    expect(manablox.contentTypes.tryGetByName('draft', 's1')).toBeDefined();
    expect(await manablox.stage(key, 's1', [draft])).toBe(false);
    await manablox.unstage(key);
    expect(manablox.contentTypes.tryGetByName('draft', 's1')).toBeUndefined();
    expect(manablox.contentTypes.tryGetByName('page', 's2')).toBeDefined();
  });

  it('rebuilds everything while a registry:contentTypes handler is registered', async () => {
    const manablox = instance();
    const seen: string[][] = [];
    manablox.hooks.on('registry:contentTypes', (types) => {
      seen.push(types.filter((type) => type.source === 'runtime').map((type) => type.name));
      return types;
    });
    await manablox.init([runtime({ name: 'page', spaceId: 's2', fields: [] })]);
    await manablox.reloadSpace('s1', [runtime({ name: 'post', spaceId: 's1', fields: [] })]);
    expect(seen.at(-1)).toEqual(['page', 'post']);
    expect(manablox.contentTypes.tryGetByName('post', 's1')).toBeDefined();
  });

  it('announces which space it reloaded', async () => {
    const manablox = instance();
    await manablox.init();
    const announced: unknown[] = [];
    manablox.hooks.on('registry:afterReload', (payload) => {
      announced.push(payload);
    });
    await manablox.reloadSpace('s1', []);
    await manablox.reload([]);
    expect(announced).toEqual([{ synced: false, spaceId: 's1' }, { synced: false }]);
  });
});
