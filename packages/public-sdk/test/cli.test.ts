import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from '../src/cli-main.js';

import type { ContentModel } from '../src/types.js';

const MODEL: ContentModel = {
  types: [
    {
      name: 'page',
      label: 'Page',
      kind: 'content' as const,
      fields: [
        {
          name: 'summary',
          type: 'string',
          required: false,
          list: false,
          kind: 'scalar' as const,
          scalar: 'String',
        },
      ],
    },
  ],
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubInstance() {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    void url;
    return new Response(JSON.stringify(MODEL), {
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

describe('parseArgs', () => {
  it('reads a command, flags and --flag=value', () => {
    expect(parseArgs(['types', '--url', 'https://a', '--prefix=Cms'])).toEqual({
      command: 'types',
      options: { url: 'https://a', prefix: 'Cms' },
      help: false,
    });
  });

  it('recognises --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('keeps every = after the first in a value', () => {
    expect(parseArgs(['types', '--url=http://x/?a=b&c==', '--prefix', 'a=b']).options).toEqual({
      url: 'http://x/?a=b&c==',
      prefix: 'a=b',
    });
  });

  it('rejects an unknown option and a missing value', () => {
    expect(() => parseArgs(['types', '--ur', 'https://a'])).toThrow(/unknown option '--ur'/);
    expect(() => parseArgs(['types', '--out'])).toThrow(/--out <value>' argument missing/);
  });
});

describe('manablox-sdk types', () => {
  it('reads /v1/types from the instance and writes a .d.ts', async () => {
    const fetch = stubInstance();
    const dir = await mkdtemp(join(tmpdir(), 'manablox-sdk-'));
    const out = join(dir, 'manablox.d.ts');

    const code = await main(['types', '--url', 'https://cms.example.com', '--out', out]);

    expect(code).toBe(0);
    // Not GraphQL introspection, which public instances disable.
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://cms.example.com/v1/types');

    const generated = await readFile(out, 'utf8');
    expect(generated).toContain('export interface Page extends ContentNode {');
    expect(generated).toContain('summary?: string | null;');
    await rm(dir, { recursive: true, force: true });
  });

  it('reflects a renamed field in its output', async () => {
    stubInstance();
    const first = await capture(['types', '--url', 'https://cms.example.com']);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          types: [
            {
              ...MODEL.types[0],
              fields: [{ ...MODEL.types[0]?.fields[0], name: 'abstract' }],
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch;

    const second = await capture(['types', '--url', 'https://cms.example.com']);

    expect(first).toContain('summary?');
    expect(second).toContain('abstract?');
    expect(second).not.toContain('summary?');
  });

  it('refuses to run without a URL', async () => {
    vi.stubEnv('MANABLOX_URL', undefined);

    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });

    expect(await main(['types'])).toBe(1);
    expect(errors.join('')).toContain('--url is required');
  });

  it('prints usage for an unknown command', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });

    expect(await main(['nonsense'])).toBe(1);
    expect(out.join('')).toContain('manablox-sdk types');
  });
});

async function capture(argv: string[]): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  await main(argv);
  spy.mockRestore();
  return chunks.join('');
}
