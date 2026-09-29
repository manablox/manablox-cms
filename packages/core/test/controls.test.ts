import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CONTROL_CATALOGUE,
  type ControlScope,
  type Controls,
  type ControlValue,
  checkLimits,
  controlDefault,
  controlEntry,
  DefaultControls,
  describeControls,
  type FeatureControl,
  type FeatureKey,
  featureDenied,
  isScopeAllowed,
  type LimitControl,
  ManabloxError,
  parseScopeLabel,
  type RateRule,
  readOnlyRefused,
  resolveAll,
  resolveControl,
  resolveFeature,
  resolveLimits,
  resolveMimeIntersection,
  resolveMostSpecific,
  resolveState,
  resolveStrictestMax,
  type ScopeChain,
  scopeChain,
  scopeLabel,
  stateRefusal,
  toTransportError,
  usageLevel,
  usagePeriod,
  validateControl,
} from '../src/index.js';
import { definePlugin } from '../src/plugin.js';
import { registerPluginCatalogue } from '../src/plugin-catalogue.js';

// A flag off by default that the narrowest scope decides, like a badge.
registerPluginCatalogue([
  definePlugin({
    name: 'badge',
    controls: {
      'features.plugins.badge.shown': {
        description: 'Shows a badge.',
        enabled: false,
        resolution: 'mostSpecific',
      },
    },
  }),
]);

const INSTANCE: ControlScope = { kind: 'instance' };
const GROUP: ControlScope = { kind: 'group', id: 'g1' };
const SPACE: ControlScope = { kind: 'space', id: 's1' };

const chain = <T>(instance?: T, group?: T, space?: T): ScopeChain<T> => [
  { scope: INSTANCE, value: instance },
  { scope: GROUP, value: group },
  { scope: SPACE, value: space },
];

