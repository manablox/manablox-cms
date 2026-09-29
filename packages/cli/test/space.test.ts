import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args.js';
import { finalizeOptions, optionsFromArgs } from '../src/create/index.js';
import {
  machineNameFrom,
  shellQuote,
  spaceCreateArgs,
  spaceOptionsFromArgs,
} from '../src/space/options.js';
import { options } from './helpers/create.js';

describe('manablox space create', () => {
  it('derives the technical name and applies the defaults', () => {
    const args = parseArgs(['space', 'create', '--name', 'Über Blog', '--starter']);
    expect(args.positionals).toEqual(['create']);
    expect(spaceOptionsFromArgs(args.options, args.flags)).toEqual({
      name: 'Über Blog',
      machineName: 'ueber-blog',
      url: 'http://localhost:3200',
      locales: ['en'],
      starter: 'basic',
    });
    expect(machineNameFrom('2024 Report!')).toBe('report');
    expect(machineNameFrom('!!!')).toBe('site');
  });

  it('rejects a missing name, a bad technical name, locale or theme', () => {
    expect(() => spaceOptionsFromArgs({}, {})).toThrow(/--name is required/);
    expect(() => spaceOptionsFromArgs({ name: 'A', 'machine-name': 'A b' }, {})).toThrow(
      /not a technical name/,
    );
    expect(() => spaceOptionsFromArgs({ name: 'A', locales: 'en,??' }, {})).toThrow(/locales/);
    expect(() => spaceOptionsFromArgs({ name: 'A', template: 'shop' }, {})).toThrow(
      /--template must be one of business, landing, portfolio, blog, basic, custom/,
    );
    expect(spaceOptionsFromArgs({ name: 'A', template: 'blog' }, { starter: true }).starter).toBe(
      'blog',
    );
    expect(spaceOptionsFromArgs({ name: 'A' }, { 'no-starter': true }).starter).toBeNull();
  });

  it('reads repeatable --plugin-data as <id>=<json>', () => {
    const args = parseArgs([
      'space',
      'create',
      '--name',
      'A',
      '--plugin-data',
      'hello={"greeting":"Hi = there"}',
      '--plugin-data',
      'acme.seo=true',
    ]);
    const picked = spaceOptionsFromArgs(args.options, args.flags, args.lists);
    expect(picked.pluginData).toEqual({ hello: { greeting: 'Hi = there' }, 'acme.seo': true });
    expect(spaceCreateArgs(picked)).toEqual(
      expect.arrayContaining([
        '--plugin-data',
        'hello={"greeting":"Hi = there"}',
        '--plugin-data',
        'acme.seo=true',
      ]),
    );
    expect(spaceOptionsFromArgs({ name: 'A' }, {}, {})).not.toHaveProperty('pluginData');
    const bad = (entries: string[]) => () =>
      spaceOptionsFromArgs({ name: 'A' }, {}, { 'plugin-data': entries });
    expect(bad(['hello'])).toThrow(/is not <plugin id>=<json>/);
    expect(bad(['Hello={}'])).toThrow(/is not <plugin id>=<json>/);
    expect(bad(['hello={greeting}'])).toThrow(/for 'hello' is not JSON/);
    expect(bad(['hello={}', 'hello=1'])).toThrow(/names the plugin 'hello' twice/);
    expect(() => parseArgs(['user', 'create', '--plugin-data', 'a=1'])).toThrow(
      /unknown option '--plugin-data' for 'user'/,
    );
  });

  it('picks the sections of the custom type', () => {
    const picked = spaceOptionsFromArgs({ name: 'A', blocks: 'hero, faq,hero' }, {});
    expect(picked).toMatchObject({ starter: 'custom', blocks: ['hero', 'faq'] });
    expect(spaceCreateArgs(picked)).toEqual(
      expect.arrayContaining(['--template', 'custom', '--blocks', 'hero,faq']),
    );
    expect(() => spaceOptionsFromArgs({ name: 'A', blocks: 'hero,slider' }, {})).toThrow(
      /--blocks must be one of hero, text/,
    );
    expect(() => spaceOptionsFromArgs({ name: 'A', template: 'blog', blocks: 'hero' }, {})).toThrow(
      /--blocks picks the sections of the custom type/,
    );
  });

  it('writes the command back as shell words', () => {
    const space = spaceOptionsFromArgs(
      { name: "Anna's site", locales: 'de,en', plan: 'types.json' },
      {},
    );
    expect(
      spaceCreateArgs({ ...space, extraArgs: ['--website', 'designed'] })
        .map(shellQuote)
        .join(' '),
    ).toBe(
      "space create --name 'Anna'\\''s site' --machine-name anna-s-site" +
        ' --url http://localhost:3200 --locales de,en --website designed --plan types.json',
    );
  });
});

describe('manablox create: first space', () => {
  it('takes the space options and treats any of them as a yes', () => {
    const given = optionsFromArgs(
      { 'space-name': 'Docs', 'space-locales': 'en,fr', 'space-website': 'external' },
      { 'no-space-starter': true },
      [],
      '/tmp',
    );
    expect(given).toMatchObject({
      space: true,
      spaceName: 'Docs',
      spaceLocales: ['en', 'fr'],
      spaceStarter: null,
    });
    expect(optionsFromArgs({}, { 'no-space': true }, [], '/tmp').space).toBe(false);
  });

  it("takes the plugins' address, else the frontend default", () => {
    expect(options().spaceUrl).toBe('http://localhost:3005');
    expect(options({ pluginSpaceUrl: 'http://localhost:3300' }).spaceUrl).toBe(
      'http://localhost:3300',
    );
    expect(finalizeOptions({ ...options(), spaceUrl: 'https://acme.test' }).spaceUrl).toBe(
      'https://acme.test',
    );
  });
});
