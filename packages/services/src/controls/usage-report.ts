import {
  type AnyUsageMetric,
  auditor,
  type ControlScope,
  type LimitControl,
  ManabloxError,
  resolveLimits,
  scopeLabel,
  type UsageLevel,
  usageLevel,
  usageMetrics,
  usagePeriod,
} from '@manablox/core';
import { CONTROL_ACTOR, type Manablox } from '@manablox/core/node';
import type { Repositories, UsageExternalInput as StoredExternal, UsageSpaces } from '@manablox/db';
import { hostSources } from '../data/registry.js';
import { normaliseHostname } from '../lib/hostnames.js';
import type { EXTERNAL_USAGE_METRICS } from './usage.js';
import { loadUsageSnapshot } from './usage-snapshot.js';

export type ExternalUsageMetric = (typeof EXTERNAL_USAGE_METRICS)[number];

type UsageExternalMode = StoredExternal['mode'];

/** `YYYY-MM`. */
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface ExternalUsageInput {
  idempotencyKey: string;
  /** One of `spaceId` and `host`. */
  spaceId?: string | undefined;
  /** A host of any host source, or the host of a space's frontend URL. */
  host?: string | undefined;
  metric: ExternalUsageMetric;
  period: string;
  value: number;
  mode: UsageExternalMode;
}

export interface ExternalUsageResult {
  spaceId: string;
  metric: ExternalUsageMetric;
  period: string;
  mode: UsageExternalMode;
  value: number;
  /** True when the key was stored before; nothing changed. */
  duplicate: boolean;
  /** The space's external figure for the metric and period after this report. */
  external: number;
}

export interface UsageMetricReport {
  /** Counted by the CMS and flushed to the database. */
  counted: number;
  /** Reported through `POST /usage/external`. */
  external: number;
  total: number;
  /** The usage limit set at this scope; `null` when none is. */
  limit: { max: number; mode: 'hard' | 'soft'; thresholds: number[] } | null;
  /** `total` against `limit`; `null` without one. */
  state: UsageLevel | null;
}

export interface UsageReport {
  scope: string;
  period: string;
  /** ISO 8601; the period's first moment. */
  start: string;
  /** ISO 8601; the next period's first moment. */
  end: string;
  metrics: Record<AnyUsageMetric, UsageMetricReport>;
  /** The instance only: counts no space could be named for, outside `metrics`; else `null`. */
  unattributed: Record<AnyUsageMetric, number> | null;
}

/** One metric of a scope as the admin shows it. */
export interface UsageMeterView {
  metric: AnyUsageMetric;
  used: number;
  /** The usage limit stored at the scope; `null` when none is. */
  limit: { max: number; mode: 'hard' | 'soft'; thresholds: number[] } | null;
  /** `used` against `limit`; `null` without one. */
  level: UsageLevel | null;
}

export interface UsageScopeView {
  /** `unattributed`: the instance's counts no space could be named for. */
  kind: ControlScope['kind'] | 'unattributed';
  /** The space; `null` for the instance and a group. */
  spaceId: string | null;
  /** The space's name; `null` otherwise. */
  name: string | null;
  metrics: UsageMeterView[];
}

export interface UsageOverview {
  period: string;
  /** ISO 8601; the period's first moment. */
  start: string;
  /** ISO 8601; the next period's first moment. */
  end: string;
  scopes: UsageScopeView[];
}

