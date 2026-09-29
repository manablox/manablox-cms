import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { contentTypeRouter } from '../src/routers/content-type.js';
import { failure, invoke, stubContext, superadmin } from './helpers/rpc.js';

describe('contentTypes.reload', () => {
  it('reloads through the service and answers the schema version', async () => {
    const contentTypes = { reload: vi.fn(async () => undefined) };
    const ctx = stubContext({ contentTypes: contentTypes as never, principal: superadmin() });
    (ctx.manablox.contentTypes as unknown as { schemaVersion: number }).schemaVersion = 7;
    expect(await invoke(contentTypeRouter.reload, undefined, ctx)).toEqual({ schemaVersion: 7 });
    expect(contentTypes.reload).toHaveBeenCalledOnce();
  });
});

describe('contentTypes.create', () => {
  it('bounds the label, description, icon and fields', async () => {
    const contentTypes = { create: vi.fn() };
    const ctx = stubContext({ contentTypes: contentTypes as never });
    const base = { spaceId: ids.space, name: 'page' };
    for (const input of [
      { ...base, label: 'x'.repeat(201) },
      { ...base, description: 'x'.repeat(1001) },
      { ...base, icon: 'x'.repeat(65) },
      { ...base, fields: Array.from({ length: 201 }, (_, i) => ({ name: `f${i}`, type: 'text' })) },
    ]) {
      expect(await failure(invoke(contentTypeRouter.create, input, ctx))).toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    expect(contentTypes.create).not.toHaveBeenCalled();
  });
});
