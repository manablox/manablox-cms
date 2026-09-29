<script setup lang="ts">
import { CheckCard, ChipFieldset, type ErrorFor, toggleInList } from '@manablox/admin-sdk';
import { type ContentEvent } from '@manablox/core';
import type { TriggerOf } from '../../model';
import type { WorkflowCatalog } from '../../queries';
import { useScopeOptions } from '../../useScopeOptions';

/** Which content events start the workflow, for which types and languages. */
const props = defineProps<{
  trigger: TriggerOf<'event'>;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  /** Errors under the trigger. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [trigger: TriggerOf<'event'>] }>();

const { types, locales } = useScopeOptions();

const patch = (change: Partial<TriggerOf<'event'>>) =>
  emit('update', { ...props.trigger, ...change });
</script>

<template>
  <fieldset>
    <legend class="mb-label">Events</legend>
    <div class="wf:grid wf:gap-1.5 wf:@md:grid-cols-2 wf:@2xl:grid-cols-3">
      <CheckCard
        v-for="event in catalog?.events ?? []"
        :key="event.id"
        bordered
        :model-value="trigger.events.includes(event.id as ContentEvent)"
        :title="event.label"
        :hint="event.description"
        :disabled="readOnly"
        @update:model-value="patch({ events: toggleInList(trigger.events, event.id as ContentEvent) })"
      />
    </div>
    <p v-if="errorFor(['events'])" class="mb-error">{{ errorFor(['events']) }}</p>
  </fieldset>

  <div class="wf:grid wf:gap-4 wf:@md:grid-cols-2">
    <ChipFieldset
      :model-value="trigger.typeIds"
      legend="Only for these content types"
      :options="types"
      :disabled="readOnly"
      empty-hint="No content types yet."
      hint="None selected means every type."
      @update:model-value="patch({ typeIds: $event })"
    />
    <ChipFieldset
      v-if="locales.length > 1"
      :model-value="trigger.locales"
      legend="Only in these languages"
      :options="locales"
      mono
      :disabled="readOnly"
      hint="None selected means every language."
      @update:model-value="patch({ locales: $event })"
    />
  </div>
</template>
