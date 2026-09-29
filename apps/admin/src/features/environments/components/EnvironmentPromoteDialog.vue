<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import {
  diffView,
  MODES,
  promoteConfirmText,
  promoteReady,
} from '@manablox/admin-sdk/features/environments/model';
import {
  type Environment,
  type EnvironmentMode,
  environments,
  type PromoteResult,
  useEnvironmentDiff,
} from '@manablox/admin-sdk/features/environments/queries';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';
import EnvironmentDiffView from './EnvironmentDiffView.vue';

/** Promotes a staging environment into production after a preview of the changes. */
const props = defineProps<{ environment: Environment }>();
const emit = defineEmits<{ close: []; done: [result: PromoteResult] }>();

const mode = ref<EnvironmentMode>('config');
const typed = ref('');
const diff = useEnvironmentDiff(() => props.environment.machineName, mode);
const view = computed(() => (diff.data.value ? diffView(diff.data.value) : null));
const confirmText = computed(() =>
  diff.data.value ? promoteConfirmText(diff.data.value, props.environment.machineName) : null,
);
const ready = computed(
  () =>
    !diff.isFetching.value &&
    promoteReady(diff.data.value, props.environment.machineName, typed.value),
);
const modes = (Object.keys(MODES) as EnvironmentMode[]).map((value) => ({
  value,
  title: MODES[value].label,
  hint: MODES[value].promote,
}));

/** Resolves true once the promote ran, which closes the dialog for its result. */
async function promote(): Promise<boolean> {
  if (!ready.value || !diff.data.value) return false;
  let result: PromoteResult | null = null;
  const confirm = diff.data.value.confirmRequired;
  const ok = await runWrite(async () => {
    result = await environments.promote(
      requireSpace(),
      props.environment.machineName,
      mode.value,
      confirm,
    );
  });
  // Assigned in the callback, which narrowing does not follow.
  const outcome = result as PromoteResult | null;
  if (!ok || !outcome) return false;
  emit('done', outcome);
  return true;
}
</script>

<template>
  <FormDialog
    :title="`Promote ${environment.name} to production`"
    width="max-w-3xl"
    submit-label="Promote to production"
    busy-label="Promoting..."
    danger
    :disabled="!ready"
    form-class="space-y-4"
    @submit="promote"
    @close="emit('close')"
  >
    <fieldset>
      <legend class="mb-label">What to promote</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <RadioCard
          v-for="entry in modes"
          :key="entry.value"
          v-model="mode"
          name="promote-mode"
          :value="entry.value"
          :title="entry.title"
          :hint="entry.hint"
        />
      </div>
    </fieldset>

    <div v-if="diff.isPending.value" class="flex items-center gap-2 text-sm text-surface-500"><Loader /> Comparing with production...</div>
    <p v-else-if="diff.error.value" class="mb-error">
      {{ messageFor(diff.error.value) }}
      <button type="button" class="ml-1 underline" @click="diff.refetch()">Try again</button>
    </p>
    <template v-else-if="view">
      <p v-if="view.breaking" class="mb-callout" role="alert">
        Some fields are removed or change their type while production documents hold values for them.
        The values stay stored, but the site and the API no longer show them.
      </p>
      <EnvironmentDiffView :view="view" />
      <TextField
        v-if="confirmText"
        v-model="typed"
        :label="`Type ${confirmText} to confirm`"
        class="mb-input-mono"
        autocomplete="off"
        :placeholder="confirmText"
      />
    </template>
    <p class="mb-hint">
      A snapshot of production is taken first when snapshots are on. Production takes no changes while the promote runs.
    </p>
  </FormDialog>
</template>
