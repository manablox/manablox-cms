import { definePlugin, ManabloxError } from '@manablox/core';
import { os } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { managementRouter } from '../src/surfaces/plugin-rpc.js';

describe('plugin routers', () => {
  it('mounts a router built from the kit under plugins.<id>', () => {
    const plugin = definePlugin({
      name: '@acme/notes',
      rpc: ({ authed }) => ({ ping: authed.handler(() => 'pong') }),
    });
    const router = managementRouter([plugin]);
    expect(Object.keys(router.plugins ?? {})).toEqual(['acme.notes']);
    expect(router.content).toBeDefined();
  });

  it('leaves the core router alone without plugin routers', () => {
    expect(managementRouter([definePlugin({ name: 'plain' })]).plugins).toBeUndefined();
  });

  it('refuses procedures that skip the kit', () => {
    const plugin = definePlugin({
      name: 'sneaky',
      rpc: ({ authed }) => ({ ok: authed.handler(() => 1), open: { raw: os.handler(() => 2) } }),
    });
    const error = (() => {
      try {
        managementRouter([plugin]);
      } catch (caught) {
        return caught;
      }
    })();
    expect(ManabloxError.is(error) && error.key).toBe('plugin.rpc.unguarded');
    expect(ManabloxError.is(error) && error.details[0]?.params).toMatchObject({
      procedures: ['open.raw'],
    });
  });
});