describe('control catalogue', () => {
  it('describes every key with scopes, a default and a description', () => {
    const described = describeControls();
    // The registered plugin's key comes on top.
    expect(described.length).toBe(Object.keys(CONTROL_CATALOGUE).length + 1);
    for (const entry of described) {
      expect(entry.scopes.length).toBeGreaterThan(0);
      expect(entry.scopes).toContain('instance');
      expect(entry.description).not.toBe('');
      expect(validateControl(entry.key.replace('*', 'seo'), entry.default).ok).toBe(true);
    }
  });

  it('lists the defaults that restrict', () => {
    expect(
      describeControls()
        .filter((entry) => entry.restrictsByDefault)
        .map((entry) => entry.key),
    ).toEqual([
      'rateLimits.auth.mails',
      'retention.snapshotsDays',
      'retention.controlEventsDays',
      'features.plugins.badge.shown',
    ]);
  });

  it('matches plugin flags by pattern', () => {
    expect(controlEntry('features.plugins.seo')?.kind).toBe('feature');
    expect(controlEntry('features.plugins.')).toBeNull();
    expect(controlEntry('features.plugins.*')).toBeNull();
    expect(controlEntry('features.nope')).toBeNull();
    expect(controlEntry('toString')).toBeNull();
  });

  it('knows which scopes a key allows', () => {
    expect(isScopeAllowed('features.customRoles', 'group')).toBe(true);
    expect(isScopeAllowed('features.apiKeys', 'space')).toBe(false);
    expect(isScopeAllowed('limits.spaces', 'space')).toBe(false);
    expect(isScopeAllowed('unknown', 'instance')).toBe(false);
  });

  it('validates a feature flag', () => {
    expect(validateControl('features.sso', { enabled: false, presentation: 'hidden' })).toEqual({
      ok: true,
      value: { enabled: false, presentation: 'hidden' },
    });
    const bad = validateControl('features.sso', { enabled: 'no', link: 'ftp://x', extra: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.map((issue) => issue.path)).toEqual([['extra'], ['enabled'], ['link']]);
      expect(bad.issues[0]?.key).toBe('control.value.invalid');
    }
  });

  it('fills the limit mode and refuses negative maxima', () => {
    expect(validateControl('limits.seats', { max: 5 })).toEqual({
      ok: true,
      value: { max: 5, mode: 'hard' },
    });
    expect(validateControl('limits.seats', { max: -1, mode: 'hard' }).ok).toBe(false);
    expect(validateControl('usage.apiRequests', { max: null, mode: 'soft' }).ok).toBe(true);
  });

  it('validates rate rules, retention, uploads and messages', () => {
    expect(validateControl('rateLimits.delivery.space', { max: 6000, windowSeconds: 60 }).ok).toBe(
      true,
    );
    expect(validateControl('rateLimits.delivery.space', { max: 6000 }).ok).toBe(false);
    expect(validateControl('rateLimits.uploads.parallel', { max: 5 }).ok).toBe(true);
    expect(validateControl('rateLimits.graphql.depth', 0).ok).toBe(false);
    expect(validateControl('retention.versionsDays', 90).ok).toBe(true);
    expect(validateControl('retention.versionsDays', 1.5).ok).toBe(false);
    expect(validateControl('uploads.allowedMimeTypes', ['image/', 'application/pdf']).ok).toBe(
      true,
    );
    expect(validateControl('uploads.allowedMimeTypes', ['nope']).ok).toBe(false);
    expect(validateControl('uploads.allowedMimeTypes', []).ok).toBe(false);
    expect(validateControl('usagePeriodAnchorDay', 29).ok).toBe(false);
    expect(
      validateControl('admin.banners', [
        { id: 'b', level: 'warning', text: 'Pay', dismissible: false, audience: 'superadmin' },
      ]).ok,
    ).toBe(true);
    expect(validateControl('admin.links', { upgrade: 'https://example.com/up' }).ok).toBe(true);
    expect(validateControl('admin.links', { shop: 'https://example.com' }).ok).toBe(false);
  });

  it('keeps messages plain text and links http(s)', () => {
    const banner = (patch: Record<string, unknown>) =>
      validateControl('admin.banners', [
        { id: 'b', level: 'info', text: 'Hi', dismissible: true, audience: 'all', ...patch },
      ]).ok;
    expect(banner({ text: 'Plans < 5 seats & more' })).toBe(true);
    expect(banner({ text: 'Pay <a href="x">here</a>' })).toBe(false);
    expect(banner({ text: 'Hi <!-- x -->' })).toBe(false);
    expect(banner({ text: 'Bell\u0007' })).toBe(false);
    expect(banner({ text: 'Two\nlines' })).toBe(true);
    expect(banner({ link: 'javascript:alert(1)' })).toBe(false);
    expect(banner({ link: 'https://user:pw@example.com' })).toBe(false);
    expect(banner({ id: 'has space' })).toBe(false);
    expect(
      validateControl('admin.banners', [
        { id: 'b', level: 'info', text: 'A', dismissible: true, audience: 'all' },
        { id: 'b', level: 'info', text: 'B', dismissible: true, audience: 'all' },
      ]).ok,
    ).toBe(false);
    expect(validateControl('admin.links', { docs: 'ftp://example.com' }).ok).toBe(false);
    expect(validateControl('state', { status: 'readOnly', message: '<b>Paused</b>' }).ok).toBe(
      false,
    );
    expect(
      validateControl('features.databags', { enabled: false, message: '<script>x</script>' }).ok,
    ).toBe(false);
  });

  it('refuses unknown keys, scopes a key does not allow and suspended below the instance', () => {
    expect(validateControl('nope', true)).toEqual({
      ok: false,
      issues: [{ key: 'control.key.unknown', params: { key: 'nope' } }],
    });
    expect(validateControl('features.apiKeys', { enabled: false }, 'space')).toEqual({
      ok: false,
      issues: [
        { key: 'control.scope.notAllowed', params: { key: 'features.apiKeys', scope: 'space' } },
      ],
    });
    expect(validateControl('state', { status: 'suspended' }, 'instance').ok).toBe(true);
    expect(validateControl('state', { status: 'suspended' }, 'space').ok).toBe(false);
    expect(validateControl('state', { status: 'readOnly' }, 'group').ok).toBe(true);
  });

  it('types values by key', () => {
    expectTypeOf<ControlValue<'features.customRoles'>>().toEqualTypeOf<FeatureControl>();
    expectTypeOf<ControlValue<'features.plugins.seo'>>().toEqualTypeOf<FeatureControl>();
    expectTypeOf<ControlValue<'limits.seats'>>().toEqualTypeOf<LimitControl>();
    expectTypeOf<ControlValue<'rateLimits.delivery.ip'>>().toEqualTypeOf<RateRule | null>();
    expectTypeOf<ControlValue<'rateLimits.graphql.depth'>>().toEqualTypeOf<number>();
    expectTypeOf<'customRoles'>().toExtend<FeatureKey>();
    expectTypeOf<'plugins.seo'>().toExtend<FeatureKey>();
    expect(controlDefault('rateLimits.delivery.ip')).toEqual({ max: 300, windowSeconds: 60 });
  });
});

