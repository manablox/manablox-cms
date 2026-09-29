import { randomUUID } from 'node:crypto';
import {
  readRuleSet,
  type WorkflowAbortMatch,
  type WorkflowAbortTrigger,
  type WorkflowRuleSet,
  type WorkflowTrigger,
} from '../sdk.js';
import type { WorkflowDesignContext } from './design-prompt.js';

/** Resolves a content type the model names to its id. */
export type TypeIdOf = (name: unknown) => string | null;

const filterOf = (raw: Record<string, unknown>): WorkflowRuleSet | null =>
  raw.filter && typeof raw.filter === 'object' ? readRuleSet(asRecord(raw.filter)) : null;

/** The trigger a step names, through its kind; an unknown kind reads as an event trigger. */
export function readTrigger(
  raw: Record<string, unknown>,
  context: WorkflowDesignContext,
  typeId: TypeIdOf,
  problems: string[],
): WorkflowTrigger {
  const kinds = context.registry.triggerKinds.filter((kind) => kind.design);
  const known = kinds.find((kind) => kind.kind === raw.kind);
  if (!known) {
    problems.push(`"trigger" must have "kind" ${kinds.map((kind) => kind.kind).join(', ')}.`);
  }
  const kind = known ?? kinds[0];
  if (!kind?.design) return { kind: 'event', events: [], typeIds: [], locales: [] };
  const trigger = kind.design.read(
    raw,
    { catalog: context.catalog.triggers[kind.kind], typeId },
    problems,
  ) as WorkflowTrigger;
  // A kind whose trigger filters its starts keeps the model's filter.
  return 'filter' in trigger
    ? ({ ...trigger, filter: filterOf(raw) } as unknown as WorkflowTrigger)
    : trigger;
}

export function readAbortTriggers(
  raw: unknown,
  context: WorkflowDesignContext,
  typeId: TypeIdOf,
  problems: string[],
): WorkflowAbortTrigger[] {
  const kinds = context.registry.abortTriggerKinds.filter((kind) => kind.design);
  return (Array.isArray(raw) ? raw : []).map(asRecord).map((entry) => {
    const base = { id: randomUUID(), filter: filterOf(entry), match: readAbortMatch(entry.match) };
    const known = kinds.find((kind) => kind.kind === entry.kind);
    if (!known) {
      problems.push(
        `An abort trigger must have "kind" ${kinds.map((kind) => kind.kind).join(' or ')}.`,
      );
    }
    const kind = known ?? kinds[0];
    const own = kind?.design?.read(
      entry,
      { catalog: context.catalog.triggers[kind.kind], typeId },
      problems,
    ) ?? { kind: 'event', events: [], typeIds: [], locales: [] };
    return { ...own, ...base } as WorkflowAbortTrigger;
  });
}

function readAbortMatch(raw: unknown): WorkflowAbortMatch {
  if (raw === 'document') return { mode: 'document', runKey: '', abortKey: '' };
  const keys = asRecord(raw);
  if (typeof keys.runKey === 'string' || typeof keys.abortKey === 'string') {
    return {
      mode: 'key',
      runKey: String(keys.runKey ?? ''),
      abortKey: String(keys.abortKey ?? ''),
    };
  }
  return { mode: 'all', runKey: '', abortKey: '' };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
