/**
 * The built-in trigger kinds, contributed by the plugin itself through its `triggers` and
 * `abortTriggers` extension points. Content events, the schedule, calls and manual starts are
 * started by the engine itself rather than through `runTrigger`.
 */

import { CONTENT_EVENTS } from '@manablox/core';
import {
  type AnyWorkflowAbortTriggerKind,
  type AnyWorkflowTriggerKind,
  defineWorkflowAbortTrigger,
  defineWorkflowTrigger,
  type WorkflowTriggerCheck,
} from '../define/triggers.js';
import {
  WORKFLOW_ABORT_EVENTS,
  WORKFLOW_TRIGGER_SPECS,
  type WorkflowAbortEvent,
  type WorkflowAbortEventTrigger,
  type WorkflowCallParameter,
  type WorkflowCallTrigger,
  type WorkflowEventTrigger,
  type WorkflowManualTrigger,
  type WorkflowScheduleTrigger,
} from '../sdk.js';
import { isValidCron, isValidTimezone } from './cron.js';

const PARAMETER_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
export const MAX_CALL_PARAMETERS = 30;

/** Resolves a content type the model names to its id. */
type TypeIdOf = (name: unknown) => string | null;

const typeIdsOf = (value: unknown, typeId: TypeIdOf): string[] =>
  (Array.isArray(value) ? value : []).map(typeId).filter((id): id is string => Boolean(id));

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter((entry): entry is string => typeof entry === 'string');

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parametersOf = (value: unknown): WorkflowCallParameter[] =>
  (Array.isArray(value) ? value : []).map((entry) => {
    const parameter = typeof entry === 'string' ? { name: entry } : asRecord(entry);
    return {
      name: String(parameter.name ?? ''),
      description: typeof parameter.description === 'string' ? parameter.description : '',
      required: parameter.required === true,
    };
  });

function checkParameters(
  parameters: WorkflowCallParameter[],
  check: WorkflowTriggerCheck,
): WorkflowCallParameter[] {
  if (parameters.length > MAX_CALL_PARAMETERS) {
    check.add('plugins.workflows.trigger.parameterInvalid', ['parameters'], {
      max: MAX_CALL_PARAMETERS,
    });
  }
  const names = new Set<string>();
  return parameters.map((parameter, index) => {
    const name = (parameter.name ?? '').trim();
    const at = ['parameters', index, 'name'];
    if (!PARAMETER_NAME.test(name)) {
      check.add('plugins.workflows.trigger.parameterInvalid', at, { name });
    } else if (names.has(name)) {
      check.add('plugins.workflows.trigger.parameterDuplicate', at, { name });
    }
    names.add(name);
    return {
      name,
      description: (parameter.description ?? '').trim(),
      required: Boolean(parameter.required),
    };
  });
}

const event = defineWorkflowTrigger<WorkflowEventTrigger>({
  kind: 'event',
  spec: WORKFLOW_TRIGGER_SPECS.event,
  check(trigger, check) {
    const events = [...new Set(trigger.events ?? [])];
    if (events.length === 0) check.add('plugins.workflows.trigger.eventsRequired', ['events']);
    for (const [index, event] of events.entries()) {
      if (!(CONTENT_EVENTS as readonly string[]).includes(event)) {
        check.add('plugins.workflows.trigger.eventUnknown', ['events', index], { event });
      }
    }
    for (const [index, typeId] of (trigger.typeIds ?? []).entries()) {
      if (!check.typeExists(typeId)) {
        check.add('plugins.workflows.trigger.typeNotFound', ['typeIds', index], { typeId });
      }
    }
    return {
      kind: 'event',
      events,
      typeIds: trigger.typeIds ?? [],
      locales: trigger.locales ?? [],
    };
  },
  design: {
    read: (raw, design) => ({
      kind: 'event',
      events: (Array.isArray(raw.events) ? raw.events : []).filter(
        (event): event is (typeof CONTENT_EVENTS)[number] =>
          (CONTENT_EVENTS as readonly unknown[]).includes(event),
      ),
      typeIds: typeIdsOf(raw.types ?? raw.typeIds, design.typeId),
      locales: strings(raw.locales),
    }),
  },
});

