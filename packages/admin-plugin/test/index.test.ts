import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AdminFieldComponents,
  type AdminPlugin,
  type AdminPluginContext,
  type AdminSlotProps,
  type ComponentLoader,
  defineAdminPlugin,
  enabledSwitchOutcome,
} from '../src/index.js';

const loader: ComponentLoader = async () => ({ default: { name: 'Stub' } });

describe('defineAdminPlugin', () => {
  it('returns the plugin unchanged', () => {
    const plugin: AdminPlugin = {
      name: 'reviews',
      routes: [{ path: '/reviews', name: 'reviews', component: loader, inSpace: true }],
      menu: [{ label: 'Reviews', to: '/reviews', order: 150, shortcut: 'r' }],
      fields: { inputs: { rating: loader }, settings: { rating: loader } },
    };
    expect(defineAdminPlugin(plugin)).toBe(plugin);
  });

  it('accepts a plugin with only a name', () => {
    expect(defineAdminPlugin({ name: 'bare' })).toEqual({ name: 'bare' });
  });

  it('hands setup its id, slot declarations and api', () => {
    const registered: unknown[] = [];
    const plugin = defineAdminPlugin({
      name: 'setup',
      setup: ({ id, defineSlot, expose }) => {
        registered.push(defineSlot('board'));
        expose({ owner: id });
      },
    });
    const context: AdminPluginContext = {
      id: 'setup',
      defineSlot: (name) => `setup:${name}`,
      expose: (api) => registered.push(api),
    };
    plugin.setup?.(context);
    expect(registered).toEqual(['setup:board', { owner: 'setup' }]);
  });

  it('types each slot by its props', () => {
    expectTypeOf<AdminSlotProps['space.settings.sections']>().toHaveProperty('space');
    expectTypeOf<AdminSlotProps['block.inspector']['update']>().toBeFunction();
    expectTypeOf<AdminSlotProps['content.preview.target']['preview']['setTarget']>().toBeFunction();
    expectTypeOf<keyof AdminSlotProps>().toEqualTypeOf<
      | 'app.sidePanels'
      | 'content.editor.views'
      | 'content.editor.actions'
      | 'block.inspector'
      | 'content.preview.target'
      | 'contentType.actions'
      | 'contentType.presets'
      | 'space.create.steps'
      | 'space.settings.sections'
      | 'space.domains'
      | 'transfer.sections'
      | 'usage.lines'
      | 'audit.entities'
      | 'environment.address'
      | 'field.actions'
      | 'assets.actions'
      | 'contentType.list.actions'
      | 'template.list.actions'
      | 'space.create.starters'
    >();
    expectTypeOf<AdminSlotProps['field.actions']['update']>().toBeFunction();
    expectTypeOf<AdminSlotProps['space.create.starters']>().toHaveProperty('setDraft');
  });
});

describe('enabledSwitchOutcome', () => {
  it('reads the new state of `enabled`', () => {
    expect(enabledSwitchOutcome(null, [{ path: 'enabled', from: false, to: true }])).toBe('on');
    expect(enabledSwitchOutcome(null, [{ path: 'enabled', from: true, to: false }])).toBe('off');
    expect(enabledSwitchOutcome(null, [{ path: 'name', to: 'x' }])).toBeNull();
  });
});

describe('field component contract', () => {
  it('keys inputs and settings forms by string, each a lazy component loader', async () => {
    const fields: AdminFieldComponents = {
      inputs: { rating: loader },
      settings: { rating: async () => ({ default: { props: ['settings', 'field', 'readOnly'] } }) },
    };
    expectTypeOf(fields.inputs).toEqualTypeOf<Record<string, ComponentLoader> | undefined>();
    expectTypeOf(fields.settings).toEqualTypeOf<Record<string, ComponentLoader> | undefined>();
    const settings = await fields.settings?.rating?.();
    expect(settings?.default).toEqual({ props: ['settings', 'field', 'readOnly'] });
  });

  it('allows either map to be left out', () => {
    expectTypeOf<{ inputs: Record<string, ComponentLoader> }>().toExtend<AdminFieldComponents>();
    expectTypeOf<{ settings: Record<string, ComponentLoader> }>().toExtend<AdminFieldComponents>();
    expectTypeOf<Record<string, never>>().toExtend<AdminFieldComponents>();
  });

  it('types a loader as a dynamic import of a module with a default export', () => {
    expectTypeOf<ComponentLoader>().returns.toExtend<Promise<{ default: unknown }>>();
    // @ts-expect-error a loader must resolve to a module, not a bare component
    const bare: ComponentLoader = async () => ({ name: 'Stub' });
    expect(bare).toBeTypeOf('function');
  });
});
