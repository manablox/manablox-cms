import { describe, expect, it } from 'vitest';
import {
  CODE_REF_PREFIX,
  collectCodeRefs,
  parseCodeRef,
  ref,
  resolveCodeRefs,
  targetsSpace,
} from '../src/code-resource.js';
import { resolveConfig } from '../src/config.js';
import { defineCredential } from '../src/credential-define.js';
import { definePlugin } from '../src/plugin.js';
import { defineTemplate } from '../src/template-define.js';

const base = {
  database: { url: 'postgres://localhost/test' },
  auth: { secret: 'x'.repeat(32) },
};

describe('references', () => {
  it('round-trips a reference', () => {
    expect(ref.contentType('article')).toBe(`${CODE_REF_PREFIX}contentType:article`);
    expect(parseCodeRef(ref.credential('stripe'))).toEqual({ kind: 'credential', name: 'stripe' });
    expect(parseCodeRef('article')).toBeNull();
    expect(parseCodeRef(`${CODE_REF_PREFIX}nonsense:x`)).toBeNull();
    // A plugin kind is `<plugin id>.<name>`.
    expect(parseCodeRef(ref.of('hello.greeting', 'hook'))).toEqual({
      kind: 'hello.greeting',
      name: 'hook',
    });
    expect(parseCodeRef(`${CODE_REF_PREFIX}.greeting:x`)).toBeNull();
  });

  it('resolves references anywhere in a structure, leaving the original alone', () => {
    const config = {
      to: ref.contentType('article'),
      nested: [{ keep: 1, id: ref.of('hello.greeting', 'hook') }],
    };
    const resolved = resolveCodeRefs(config, (reference) => `${reference.kind}-${reference.name}`);

    expect(resolved).toEqual({
      to: 'contentType-article',
      nested: [{ keep: 1, id: 'hello.greeting-hook' }],
    });
    expect(config.to).toBe(ref.contentType('article'));
  });

  it('collects every distinct reference', () => {
    const refs = collectCodeRefs([ref.contentType('a'), ref.contentType('a'), ref.credential('b')]);
    expect(refs).toEqual([
      { kind: 'contentType', name: 'a' },
      { kind: 'credential', name: 'b' },
    ]);
  });

  it('targets every space when it names none', () => {
    expect(targetsSpace('*', 'marketing')).toBe(true);
    expect(targetsSpace(undefined, 'marketing')).toBe(true);
    expect(targetsSpace(['docs'], 'marketing')).toBe(false);
    expect(targetsSpace(['docs', 'marketing'], 'marketing')).toBe(true);
  });
});

describe('defineCredential', () => {
  it('declares a slot with no values in it', () => {
    expect(defineCredential({ slug: 'stripe', kind: 'apiKey' })).toMatchObject({
      credentialKind: 'apiKey',
      values: null,
      spaces: '*',
    });
  });

  it('refuses a field the kind does not have', () => {
    expect(() =>
      defineCredential({ slug: 'stripe', kind: 'bearer', values: { nonsense: 'x' } }),
    ).toThrow(/codeCredential.field.unknown/);
  });

  it('lets a custom credential carry whatever it likes', () => {
    expect(
      defineCredential({ slug: 'thing', kind: 'custom', values: { anything: 'x' } }).values,
    ).toEqual({ anything: 'x' });
  });
});

describe('defineTemplate', () => {
  it('takes one block list for every locale', () => {
    const template = defineTemplate({ slug: 'hero', blocks: [] });
    expect(template).toMatchObject({ manage: 'seed', publish: true });
    expect(template.blocks).toEqual([{ locale: null, value: { blocks: [] } }]);
  });

  it('takes a list per locale', () => {
    const template = defineTemplate({ slug: 'hero', blocks: { en: [], de: { blocks: [] } } });
    expect(template.blocks.map((entry) => entry.locale)).toEqual(['en', 'de']);
  });
});

describe('resolveConfig', () => {
  const credential = defineCredential({ slug: 'stripe', kind: 'apiKey' });

  it('collects the declarations of the config and of every plugin, stamped with their source', () => {
    const resolved = resolveConfig({
      ...base,
      resources: { credentials: [credential] },
      plugins: [
        definePlugin({
          name: '@acme/seo',
          templates: [defineTemplate({ slug: 'hero', blocks: [] })],
        }),
      ],
    });

    expect(resolved.resources.credentials).toEqual([
      expect.objectContaining({ slug: 'stripe', sourceRef: 'config' }),
    ]);
    expect(resolved.resources.templates).toEqual([
      expect.objectContaining({ slug: 'hero', sourceRef: '@acme/seo' }),
    ]);
    expect(resolved.resources.apply).toBe('manual');
    expect(resolved.resources.prune).toBe(false);
  });

  it('refuses two declarations of one kind and slug', () => {
    expect(() =>
      resolveConfig({
        ...base,
        resources: { credentials: [credential] },
        plugins: [definePlugin({ name: '@acme/seo', credentials: [credential] })],
      }),
    ).toThrow(/codeResource.duplicate/);
  });
});
