import { resolveConfig } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { websitePlugin } from '../../src/index.js';

const base = {
  database: { url: 'postgres://localhost/test' },
  auth: { secret: 'x'.repeat(32) },
};

describe('the website mode', () => {
  it('adds the website mode and nothing under another name', () => {
    expect(() =>
      resolveConfig({
        ...base,
        plugins: [websitePlugin()],
        server: { mode: 'site' },
      }),
    ).toThrow(
      expect.objectContaining({
        details: [
          expect.objectContaining({
            key: 'config.mode.unknown',
            params: { mode: 'site', known: 'management, public, website' },
          }),
        ],
      }),
    );
    expect(
      resolveConfig({
        ...base,
        plugins: [websitePlugin()],
        server: { mode: 'website' },
      }).server.mode,
    ).toBe('website');
  });
});
