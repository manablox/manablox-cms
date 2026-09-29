import {
  ApiResponseError,
  errorDetails,
  errorKey,
  responseError,
} from '@manablox/admin-sdk/lib/api-errors';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { describe, expect, it } from 'vitest';

const transport = (over: Record<string, unknown> = {}) => ({
  key: 'content.notFound',
  kind: 'not_found',
  status: 404,
  message: 'content.notFound',
  details: [{ key: 'content.notFound', params: { id: 'x' } }],
  ...over,
});

describe('api errors', () => {
  it('reads key and details from an oRPC error', () => {
    const error = Object.assign(new Error('content.notFound'), { data: transport() });
    expect(errorKey(error)).toBe('content.notFound');
    expect(errorDetails(error)).toEqual([{ key: 'content.notFound', params: { id: 'x' } }]);
    expect(messageFor(error)).toBe('That document no longer exists.');
  });

  it('words schema issues from their params', () => {
    const error = {
      data: transport({
        key: 'validation.failed',
        details: [
          {
            key: 'validation.invalid',
            path: ['name'],
            params: { message: 'Too small', code: 'too_small', origin: 'string', minimum: 3 },
          },
          {
            key: 'validation.invalid',
            path: ['slug'],
            params: {
              message: 'Invalid input: expected string, received undefined',
              code: 'invalid_type',
            },
          },
        ],
      }),
    };
    expect(errorDetails(error).map((detail) => detail.params?.message)).toEqual([
      'Use at least 3 characters.',
      'This is required.',
    ]);
  });

  it('turns an `{ error }` response into an error messageFor reads', async () => {
    const response = new Response(JSON.stringify({ error: transport() }), { status: 404 });
    const error = await responseError(response);
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(errorKey(error)).toBe('content.notFound');
    expect(messageFor(error)).toBe('That document no longer exists.');
  });

  it('falls back to internal.error for a body without an envelope', async () => {
    const error = await responseError(new Response('<html>', { status: 502 }));
    expect(error.data).toMatchObject({ key: 'internal.error', status: 502 });
  });

  it('falls back to the message of a plain error', () => {
    expect(errorKey(new Error('Failed to fetch'))).toBe('Failed to fetch');
    expect(errorDetails(new Error('x'))).toEqual([]);
  });
});
