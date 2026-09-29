<script setup lang="ts">
import {
  AsyncList,
  Icon,
  IconButton,
  NewButton,
  PageHeader,
  plural,
  requireSpace,
  runWrite,
  SectionIntro,
  StatusBadge,
  Switch,
  toast,
  useCan,
  useJsonFilePick,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed, ref, watch } from 'vue';
import StartRunDialog from '../components/StartRunDialog.vue';
import WorkflowCreateDialog from '../components/WorkflowCreateDialog.vue';
import { describeTrigger, triggerKind } from '../model';
import {
  useWorkflowCatalog,
  useWorkflowPage,
  WORKFLOW_PAGE_SIZE,
  type WorkflowListItem,
  workflows as workflowActions,
} from '../queries';
import { exportWorkflow } from '../useWorkflowActions';

/** The `/workflows` landing, with a switch per workflow. */
const spaces = useSpaceStore();
const { data, isPending, error, refetch, page, total } = useWorkflowPage();
const items = computed(() => data.value?.items);
const { data: catalog } = useWorkflowCatalog();
const canWrite = useCan('workflows:write');

const creating = ref(false);

/** The row whose copy is being made, to keep its button busy. */
const duplicating = ref<string | null>(null);
async function duplicate(id: string) {
  if (duplicating.value) return;
  duplicating.value = id;
  await runWrite(() => workflowActions.duplicate(requireSpace(), id), {
    success: (copy) => `Copied to "${copy.name}"`,
  });
  duplicating.value = null;
}

/** The manual workflow being started. */
const starting = ref<WorkflowListItem | null>(null);

/** The last import, with what it had to change to fit this space. */
const imported = ref<{ id: string; name: string; notes: string[] } | null>(null);
const importing = ref(false);
const filePicker = ref<HTMLInputElement | null>(null);

const { onChange: importFile, error: importError } = useJsonFilePick<
  Parameters<typeof workflowActions.import>[1]
>({
  clear: true,
  invalid: 'That file is not JSON.',
  onPicked: async (parsed) => {
    await runWrite(
      async () => {
        const result = await workflowActions.import(requireSpace(), parsed);
        imported.value = {
          id: result.workflow.id,
          name: result.workflow.name,
          notes: result.notes,
        };
        return result;
      },
      { success: (result) => `Imported "${result.workflow.name}" as a draft`, busy: importing },
    );
  },
});
watch(importError, (message) => {
  if (message) toast.error(message);
});

function setEnabled(id: string, enabled: boolean) {
  return runWrite(() => workflowActions.setEnabled(requireSpace(), id, enabled), {
    success: (saved) => `${saved.name} is ${enabled ? 'on' : 'off'}`,
  });
}

/** One sentence per workflow, computed per page. */
const descriptions = computed(
  () => new Map((items.value ?? []).map((workflow) => [workflow.id, describe(workflow)])),
);