describe('scopes', () => {
  it('builds the chain for a space', () => {
    expect(scopeChain(null)).toEqual([INSTANCE]);
    expect(scopeChain('s1')).toEqual([INSTANCE, SPACE]);
    expect(scopeChain('s1', 'g1')).toEqual([INSTANCE, GROUP, SPACE]);
  });

  it('labels scopes and reads labels back', () => {
    for (const scope of [INSTANCE, GROUP, SPACE]) {
      expect(parseScopeLabel(scopeLabel(scope))).toEqual(scope);
    }
    expect(scopeLabel(SPACE)).toBe('space:s1');
    expect(parseScopeLabel('space:')).toBeNull();
  });
});

type Flag = FeatureControl | undefined;
const FLAG_STATES: Flag[] = [undefined, { enabled: true }, { enabled: false }];

describe('resolveFeature', () => {
  it('is on only when no scope switches it off, for every combination', () => {
    for (const instance of FLAG_STATES) {
      for (const group of FLAG_STATES) {
        for (const space of FLAG_STATES) {
          const expected = [instance, group, space].every((flag) => flag?.enabled !== false);
          expect(resolveFeature(chain(instance, group, space), { enabled: true }).enabled).toBe(
            expected,
          );
        }
      }
    }
  });

  it('uses the default for an unset instance only', () => {
    expect(resolveFeature(chain(), { enabled: false }).enabled).toBe(false);
    expect(resolveFeature(chain({ enabled: true }), { enabled: false }).enabled).toBe(true);
  });

  it('takes the most specific presentation, and the message of the scope that switches off', () => {
    const resolved = resolveFeature(
      chain<FeatureControl>(
        { enabled: false, presentation: 'hidden', message: 'instance', link: 'https://i' },
        { enabled: true, presentation: 'locked', message: 'group' },
        undefined,
      ),
      { enabled: true },
    );
    expect(resolved).toEqual({
      enabled: false,
      presentation: 'locked',
      message: 'instance',
      link: 'https://i',
    });
    expect(resolveFeature(chain(), { enabled: true })).toEqual({
      enabled: true,
      presentation: 'locked',
    });
  });

  it('lets the most specific scope decide for flags that resolve that way', () => {
    const badge = (instance?: boolean, space?: boolean) =>
      resolveControl(
        'features.plugins.badge.shown',
        chain(
          instance === undefined ? undefined : { enabled: instance },
          undefined,
          space === undefined ? undefined : { enabled: space },
        ),
      ).enabled;
    expect(badge()).toBe(false);
    expect(badge(true)).toBe(true);
    expect(badge(undefined, true)).toBe(true);
    expect(badge(true, false)).toBe(false);
  });
});

