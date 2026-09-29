<script setup lang="ts">
import { type ErrorFor, SegmentedControl, scoped } from '@manablox/admin-sdk';
import { computed } from 'vue';
import type { WorkflowRuleSet, WorkflowTrigger } from '../../sdk';
import { describeSchedule, kindOptions, triggerHints, useTriggerKinds } from '../model';
import type { WorkflowCatalog } from '../queries';
import type { WorkflowTriggerValue } from '../slots';
import GuardedRules from './GuardedRules.vue';
import CallTriggerForm from './trigger/CallTriggerForm.vue';
import EventTriggerForm from './trigger/EventTriggerForm.vue';
import ManualTriggerForm from './trigger/ManualTriggerForm.vue';
import ScheduleTriggerForm from './trigger/ScheduleTriggerForm.vue';
import TriggerCardHeader from './trigger/TriggerCardHeader.vue';

/**
 * What starts the workflow. Switching kind replaces the trigger with a fresh one. Kinds other
 * plugins contribute draw their form in the `workflows:triggerForm` slot.
 */
const props = defineProps<{
  trigger: WorkflowTrigger;
  spaceId: string | null;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [trigger: WorkflowTrigger] }>();

const kinds = useTriggerKinds(() => props.catalog);
const current = computed(() => kinds.of(props.trigger.kind));
const KINDS = computed(() => kindOptions(kinds.list.value));
const errors = computed(() => scoped(props.errorFor, ['trigger']));

/** A contributed kind's catalogue entry, e.g. the endpoints a trigger may name. */
const own = computed(() => props.catalog?.triggers[props.trigger.kind]);
const value = computed(() => props.trigger as unknown as WorkflowTriggerValue);
const update = (trigger: WorkflowTriggerValue) =>
  emit('update', trigger as unknown as WorkflowTrigger);

function setKind(kind: string) {
  if (props.trigger.kind !== kind) update(kinds.of(kind).create(null));
}

const title = computed(() => {
  const trigger = props.trigger;
  switch (trigger.kind) {
    case 'event':
      return 'Content changes';
    case 'call':
      return 'Another workflow runs it';
    case 'manual':
      return 'Someone runs it';
    case 'schedule':
      return describeSchedule(trigger.cron, trigger.timezone);
  }
  return current.value.entry?.title?.(value.value, own.value) ?? current.value.label;
});

/** A contributed kind's `filter`, where its plugin asks for one. */
const filter = computed(() => current.value.entry?.filter ?? null);
const filterValue = computed(
  () => (value.value.filter as WorkflowRuleSet | null | undefined) ?? null,
);
</script>

<template>
  <section class="mb-card wf:relative wf:overflow-hidden wf:p-0!">
    <TriggerCardHeader
      :icon="current.icon"
      :tile="current.tile"
      eyebrow="Starts when"
      :title="title"
    >
      <SegmentedControl
        v-if="!readOnly"
        class="wf:w-full"
        :model-value="trigger.kind"
        :options="KINDS"
        :columns="1"
        aria-label="Trigger kind"
        @update:model-value="setKind"
      />
    </TriggerCardHeader>

    <div class="wf:@container wf:space-y-4 wf:px-4 wf:py-4">
      <EventTriggerForm v-if="trigger.kind === 'event'" :trigger="trigger" :catalog="catalog" :read-only="readOnly" :error-for="errors" @update="emit('update', $event)" />
      <ScheduleTriggerForm v-else-if="trigger.kind === 'schedule'" :trigger="trigger" :read-only="readOnly" :error-for="errors" @update="emit('update', $event)" />
      <CallTriggerForm v-else-if="trigger.kind === 'call'" :trigger="trigger" :read-only="readOnly" :error-for="errors" @update="emit('update', $event)" />
      <ManualTriggerForm v-else-if="trigger.kind === 'manual'" :trigger="trigger" :read-only="readOnly" :error-for="errors" @update="emit('update', $event)" />
      <template v-else-if="current.item">
        <component
          :is="current.item.component"
          :trigger="value"
          mode="trigger"
          :space-id="spaceId"
          :catalog="own"
          :read-only="readOnly"
          :error-for="errors"
          :update="update"
        />
        <GuardedRules
          v-if="filter"
          :model-value="filterValue"
          :title="filter.title"
          :hint="filter.hint"
          :lead="filter.lead"
          :field="filter.field"
          :read-only="readOnly"
          :hints="triggerHints(value.kind, value)"
          :catalog="catalog"
          :error-for="scoped(errors, ['filter'])"
          @update:model-value="update({ ...value, filter: $event })"
        />
      </template>
      <p v-else class="mb-callout wf:text-xs">
        Nothing here draws a <span class="wf:font-mono">{{ value.kind }}</span> trigger: the plugin
        that adds it is not installed or switched off. The workflow never starts until it is back.
      </p>
    </div>
  </section>
</template>
