import {
  diffView,
  environmentRows,
  promoteConfirmText,
  promoteOutcome,
  promoteReady,
  switcherState,
  switchPath,
} from '@manablox/admin-sdk/features/environments/model';
import type {
  Environment,
  EnvironmentDiff,
  PromoteResult,
} from '@manablox/admin-sdk/features/environments/queries';
import { FEATURE_ON, type FeatureState } from '@manablox/admin-sdk/lib/features';
import { describe, expect, it } from 'vitest';

const off = (presentation: 'hidden' | 'locked'): FeatureState => ({
  enabled: false,
  hidden: presentation === 'hidden',
  locked: presentation === 'locked',
  message: null,
  link: null,
});

const env = (machineName: string, extra: Partial<Environment> = {}): Environment => ({
  id: `id-${machineName}`,
  machineName,
  name: machineName === 'production' ? 'Production' : 'Staging',
  kind: machineName === 'production' ? 'production' : 'staging',
  createdFrom: null,
  createdMode: null,
  createdAt: new Date('2026-09-26T10:00:00Z'),
  updatedAt: new Date('2026-09-26T10:00:00Z'),
  ...extra,
});

const production = env('production');
const staging = env('staging', { createdFrom: 'id-production', createdMode: 'config' });

const diff = (extra: Partial<EnvironmentDiff> = {}): EnvironmentDiff => ({
  environment: 'staging',
  mode: 'config',
  contentTypes: [],
  changes: [],
  breaking: false,
  confirmRequired: false,
  ...extra,
});

describe('the environment switcher', () => {
  it('hides while production is the only environment', () => {
    expect(switcherState(FEATURE_ON, [production])).toBe('hidden');
    expect(switcherState(FEATURE_ON, undefined)).toBe('hidden');
  });

  it('offers the environments once there is a staging one', () => {
    expect(switcherState(FEATURE_ON, [production, staging])).toBe('select');
  });

  it('hides with the feature hidden and shows a lock with it locked', () => {
    expect(switcherState(off('hidden'), [production, staging])).toBe('hidden');
    expect(switcherState(off('locked'), [production])).toBe('locked');
  });
});

describe('environment rows', () => {
  it('names where a staging copy came from and how', () => {
    const [first, second] = environmentRows([production, staging]);
    expect(first).toMatchObject({ production: true, origin: '', kind: 'production' });
    expect(second).toMatchObject({
      production: false,
      origin: 'Copied from Production (config only)',
      machineName: 'staging',
    });
  });

  it('copes with a deleted source', () => {
    const orphan = env('qa', { createdFrom: 'gone', createdMode: 'full' });
    expect(environmentRows([orphan])[0]?.origin).toBe(
      'Copied from a deleted environment (config and content)',
    );
  });
});

describe('the promote diff', () => {
  const breaking = diff({
    breaking: true,
    confirmRequired: true,
    contentTypes: [
      {
        id: 't1',
        name: 'article',
        label: 'Article',
        status: 'changed',
        documents: 12,
        fields: [
          {
            name: 'subtitle',
            label: 'Subtitle',
            status: 'removed',
            from: 'text',
            to: null,
            documents: 3,
          },
          {
            name: 'rating',
            label: 'Rating',
            status: 'retyped',
            from: 'text',
            to: 'number',
            documents: 1,
          },
          {
            name: 'teaser',
            label: 'Teaser',
            status: 'added',
            from: null,
            to: 'text',
            documents: 0,
          },
        ],
      },
    ],
    changes: [
      {
        kind: 'menus',
        added: 1,
        changed: 0,
        removed: 2,
        items: [{ status: 'added', id: 'm1', label: 'Footer' }],
        truncated: true,
      },
      { kind: 'redirects', added: 0, changed: 0, removed: 0, items: [], truncated: false },
    ],
  });

  it('lists changed types with their fields and affected documents', () => {
    const view = diffView(breaking);
    expect(view.empty).toBe(false);
    expect(view.types[0]).toMatchObject({
      label: 'Article',
      documents: 'used by 12 production documents',
    });
    expect(view.types[0]?.fields).toEqual([
      expect.objectContaining({
        label: 'Subtitle',
        breaking: true,
        documents: '3 production documents hold a value',
      }),
      expect.objectContaining({
        label: 'Rating',
        breaking: true,
        types: 'text -> number',
        documents: '1 production document holds a value',
      }),
      expect.objectContaining({ label: 'Teaser', breaking: false, documents: '' }),
    ]);
  });

  it('summarises the other kinds and drops unchanged ones', () => {
    const view = diffView(breaking);
    expect(view.kinds).toHaveLength(1);
    expect(view.kinds[0]).toMatchObject({
      label: 'Menus',
      summary: '1 new, 2 removed',
      more: true,
    });
    expect(view.kinds[0]?.items[0]).toMatchObject({ label: 'Footer', badge: { text: 'new' } });
  });

  it('reads as empty when nothing changes', () => {
    expect(diffView(diff()).empty).toBe(true);
  });

  it('asks for the machine name only when the diff requires confirmation', () => {
    expect(promoteConfirmText(breaking, 'staging')).toBe('staging');
    expect(promoteConfirmText(diff(), 'staging')).toBeNull();
    expect(promoteReady(breaking, 'staging', '')).toBe(false);
    expect(promoteReady(breaking, 'staging', 'Staging')).toBe(false);
    expect(promoteReady(breaking, 'staging', ' staging ')).toBe(true);
    expect(promoteReady(diff(), 'staging', '')).toBe(true);
    expect(promoteReady(undefined, 'staging', 'staging')).toBe(false);
  });
});

describe('the promote result', () => {
  const result = (status: PromoteResult['status']): PromoteResult =>
    ({
      environment: 'staging',
      mode: 'config',
      status,
      snapshot: status === 'applied' ? 'snap' : null,
      groups: [
        { group: 'contentTypes', status: 'applied', error: null },
        {
          group: 'menus',
          status: status === 'applied' ? 'applied' : 'failed',
          error: status === 'applied' ? null : 'internal.error',
        },
        { group: 'redirects', status: status === 'applied' ? 'applied' : 'skipped', error: null },
      ],
      diff: diff(),
    }) as PromoteResult;

  it('reports a full success with the snapshot', () => {
    const outcome = promoteOutcome(result('applied'), 'Staging', (key) => key);
    expect(outcome.tone).toBe('ok');
    expect(outcome.message).toContain('snapshot');
    expect(outcome.groups.map((group) => group.badge.text)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
  });

  it('reports each group of a partial promote', () => {
    const outcome = promoteOutcome(result('partial'), 'Staging', (key) => `text of ${key}`);
    expect(outcome.tone).toBe('warn');
    expect(outcome.groups).toEqual([
      expect.objectContaining({
        label: 'Content types',
        badge: expect.objectContaining({ text: 'applied' }),
      }),
      expect.objectContaining({ label: 'Menus', error: 'text of internal.error' }),
      expect.objectContaining({
        label: 'Redirects',
        badge: expect.objectContaining({ text: 'skipped' }),
      }),
    ]);
  });
});

describe('switching lands', () => {
  it("on an editor's section, else on the same page", () => {
    expect(
      switchPath({ path: '/content/abc', meta: { editor: 'edit', section: '/content' } }),
    ).toBe('/content');
    expect(switchPath({ path: '/settings', meta: { section: '/settings' } })).toBe('/settings');
  });
});
