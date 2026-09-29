<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fromLocalInput, type ScheduleWindow, toLocalInput } from '../../lib/schedule';
import SaveButton from './SaveButton.vue';
import TextField from './TextField.vue';

/** Publish/unpublish window inputs; emits the dates to save. */
const props = defineProps<{
  window: ScheduleWindow;
  saving?: boolean | undefined;
  disabled?: boolean | undefined;
  publishHint: string;
  unpublishHint: string;
  idPrefix: string;
}>();
const emit = defineEmits<{ save: [ScheduleWindow] }>();

const publishAt = ref('');
const unpublishAt = ref('');

watch(
  () => props.window,
  (window) => {
    publishAt.value = toLocalInput(window.publishAt);
    unpublishAt.value = toLocalInput(window.unpublishAt);
  },
  { immediate: true, deep: true },
);

const isDirty = computed(
  () =>
    publishAt.value !== toLocalInput(props.window.publishAt) ||
    unpublishAt.value !== toLocalInput(props.window.unpublishAt),
);

/** Mirrors the server's rule client-side. */
const error = computed(() => {
  const from = fromLocalInput(publishAt.value);
  const until = fromLocalInput(unpublishAt.value);
  return from && until && until <= from ? 'The end of the window must come after its start.' : null;
});

const hasSchedule = computed(() => Boolean(publishAt.value || unpublishAt.value));

function submit() {
  if (error.value) return;
  emit('save', {
    publishAt: fromLocalInput(publishAt.value),
    unpublishAt: fromLocalInput(unpublishAt.value),
  });
}

function clear() {
  publishAt.value = '';
  unpublishAt.value = '';
  emit('save', { publishAt: null, unpublishAt: null });
}
</script>

<template>
  <form class="space-y-3" @submit.prevent="submit">
    <TextField
      :id="`${idPrefix}-publish-at`"
      v-model="publishAt"
      label="Publish at"
      type="datetime-local"
      :disabled="disabled"
      :hint="publishHint"
    />
    <TextField
      :id="`${idPrefix}-unpublish-at`"
      v-model="unpublishAt"
      label="Unpublish at"
      type="datetime-local"
      :disabled="disabled"
      :hint="unpublishHint"
    />

    <p v-if="error" class="mb-error">{{ error }}</p>

    <div class="flex items-center gap-2">
      <SaveButton
        type="submit"
        class="flex-1 justify-center"
        :saving="Boolean(saving)"
        :disabled="disabled || !isDirty || Boolean(error)"
        label="Save schedule"
      />
      <button
        v-if="hasSchedule"
        type="button"
        class="mb-btn-ghost"
        :disabled="disabled || saving"
        @click="clear"
      >
        Clear
      </button>
    </div>
  </form>
</template>
