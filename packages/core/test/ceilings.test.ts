import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/ids.node.js';
import {
  type AdminBanner,
  type ControlScope,
  DefaultControls,
  type FeatureCeilingProvider,
  FeatureCeilings,
  type FeatureControl,
  type FeatureKey,
  type FeatureScope,
  resolveAll,
  resolveControl,
  resolveFeature,
  type ScopeChain,
} from '../src/index.js';
import { definePlugin } from '../src/plugin.js';
import { registerPluginCatalogue } from '../src/plugin-catalogue.js';

registerPluginCatalogue([
  definePlugin({
    name: 'capped',
    controls: {
      'features.plugins.capped.badge': {
        description: 'Shows a badge.',
        enabled: false,
        resolution: 'mostSpecific',
      },
    },
  }),
]);

const CEILING = { kind: 'ceiling' } as const;
const INSTANCE: ControlScope = { kind: 'instance' };
const GROUP: ControlScope = { kind: 'group', id: 'g1' };
const SPACE: ControlScope = { kind: 'space', id: 's1' };

const chain = (
  ceiling: FeatureControl | undefined,
  instance?: FeatureControl,
  group?: FeatureControl,
  space?: FeatureControl,
): ScopeChain<FeatureControl, FeatureScope> => [
  ...(ceiling ? [{ scope: CEILING, value: ceiling }] : []),
  { scope: INSTANCE, value: instance },
  { scope: GROUP, value: group },
  { scope: SPACE, value: space },
];

const locked: FeatureControl = {
  enabled: false,
  presentation: 'locked',
  message: 'Needs a license',
  link: 'https://buy',
};

/** A provider whose values a test changes, moving its version. */
function provider(features: Record<string, FeatureControl> = {}, banners: AdminBanner[] = []) {
  let version = 0;
  let current = new Map(Object.entries(features)) as Map<FeatureKey, FeatureControl>;
  const self: FeatureCeilingProvider & { set(next: Record<string, FeatureControl>): void } = {
    features: () => current,
    version: () => version,
    banners: () => banners,
    set(next) {
      current = new Map(Object.entries(next)) as Map<FeatureKey, FeatureControl>;
      version++;
    },
  };
  return self;
}

describe('resolveFeature under a ceiling', () => {
  it('is off when the ceiling is off, even with instance, group and space on', () => {
    const on = { enabled: true, message: 'stored' };
    expect(resolveFeature(chain(locked, on, on, on), { enabled: true })).toEqual({
      enabled: false,
      presentation: 'locked',
      message: 'Needs a license',
      link: 'https://buy',
    });
  });

  it('keeps the stored message when a stored scope is off too, the ceiling filling in', () => {
    expect(
      resolveFeature(chain(locked, undefined, undefined, { enabled: false, message: 'tier' }), {
        enabled: true,
      }),
    ).toEqual({ enabled: false, presentation: 'locked', message: 'tier', link: 'https://buy' });
  });

  it('takes the presentation from the ceiling when it alone is off', () => {
    const hidden = { enabled: false, presentation: 'hidden' } as const;
    expect(
      resolveFeature(chain(hidden, { enabled: true, presentation: 'locked' }), { enabled: true }),
    ).toEqual({ enabled: false, presentation: 'hidden' });
  });

  it('changes nothing when the ceiling is on', () => {
    expect(
      resolveFeature(chain({ enabled: true, message: 'x' }, { enabled: false }), { enabled: true }),
    ).toEqual({ enabled: false, presentation: 'locked' });
    expect(resolveFeature(chain({ enabled: true }), { enabled: true }).enabled).toBe(true);
  });

  it('decides a most-specific flag with its own message and link', () => {
    const on = { enabled: true, message: 'space' };
    expect(
      resolveControl(
        'features.plugins.capped.badge',
        chain(locked, undefined, undefined, on) as never,
      ),
    ).toEqual({
      enabled: false,
      presentation: 'locked',
      message: 'Needs a license',
      link: 'https://buy',
    });
  });
});

describe('FeatureCeilings', () => {
  it('combines providers: the first that has a feature off wins, on values drop out', () => {
    const ceilings = new FeatureCeilings();
    expect(ceilings.current().version).toBe('');
    ceilings.add(
      provider({ 'plugins.a': { enabled: true }, 'plugins.b': { enabled: false, message: '1' } }),
    );
    ceilings.add(provider({ 'plugins.a': locked, 'plugins.b': { enabled: false, message: '2' } }));
    const { features, version } = ceilings.current();
    expect(version).toBe('0:0');
    expect(Object.fromEntries(features)).toEqual({
      'plugins.a': locked,
      'plugins.b': { enabled: false, message: '1' },
    });
  });

  it('combines again only when a version moves', () => {
    const ceilings = new FeatureCeilings();
    const one = provider();
    ceilings.add(one);
    const first = ceilings.current();
    expect(ceilings.current()).toBe(first);
    one.set({ 'plugins.a': locked });
    expect(ceilings.current()).not.toBe(first);
    expect(ceilings.current().features.get('plugins.a' as FeatureKey)).toEqual(locked);
  });
});

describe('resolveAll under ceilings', () => {
  const banner: AdminBanner = {
    id: 'license',
    level: 'warning',
    text: 'Payment failed',
    dismissible: true,
    audience: 'superadmin',
  };

  it('adds ceiling flags no scope stores, and puts ceiling banners first', () => {
    const ceilings = new FeatureCeilings();
    ceilings.add(provider({ 'plugins.capped': locked, approvals: locked }, [banner]));
    const resolved = resolveAll(
      [
        {
          scope: INSTANCE,
          values: {
            'features.approvals': { enabled: true },
            'admin.banners': [{ ...banner, id: 'stored' }],
          },
        },
      ],
      {},
      ceilings.current(),
    );
    expect(resolved.features['plugins.capped']?.enabled).toBe(false);
    expect(resolved.features.approvals.message).toBe('Needs a license');
    expect(resolved.messages.banners.map((entry) => entry.id)).toEqual(['license', 'stored']);
  });
});

describe('DefaultControls under ceilings', () => {
  it('follows a ceiling in feature, assertFeature and resolved, per version', async () => {
    const ceilings = new FeatureCeilings();
    const one = provider();
    ceilings.add(one);
    const controls = new DefaultControls(ceilings);
    expect((await controls.feature('s1', 'approvals')).enabled).toBe(true);
    expect((await controls.resolved(null)).features.approvals.enabled).toBe(true);

    one.set({ approvals: locked });
    expect(await controls.feature('s1', 'approvals')).toMatchObject({ enabled: false });
    await expect(controls.assertFeature('s1', 'approvals')).rejects.toMatchObject({
      key: 'control.feature',
    });
    expect((await controls.resolved(null)).features.approvals.enabled).toBe(false);
  });
});

describe('uuidv7', () => {
  it('is a version 7 uuid that sorts by time', () => {
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_700_000_000_001);
    expect(early).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(early < late).toBe(true);
    expect(early.slice(0, 13).replace('-', '')).toBe(
      (1_700_000_000_000).toString(16).padStart(12, '0'),
    );
  });
});