const describe = (workflow: WorkflowListItem): string =>
  describeTrigger(workflow.trigger, catalog.value, (id) => spaces.typeById(id)?.label);
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Workflows"
      description="What happens when content changes, or on a schedule: call an API, ask a model, write a document, tell someone - as nodes you join up on a canvas."
    >
      <template v-if="canWrite">
        <button class="mb-btn-outline" :disabled="importing" title="Create a workflow from an exported JSON file" @click="filePicker?.click()">
          <Icon name="file-up" /> {{ importing ? 'Importing...' : 'Import' }}
        </button>
        <input ref="filePicker" type="file" accept="application/json,.json" class="wf:sr-only" aria-label="Workflow file to import" @change="importFile" />
      </template>
      <NewButton label="New workflow" :enabled="canWrite" @click="creating = true" />
    </PageHeader>

    <div v-if="imported" class="mb-callout wf:mb-4 wf:text-xs" role="status">
      <div class="wf:flex wf:items-start wf:gap-2">
        <div class="wf:min-w-0 wf:flex-1 wf:space-y-1">
          <p>
            Imported <RouterLink :to="`/workflows/${imported.id}`" class="wf:font-semibold wf:underline">{{ imported.name }}</RouterLink>.
            It is an unpublished draft, switched off, until you have checked and published it.
          </p>
          <ul v-if="imported.notes.length" class="wf:list-disc wf:pl-4">
            <li v-for="line in imported.notes" :key="line">{{ line }}</li>
          </ul>
        </div>
        <IconButton icon="x" label="Dismiss" @click="imported = null" />
      </div>
    </div>

    <div v-if="catalog && (!catalog.mail || !catalog.push)" class="mb-callout wf:mb-4 wf:text-xs">
      <template v-if="!catalog.mail && !catalog.push">
        Mail and push are not configured on this instance. Steps of those kinds are saved, but fail when they run.
      </template>
      <template v-else-if="!catalog.mail">Mail is not configured on this instance (MAIL_DRIVER), so the email action fails when it runs.</template>
      <template v-else>Push is not configured on this instance (PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY), so the push action fails when it runs.</template>
    </div>

    <section class="mb-card wf:space-y-3">
      <SectionIntro
        icon="workflow"
        title="Workflows in this space"
        :count="total"
        blurb="Pick a workflow to build it on the canvas. The switch turns one on or off; a workflow runs its published version only."
      />
      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="items"
        empty-icon="workflow"
        empty-title="No workflows yet"
        :empty-description="canWrite ? 'Start with one that emails you when a page is published.' : 'Someone with workflow rights can create one.'"
        item-class="wf:flex wf:items-center wf:gap-3 wf:py-2.5"
        v-model:page="page"
        :total="total"
        :page-size="WORKFLOW_PAGE_SIZE"
      >
        <template v-if="canWrite" #empty-actions>
          <button class="mb-btn-primary" @click="creating = true">Create workflow</button>
        </template>
        <template #item="{ item }">
          <Icon :name="triggerKind(item.trigger.kind).icon" class="mb-icon wf:shrink-0 wf:text-surface-400" />
          <RouterLink :to="`/workflows/${item.id}`" class="wf:min-w-0 wf:flex-1">
            <span class="wf:flex wf:items-center wf:gap-2">
              <span class="wf:truncate wf:text-sm wf:font-medium wf:hover:underline">{{ item.name }}</span>
              <StatusBadge
                v-if="item.source === 'code'"
                status="code"
                :title="`Declared by ${item.sourceRef ?? 'the config'}`"
              />
              <StatusBadge v-if="item.publishedVersion === null" status="draft" title="Not published: its trigger starts nothing yet" />
              <StatusBadge v-else-if="item.draftChanged" status="changed" title="Has saved changes that are not published" />
            </span>
            <span class="wf:block wf:truncate mb-meta">{{ descriptions.get(item.id) }} - {{ plural(item.nodes.length, 'node') }}<template v-if="item.publishedVersion !== null"> - v{{ item.publishedVersion }} live</template></span>
          </RouterLink>
          <IconButton
            v-if="canWrite && item.triggerKind === 'manual' && item.publishedVersion !== null"
            icon="play"
            :label="`Run ${item.name}`"
            :title="item.enabled ? 'Run the live version now' : 'Switch it on to run it'"
            :disabled="!item.enabled"
            @click="starting = item"
          />
          <IconButton
            icon="download"
            :label="`Export ${item.name}`"
            title="Export as JSON"
            @click="exportWorkflow(item.id, item.slug || item.name)"
          />
          <IconButton
            v-if="canWrite"
            icon="copy"
            :label="`Duplicate ${item.name}`"
            title="Duplicate"
            :disabled="duplicating !== null"
            @click="duplicate(item.id)"
          />
          <Switch
            :model-value="item.enabled"
            :aria-label="`${item.name}: ${item.enabled ? 'on' : 'off'}`"
            :disabled="!canWrite"
            @update:model-value="setEnabled(item.id, $event)"
          />
        </template>
      </AsyncList>
    </section>

    <StartRunDialog v-if="starting && starting.publishedVersion !== null" :workflow-id="starting.id" :name="starting.name" :version="starting.publishedVersion" @close="starting = null" />
    <WorkflowCreateDialog v-if="creating && spaces.currentId" :space-id="spaces.currentId" @close="creating = false" />
  </div>
</template>
