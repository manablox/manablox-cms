import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import contribution from '../../src/cli/index.js';
import { websitePlugin } from '../../src/index.js';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('the website plugin in the manablox CLI', () => {
  it('names its CLI part in package.json, not on the plugin', () => {
    expect(manifest.manablox).toEqual({
      plugin: 'website',
      cli: '@manablox/plugin-website/cli',
    });
    expect(manifest.exports['./cli']).toBeDefined();
    expect(manifest.publishConfig.exports['./cli']).toEqual({
      types: './dist/cli.d.ts',
      default: './dist/cli.js',
    });
    // The CLI reads the package, so a config never has to load the CLI part.
    expect(websitePlugin().cli).toBeUndefined();
  });

  it('adds publish-all and the domain commands', () => {
    expect(Object.keys(contribution.commands ?? {})).toEqual([
      'publish-all',
      'domains list',
      'domains add',
      'domains verify',
      'domains remove',
    ]);
    expect(contribution.summary).toBe('designed websites, served by the site process');
  });
});
