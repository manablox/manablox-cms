import { DefaultControls, ManabloxError } from '@manablox/core';
import { call, ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { authed, base } from '../src/base.js';
import type { RpcContext } from '../src/context.js';

const context = {
  principal: null,
  manablox: { controls: new DefaultControls() },
} as unknown as RpcContext;

const failWith = (error: unknown) =>
  base.input(z.object({ limit: z.number().max(10) })).handler(() => {
    throw error;
  });

async function caught(promise: Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    return error as ORPCError<string, unknown>;
  }
  throw new Error('expected the call to fail');
}

describe('RPC error mapping', () => {
  it('carries the transport shape as data', async () => {
    const procedure = failWith(ManabloxError.notFound('content.notFound', { id: 'x' }));
    const error = await caught(call(procedure, { limit: 1 }, { context }));

    expect(error).toBeInstanceOf(ORPCError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('content.notFound');
    expect(error.data).toEqual({
      key: 'content.notFound',
      kind: 'not_found',
      status: 404,
      message: 'content.notFound',
      details: [{ key: 'content.notFound', params: { id: 'x' } }],
    });
  });

  it('maps input validation to validation.failed with a detail per issue', async () => {
    const procedure = failWith(new Error('unreached'));
    const error = await caught(call(procedure, { limit: 50 }, { context }));

    expect(error.code).toBe('BAD_REQUEST');
    expect(error.status).toBe(422);
    expect(error.data).toMatchObject({
      key: 'validation.failed',
      kind: 'validation',
      status: 422,
      details: [
        {
          key: 'validation.invalid',
          path: ['limit'],
          params: expect.objectContaining({ code: 'too_big', maximum: 10 }),
        },
      ],
    });
  });

  it('maps a missing principal to unauthorized', async () => {
    const procedure = authed.handler(() => 'ok');
    const error = await caught(call(procedure, undefined, { context }));

    expect(error.status).toBe(401);
    expect(error.data).toMatchObject({ key: 'auth.unauthorized', kind: 'unauthorized' });
  });

  it('leaves unexpected errors to oRPC', async () => {
    const boom = new Error('boom');
    const error = await caught(call(failWith(boom), { limit: 1 }, { context }));
    expect(error).toBe(boom);
  });
});
