import type { PluginDataProvider } from '@manablox/core';
import { definePlugin } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { dataProviders, environmentProviders, transferProviders } from '../src/data/registry.js';

describe('plugin data providers', () => {
  it("hand their callbacks the owning plugin's context", async () => {
    const seen: unknown[] = [];
    const plugin = definePlugin({
      name: 'notes',
      data: [
        {
          kind: 'notes.rows',
          transfer: {
            section: { label: 'Notes' },
            count: async (context) => {
              seen.push(context.plugin?.services);
              return 0;
            },
            export: async () => [],
            import: async () => {},
          },
        },
      ],
    });
    const manablox = {
      config: { plugins: [plugin] },
      plugin: (name: string) => ({ id: name, services: { name } }),
    };
    const provider = dataProviders(manablox as never).find((entry) => entry.kind === 'notes.rows');
    await provider?.transfer?.count({
      manablox: manablox as never,
      repos: {} as never,
      spaceId: 's',
    });
    expect(seen).toEqual([{ name: 'notes' }]);
  });

  const transfer = (dependsOn: string[] = []) => ({
    section: { label: 'Rows', dependsOn },
    count: async () => 0,
    export: async () => [],
    import: async () => {},
  });
  const environments = (key: string, after: string[] = []) => ({
    key,
    after,
    load: async () => [],
    describe: () => ({ label: '', value: null }),
    copy: async () => {},
    promote: async () => {},
  });
  const instance = (...data: PluginDataProvider[][]) => ({
    config: {
      plugins: data.map((list, index) => definePlugin({ name: `p${index}`, data: list })),
    },
  });

  it('import sections after the kinds they depend on, core and missing ones aside', () => {
    const config = instance(
      [{ kind: 'p0.a', transfer: transfer(['p1.b', 'contentTypes', 'p9.gone']) }],
      [{ kind: 'p1.b', transfer: transfer(['credentials']) }],
    );
    expect(transferProviders(config as never).map(({ kind }) => kind)).toEqual(['p1.b', 'p0.a']);
  });

  it('refuses sections that depend on each other in a cycle', () => {
    const config = instance(
      [{ kind: 'p0.a', transfer: transfer(['p1.b']) }],
      [{ kind: 'p1.b', transfer: transfer(['p0.a']) }],
    );
    expect(() => transferProviders(config as never)).toThrow(/cycle: p0.a -> p1.b -> p0.a/);
  });

  it('runs promote groups after the groups their `after` names', () => {
    const config = instance(
      [{ kind: 'p0.a', environments: environments('first', ['second']) }],
      [{ kind: 'p1.b', environments: environments('second') }],
    );
    expect(environmentProviders(config as never).map(({ key }) => key)).toEqual([
      'second',
      'first',
    ]);
  });
});
