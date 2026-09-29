import type { AdminSlotEntry } from '@manablox/admin-plugin';
import { type PluginSlotItem, slotEntries, useSlotEntries } from '@manablox/admin-sdk';
import { CONTENT_EVENT_LABELS } from '@manablox/core';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import {
  WORKFLOW_TRIGGER_SPECS,
  type WorkflowAbortEventTrigger,
  type WorkflowAbortTrigger,
  type WorkflowBuiltinTriggerKind,
  type WorkflowCallTrigger,
  type WorkflowEventTrigger,
  type WorkflowManualTrigger,
  type WorkflowScheduleTrigger,
  type WorkflowSelection,
  type WorkflowTrigger,
  type WorkflowTriggerSpec,
} from '../../sdk';
import type { WorkflowCatalog } from '../queries';
import type { WorkflowTone, WorkflowTriggerValue } from '../slots';
import { toneClass } from './nodes';
import { browserTimezone, describeSchedule } from './schedule';

/** A built-in trigger of one kind. */
export type TriggerOf<K extends WorkflowBuiltinTriggerKind> = Extract<WorkflowTrigger, { kind: K }>;

export function newEventTrigger(): WorkflowEventTrigger {
  return { kind: 'event', events: ['content.saved'], typeIds: [], locales: [] };
}

function newScheduleTrigger(): WorkflowScheduleTrigger {
  return {
    kind: 'schedule',
    cron: '0 8 * * *',
    timezone: browserTimezone(),
    selection: null,
    perDocument: false,
  };
}

/** Started by other workflows' call nodes; what they hand over is declared here. */
function newCallTrigger(): WorkflowCallTrigger {
  return { kind: 'call', parameters: [], output: '' };
}

/** Started by hand; what it asks for is declared here. */
function newManualTrigger(): WorkflowManualTrigger {
  return { kind: 'manual', parameters: [] };
}

export function newSelection(): WorkflowSelection {
  return { typeIds: [], status: 'any', changedWithinHours: 24, locale: null };
}

const allRuns = () => ({ mode: 'all' as const, runKey: '', abortKey: '' });

function newAbortEventTrigger(): WorkflowAbortEventTrigger {
  return {
    id: crypto.randomUUID(),
    kind: 'event',
    events: ['content.deleted'],
    typeIds: [],
    locales: [],
    filter: null,
    match: { ...allRuns(), mode: 'document' },
  };
}

// --- trigger kinds -----------------------------------------------------------------------

/** The slot entry of a trigger kind another plugin contributes. */
type TriggerFormEntry = AdminSlotEntry<'workflows:triggerForm'>;

/** The slot contributed trigger kinds draw their forms in. */
const TRIGGER_FORM_SLOT = 'workflows:triggerForm';

/** A trigger kind as the admin shows it; label and hint come from the server. */
export interface TriggerKindUi extends Omit<WorkflowTriggerSpec, 'design' | 'abortDesign'> {
  kind: string;
  icon: string;
  tone: WorkflowTone;
  tile: string;
  abortLabel: string;
  abortHint: string;
  /** A fresh trigger; a contributed kind points it at `preset` where it takes a record. */
  create: (preset: string | null) => WorkflowTriggerValue;
  /** A fresh abort trigger, for kinds that can stop runs. */
  abort: ((preset: string | null) => WorkflowAbortTrigger) | null;
  /** The contributing plugin's slot entry; absent for the built-in kinds. */
  entry?: TriggerFormEntry | undefined;
  /** The slot item, whose component draws the kind's form. */
  item?: PluginSlotItem | undefined;
}

type SpecLike = Pick<
  WorkflowTriggerSpec,
  'label' | 'hint' | 'aborts' | 'abortLabel' | 'abortHint' | 'context'
>;

const kindUi = (
  kind: string,
  spec: SpecLike,
  icon: string,
  tone: WorkflowTone,
  create: TriggerKindUi['create'],
  abort: TriggerKindUi['abort'] = null,
): TriggerKindUi => ({
  label: spec.label,
  hint: spec.hint,
  aborts: spec.aborts,
  context: spec.context,
  abortLabel: spec.abortLabel ?? spec.label,
  abortHint: spec.abortHint ?? spec.hint,
  kind,
  icon,
  tone,
  tile: toneClass(tone),
  create,
  abort,
});

const builtin = (
  kind: WorkflowBuiltinTriggerKind,
  icon: string,
  tone: WorkflowTone,
  create: () => WorkflowTrigger,
  abort: (() => WorkflowAbortTrigger) | null = null,
) =>
  kindUi(
    kind,
    WORKFLOW_TRIGGER_SPECS[kind],
    icon,
    tone,
    create as unknown as TriggerKindUi['create'],
    abort,
  );

/** The built-in kinds, in the editor's order. */
export const TRIGGER_KINDS: Record<WorkflowBuiltinTriggerKind, TriggerKindUi> = {
  event: builtin('event', 'zap', 'clay', newEventTrigger, newAbortEventTrigger),
  schedule: builtin('schedule', 'clock', 'sand', newScheduleTrigger),
  call: builtin('call', 'workflow', 'ochre', newCallTrigger),
  manual: builtin('manual', 'play', 'plain', newManualTrigger),
};