const schedule = defineWorkflowTrigger<WorkflowScheduleTrigger>({
  kind: 'schedule',
  spec: WORKFLOW_TRIGGER_SPECS.schedule,
  check(trigger, check) {
    if (!isValidCron(trigger.cron)) check.add('plugins.workflows.trigger.cronInvalid', ['cron']);
    if (!isValidTimezone(trigger.timezone)) {
      check.add('plugins.workflows.trigger.timezoneInvalid', ['timezone']);
    }
    for (const [index, typeId] of (trigger.selection?.typeIds ?? []).entries()) {
      if (!check.typeExists(typeId)) {
        check.add('plugins.workflows.trigger.typeNotFound', ['selection', 'typeIds', index], {
          typeId,
        });
      }
    }
    return {
      kind: 'schedule',
      cron: trigger.cron.trim(),
      timezone: trigger.timezone,
      selection: trigger.selection
        ? {
            typeIds: trigger.selection.typeIds,
            status: trigger.selection.status,
            changedWithinHours: trigger.selection.changedWithinHours ?? null,
            locale: trigger.selection.locale || null,
          }
        : null,
      perDocument: Boolean(trigger.perDocument && trigger.selection),
    };
  },
  design: {
    read(raw, { typeId }) {
      const selection =
        raw.selection && typeof raw.selection === 'object' ? asRecord(raw.selection) : null;
      return {
        kind: 'schedule',
        cron: String(raw.cron ?? '0 8 * * *'),
        timezone: String(raw.timezone ?? 'UTC'),
        selection: selection
          ? {
              typeIds: typeIdsOf(selection.types ?? selection.typeIds, typeId),
              status:
                selection.status === 'draft' || selection.status === 'published'
                  ? selection.status
                  : 'any',
              changedWithinHours:
                typeof selection.changedWithinHours === 'number'
                  ? Math.max(1, Math.round(selection.changedWithinHours))
                  : null,
              locale: typeof selection.locale === 'string' ? selection.locale : null,
            }
          : null,
        perDocument: raw.perDocument === true,
      };
    },
  },
});

const call = defineWorkflowTrigger<WorkflowCallTrigger>({
  kind: 'call',
  spec: WORKFLOW_TRIGGER_SPECS.call,
  check: (trigger, check) => ({
    kind: 'call',
    parameters: checkParameters(trigger.parameters ?? [], check),
    output: (trigger.output ?? '').trim(),
  }),
  design: {
    read: (raw) => ({
      kind: 'call',
      parameters: parametersOf(raw.parameters),
      output: typeof raw.output === 'string' ? raw.output : '',
    }),
  },
});

const manual = defineWorkflowTrigger<WorkflowManualTrigger>({
  kind: 'manual',
  spec: WORKFLOW_TRIGGER_SPECS.manual,
  check: (trigger, check) => ({
    kind: 'manual',
    parameters: checkParameters(trigger.parameters ?? [], check),
  }),
  design: {
    read: (raw) => ({ kind: 'manual', parameters: parametersOf(raw.parameters) }),
  },
});

const eventAbort = defineWorkflowAbortTrigger<WorkflowAbortEventTrigger>({
  kind: 'event',
  check(trigger, check) {
    const events = [...new Set(trigger.events ?? [])];
    if (events.length === 0) check.add('plugins.workflows.abort.eventsRequired', ['events']);
    for (const [i, event] of events.entries()) {
      if (!(WORKFLOW_ABORT_EVENTS as readonly string[]).includes(event)) {
        check.add('plugins.workflows.abort.eventUnknown', ['events', i], { event });
      }
    }
    for (const [i, typeId] of (trigger.typeIds ?? []).entries()) {
      if (!check.typeExists(typeId)) {
        check.add('plugins.workflows.abort.typeNotFound', ['typeIds', i], { typeId });
      }
    }
    return {
      kind: 'event',
      events,
      typeIds: trigger.typeIds ?? [],
      locales: trigger.locales ?? [],
    };
  },
  document: (trigger) => (trigger.events ?? []).some((event) => event.startsWith('content.')),
  design: {
    read: (raw, design) => ({
      kind: 'event',
      events: (Array.isArray(raw.events) ? raw.events : []).filter(
        (event): event is WorkflowAbortEvent =>
          (WORKFLOW_ABORT_EVENTS as readonly unknown[]).includes(event),
      ),
      typeIds: typeIdsOf(raw.types ?? raw.typeIds, design.typeId),
      locales: strings(raw.locales),
    }),
  },
});

/** The built-in trigger kinds, in the editor's order. */
export const BUILTIN_TRIGGERS: AnyWorkflowTriggerKind[] = [event, schedule, call, manual];

/** The built-in abort trigger kinds. */
export const BUILTIN_ABORT_TRIGGERS: AnyWorkflowAbortTriggerKind[] = [eventAbort];
