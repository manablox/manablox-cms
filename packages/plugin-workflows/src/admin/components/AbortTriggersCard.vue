<script setup lang="ts">
import {
  ChipFieldset,
  type ErrorFor,
  FormField,
  Icon,
  IconButton,
  plural,
  SegmentedControl,
  Select,
  type SelectOption,
  scoped,
  TextField,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import type { WorkflowAbortEvent, WorkflowAbortTrigger } from '../../sdk';
import { abortHints, kindOptions, useTriggerKinds } from '../model';
import type { WorkflowCatalog } from '../queries';
import type { WorkflowTriggerValue } from '../slots';
import { useScopeOptions } from '../useScopeOptions';
import GuardedRules from './GuardedRules.vue';
import TriggerCardHeader from './trigger/TriggerCardHeader.vue';

/**
 * What stops the workflow's runs that are still going: waiting at a delay or mid-action. Kinds
 * other plugins contribute draw their own fields in the `workflows:triggerForm` slot.
 */
const props = defineProps<{
  triggers: WorkflowAbortTrigger[];
  spaceId: string | null;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [triggers: WorkflowAbortTrigger[]] }>();

const { types, locales } = useScopeOptions();
const kinds = useTriggerKinds(() => props.catalog);

const eventOptions = (content: boolean) =>
  (props.catalog?.abortEvents ?? [])
    .filter((event) => event.id.startsWith('content.') === content)
    .map((event) => ({
      value: event.id as WorkflowAbortEvent,
      label: event.label,
      title: event.description,
    }));
const contentEvents = computed(() => eventOptions(true));
const otherEvents = computed(() => eventOptions(false));

const KINDS = computed(() => kindOptions(kinds.abortList.value, true));

/** A fresh abort trigger of `kind`. */
const fresh = (kind: string) => kinds.of(kind).abort?.(null) as WorkflowAbortTrigger;

/** A contributed kind's own fields changed; the shared ones stay. */
const updateOwn = (index: number) => (next: WorkflowTriggerValue) => {
  const current = props.triggers[index];
  if (!current) return;
  const { id, filter, match } = current;
  replace(index, { ...next, id, filter, match } as unknown as WorkflowAbortTrigger);
};

const errorsAt = (index: number) => scoped(props.errorFor, ['abortTriggers', index]);

function replace(index: number, next: WorkflowAbortTrigger) {
  emit(
    'update',
    props.triggers.map((trigger, i) => (i === index ? next : trigger)),
  );
}

function patch(index: number, change: Partial<WorkflowAbortTrigger>) {
  const current = props.triggers[index];
  if (current) replace(index, { ...current, ...change } as WorkflowAbortTrigger);
}

function setKind(index: number, kind: string) {
  const current = props.triggers[index];
  if (!current || current.kind === kind) return;
  replace(index, { ...fresh(kind), id: current.id });
}

function add() {
  emit('update', [...props.triggers, fresh('event')]);
}

function remove(index: number) {
  emit(
    'update',
    props.triggers.filter((_, i) => i !== index),
  );
}

const aboutContent = (trigger: WorkflowAbortTrigger) =>
  trigger.kind === 'event' && trigger.events.some((event) => event.startsWith('content.'));

/** A contributed kind's filter and abort key wording; the event kind's otherwise. */
const abortFilter = (trigger: WorkflowAbortTrigger) =>
  kinds.of(trigger.kind).entry?.abortFilter ?? {
    hint: 'Abort only when the event matches, e.g. data.workflowId is a certain workflow.',
    field: 'content.',
    key: '{{ content.id }}',
  };

/** Sets the events of one group, keeping the other group's. */
function setEvents(index: number, content: boolean, picked: WorkflowAbortEvent[]) {
  const current = props.triggers[index];
  if (current?.kind !== 'event') return;
  const kept = current.events.filter((event) => event.startsWith('content.') !== content);
  const events = [...kept, ...picked];
  const next = { ...current, events };
  // Same-document matching needs a content event.
  if (next.match.mode === 'document' && !events.some((entry) => entry.startsWith('content.'))) {
    next.match = { ...next.match, mode: 'all' };
  }
  replace(index, next);
}

type MatchMode = WorkflowAbortTrigger['match']['mode'];

function matchOptions(trigger: WorkflowAbortTrigger): SelectOption<MatchMode>[] {
  const options: SelectOption<MatchMode>[] = [
    { value: 'all', label: 'Every run still going', hint: 'Queued, running or waiting' },
    {
      value: 'document',
      label: 'Runs about the same document',
      hint: 'The run started for the document this event is about',
    },
    {
      value: 'key',
      label: 'Runs with a matching key',
      hint: 'Compare a value of the run with one of the abort',
    },
  ];
  return aboutContent(trigger) ? options : options.filter((option) => option.value !== 'document');
}

function setMode(index: number, mode: MatchMode) {
  const current = props.triggers[index];
  if (current) patch(index, { match: { ...current.match, mode } });
}

function setKey(index: number, field: 'runKey' | 'abortKey', value: string) {
  const current = props.triggers[index];
  if (current) patch(index, { match: { ...current.match, [field]: value } });
}
</script>

<template>
  <section class="mb-card wf:relative wf:overflow-hidden wf:p-0!">
    <TriggerCardHeader
      icon="stop"
      tile="mb-tile-ochre"
      eyebrow="Aborts when"
      :title="triggers.length ? plural(triggers.length, 'abort trigger') : 'Nothing stops a run'"
    >
      <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm wf:shrink-0" @click="add">
        <Icon name="plus" class="mb-icon-sm" /> Add
      </button>
    </TriggerCardHeader>

    <p v-if="!triggers.length" class="wf:px-4 wf:py-3 mb-meta">
      Stop runs that are still going - waiting at a delay, or in the middle of an action - when
      something happens in the system or another service calls in. The API can abort runs too.
    </p>
    <p v-if="errorFor(['abortTriggers'])" class="mb-error wf:px-4">{{ errorFor(['abortTriggers']) }}</p>

    <div v-for="(trigger, index) in triggers" :key="trigger.id || index" class="wf:space-y-4 wf:border-t wf:border-surface-200 wf:px-4 wf:py-4 wf:first-of-type:border-t-0 wf:dark:border-surface-800">
      <div class="wf:flex wf:items-center wf:gap-2">
        <SegmentedControl
          class="wf:flex-1"
          :model-value="trigger.kind"
          :options="KINDS"
          :columns="1"
          :disabled="readOnly"
          aria-label="Abort trigger kind"
          @update:model-value="setKind(index, $event)"
        />
        <IconButton
          v-if="!readOnly"
          icon="trash"
          label="Remove abort trigger"
          title="Remove"
          danger
          class="wf:shrink-0"
          @click="remove(index)"
        />
      </div>
      <p class="mb-hint wf:-mt-2">{{ kinds.of(trigger.kind).abortHint }}</p>

      <template v-if="trigger.kind === 'event'">
        <ChipFieldset
          :model-value="trigger.events.filter((event) => event.startsWith('content.'))"
          legend="Content events"
          :options="contentEvents"
          :disabled="readOnly"
          @update:model-value="setEvents(index, true, $event)"
        />
        <ChipFieldset
          :model-value="trigger.events.filter((event) => !event.startsWith('content.'))"
          legend="Elsewhere in the system"
          :options="otherEvents"
          :disabled="readOnly"
          :error="errorsAt(index)(['events'])"
          @update:model-value="setEvents(index, false, $event)"
        />
        <ChipFieldset
          v-if="aboutContent(trigger) && types.length"
          :model-value="trigger.typeIds"
          legend="Only for these content types"
          :options="types"
          :disabled="readOnly"
          hint="None selected means every type."
          @update:model-value="patch(index, { typeIds: $event })"
        />
        <ChipFieldset
          v-if="aboutContent(trigger) && locales.length > 1"
          :model-value="trigger.locales"
          legend="Only in these languages"
          :options="locales"
          mono
          :disabled="readOnly"
          @update:model-value="patch(index, { locales: $event })"
        />
      </template>

      <component
        :is="kinds.of(trigger.kind).item?.component"
        v-else-if="kinds.of(trigger.kind).item"
        :trigger="trigger"
        mode="abort"
        :space-id="spaceId"
        :catalog="catalog?.triggers[trigger.kind]"
        :read-only="readOnly"
        :error-for="errorsAt(index)"
        :update="updateOwn(index)"
      />

      <FormField label="Which runs" :error="errorsAt(index)(['match', 'mode'])" v-slot="{ id }">
        <Select
          :id="id"
          :key="`${trigger.id}-${aboutContent(trigger)}`"
          :model-value="trigger.match.mode"
          :options="matchOptions(trigger)"
          :disabled="readOnly"
          @update:model-value="setMode(index, $event)"
        />
      </FormField>
      <div v-if="trigger.match.mode === 'key'" class="wf:space-y-3">
        <TextField
          label="Run key"
          class="mb-input-mono"
          :model-value="trigger.match.runKey"
          :readonly="readOnly"
          placeholder="{{ payload.body.orderId }}"
          hint="Read from each run: its trigger data or a node's output, like {{ nodes.create_order.body.id }}."
          :error="errorsAt(index)(['match', 'runKey'])"
          @update:model-value="setKey(index, 'runKey', String($event ?? ''))"
        />
        <TextField
          label="Abort key"
          class="mb-input-mono"
          :model-value="trigger.match.abortKey"
          :readonly="readOnly"
          :placeholder="abortFilter(trigger).key"
          hint="Read from what aborts. A run stops when both come out the same and not empty."
          :error="errorsAt(index)(['match', 'abortKey'])"
          @update:model-value="setKey(index, 'abortKey', String($event ?? ''))"
        />
      </div>

      <GuardedRules
        :model-value="trigger.filter"
        title="Only sometimes"
        :hint="abortFilter(trigger).hint"
        lead="Abort only if"
        :field="abortFilter(trigger).field"
        :read-only="readOnly"
        :hints="abortHints(trigger)"
        :catalog="catalog"
        :error-for="scoped(errorsAt(index), ['filter'])"
        @update:model-value="patch(index, { filter: $event })"
      />
    </div>
  </section>
</template>
