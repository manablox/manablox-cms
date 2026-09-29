import { describe, expect, it } from 'vitest';
import { renderConfigSource } from '../src/config/format.js';

describe('the rendered file', () => {
  it('writes each declaration as its own constant and collects them', () => {
    const code = renderConfigSource({
      credentials: [{ slug: 'mailer', kind: 'smtp' }],
      templates: [{ slug: 'landing', title: 'Landing', blocks: { en: [] } }],
    });

    expect(code).toContain("import { defineCredential, defineTemplate } from '@manablox/core';");
    expect(code).toContain('export const mailer = defineCredential({');
    expect(code).toContain('export const landing = defineTemplate({');
    expect(code).toContain('  credentials: [mailer],');
    expect(code).toContain('  templates: [landing],');
  });

  it('writes a reference as the call that produces it, not as an id', () => {
    const code = renderConfigSource({
      plugins: [
        {
          kind: 'hello.greeting',
          define: { name: 'defineGreeting', from: '@acme/hello/define' },
          entries: [
            {
              slug: 'notify',
              input: { slug: 'notify', typeIds: ['@manablox:contentType:article'] },
            },
          ],
        },
      ],
    });

    expect(code).toContain("import { ref } from '@manablox/core';");
    expect(code).toContain("ref.contentType('article')");
    expect(code).not.toContain('@manablox:');
  });

  it('keeps two declarations of the same name apart', () => {
    const code = renderConfigSource({
      credentials: [{ slug: 'orders', kind: 'apiKey' }],
      templates: [{ slug: 'orders', title: 'Orders', blocks: { en: [] } }],
    });

    expect(code).toContain('export const orders = defineCredential({');
    expect(code).toContain('export const orders2 = defineTemplate({');
  });

  it('writes plugin resource kinds with their own define functions', () => {
    const code = renderConfigSource({
      credentials: [{ slug: 'mailer', kind: 'smtp' }],
      plugins: [
        {
          kind: 'hello.greeting',
          define: { name: 'defineGreeting', from: '@acme/hello/define' },
          entries: [
            {
              slug: 'welcome',
              input: { slug: 'welcome', uses: ['@manablox:hello.greeting:other'] },
            },
            { slug: 'mailer', input: { slug: 'mailer' } },
          ],
        },
      ],
    });

    expect(code).toContain("import { defineCredential, ref } from '@manablox/core';");
    expect(code).toContain("import { defineGreeting } from '@acme/hello/define';");
    expect(code).toContain('export const welcome = defineGreeting({');
    expect(code).toContain("ref.of('hello.greeting', 'other')");
    expect(code).toContain('export const mailer2 = defineGreeting({');
    expect(code).toContain("    'hello.greeting': [welcome, mailer2],");
  });
});
