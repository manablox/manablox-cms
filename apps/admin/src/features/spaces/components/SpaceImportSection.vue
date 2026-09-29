<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import ProgressBar from '@manablox/admin-sdk/components/ui/ProgressBar.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import { plural } from '@manablox/admin-sdk/lib/format';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import { importStateOf } from '../import-state';
import { type Space, spaces as spaceActions } from '../queries';

/** A space's unfinished import: progress while it runs, the error and Resume / Delete after a failure. */
const props = defineProps<{ space: Space }>();
const emit = defineEmits<{ deleted: [] }>();

const session = useSessionStore();
const state = computed(() => importStateOf(props.space));
const resuming = ref(false);
const error = ref<string | null>(null);

const canResume = computed(
  () =>
    session.isSuperadmin &&
    Boolean(state.value?.resumable) &&
    (state.value?.status === 'failed' || Boolean(state.value?.stale)),
);

const title = computed(() => (state.value?.status === 'failed' ? 'Import failed' : 'Importing'));
const description = computed(() =>
  state.value?.status === 'failed'
    ? 'The import stopped partway. Resume continues where it stopped; delete removes the space and everything imported so far.'
    : 'The space is hidden from delivery and automations until the import finishes. It takes no edits until then.',
);

function resume() {
  return runWrite(() => spaceActions.resumeImport(props.space.id), {
    success: (result) =>
      `Imported ${props.space.name}: ${plural(result.contents, 'document')}, ${plural(result.assets, 'asset')}`,
    busy: resuming,
    error,
  });
}

function remove() {
  return confirmAndRun(
    {
      title: `Delete ${props.space.name}?`,
      message: 'This removes the space and everything its import wrote so far.',
      confirmLabel: 'Delete space',
      danger: true,
    },
    async () => {
      await spaceActions.remove(props.space.id);
      emit('deleted');
    },
    { success: `Deleted ${props.space.name}`, error },
  );
}
</script>

<template>
  <Panel v-if="state" :title="title" :description="description" heading="h3">
    <template #actions>
      <StatusBadge :status="state.status" />
    </template>

    <div class="space-y-3">
      <ProgressBar
        :value="state.percent"
        :label="`${title}: ${state.percent}%`"
        :tone="state.status === 'failed' ? 'danger' : 'brand'"
      />
      <p class="text-sm text-surface-500">
        {{ state.status === 'failed' ? 'Stopped at' : 'Now' }}: {{ state.step }} ({{ state.percent }}%)
      </p>
      <p v-if="state.error" class="mb-callout text-sm" role="alert">{{ state.error }}</p>
      <p v-if="state.stale" class="text-sm text-surface-500">
        No progress for a while; the import may have been interrupted.
      </p>
      <p v-if="state.status === 'failed' && !state.resumable" class="text-sm text-surface-500">
        The file was not kept, so this import cannot be resumed. Delete the space and import again.
      </p>
      <p v-if="error" class="mb-error">{{ error }}</p>

      <div v-if="canResume || session.can('space:delete', space.id)" class="flex flex-wrap gap-2">
        <button v-if="canResume" type="button" class="mb-btn-primary" :disabled="resuming" @click="resume">
          <Icon name="play" /> {{ resuming ? 'Resuming...' : 'Resume import' }}
        </button>
        <button
          v-if="session.can('space:delete', space.id)"
          type="button"
          class="mb-btn-ghost-danger"
          :disabled="resuming"
          @click="remove"
        >
          <Icon name="trash" /> Delete space
        </button>
      </div>
    </div>
  </Panel>
</template>
