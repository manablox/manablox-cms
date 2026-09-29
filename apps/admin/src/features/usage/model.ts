import type { Me } from '@manablox/admin-sdk/lib/api-types';
import { formatDate } from '@manablox/admin-sdk/lib/format';
import type { UsageLevel, UsageMetric } from '@manablox/core';
import { pluginUsageMetric } from '~/lib/plugins/registry';
import type { UsageOverview } from './queries';

export type UsageScope = UsageOverview['scopes'][number];
export type UsageMeterData = UsageScope['metrics'][number];

const USAGE_METRIC_LABELS: Partial<Record<string, string>> = {
  apiRequests: 'API requests',
  bandwidthBytes: 'Bandwidth',
  mails: 'Mails',
  uploads: 'Uploads',
};

/** What stops while a metric is blocked, for the page and the banner. */
const BLOCKED_EFFECTS: Partial<Record<string, string>> = {
  apiRequests: 'The delivery API answers with an error.',
  bandwidthBytes: 'The site, media and the delivery API are unavailable.',
  mails: 'Notification mails are not sent; mail steps of plugins fail.',
  uploads: 'Uploads are refused.',
};

/** A metric's name, plugins' included. */
const metricLabel = (metric: string): string =>
  USAGE_METRIC_LABELS[metric] ?? pluginUsageMetric(metric)?.label ?? metric;

/** What stops while a metric is blocked. */
export const blockedEffect = (metric: string): string =>
  BLOCKED_EFFECTS[metric] ?? pluginUsageMetric(metric)?.blocked ?? '';

const LEVEL_LABELS: Record<UsageLevel, string> = {
  ok: 'Within the limit',
  warn: 'Close to the limit',
  over: 'Over the limit',
  blocked: 'Used up',
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** `512 B`, `3.2 GB`. */
export function formatUsageBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

const count = new Intl.NumberFormat();

function formatUsage(metric: UsageMetric, value: number): string {
  return metric === 'bandwidthBytes' ? formatUsageBytes(value) : count.format(value);
}

/** One meter as the page draws it. */
export interface UsageMeterView {
  metric: UsageMetric;
  label: string;
  used: string;
  /** `null` without a limit. */
  max: string | null;
  /** Percent of the limit, capped at 100; `null` without a limit. */
  percent: number | null;
  level: UsageLevel | null;
  levelLabel: string | null;
  /** `hard` stops at the limit; `soft` lets it pass. */
  mode: 'hard' | 'soft' | null;
  tone: 'brand' | 'warn' | 'danger';
  /** What stops, when blocked. */
  effect: string | null;
}

export function meterView(meter: UsageMeterData): UsageMeterView {
  const metric = meter.metric as UsageMetric;
  const limit = meter.limit;
  const level = meter.level as UsageLevel | null;
  const percent =
    limit === null ? null : limit.max === 0 ? 100 : Math.min(100, (meter.used / limit.max) * 100);
  return {
    metric,
    label: metricLabel(metric),
    used: formatUsage(metric, meter.used),
    max: limit ? formatUsage(metric, limit.max) : null,
    percent,
    level,
    levelLabel: level ? LEVEL_LABELS[level] : null,
    mode: limit?.mode ?? null,
    tone: level === 'blocked' || level === 'over' ? 'danger' : level === 'warn' ? 'warn' : 'brand',
    effect: level === 'blocked' ? blockedEffect(metric) : null,
  };
}

/** The heading of a scope's meters. */
export function scopeTitle(scope: Pick<UsageScope, 'kind' | 'name'>): string {
  if (scope.kind === 'instance') return 'Whole instance';
  if (scope.kind === 'unattributed') return 'Unattributed';
  if (scope.kind === 'group') return 'Shared with other spaces';
  return scope.name ?? 'This space';
}

/** A line under a scope's heading. */
export function scopeHint(scope: Pick<UsageScope, 'kind'>, forSpace: boolean): string {
  if (scope.kind === 'instance') {
    return forSpace
      ? 'Limits set for the whole instance also apply to this space.'
      : 'Every space together.';
  }
  if (scope.kind === 'unattributed') {
    return 'Requests no space could be named for, such as delivery without a space header. Not part of any space or the total above.';
  }
  if (scope.kind === 'group') return 'Limits this space shares with other spaces.';
  return forSpace ? 'This space alone.' : '';
}

export function periodLabel(overview: Pick<UsageOverview, 'start' | 'end'>): string {
  const last = new Date(new Date(overview.end).getTime() - 1);
  return `${formatDate(overview.start)} to ${formatDate(last)}; resets ${formatDate(overview.end)}`;
}

/** A blocked metric the viewer can see, for the admin's banner. */
export interface UsageBannerItem {
  metric: UsageMetric;
  label: string;
  /** The space it blocks; `null` for the instance. */
  spaceId: string | null;
  resetsAt: string;
  /** Where to see the numbers. */
  to: string;
}

type Flags = Partial<
  Record<string, { level: UsageLevel; resetsAt: string; scope: 'instance' | 'group' | 'space' }>
>;

/**
 * Blocked metrics the viewer can see: the instance's, then the current space's, then other
 * spaces'. A space's block set at the instance is left to the instance's entry when shown.
 */
export function usageBannerItems(me: Me | null, spaceId: string | null): UsageBannerItem[] {
  const controls = me?.controls;
  if (!controls) return [];
  const instance = (controls.usage ?? {}) as Flags;
  const out: UsageBannerItem[] = [];
  const add = (flags: Flags | undefined, owner: string | null) => {
    for (const [metric, flag] of Object.entries(flags ?? {})) {
      if (flag?.level !== 'blocked') continue;
      if (owner !== null && flag.scope === 'instance' && instance[metric]) continue;
      out.push({
        metric: metric as UsageMetric,
        label: metricLabel(metric),
        spaceId: owner,
        resetsAt: flag.resetsAt,
        to:
          owner === null
            ? '/settings?tab=instanceUsage'
            : owner === spaceId
              ? '/settings?tab=usage'
              : `/settings?tab=usage&space=${owner}`,
      });
    }
  };
  add(instance, null);
  const spaces = controls.spaces as Record<string, { usage?: Flags }>;
  if (spaceId) add(spaces[spaceId]?.usage, spaceId);
  for (const [id, entry] of Object.entries(spaces)) if (id !== spaceId) add(entry.usage, id);
  return out;
}