describe('resolveLimits', () => {
  const unlimited: LimitControl = { max: null, mode: 'hard' };
  const at = (max: number, mode: LimitControl['mode'] = 'hard'): LimitControl => ({ max, mode });

  it('keeps each set limit with its scope, for every combination', () => {
    const states: (LimitControl | undefined)[] = [undefined, unlimited, at(5), at(3, 'off')];
    for (const instance of states) {
      for (const group of states) {
        for (const space of states) {
          const resolved = resolveLimits(chain(instance, group, space), unlimited);
          const expected = [
            [INSTANCE, instance],
            [GROUP, group],
            [SPACE, space],
          ].filter(([, value]) => (value as LimitControl | undefined)?.max === 5);
          expect(resolved.map((limit) => limit.scope)).toEqual(expected.map(([scope]) => scope));
        }
      }
    }
  });

  it('fills thresholds and applies a default at the instance', () => {
    expect(resolveLimits(chain(), at(2, 'soft'))).toEqual([
      { scope: INSTANCE, max: 2, mode: 'soft', thresholds: [80, 100] },
    ]);
  });

  it('refuses at the first hard limit and lists soft ones', () => {
    const limits = resolveLimits(chain(at(10), at(4, 'soft'), at(5)), unlimited);
    const used = new Map([
      ['instance', 3],
      ['group:g1', 4],
      ['space:s1', 5],
    ]);
    const result = checkLimits(limits, (scope) => used.get(scopeLabel(scope)) ?? 0);
    expect(result.hard?.limit.scope).toEqual(SPACE);
    expect(result.soft.map((breach) => breach.limit.scope)).toEqual([GROUP]);
    expect(checkLimits(limits, () => 3, 0).hard).toBeNull();
  });

  it('grades usage', () => {
    const level = (limit: LimitControl, used: number) =>
      usageLevel(resolveLimits(chain(limit), unlimited), () => used);
    expect(level(at(100), 10)).toBe('ok');
    expect(level(at(100), 80)).toBe('warn');
    expect(level(at(100), 100)).toBe('blocked');
    expect(level(at(100, 'soft'), 100)).toBe('warn');
    expect(level(at(100, 'soft'), 101)).toBe('over');
    expect(level(unlimited, 1e9)).toBe('ok');
  });
});

describe('other resolutions', () => {
  it('takes the most specific set value for every combination', () => {
    const values = [undefined, 1, 2];
    for (const instance of values) {
      for (const group of values) {
        for (const space of [undefined, 3]) {
          expect(resolveMostSpecific(chain(instance, group, space), 0)).toBe(
            space ?? group ?? instance ?? 0,
          );
        }
      }
    }
  });

  it('takes the smallest upload size', () => {
    expect(resolveStrictestMax(chain(), null)).toBeNull();
    expect(resolveStrictestMax(chain(10, null, 5), null)).toBe(5);
    expect(resolveStrictestMax(chain(3, undefined, 5), null)).toBe(3);
  });

  it('intersects MIME lists', () => {
    expect(resolveMimeIntersection(chain(), null)).toBeNull();
    expect(
      resolveMimeIntersection(chain(['image/', 'application/pdf'], null, ['image/png']), null),
    ).toEqual(['image/png']);
    expect(resolveMimeIntersection(chain(['image/png'], ['image/']), null)).toEqual(['image/png']);
    expect(resolveMimeIntersection(chain(['image/'], undefined, ['video/']), null)).toEqual([]);
  });

  it('takes the most severe state', () => {
    expect(resolveState(chain(), { status: 'active' })).toEqual({ status: 'active', scope: null });
    expect(
      resolveState(
        chain({ status: 'readOnly', message: 'invoice' }, undefined, { status: 'readOnly' }),
        { status: 'active' },
      ),
    ).toEqual({ status: 'readOnly', scope: SPACE });
    expect(
      resolveState(chain({ status: 'suspended', message: 'gone' }, { status: 'readOnly' }), {
        status: 'active',
      }),
    ).toEqual({ status: 'suspended', scope: INSTANCE, message: 'gone' });
  });

  it('resolves every key at once', () => {
    const resolved = resolveAll(
      [
        {
          scope: INSTANCE,
          values: {
            'features.sso': { enabled: false },
            'features.plugins.seo': { enabled: false },
            'limits.spaces': { max: 5, mode: 'hard' },
            'admin.banners': [
              { id: 'a', level: 'info', text: 'Hi', dismissible: true, audience: 'all' },
            ],
          },
        },
        {
          scope: SPACE,
          values: {
            'rateLimits.delivery.ip': { max: 50, windowSeconds: 60 },
            'retention.versionsDays': 30,
            'admin.banners': [
              { id: 'b', level: 'info', text: 'Space', dismissible: true, audience: 'all' },
            ],
          },
        },
      ],
      {},
    );
    expect(resolved.features.sso.enabled).toBe(false);
    expect(resolved.features.customRoles.enabled).toBe(true);
    expect(resolved.features['plugins.seo']?.enabled).toBe(false);
    expect(resolved.features['plugins.badge.shown']?.enabled).toBe(false);
    expect(resolved.limits.spaces).toHaveLength(1);
    expect(resolved.limits.seats).toEqual([]);
    expect(resolved.rateLimits['delivery.ip']).toEqual({ max: 50, windowSeconds: 60 });
    expect(resolved.rateLimits['management.apiKey']).toEqual({ max: 600, windowSeconds: 60 });
    expect(resolved.rateLimits['graphql.depth']).toBe(8);
    expect(resolved.retention.versionsDays).toBe(30);
    expect(resolved.retention.snapshotsDays).toBe(7);
    expect(resolved.messages.banners.map((banner) => banner.id)).toEqual(['a', 'b']);
    expect(resolved.usage.periodAnchorDay).toBe(1);
    expect(resolved.state.status).toBe('active');
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
  });
});