/** Metrics a request without a space still counts toward. */
const REQUEST_METRICS: ReadonlySet<AnyUsageMetric> = new Set(['apiRequests', 'bandwidthBytes']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Usage reads and external usage reports for the control API. */
export class UsageReports {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = auditor(repos, 'control', (target: { id: string; spaceId: string }) => target.id, {
      actor: CONTROL_ACTOR,
    });
  }

  /** The label of the current period, with the instance's anchor day. */
  async currentPeriod(at = new Date()): Promise<string> {
    return usagePeriod(at, await this.anchorDay()).label;
  }

  /** Stores a figure once per idempotency key; a repeat with other values is refused. */
  async external(input: ExternalUsageInput): Promise<ExternalUsageResult> {
    assertPeriod(input.period);
    const spaceId = await this.spaceOf(input);
    const row = {
      idempotencyKey: input.idempotencyKey,
      spaceId,
      metric: input.metric,
      period: input.period,
      value: input.value,
      mode: input.mode,
    };
    const stored = await this.repos.transaction(async (tx) => {
      if (!(await tx.usageExternal.insert(row))) return false;
      await this.audit
        .in(tx)
        .record(
          'usage.external',
          { id: scopeLabel({ kind: 'space', id: spaceId }), spaceId },
          [{ path: input.metric, from: null, to: input.value }],
          { idempotencyKey: input.idempotencyKey, period: input.period, mode: input.mode },
        );
      return true;
    });
    let reported = row;
    if (!stored) {
      const seen = await this.repos.usageExternal.findByKey(input.idempotencyKey);
      if (
        !seen ||
        seen.spaceId !== spaceId ||
        seen.metric !== input.metric ||
        seen.period !== input.period ||
        Number(seen.value) !== input.value ||
        seen.mode !== input.mode
      ) {
        throw ManabloxError.conflict('control.idempotency.mismatch');
      }
      reported = { ...row, value: Number(seen.value) };
    }
    return {
      spaceId,
      metric: input.metric,
      period: reported.period,
      mode: reported.mode,
      value: reported.value,
      duplicate: !stored,
      external: await this.repos.usageExternal.total(spaceId, input.metric, input.period),
    };
  }

  /** Counted, external and total usage of a scope per metric, with the scope's own limits. */
  async report(scope: ControlScope, period?: string): Promise<UsageReport> {
    const anchor = await this.anchorDay();
    const label = period ?? usagePeriod(new Date(), anchor).label;
    const [, year, month] = assertPeriod(label);
    const bounds = usagePeriod(new Date(Date.UTC(Number(year), Number(month) - 1, anchor)), anchor);

    const spaceIds = await this.spacesOf(scope);
    const list = usageMetrics();
    const [counted, externals, rows, unattributed] = await Promise.all([
      this.repos.usageCounters.sumsForSpaces(label, spaceIds, list),
      this.repos.usageExternal.totals({
        period: label,
        ...(spaceIds === 'all' ? {} : { spaceIds }),
      }),
      this.repos.controlSettings.listByScope(scope),
      scope.kind === 'instance' ? this.unattributed(label) : null,
    ]);
    const external: Record<string, number> = {};
    for (const entry of externals) {
      external[entry.metric] = (external[entry.metric] ?? 0) + entry.value;
    }
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    const metrics = {} as Record<AnyUsageMetric, UsageMetricReport>;
    for (const metric of list) {
      const own = counted[metric] ?? 0;
      const outside = external[metric] ?? 0;
      const total = own + outside;
      const value = stored.get(`usage.${metric}`) as LimitControl | undefined;
      const [limit] = value ? resolveLimits([{ scope, value }], { max: null, mode: 'off' }) : [];
      metrics[metric] = {
        counted: own,
        external: outside,
        total,
        limit: limit ? { max: limit.max, mode: limit.mode, thresholds: limit.thresholds } : null,
        state: limit ? usageLevel([limit], () => total) : null,
      };
    }
    return {
      scope: scopeLabel(scope),
      period: label,
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      metrics,
      unattributed,
    };
  }

  /**
   * The admin's usage page. With a space: its meters, then those of its group and the instance
   * that limit it. Without: the instance's meters, then every space's.
   */
  async overview(spaceId: string | null): Promise<UsageOverview> {
    const bounds = usagePeriod(new Date(), await this.anchorDay());
    const snapshot = await loadUsageSnapshot(this.repos, bounds.label, { withUsage: true });
    const list = usageMetrics();
    const meters = (scope: ControlScope, onlyLimited: boolean): UsageMeterView[] =>
      list.flatMap((metric) => {
        const limit = snapshot.limitAt(scope, metric);
        if (onlyLimited && !limit) return [];
        const used = snapshot.usedAt(scope, metric);
        return [
          {
            metric,
            used,
            limit: limit
              ? { max: limit.max, mode: limit.mode, thresholds: limit.thresholds }
              : null,
            level: limit ? usageLevel([limit], () => used) : null,
          },
        ];
      });
    const spaceView = (space: { id: string; name: string }): UsageScopeView => ({
      kind: 'space',
      spaceId: space.id,
      name: space.name,
      metrics: meters({ kind: 'space', id: space.id }, false),
    });
    const scopes: UsageScopeView[] = [];
    if (spaceId === null) {
      scopes.push({
        kind: 'instance',
        spaceId: null,
        name: null,
        metrics: meters({ kind: 'instance' }, false),
      });
      const unattributed = await this.unattributed(bounds.label);
      scopes.push({
        kind: 'unattributed',
        spaceId: null,
        name: null,
        metrics: list
          .filter((metric) => REQUEST_METRICS.has(metric) || (unattributed[metric] ?? 0) > 0)
          .map((metric) => ({
            metric,
            used: unattributed[metric] ?? 0,
            limit: null,
            level: null,
          })),
      });
      for (const space of snapshot.spaces) scopes.push(spaceView(space));
    } else {
      const space = snapshot.spaces.find((entry) => entry.id === spaceId);
      if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
      scopes.push(spaceView(space));
      const above: ControlScope[] = [
        ...(space.groupId ? [{ kind: 'group' as const, id: space.groupId }] : []),
        { kind: 'instance' },
      ];
      for (const scope of above) {
        const metrics = meters(scope, true);
        if (metrics.length > 0)
          scopes.push({ kind: scope.kind, spaceId: null, name: null, metrics });
      }
    }
    return {
      period: bounds.label,
      start: bounds.start.toISOString(),
      end: bounds.end.toISOString(),
      scopes,
    };
  }

  /** The instance's own counters of a period: counts no space could be named for. */
  private async unattributed(period: string): Promise<Record<AnyUsageMetric, number>> {
    const rows = await this.repos.usageCounters.listForScope({ kind: 'instance' }, period);
    const out = Object.fromEntries(usageMetrics().map((metric) => [metric, 0])) as Record<
      AnyUsageMetric,
      number
    >;
    for (const row of rows) {
      if (row.metric in out) out[row.metric as AnyUsageMetric] = Number(row.value);
    }
    return out;
  }

  private async anchorDay(): Promise<number> {
    return (await this.manablox.controls.resolved(null)).usage.periodAnchorDay;
  }

  private async spacesOf(scope: ControlScope): Promise<UsageSpaces> {
    if (scope.kind === 'instance') return 'all';
    if (scope.kind === 'space') {
      if (!(await this.repos.spaces.findById(scope.id))) {
        throw ManabloxError.notFound('space.notFound', { spaceId: scope.id });
      }
      return [scope.id];
    }
    return this.repos.spaceGroups.listSpaceIds(scope.id);
  }

  /** The space named by id, else by a host of any source, else by its frontend URL's host. */
  private async spaceOf(input: ExternalUsageInput): Promise<string> {
    if ((input.spaceId === undefined) === (input.host === undefined)) {
      throw ManabloxError.validation([{ key: 'validation.invalid', path: ['spaceId'] }]);
    }
    if (input.spaceId !== undefined) {
      const found = UUID.test(input.spaceId) && (await this.repos.spaces.findById(input.spaceId));
      if (!found) throw ManabloxError.notFound('space.notFound', { spaceId: input.spaceId });
      return found.id;
    }
    const hostname = normaliseHostname(input.host ?? '');
    if (hostname) {
      for (const source of hostSources(this.manablox)) {
        const host = await source.find(this.repos, hostname);
        if (host) return host.spaceId;
      }
      for (const space of await this.repos.spaces.list()) {
        if (hostOf(space.url) === hostname) return space.id;
      }
    }
    throw ManabloxError.notFound('space.notFound', { host: input.host });
  }
}

function assertPeriod(period: string): RegExpExecArray {
  const match = PERIOD.exec(period);
  if (!match) {
    throw ManabloxError.validation([
      { key: 'validation.invalid', path: ['period'], params: { pattern: 'YYYY-MM' } },
    ]);
  }
  return match;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
