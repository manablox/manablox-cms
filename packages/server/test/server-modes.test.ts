import { definePlugin, type ManabloxConfig } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { PLUGIN_MODE_HEADERS } from '../src/surfaces/middleware.js';
import { type PluginModeSurface, pluginMode } from '../src/surfaces/mode.js';
import { pluginServer } from '../src/surfaces/plugins.js';
import { stubRuntime } from './helpers/runtime.js';

const SPACE = '00000000-0000-4000-8000-0000000000aa';

/** A mode answering `GET /probe` and serving plugin routes of its own scope. */
const probe = definePlugin({
  name: 'probe',
  modes: [
    pluginMode({
      name: 'probe',
      scopes: ['media'],
      surface: ({ plugin }): PluginModeSurface => ({
        mount(app) {
          app.get('/probe', (c) => c.json({ plugin: plugin.id }));
          app.get('/boom', () => {
            throw new Error('hidden');
          });
        },
        spaceOf: async () => SPACE,
        fallback: (c, status) => c.text(`probe ${status}`, status),
      }),
    }),
  ],
  server: pluginServer({
    routes: [
      {
        scopes: ['probe'],
        register(app, helpers) {
          app.get('/scope', (c) => c.json({ scope: helpers.scope }));
        },
      },
    ],
  }),
});

const runtimeFor = (config: Partial<ManabloxConfig>) =>
  stubRuntime({ plugins: [probe], ...config }).runtime;

describe('plugin server modes', () => {
  it("mounts the mode's surface, its scopes and the plugin routes of the mode", async () => {
    const runtime = runtimeFor({ server: { mode: 'probe', rateLimit: false } });
    expect(runtime.manablox.config.server.scopes).toEqual(['media']);
    expect(runtime.mode).toBe('probe');
    const app = await createApp(runtime);

    expect(await (await app.request('/probe')).json()).toEqual({ plugin: 'probe' });
    expect(await (await app.request('/plugins/probe/scope')).json()).toEqual({ scope: 'probe' });
    // Anonymous: no management surface, and the mode answers what nothing claims.
    const rpc = await app.request('/rpc/spaces/list', { method: 'POST' });
    expect(rpc.status).toBe(404);
    expect(await rpc.text()).toBe('probe 404');
    const failed = await app.request('/boom');
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe('probe 500');
  });

  it('sets the baseline security headers where a response has none, changed by the mode', async () => {
    const probeApp = await createApp(runtimeFor({ server: { mode: 'probe', rateLimit: false } }));
    const plain = await probeApp.request('/probe');
    for (const [name, value] of Object.entries(PLUGIN_MODE_HEADERS)) {
      expect(plain.headers.get(name), name).toBe(value);
    }

    const changed = pluginMode({
      name: 'probe',
      scopes: [],
      surface: (): PluginModeSurface => ({
        mount(app) {
          app.get('/own', (c) => c.text('own', 200, { 'x-frame-options': 'DENY' }));
        },
        headers: { 'Referrer-Policy': 'same-origin', 'x-frame-options': null, 'x-extra': '1' },
      }),
    });
    const app = await createApp(runtimeFor({ server: { mode: 'probe', rateLimit: false } }), {
      mode: changed,
    });
    const own = await app.request('/own');
    expect(own.headers.get('referrer-policy')).toBe('same-origin');
    expect(own.headers.get('x-extra')).toBe('1');
    // A response's own header wins; a dropped one is not added.
    expect(own.headers.get('x-frame-options')).toBe('DENY');
    expect((await app.request('/missing')).headers.get('x-frame-options')).toBeNull();
    expect(own.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('keeps plugin mode routes off core modes', async () => {
    const app = await createApp(runtimeFor({ server: { scopes: ['rpc'], rateLimit: false } }));
    expect((await app.request('/probe')).status).toBe(404);
    expect((await app.request('/plugins/probe/scope')).status).toBe(404);
  });

  it('refuses a mode no plugin declares', async () => {
    await expect(createApp(runtimeFor({}), { mode: 'nope' })).rejects.toMatchObject({
      key: 'config.mode.unknown',
    });
    expect(() => stubRuntime({ server: { mode: 'probe' } })).toThrow(
      expect.objectContaining({
        details: [
          expect.objectContaining({
            key: 'config.mode.unknown',
            params: { mode: 'probe', known: 'management, public' },
          }),
        ],
      }),
    );
  });
});
