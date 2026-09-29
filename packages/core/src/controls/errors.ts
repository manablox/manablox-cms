/** The errors a control refusal throws. */

import { ManabloxError } from '../errors.js';
import type { AnyLimitKey, AnyUsageMetric, FeatureKey } from './catalogue.js';
import { scopeLabel } from './resolve.js';
import type { ControlScope, ResolvedFeature, ResolvedState } from './types.js';

/** 403 `control.feature`: the feature is switched off. */
export function featureDenied(key: FeatureKey, feature: ResolvedFeature): ManabloxError {
  return ManabloxError.forbidden('control.feature', {
    feature: key,
    message: feature.message ?? null,
    link: feature.link ?? null,
  });
}

/** 409 `control.limit`: a hard count limit is reached. */
export function limitReached(
  key: AnyLimitKey,
  scope: ControlScope,
  used: number,
  max: number,
): ManabloxError {
  return ManabloxError.conflict('control.limit', {
    limit: key,
    scope: scopeLabel(scope),
    used,
    max,
  });
}

/** 429 `control.usage`: a hard usage limit is used up for the period. */
export function usageExceeded(
  metric: AnyUsageMetric,
  scope: ControlScope,
  used: number,
  max: number,
  resetsAt: string,
): ManabloxError {
  return ManabloxError.rateLimited('control.usage', {
    metric,
    scope: scopeLabel(scope),
    used,
    max,
    resetsAt,
  });
}

/** 423 `control.readOnly`: the instance, group or space takes no writes. */
export function readOnlyRefused(scope: ControlScope, reason: string | null): ManabloxError {
  return ManabloxError.locked('control.readOnly', { scope: scopeLabel(scope), reason });
}

/** 423 `control.readOnly` with reason `promote`: a promote writes the space's production. */
export function promoteRefused(spaceId: string): ManabloxError {
  return ManabloxError.locked('control.readOnly', {
    scope: scopeLabel({ kind: 'space', id: spaceId }),
    reason: 'promote',
    message: 'A promote is in progress.',
  });
}

/** 423 `control.suspended`: the instance is suspended. */
export function suspendedRefused(reason: string | null): ManabloxError {
  return ManabloxError.locked('control.suspended', { reason });
}

/** The refusal of a write under `state`; `null` while active. */
export function stateRefusal(state: ResolvedState): ManabloxError | null {
  if (state.status === 'active') return null;
  const reason = state.message ?? null;
  if (state.status === 'suspended') return suspendedRefused(reason);
  return readOnlyRefused(state.scope ?? { kind: 'instance' }, reason);
}

/** 429 `rateLimit.exceeded` for a named rule; `retryAfter` in seconds. */
export function rateLimitExceeded(rule: string, retryAfter: number): ManabloxError {
  return ManabloxError.rateLimited('rateLimit.exceeded', { rule, retryAfter });
}
