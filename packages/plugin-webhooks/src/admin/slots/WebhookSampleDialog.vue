<script setup lang="ts">
import { FormDialog, FormField, Select, TextareaField, TextField } from '@manablox/admin-sdk';
import type { WorkflowSampleProps } from '@manablox/plugin-workflows/admin-slots';
import { computed, ref } from 'vue';

/** A sample incoming call for test-running a webhook workflow. */
const props = defineProps<WorkflowSampleProps>();

const METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'].map((value) => ({ value, label: value }));
const method = ref('POST');
const body = ref('{\n  "test": true\n}');
const query = ref('');

/** The body as JSON; an empty body is `{}`. */
const parsed = computed<{ ok: boolean; value: unknown }>(() => {
  const text = body.value.trim();
  if (!text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, value: null };
  }
});

function submit() {
  if (!parsed.value.ok) return;
  const params = Object.fromEntries(new URLSearchParams(query.value.trim().replace(/^\?/, '')));
  props.run({ payload: { method: method.value, body: parsed.value.value, query: params } });
}
</script>

<template>
  <FormDialog
    title="Test it with this call"
    width="max-w-xl"
    form-class="wh:space-y-4"
    submit-label="Run test"
    busy-label="Running..."
    :disabled="!parsed.ok"
    @submit="submit"
    @close="close"
  >
    <p class="mb-meta">
      The draft runs as if the endpoint had been called like this. Its actions really happen.
    </p>
    <div class="wh:grid wh:gap-3 wh:sm:grid-cols-[8rem_minmax(0,1fr)]">
      <FormField id="webhook-sample-method" label="Method" v-slot="{ id }">
        <Select :id="id" v-model="method" :options="METHODS" />
      </FormField>
      <TextField id="webhook-sample-query" v-model="query" label="Query string" class="wh:font-mono wh:text-xs" placeholder="order=42&amp;source=shop" />
    </div>
    <TextareaField
      id="webhook-sample-body"
      v-model="body"
      label="Body"
      rows="10"
      class="wh:font-mono wh:text-xs"
      spellcheck="false"
      :error="parsed.ok ? null : 'This is not valid JSON.'"
    >
      <template #hint>Read by the nodes as <span v-pre class="wh:font-mono">{{ payload.body }}</span>.</template>
    </TextareaField>
  </FormDialog>
</template>
