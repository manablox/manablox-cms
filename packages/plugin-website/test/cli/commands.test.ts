import type { CliCommandContext, CliValues } from '@manablox/core';
import { describe, expect, it, vi } from 'vitest';
import contribution from '../../src/cli/index.js';

const spaces = [
  { id: 's1', machineName: 'blog' },
  { id: 's2', machineName: 'docs' },
];
const domain = {
  id: 'd1',
  hostname: 'acme.test',
  isPrimary: true,
  verification: { status: 'pending', txtName: '_manablox.acme.test', txtValue: 'tok' },
};
const services = {
  designs: { publishAll: vi.fn(async () => ({ published: [{}, {}], revision: 7 })) },
  domains: {
    list: vi.fn(async () => [domain]),
    create: vi.fn(async () => domain),
    verify: vi.fn(async () => ({
      ...domain,
      verification: { ...domain.verification, status: 'verified' },
    })),
    delete: vi.fn(async () => {}),
  },
};

function run(words: string, positionals: string[], values: CliValues = {}) {
  const out: string[] = [];
  const context: CliCommandContext = {
    positionals,
    values,
    out: { write: (text: string) => out.push(text) },
    err: { write: () => true },
    cwd: process.cwd(),
    prompter: null,
    signal: new AbortController().signal,
    open: async () => {},
    spin: (_label, work) => work(),
    runtime: async () =>
      ({ plugin: { repos: { spaces: { list: async () => spaces } }, services } }) as never,
  };
  const command = contribution.commands?.[words];
  if (!command) throw new Error(words);
  return command.run(context).then((code) => ({ code, out: out.join('') }));
}

describe('website CLI: commands', () => {
  it('publishes every design of the space --space names', async () => {
    expect(await run('publish-all', [], { space: 'docs' })).toEqual({
      code: 0,
      out: 'manablox: published 2 designs of docs (revision 7)\n',
    });
    expect(services.designs.publishAll).toHaveBeenCalledWith('s2', null);
    await expect(run('publish-all', [])).rejects.toThrow(
      'pass --space <name>; there are 2 spaces: blog, docs',
    );
    await expect(run('publish-all', [], { space: 'nope' })).rejects.toThrow("no space 'nope'");
  });

  it('lists, adds, verifies and removes domains', async () => {
    expect((await run('domains list', [], { space: 'blog' })).out).toBe(
      'acme.test  primary, pending\n',
    );
    const added = await run('domains add', ['Acme.test'], { space: 'blog', primary: true });
    expect(services.domains.create).toHaveBeenCalledWith('s1', {
      hostname: 'acme.test',
      isPrimary: true,
    });
    expect(added.out).toContain('verify it with the TXT record _manablox.acme.test = tok');
    expect(await run('domains verify', ['acme.test'], { space: 'blog' })).toEqual({
      code: 0,
      out: 'manablox: acme.test is verified\n',
    });
    expect((await run('domains remove', ['acme.test'], { space: 'blog' })).out).toBe(
      'manablox: removed acme.test from blog\n',
    );
    expect(services.domains.delete).toHaveBeenCalledWith('s1', 'd1');
    await expect(run('domains remove', ['other.test'], { space: 'blog' })).rejects.toThrow(
      'the space has no domain other.test',
    );
    await expect(run('domains add', [], { space: 'blog' })).rejects.toThrow(
      'usage: manablox website domains add <hostname>',
    );
  });
});
