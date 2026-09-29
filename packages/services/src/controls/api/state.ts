import {
  CONTROL_CATALOGUE_VERSION,
  type ControlScope,
  controlEntry,
  type ResolvedControls,
  resolveAll,
  type ScopeValues,
  scopeLabel,
  type UsageMetric,
  type UsageState,
} from '@manablox/core';
import type { ControlSettingRow } from '@manablox/db';
import type { ControlSettings } from '../service.js';
import type { ControlApiContext } from './context.js';
import type { ControlScopeState, ControlStateReport, ControlUsageLevel } from './types.js';

/**
 * Resolved state and switched-off features of the instance, every group and every space,
 * under this process's feature ceilings.
 */
export async function stateReport(ctx: ControlApiContext): Promise<ControlStateReport> {
  const [rows, groups, spaces] = await Promise.all([
    ctx.repos.controlSettings.listAll(),
    ctx.repos.spaceGroups.list(),
    ctx.repos.spaces.list(),
  ]);
  const ceilings = ctx.manablox.ceilings.current();
  const values = (scope: ControlScope): ScopeValues => ({ scope, values: valuesOf(rows, scope) });
  const instance = values({ kind: 'instance' });
  const report = (scope: ControlScope, chain: ScopeValues[], extra = {}): ControlScopeState => ({
    scope: scopeLabel(scope),
    ...extra,
    ...stateOf(resolveAll(chain, {}, ceilings)),
  });

  return {
    version: CONTROL_CATALOGUE_VERSION,
    scopes: [
      report({ kind: 'instance' }, [instance]),
      ...groups.map((group) => {
        const scope: ControlScope = { kind: 'group', id: group.id };
        return report(scope, [instance, values(scope)]);
      }),
      ...spaces.map((space) => {
        const scope: ControlScope = { kind: 'space', id: space.id };
        const groupScope: ControlScope | null = space.groupId
          ? { kind: 'group', id: space.groupId }
          : null;
        return report(
          scope,
          [instance, ...(groupScope ? [values(groupScope)] : []), values(scope)],
          { group: groupScope ? scopeLabel(groupScope) : null },
        );
      }),
    ],
    usage: await usageLevels(ctx, [
      { kind: 'instance' },
      ...groups.map((group) => ({ kind: 'group' as const, id: group.id })),
      ...spaces.map((space) => ({ kind: 'space' as const, id: space.id })),
    ]),
  };
}

/** The evaluated metrics that are not `ok`, per scope. */
async function usageLevels(
  ctx: ControlApiContext,
  scopes: ControlScope[],
): Promise<ControlStateReport['usage']> {
  const states = (await ctx.usageState?.scopes(scopes)) ?? new Map();
  const out: ControlStateReport['usage'] = {};
  for (const [label, metrics] of states) {
    const entry: Partial<Record<UsageMetric, ControlUsageLevel>> = {};
    for (const [metric, state] of Object.entries(metrics) as [
      UsageMetric,
      UsageState | undefined,
    ][]) {
      if (!state || state.level === 'ok' || state.max === null) continue;
      entry[metric] = {
        level: state.level,
        used: state.used,
        max: state.max,
        resetsAt: state.resetsAt,
      };
    }
    if (Object.keys(entry).length > 0) out[label] = entry;
  }
  return out;
}

function valuesOf(rows: readonly ControlSettingRow[], scope: ControlScope): ControlSettings {
  const id = scope.kind === 'instance' ? '' : scope.id;
  const out: ControlSettings = {};
  for (const row of rows) {
    if (row.scopeKind === scope.kind && (row.scopeId ?? '') === id) out[row.key] = row.value;
  }
  return out;
}

/** State and restricting features that are off; `mostSpecific` flags, such as badges, do not count. */
function stateOf(resolved: ResolvedControls): Pick<ControlScopeState, 'state' | 'featuresOff'> {
  const { state } = resolved;
  const featuresOff = Object.entries(resolved.features)
    .filter(
      ([key, feature]) =>
        feature && !feature.enabled && controlEntry(`features.${key}`)?.resolution === 'feature',
    )
    .map(([key]) => key)
    .sort();
  return {
    state: {
      status: state.status,
      scope: state.scope ? scopeLabel(state.scope) : null,
      ...(state.message !== undefined ? { message: state.message } : {}),
    },
    featuresOff,
  };
}