describe('usagePeriod', () => {
  it('starts months on the anchor day', () => {
    const period = usagePeriod(new Date('2026-10-14T12:00:00Z'));
    expect(period.label).toBe('2026-10');
    expect(period.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    const anchored = usagePeriod(new Date('2026-01-10T00:00:00Z'), 15);
    expect(anchored.label).toBe('2025-12');
    expect(anchored.start.toISOString()).toBe('2025-12-15T00:00:00.000Z');
    expect(anchored.end.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('control errors', () => {
  it('carries the status and params', () => {
    const denied = toTransportError(
      featureDenied('sso', { enabled: false, presentation: 'locked', message: 'Upgrade' }),
    );
    expect(denied).toMatchObject({ key: 'control.feature', kind: 'forbidden', status: 403 });
    expect(denied.details[0]?.params).toEqual({ feature: 'sso', message: 'Upgrade', link: null });
    const locked = readOnlyRefused(SPACE, null);
    expect(locked.status).toBe(423);
    expect(locked.details[0]?.params).toEqual({ scope: 'space:s1', reason: null });
  });

  it('refuses writes by state', () => {
    expect(stateRefusal({ status: 'active', scope: null })).toBeNull();
    const readOnly = stateRefusal({ status: 'readOnly', scope: SPACE, message: 'Over' });
    expect(readOnly?.key).toBe('control.readOnly');
    expect(readOnly?.details[0]?.params).toEqual({ scope: 'space:s1', reason: 'Over' });
    const suspended = stateRefusal({ status: 'suspended', scope: { kind: 'instance' } });
    expect(suspended?.status).toBe(423);
    expect(suspended?.key).toBe('control.suspended');
    expect(suspended?.details[0]?.params).toEqual({ reason: null });
  });
});

describe('DefaultControls', () => {
  const controls: Controls = new DefaultControls();

  it('leaves features on except those off by default', async () => {
    await expect(controls.assertFeature('s1', 'customRoles')).resolves.toBeUndefined();
    await expect(controls.assertFeature(null, 'plugins.seo')).resolves.toBeUndefined();
    const error = await controls
      .assertFeature('s1', 'plugins.badge.shown')
      .catch((caught) => caught);
    expect(ManabloxError.is(error) && error.key).toBe('control.feature');
  });

  it('has no limits and counts nothing', async () => {
    expect(await controls.limit('s1', 'seats')).toEqual([]);
    await expect(controls.assertLimit('s1', 'seats', { increment: 1 })).resolves.toEqual([]);
    expect(() => controls.consume('s1', 'apiRequests', 1)).not.toThrow();
  });

  it('resolves the defaults per space', async () => {
    const resolved = await controls.resolved('s1');
    expect(resolved.scopes).toEqual([INSTANCE, SPACE]);
    resolved.features.sso.enabled = false;
    expect((await controls.resolved('s1')).features.sso.enabled).toBe(true);
  });
});
