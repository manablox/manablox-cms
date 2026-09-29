<script setup lang="ts">
import {
  Checkbox,
  CheckCard,
  ChipFieldset,
  type ErrorFor,
  FormField,
  NumberField,
  Select,
  type SelectOption,
  TextField,
} from '@manablox/admin-sdk';
import { computed, ref, useId, watch } from 'vue';
import {
  CHANGED_WITHIN,
  cronFrom,
  DAYS_OF_MONTH,
  HOURS,
  MINUTES,
  newSelection,
  SCHEDULE_PRESETS,
  type ScheduleForm,
  SELECTION_STATUSES,
  scheduleFormFrom,
  TIMEZONES,
  type TriggerOf,
  WEEKDAYS,
} from '../../model';
import { useScopeOptions } from '../../useScopeOptions';

type Schedule = TriggerOf<'schedule'>;
type Selection = NonNullable<Schedule['selection']>;

/** When the workflow runs, and which documents each run looks at. */
const props = defineProps<{
  trigger: Schedule;
  readOnly: boolean;
  /** Errors under the trigger. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [trigger: Schedule] }>();

const { types, locales } = useScopeOptions();
const zoneList = useId();

const patch = (change: Partial<Schedule>) => emit('update', { ...props.trigger, ...change });

function patchSelection(change: Partial<Selection>) {
  if (props.trigger.selection) patch({ selection: { ...props.trigger.selection, ...change } });
}

const form = ref<ScheduleForm>(scheduleFormFrom(props.trigger.cron));
watch(
  () => props.trigger.cron,
  (cron) => {
    if (cron !== cronFrom(form.value)) form.value = scheduleFormFrom(cron);
  },
);

function patchForm(change: Partial<ScheduleForm>) {
  form.value = { ...form.value, ...change };
  patch({ cron: cronFrom(form.value) });
}

// Committed on change, so a half-typed zone is not saved.
const zone = ref(props.trigger.timezone);
watch(
  () => props.trigger.timezone,
  (value) => {
    zone.value = value;
  },
);

const changedWithin = computed({
  get: () => props.trigger.selection?.changedWithinHours ?? 0,
  set: (hours: number) => {
    patchSelection({ changedWithinHours: hours > 0 ? hours : null });
  },
});

const localeOptions = computed((): SelectOption<string | null>[] => [
  { value: null, label: 'Any' },
  ...locales.value,
]);
</script>

<template>
  <div class="wf:grid wf:gap-4 wf:@md:grid-cols-2">
    <FormField label="Repeat" v-slot="{ id }">
      <Select
        :id="id"
        :model-value="form.preset"
        :options="SCHEDULE_PRESETS"
        :disabled="readOnly"
        @update:model-value="patchForm({ preset: $event })"
      />
    </FormField>
    <TextField
      v-model="zone"
      label="Timezone"
      class="mb-input-mono"
      :readonly="readOnly"
      :list="zoneList"
      placeholder="Europe/Vienna"
      :error="errorFor(['timezone'])"
      @change="patch({ timezone: zone.trim() || 'UTC' })"
    >
      <template #hint>
        <datalist :id="zoneList">
          <option v-for="entry in TIMEZONES" :key="entry" :value="entry" />
        </datalist>
      </template>
    </TextField>
  </div>

  <div class="wf:flex wf:flex-wrap wf:items-end wf:gap-3">
    <div v-if="form.preset === 'minutes'" class="wf:flex wf:items-end wf:gap-2">
      <NumberField
        :model-value="form.every"
        label="Every"
        class="wf:w-24"
        :min="1"
        :max="59"
        :readonly="readOnly"
        @update:model-value="$event != null && patchForm({ every: $event })"
      />
      <span class="wf:pb-2.5 wf:text-sm wf:text-surface-500">minutes</span>
    </div>
    <ChipFieldset
      v-if="form.preset === 'weekly'"
      :model-value="form.days"
      legend="On"
      :options="WEEKDAYS"
      :disabled="readOnly"
      @update:model-value="patchForm({ days: $event })"
    />
    <FormField v-if="form.preset === 'monthly'" label="On day" v-slot="{ id }">
      <Select :id="id" :model-value="form.dayOfMonth" :options="DAYS_OF_MONTH" :disabled="readOnly" @update:model-value="patchForm({ dayOfMonth: $event })" />
    </FormField>
    <div v-if="['daily', 'weekly', 'monthly'].includes(form.preset)" class="wf:flex wf:items-end wf:gap-2">
      <FormField label="At" v-slot="{ id }">
        <Select :id="id" :model-value="form.hour" :options="HOURS" :disabled="readOnly" @update:model-value="patchForm({ hour: $event })" />
      </FormField>
      <span class="wf:pb-2.5 wf:text-sm wf:text-surface-500">:</span>
      <FormField label="Minute" v-slot="{ id }">
        <Select :id="id" :model-value="form.minute" :options="MINUTES" :disabled="readOnly" @update:model-value="patchForm({ minute: $event })" />
      </FormField>
    </div>
    <FormField v-if="form.preset === 'hourly'" label="At minute" v-slot="{ id }">
      <Select :id="id" :model-value="form.minute" :options="MINUTES" :disabled="readOnly" @update:model-value="patchForm({ minute: $event })" />
    </FormField>
    <TextField
      v-if="form.preset === 'custom'"
      label="Cron expression"
      field-class="wf:min-w-64"
      class="mb-input-mono"
      :model-value="form.cron"
      :readonly="readOnly"
      placeholder="0 8 * * 1-5"
      hint="minute - hour - day of month - month - weekday"
      @update:model-value="patchForm({ cron: String($event ?? '') })"
    />
  </div>
  <p v-if="errorFor(['cron'])" class="mb-error">{{ errorFor(['cron']) }}</p>

  <div class="wf:rounded-card wf:border wf:border-surface-200 wf:p-3 wf:dark:border-surface-800">
    <CheckCard
      :model-value="trigger.selection !== null"
      title="Look at documents"
      hint="Hands the matching documents to the steps as `documents`, or runs the steps once per document."
      :disabled="readOnly"
      @update:model-value="patch({ selection: $event ? newSelection() : null, perDocument: false })"
    />

    <div v-if="trigger.selection" class="wf:mt-3 wf:space-y-3 wf:border-t wf:border-surface-200 wf:pt-3 wf:dark:border-surface-800">
      <div class="wf:grid wf:gap-3 wf:@md:grid-cols-3">
        <FormField label="Status" v-slot="{ id }">
          <Select
            :id="id"
            :model-value="trigger.selection.status"
            :options="SELECTION_STATUSES"
            :disabled="readOnly"
            @update:model-value="patchSelection({ status: $event })"
          />
        </FormField>
        <FormField label="Changed within" v-slot="{ id }">
          <Select :id="id" v-model="changedWithin" :options="CHANGED_WITHIN" :disabled="readOnly" />
        </FormField>
        <FormField v-if="locales.length > 1" label="Language" v-slot="{ id }">
          <Select
            :id="id"
            :model-value="trigger.selection.locale ?? null"
            :options="localeOptions"
            :disabled="readOnly"
            @update:model-value="patchSelection({ locale: $event })"
          />
        </FormField>
      </div>
      <ChipFieldset
        :model-value="trigger.selection.typeIds"
        legend="Content types"
        :options="types"
        :disabled="readOnly"
        hint="None selected means every type."
        @update:model-value="patchSelection({ typeIds: $event })"
      />
      <Checkbox class="wf:cursor-pointer" :model-value="trigger.perDocument" :disabled="readOnly" @update:model-value="patch({ perDocument: $event })">
        <span>Run the steps once per document, with each as <span class="wf:font-mono">content</span></span>
      </Checkbox>
    </div>
  </div>
</template>
