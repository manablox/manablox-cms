import { describe, expect, it } from 'vitest';
import { defaultOptions, finalizeOptions } from '../src/create/index.js';
import { fill, fillSlots } from '../src/template-files.js';
import { render } from './helpers/create.js';

describe('template files: fill', () => {
  it('replaces tokens literally, `$` included', () => {
    expect(fill('a __X__ b', { __X__: "$& $1 $'" })).toBe("a $& $1 $' b");
  });

  it('drops the whole line of a directive that stands alone', () => {
    const template = 'one\n{{#if yes}}\ntwo\n{{#else}}\nthree\n{{/if}}\nfour\n';
    expect(fill(template, {}, { yes: true })).toBe('one\ntwo\nfour\n');
    expect(fill(template, {}, { yes: false })).toBe('one\nthree\nfour\n');
  });

  it('keeps the line around an inline directive', () => {
    const template = 'port 80{{#if tls}}, 443{{/if}} |\n';
    expect(fill(template, {}, { tls: true })).toBe('port 80, 443 |\n');
    expect(fill(template, {}, { tls: false })).toBe('port 80 |\n');
  });

  it('nests and negates', () => {
    const template = '{{#if !a}}\n{{#if b}}\nx\n{{#else}}\ny\n{{/if}}\n{{/if}}\nz\n';
    expect(fill(template, {}, { a: false, b: false })).toBe('y\nz\n');
    expect(fill(template, {}, { a: true, b: true })).toBe('z\n');
  });

  it('puts an anchor and a marked region per plugin in place of each slot line', () => {
    const template = 'a\n  {{slot one}}\nb\n{{slot two}}\nc\n';
    const slots = {
      one: [
        { id: 'x', fragment: '  x()' },
        { id: 'empty', fragment: '{{#if f}}{{/if}}' },
      ],
      two: [{ id: 'y', fragment: '{{#if f}}__T__{{/if}}\n' }],
    };
    expect(fill(template, { __T__: 't' }, { f: true }, slots, 'a.ts')).toBe(
      [
        'a',
        '  // manablox:slot one',
        '  // manablox:plugin x >>>',
        '  x()',
        '  // manablox:plugin x <<<',
        'b',
        '// manablox:slot two',
        '// manablox:plugin y >>>',
        't',
        '// manablox:plugin y <<<',
        'c',
        '',
      ].join('\n'),
    );
    // Markdown comments, and JSON without any.
    expect(fillSlots('{{slot s}}\n', { s: [{ id: 'x', fragment: 'x' }] }, 'README.md')).toBe(
      '<!-- manablox:slot s -->\n<!-- manablox:plugin x >>> -->\nx\n<!-- manablox:plugin x <<< -->\n',
    );
    expect(fillSlots('{{slot s}}\n', { s: [{ id: 'x', fragment: 'x' }] }, 'env')).toBe(
      '# manablox:slot s\n# manablox:plugin x >>>\nx\n# manablox:plugin x <<<\n',
    );
    expect(
      fillSlots('{\n{{slot s}}\n}\n', { s: [{ id: 'x', fragment: '"x": 1' }] }, 'package.json'),
    ).toBe('{\n"x": 1\n}\n');
  });

  it('leaves the blocks alone without flags and rejects unknown or unclosed ones', () => {
    expect(fill('{{#if a}}x{{/if}}', {})).toBe('{{#if a}}x{{/if}}');
    expect(() => fill('{{#if a}}x{{/if}}', {}, {})).toThrow(/unknown template flag 'a'/);
    expect(() => fill('{{#if a}}x', {}, { a: true })).toThrow(/unclosed/);
    expect(() => fill('x{{/if}}', {}, {})).toThrow(/without an open block/);
  });
});

describe('template files: instance templates', () => {
  const mails = ['smtp', 'mailpit', 'gmail', 'microsoft', 'none'] as const;

  it('leave no token, block or slot behind, whatever the options', async () => {
    for (const preset of ['local', 'docker'] as const)
      for (const proxy of ['caddy', 'nginx', 'none'] as const)
        for (const database of ['postgres', 'sqlite'] as const)
          for (const publicApi of [true, false])
            for (const site of [true, false])
              for (const mail of mails)
                for (const adminDomain of ['cms.example.com', 'http://cms.localhost']) {
                  const options = finalizeOptions({
                    ...defaultOptions('/tmp/my-cms', '0.4.0'),
                    preset,
                    proxy,
                    database,
                    publicApi,
                    mail,
                    adminDomain,
                  });
                  for (const file of await render(options, site ? {} : false)) {
                    expect(file.content, `${preset}/${proxy}/${database} ${file.path}`).not.toMatch(
                      /__[A-Z_]+__|\{\{[#/]|\{\{slot/,
                    );
                  }
                }
  });
});
