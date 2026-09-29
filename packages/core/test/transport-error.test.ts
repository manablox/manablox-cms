import { describe, expect, it } from 'vitest';
import {
  isExpectedError,
  isTransportError,
  ManabloxError,
  toTransportError,
} from '../src/errors.js';

describe('toTransportError', () => {
  it('keeps key, kind, status and details of a ManabloxError', () => {
    const error = ManabloxError.validation([{ key: 'content.slug.unique', path: ['slug'] }]);
    expect(toTransportError(error)).toEqual({
      key: 'validation.failed',
      kind: 'validation',
      status: 422,
      message: 'validation.failed',
      details: [{ key: 'content.slug.unique', path: ['slug'] }],
    });
    expect(error.toJSON()).toEqual(toTransportError(error));
  });

  it('masks only the details of internal errors', () => {
    const internal = new ManabloxError('internal.error', {
      details: [{ key: 'internal.error', params: { message: 'db host 10.0.0.7' } }],
    });
    expect(toTransportError(internal, { mask: true }).details).toEqual([]);
    expect(toTransportError(internal).details).toHaveLength(1);

    const notFound = ManabloxError.notFound('content.notFound', { id: 'x' });
    expect(toTransportError(notFound, { mask: true }).details).toHaveLength(1);
  });

  it('never exposes an unexpected error', () => {
    const transport = toTransportError(new Error('password=hunter2'));
    expect(transport).toEqual({
      key: 'internal.error',
      kind: 'internal',
      status: 500,
      message: 'Internal server error.',
      details: [],
    });
    expect(isExpectedError(new Error('x'))).toBe(false);
  });

  it('maps a thrown schema failure to validation details', () => {
    const failure = {
      data: { issues: [{ message: 'Too big', path: ['limit'], code: 'too_big', maximum: 100n }] },
    };
    expect(isExpectedError(failure)).toBe(true);
    expect(toTransportError(failure)).toMatchObject({
      key: 'validation.failed',
      status: 422,
      details: [
        {
          key: 'validation.invalid',
          path: ['limit'],
          params: { message: 'Too big', code: 'too_big', maximum: 100 },
        },
      ],
    });
  });

  it('gives rate limits their own kind', () => {
    expect(toTransportError(ManabloxError.rateLimited())).toMatchObject({
      key: 'rateLimit.exceeded',
      kind: 'rate_limited',
      status: 429,
    });
  });

  it('recognises the shape', () => {
    expect(isTransportError(toTransportError(new Error()))).toBe(true);
    expect(isTransportError({ key: 'x' })).toBe(false);
  });
});