export const isBuiltinTriggerKind = (kind: string): kind is WorkflowBuiltinTriggerKind =>
  Object.hasOwn(TRIGGER_KINDS, kind);

/** A contributed kind from its slot entry and the server's description of it. */
function contributedUi(
  item: PluginSlotItem,
  spec: SpecLike | undefined,
  catalog: WorkflowCatalog | undefined,
): TriggerKindUi {
  const entry = item.entry as TriggerFormEntry;
  const own = () => catalog?.triggers[entry.kind];
  const { abort } = entry;
  return {
    ...kindUi(
      entry.kind,
      spec ?? {
        label: item.label ?? entry.kind,
        hint: item.entry.hint ?? '',
        aborts: Boolean(abort),
        context: [],
      },
      item.icon ?? 'zap',
      entry.tone ?? 'plain',
      (preset) => entry.create(preset, own()),
      abort
        ? (preset) =>
            ({
              ...abort(preset, own()),
              id: crypto.randomUUID(),
              filter: null,
              match: allRuns(),
            }) as unknown as WorkflowAbortTrigger
        : null,
    ),
    entry,
    item,
  };
}

/** A kind nobody draws here, e.g. one of a plugin that is not loaded: shown, never offered. */
const unknownUi = (kind: string, spec: SpecLike | undefined): TriggerKindUi =>
  kindUi(
    kind,
    spec ?? { label: kind, hint: '', aborts: false, context: [] },
    'zap',
    'plain',
    () => ({ kind }),
  );

const entryOf = (items: readonly PluginSlotItem[], kind: string) =>
  items.find((item) => (item.entry as TriggerFormEntry).kind === kind);

/** Any trigger kind by name, without the catalogue: for icons and labels in lists. */
export function triggerKind(kind: string, catalog?: WorkflowCatalog | undefined): TriggerKindUi {
  if (isBuiltinTriggerKind(kind)) return TRIGGER_KINDS[kind];
  const spec = catalog?.triggerKinds.find((entry) => entry.kind === kind);
  const item = entryOf(slotEntries(TRIGGER_FORM_SLOT), kind);
  return item ? contributedUi(item, spec, catalog) : unknownUi(kind, spec);
}

/**
 * What starts a workflow, as a sentence for lists and reviews. `typeLabel` names a content
 * type by id.
 */
export function describeTrigger(
  trigger: WorkflowTrigger,
  catalog: WorkflowCatalog | undefined,
  typeLabel: (id: string) => string | undefined,
): string {
  // Plugins add kinds the built-in union does not name.
  const name: string = trigger.kind;
  if (trigger.kind === 'schedule') return describeSchedule(trigger.cron, trigger.timezone);
  if (trigger.kind === 'call' || trigger.kind === 'manual') {
    const names = trigger.parameters.map((parameter) => parameter.name);
    const who = trigger.kind === 'call' ? 'another workflow runs it' : 'someone runs it';
    return `When ${who}${names.length ? `, with ${names.join(', ')}` : ''}`;
  }
  if (trigger.kind === 'event') {
    const events = trigger.events
      .map((event) => CONTENT_EVENT_LABELS[event]?.label.toLowerCase() ?? event)
      .join(', ');
    const types = trigger.typeIds.map((id) => typeLabel(id) ?? 'a type').join(', ');
    return `When ${types || 'content'} is ${events || '...'}`;
  }
  const kind = triggerKind(name, catalog);
  const title = kind.entry?.title?.(trigger as never, catalog?.triggers[name]);
  return title ? `When ${title}` : kind.label;
}

/**
 * The trigger kinds the editor offers: the built-in ones, then those whose plugin contributes a
 * form here and a kind on the server.
 */
export function useTriggerKinds(catalog: MaybeRefOrGetter<WorkflowCatalog | undefined>) {
  const items = useSlotEntries(TRIGGER_FORM_SLOT);
  const list = computed(() => {
    const current = toValue(catalog);
    const contributed = items.value.flatMap((item) => {
      const kind = (item.entry as TriggerFormEntry).kind;
      const spec = current?.triggerKinds.find((entry) => entry.kind === kind);
      return spec && !isBuiltinTriggerKind(kind) ? [contributedUi(item, spec, current)] : [];
    });
    return [...Object.values(TRIGGER_KINDS), ...contributed];
  });
  return {
    list,
    /** Kinds that can stop runs. */
    abortList: computed(() => list.value.filter((entry) => entry.abort)),
    /** Any kind by name, including one that is not offered. */
    of: (kind: string): TriggerKindUi =>
      list.value.find((entry) => entry.kind === kind) ?? triggerKind(kind, toValue(catalog)),
  };
}

/** Kinds offered in the editor, with their labels, as picker options. */
export const kindOptions = (kinds: readonly TriggerKindUi[], abort = false) =>
  kinds.map((entry) => ({
    value: entry.kind,
    label: abort ? entry.abortLabel : entry.label,
    icon: entry.icon,
  }));
