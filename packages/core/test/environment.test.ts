import { describe, expect, it } from 'vitest';
import { contentTypeId, defineContentType } from '../src/content-type.js';
import {
  environmentCacheTag,
  HOME_NOMINATION,
  inScope,
  nominationOf,
  nominationsOf,
  spacePurgeTag,
  withStagingNominations,
} from '../src/environment.js';
import { FieldTypeRegistry } from '../src/field-type.js';
import { ContentTypeRegistry } from '../src/registry.js';

const production = {
  spaceId: 's1',
  environmentId: 'p1',
  machineName: 'production',
  production: true,
};
const staging = { spaceId: 's1', environmentId: 'e1', machineName: 'staging', production: false };

const registry = () => {
  const types = new ContentTypeRegistry(new FieldTypeRegistry());
  const runtime = (input: Parameters<typeof defineContentType>[0]) => ({
    ...defineContentType(input),
    source: 'runtime' as const,
  });
  types.setAll([
    defineContentType({ name: 'folder', fields: [] }),
    defineContentType({ name: 'coded', spaceId: 's1', fields: [] }),
    runtime({ name: 'article', spaceId: 's1', fields: [] }),
    runtime({ name: 'article', spaceId: 's1', environmentId: 'e1', fields: [] }),
    runtime({ name: 'promo', spaceId: 's1', environmentId: 'e1', fields: [] }),
  ]);
  return types;
};

describe('content types per environment', () => {
  it('derives a staging type id from its environment, production unchanged', () => {
    expect(contentTypeId('s1', 'article')).toBe(
      defineContentType({ name: 'article', spaceId: 's1', fields: [] }).id,
    );
    expect(contentTypeId('s1', 'article', 'e1')).not.toBe(contentTypeId('s1', 'article'));
  });

  it("gives each environment its types, the space's code types and the global ones", () => {
    const types = registry();
    const names = (scope: Parameters<typeof types.forSpace>[0]) =>
      types
        .forSpace(scope)
        .map((type) => `${type.name}${type.environmentId ? '@staging' : ''}`)
        .sort();
    expect(names('s1')).toEqual(['article', 'coded', 'folder']);
    expect(names(production)).toEqual(['article', 'coded', 'folder']);
    expect(names(staging)).toEqual(['article@staging', 'coded', 'folder', 'promo@staging']);
    expect(types.tryGetByName('promo', 's1')).toBeUndefined();
    expect(types.tryGetByName('promo', staging)?.environmentId).toBe('e1');
    expect(types.tryGetByName('article', staging)?.environmentId).toBe('e1');
    expect(types.tryGetByName('article', production)?.environmentId).toBeUndefined();
  });

  it("changes one environment's schema version, not the other's", () => {
    const types = registry();
    const before = [types.schemaVersionOf(production), types.schemaVersionOf(staging)];
    types.add({
      ...defineContentType({ name: 'banner', spaceId: 's1', environmentId: 'e1', fields: [] }),
      source: 'runtime',
    });
    expect(types.schemaVersionOf(production)).toBe(before[0]);
    expect(types.schemaVersionOf(staging)).not.toBe(before[1]);
  });
});

describe('scopes', () => {
  it('matches rows by space, and by environment when the scope names one', () => {
    const row = { spaceId: 's1', environmentId: 'e1' };
    expect(inScope(row, 's1')).toBe(true);
    expect(inScope(row, staging)).toBe(true);
    expect(inScope(row, production)).toBe(false);
    expect(inScope({ spaceId: 's1' }, production)).toBe(true);
  });

  it('tags staging caches with the environment, production as today', () => {
    expect(environmentCacheTag('s1', 'e1')).toBe('space:s1:env:e1');
    expect(spacePurgeTag(production)).toBe('space:s1');
    expect(spacePurgeTag(staging)).toBe('space:s1:env:e1');
  });

  it('keeps home pages per environment', () => {
    const settings = { homeContentId: 'h1', other: 1 };
    expect(nominationsOf(settings, null)).toEqual({ homeContentId: 'h1' });
    expect(nominationOf(settings, 'e1', HOME_NOMINATION)).toBeNull();
    expect(nominationsOf(settings, 'e1')).toEqual({ homeContentId: null });
    const staged = withStagingNominations(settings, 'e1', { homeContentId: 'h2' });
    expect(nominationsOf(staged, 'e1')).toEqual({ homeContentId: 'h2' });
    expect(nominationsOf(staged, null).homeContentId).toBe('h1');
    expect(withStagingNominations(staged, 'e1', { homeContentId: null })).toEqual(settings);
  });

  it('writes production nominations in their own places', () => {
    expect(HOME_NOMINATION.write({ homeContentId: 'h1', a: 1 }, null)).toEqual({ a: 1 });
    expect(HOME_NOMINATION.write({}, 'h2')).toEqual({ homeContentId: 'h2' });
  });
});
