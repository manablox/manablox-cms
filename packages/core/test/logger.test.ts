import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogging, type LogAdapter, registerLogAdapter } from '../src/logger.node.js';

/** Captures the NDJSON lines an adapter is handed. */
function capture(name: string, level?: LogAdapter['level']): LogAdapter & { lines: string[] } {
  const lines: string[] = [];
  return {
    name,
    ...(level ? { level } : {}),
    lines,
    stream: new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    }),
  };
}

const records = (adapter: { lines: string[] }) =>
  adapter.lines.flatMap((line) =>
    line
      .split('\n')
      .filter(Boolean)
      .map((entry) => JSON.parse(entry) as Record<string, unknown>),
  );

describe('createLogging', () => {
  it('writes every record to every adapter', async () => {
    const first = capture('first');
    const second = capture('second');
    const logging = createLogging({ level: 'info', adapters: [first, second] });

    logging.logger.info({ a: 1 }, 'hello');
    await logging.close();

    expect(records(first)).toHaveLength(1);
    expect(records(second)[0]).toMatchObject({ msg: 'hello', a: 1 });
  });

  it('lets one adapter keep a lower level than the rest', async () => {
    const console = capture('console', 'info');
    const file = capture('file', 'debug');
    const logging = createLogging({ level: 'info', adapters: [console, file] });

    logging.logger.debug('quiet');
    logging.logger.warn('loud');
    await logging.close();

    expect(records(console).map((r) => r.msg)).toEqual(['loud']);
    expect(records(file).map((r) => r.msg)).toEqual(['quiet', 'loud']);
  });

  it('redacts the default paths', async () => {
    const adapter = capture('adapter');
    const logging = createLogging({ adapters: [adapter] });

    logging.logger.info({ user: { password: 'hunter2' } }, 'sign in');
    await logging.close();

    expect(records(adapter)[0]).toMatchObject({ user: { password: '[redacted]' } });
  });

  it('closes each adapter once, and survives one that throws', async () => {
    const close = vi.fn();
    const failing: LogAdapter = {
      ...capture('failing'),
      close: () => {
        throw new Error('nope');
      },
    };
    const closing: LogAdapter = { ...capture('closing'), close };

    const logging = createLogging({ adapters: [failing, closing] });
    await expect(logging.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it('stamps the base fields on every record', async () => {
    const adapter = capture('adapter');
    const logging = createLogging({ adapters: [adapter], base: { service: 'api' } });

    logging.logger.info('up');
    await logging.close();

    expect(records(adapter)[0]).toMatchObject({ service: 'api' });
  });
});

describe('built-in adapters', () => {
  it('writes json lines to a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manablox-log-'));
    const path = join(dir, 'nested', 'app.log');
    const logging = createLogging({ adapters: [{ type: 'file', path }] });

    logging.logger.info({ id: 7 }, 'written');
    await logging.close();

    expect(JSON.parse(readFileSync(path, 'utf8').trim())).toMatchObject({ msg: 'written', id: 7 });
    rmSync(dir, { recursive: true, force: true });
  });

  it('posts batches to an http endpoint and flushes what is left on close', async () => {
    const posted: { url: string; body: string }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      posted.push({ url: String(url), body: String(init?.body) });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const logging = createLogging({
      adapters: [{ type: 'http', url: 'https://logs.example/ingest', batchSize: 2 }],
    });

    logging.logger.info('one');
    logging.logger.info('two');
    logging.logger.info('three');
    await logging.close();

    expect(posted).toHaveLength(2);
    expect(posted[0]?.url).toBe('https://logs.example/ingest');
    expect(posted[0]?.body.trim().split('\n')).toHaveLength(2);
    expect(posted[1]?.body).toContain('three');
  });

  it('keeps running when the endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const logging = createLogging({
      adapters: [{ type: 'http', url: 'https://logs.example/ingest', batchSize: 1 }],
    });

    expect(() => logging.logger.info('lost')).not.toThrow();
    await expect(logging.close()).resolves.toBeUndefined();
  });
});

describe('registerLogAdapter', () => {
  it('resolves a plugin-registered type by name, with its options', async () => {
    const seen: Record<string, unknown>[] = [];
    registerLogAdapter('test-sink', (options) => {
      seen.push(options);
      return capture('test-sink');
    });

    const logging = createLogging({
      adapters: [{ type: 'test-sink', token: 'abc' } as never],
    });
    await logging.close();

    expect(seen).toEqual([{ token: 'abc' }]);
  });

  it('refuses an unknown type rather than dropping the destination', () => {
    expect(() => createLogging({ adapters: [{ type: 'nowhere' } as never] })).toThrow(
      /Unknown log adapter type: nowhere/,
    );
  });
});
