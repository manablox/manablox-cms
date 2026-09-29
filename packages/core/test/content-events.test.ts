import { describe, expect, it, vi } from 'vitest';
import { contentEventHooks } from '../src/content-events.js';
import type { ContentRecord } from '../src/types.js';

const row = (id: string) =>
  ({ id, spaceId: 's1', environmentId: 'e1', permalink: null }) as unknown as ContentRecord;

describe('contentEventHooks', () => {
  it('turns the content hooks into content events with their scope', async () => {
    const handler = vi.fn(async () => {});
    const hooks = contentEventHooks(handler, { priority: 200 });
    expect(hooks.map((entry) => [entry.hook, entry.priority])).toEqual([
      ['content:afterCreate', 200],
      ['content:afterUpdate', 200],
      ['content:afterPublish', 200],
      ['content:afterDeleteMany', 200],
      ['content:afterUnpublishMany', 200],
    ]);
    const call = (index: number, payload: unknown, context: object) =>
      (hooks[index]?.handler as (p: unknown, c: unknown) => Promise<void>)(payload, context);

    await call(1, row('a'), { manablox: {} });
    expect(handler).toHaveBeenLastCalledWith(
      'content.updated',
      [row('a')],
      expect.objectContaining({ spaceId: 's1', scope: { spaceId: 's1', environmentId: 'e1' } }),
    );
    await call(3, [], { manablox: {}, spaceId: 's1' });
    expect(handler).toHaveBeenLastCalledWith(
      'content.deleted',
      [],
      expect.objectContaining({ scope: 's1' }),
    );
  });
});
