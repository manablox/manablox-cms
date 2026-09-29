import type { Me } from '@manablox/admin-sdk/lib/api-types';
import { describe, expect, it } from 'vitest';
import {
  formatUsageBytes,
  meterView,
  periodLabel,
  scopeTitle,
  usageBannerItems,
} from '~/features/usage/model';
import { meWithControls } from '../../controls-fixture';

const limit = (max: number, mode: 'hard' | 'soft' = 'hard') => ({
  max,
  mode,
  thresholds: [80, 100],
});

describe('usage meters', () => {
  it('shows used against the limit with the level, tone and what stops', () => {
    expect(
      meterView({
        metric: 'bandwidthBytes',
        used: 3 * 1024 ** 3,
        limit: limit(4 * 1024 ** 3),
        level: 'warn',
      }),
    ).toMatchObject({
      label: 'Bandwidth',
      used: '3.0 GB',
      max: '4.0 GB',
      percent: 75,
      levelLabel: 'Close to the limit',
      mode: 'hard',
      tone: 'warn',
      effect: null,
    });
    expect(
      meterView({ metric: 'apiRequests', used: 1200, limit: limit(1000), level: 'blocked' }),
    ).toMatchObject({
      percent: 100,
      tone: 'danger',
      levelLabel: 'Used up',
      effect: expect.any(String),
    });
    expect(
      meterView({ metric: 'mails', used: 12, limit: limit(10, 'soft'), level: 'over' }),
    ).toMatchObject({ tone: 'danger', mode: 'soft', effect: null });
  });

  it('shows usage without a limit as just the count', () => {
    expect(meterView({ metric: 'uploads', used: 4, limit: null, level: null })).toMatchObject({
      used: '4',
      max: null,
      percent: null,
      level: null,
      mode: null,
      tone: 'brand',
    });
  });

  it('formats bytes in binary units', () => {
    expect(formatUsageBytes(512)).toBe('512 B');
    expect(formatUsageBytes(1536)).toBe('1.5 KB');
    expect(formatUsageBytes(250 * 1024 ** 2)).toBe('250 MB');
  });

  it('names scopes without naming groups', () => {
    expect(scopeTitle({ kind: 'instance', name: null })).toBe('Whole instance');
    expect(scopeTitle({ kind: 'unattributed', name: null })).toBe('Unattributed');
    expect(scopeTitle({ kind: 'group', name: null })).toBe('Shared with other spaces');
    expect(scopeTitle({ kind: 'space', name: 'Blog' })).toBe('Blog');
  });

  it('labels the period with its last day and reset', () => {
    const label = periodLabel({
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-10-01T00:00:00.000Z',
    });
    expect(label).toContain('resets');
  });
});

/** The fixture with usage flags for the instance and spaces. */
function meWith(usage: {
  instance?: Record<string, unknown>;
  spaces?: Record<string, Record<string, unknown>>;
}): Me {
  const me = meWithControls() as unknown as {
    controls: { usage: unknown; spaces: Record<string, Record<string, unknown>> };
  };
  me.controls.usage = usage.instance ?? {};
  for (const [id, flags] of Object.entries(usage.spaces ?? {})) {
    me.controls.spaces[id] = { ...(me.controls.spaces[id] ?? { features: {} }), usage: flags };
  }
  return me as unknown as Me;
}

const flag = (level: string, scope = 'space') => ({
  level,
  resetsAt: '2026-10-01T00:00:00.000Z',
  scope,
});

describe('the usage banner', () => {
  it('lists blocked metrics only, instance first, then the current space, then others', () => {
    const me = meWith({
      instance: { workflowRuns: flag('blocked', 'instance') },
      spaces: {
        s1: { mails: flag('warn'), uploads: flag('blocked') },
        s2: { bandwidthBytes: flag('blocked', 'group') },
      },
    });
    expect(usageBannerItems(me, 's2').map((item) => [item.metric, item.spaceId, item.to])).toEqual([
      ['workflowRuns', null, '/settings?tab=instanceUsage'],
      ['bandwidthBytes', 's2', '/settings?tab=usage'],
      ['uploads', 's1', '/settings?tab=usage&space=s1'],
    ]);
  });

  it("leaves a space's instance block to the instance entry", () => {
    const me = meWith({
      instance: { workflowRuns: flag('blocked', 'instance') },
      spaces: { s1: { workflowRuns: flag('blocked', 'instance') } },
    });
    expect(usageBannerItems(me, 's1')).toHaveLength(1);
    // Without the instance entry (not a superadmin) the space shows it.
    const editor = meWith({ spaces: { s1: { workflowRuns: flag('blocked', 'instance') } } });
    expect(usageBannerItems(editor, 's1').map((item) => item.spaceId)).toEqual(['s1']);
  });

  it('is empty without controls or blocks', () => {
    expect(usageBannerItems(null, null)).toEqual([]);
    expect(usageBannerItems(meWith({ spaces: { s1: { mails: flag('over') } } }), 's1')).toEqual([]);
  });
});
