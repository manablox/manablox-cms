import type { WorkflowConditionRule, WorkflowRuleSet } from '../sdk.js';
import { render, resolvePath, stringify } from './template.js';

/** What rules read: a run's context, or an abort's. `previous` backs `changed`. */
export type ConditionContext = { previous: Record<string, unknown> | null };

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

/** Loose equality: `"true"` matches `true`, `"3"` matches `3`. */
const same = (actual: unknown, expected: string): boolean => {
  if (typeof actual === 'string') return actual === expected;
  if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected;
  if (actual === null || actual === undefined) return expected === '' || expected === 'null';
  return stringify(actual) === expected;
};

/** `changed` compares the path under `content` and `previous`. */
function previousValue(context: ConditionContext, field: string): unknown {
  if (!field.startsWith('content')) return undefined;
  const rest = field.slice('content'.length);
  return resolvePath(context.previous, rest.replace(/^\./, ''));
}

export function evaluateRule(rule: WorkflowConditionRule, context: ConditionContext): boolean {
  const actual = resolvePath(context, rule.field);
  // The expected side may be a template, to compare two paths.
  const expected = render(rule.value ?? '', context);

  switch (rule.operator) {
    case 'equals':
      return same(actual, expected);
    case 'notEquals':
      return !same(actual, expected);
    case 'contains':
      return Array.isArray(actual)
        ? actual.some((entry) => same(entry, expected))
        : stringify(actual).toLowerCase().includes(expected.toLowerCase());
    case 'notContains':
      return Array.isArray(actual)
        ? !actual.some((entry) => same(entry, expected))
        : !stringify(actual).toLowerCase().includes(expected.toLowerCase());
    case 'startsWith':
      return stringify(actual).toLowerCase().startsWith(expected.toLowerCase());
    case 'isEmpty':
      return isEmpty(actual);
    case 'isNotEmpty':
      return !isEmpty(actual);
    case 'greaterThan': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a !== null && b !== null ? a > b : stringify(actual) > expected;
    }
    case 'lessThan': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      return a !== null && b !== null ? a < b : stringify(actual) < expected;
    }
    case 'changed': {
      // Without a previous row every field counts as changed.
      if (!context.previous) return true;
      return stringify(actual) !== stringify(previousValue(context, rule.field));
    }
  }
}

/** Whether all rules hold; no rules means true. */
export function evaluateCondition(set: WorkflowRuleSet, context: ConditionContext): boolean {
  if (set.rules.length === 0) return true;
  const results = set.rules.map((rule) => evaluateRule(rule, context));
  return set.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}
