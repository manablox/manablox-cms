import { describe, expect, it } from 'vitest';
import type { WorkflowConditionRule, WorkflowRuleSet, WorkflowRunContext } from '../src/sdk.js';
import { evaluateCondition, evaluateRule } from '../src/server/conditions.js';

const base: WorkflowRunContext = {
  event: 'content.updated',
  workflow: { id: 'w', name: 'W' },
  space: { id: 's', name: 'S', machineName: 's', url: '' },
  content: { status: 'published', title: 'Launch', fields: { tags: ['news'], score: 7, note: '' } },
  payload: null,
  headers: null,
  previous: { status: 'draft', title: 'Launch', fields: { tags: ['news'], score: 5, note: '' } },
  documents: [],
  actor: { id: 'u', name: 'Ann', email: 'ann@example.com' },
  url: null,
  nodes: {},
  at: '2026-09-06T00:00:00.000Z',
};

const rule = (field: string, operator: WorkflowConditionRule['operator'], value = '') =>
  evaluateRule({ field, operator, value }, base);

describe('evaluateRule', () => {
  it('compares loosely across types', () => {
    expect(rule('content.status', 'equals', 'published')).toBe(true);
    expect(rule('content.fields.score', 'equals', '7')).toBe(true);
    expect(rule('content.status', 'notEquals', 'draft')).toBe(true);
    expect(rule('content.fields.tags', 'contains', 'news')).toBe(true);
    expect(rule('content.title', 'contains', 'LAUNCH')).toBe(true);
    expect(rule('content.title', 'startsWith', 'la')).toBe(true);
    expect(rule('content.fields.note', 'isEmpty')).toBe(true);
    expect(rule('content.fields.tags', 'isNotEmpty')).toBe(true);
    expect(rule('content.fields.score', 'greaterThan', '6')).toBe(true);
    expect(rule('content.fields.score', 'lessThan', '6')).toBe(false);
    expect(rule('content.missing', 'isEmpty')).toBe(true);
  });

  it('reads the previous row for "changed"', () => {
    expect(rule('content.status', 'changed')).toBe(true);
    expect(rule('content.title', 'changed')).toBe(false);
    expect(rule('content.fields.score', 'changed')).toBe(true);
    expect(rule('content.fields.tags', 'changed')).toBe(false);
  });

  it('treats everything as changed without a previous row', () => {
    expect(
      evaluateRule(
        { field: 'content.title', operator: 'changed', value: '' },
        { ...base, previous: null },
      ),
    ).toBe(true);
  });

  it('renders the expected side as a template', () => {
    expect(rule('actor.email', 'equals', '{{ actor.email }}')).toBe(true);
  });
});

describe('evaluateCondition', () => {
  const step = (match: 'all' | 'any', ...rules: WorkflowConditionRule[]): WorkflowRuleSet => ({
    match,
    rules,
  });

  it('combines rules', () => {
    const yes = { field: 'content.status', operator: 'equals', value: 'published' } as const;
    const no = { field: 'content.status', operator: 'equals', value: 'draft' } as const;
    expect(evaluateCondition(step('all', yes, no), base)).toBe(false);
    expect(evaluateCondition(step('any', yes, no), base)).toBe(true);
    expect(evaluateCondition(step('all'), base)).toBe(true);
  });
});
