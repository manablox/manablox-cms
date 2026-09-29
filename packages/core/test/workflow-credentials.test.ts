import { describe, expect, it } from 'vitest';
import { API_KEY_HEADER, apiKeyHeader } from '../src/index.js';

describe('apiKeyHeader', () => {
  it('sends the key in the named header, after the prefix', () => {
    expect(apiKeyHeader({ header: 'Authorization', key: 'k', prefix: 'Token' })).toEqual({
      name: 'Authorization',
      value: 'Token k',
    });
  });

  it('falls back to X-Api-Key and no prefix', () => {
    expect(apiKeyHeader({ key: 'k', header: ' ', prefix: '' })).toEqual({
      name: API_KEY_HEADER,
      value: 'k',
    });
    expect(API_KEY_HEADER).toBe('X-Api-Key');
  });
});
