<script setup lang="ts">
import ContentPicker from '@manablox/admin-sdk/components/ContentPicker.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EditorHeader from '@manablox/admin-sdk/components/layout/EditorHeader.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import TextareaField from '@manablox/admin-sdk/components/ui/TextareaField.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useEditorForm } from '@manablox/admin-sdk/composables/useEditorForm';
import { menus as menuActions, useMenu } from '@manablox/admin-sdk/features/menus/queries';
import { isNotFound } from '@manablox/admin-sdk/lib/api-errors';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { technicalName } from '@manablox/core';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EditorLayout from '~/components/layout/EditorLayout.vue';
import MenuItemTree from '~/features/menus/components/MenuItemTree.vue';
import {
  applyMenuOp,
  contentItem,
  countItems,
  itemErrors,
  linkItem,
  type MenuDraft,
  type MenuOp,
  menuToDraft,
  toItemInput,
} from '~/features/menus/model';

const route = useRoute();
const router = useRouter();
const spaces = useSpaceStore();

const id = computed(() => route.params.id as string);
const { data, isLoading, error: loadError, refetch } = useMenu(id, () => spaces.locale);
const notFound = computed(() => isNotFound(loadError.value));

const canWrite = useCan('menu:write');
const readOnly = computed(() => !canWrite.value);

const form = useEditorForm({
  source: data,
  toDraft: menuToDraft,
  shallow: true,
  what: 'This menu',
  crumb: (draft: MenuDraft) => draft.name,
  save: () => save(),
  inline: ['items', 'name', 'machineName'],
});
const { draft, isDirty, saving, errors, otherErrors } = form;
const fieldError = form.fieldError;

/** Applies an op to a copy of the tree and swaps it in whole. */
function apply(op: MenuOp) {
  if (!draft.value) return;
  const items = applyMenuOp(draft.value.items, op);
  if (items) draft.value.items = items;
}

/** Expanded entries; new ones open expanded. */
const open = ref(new Set<string>());
function toggleOpen(key: string) {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

/** Documents whose type allows menus. */
const pickable = (row: { typeId: string }) => {
  const type = spaces.typeById(row.typeId);
  return type ? type.canBeVisibleInMenu && type.kind === 'content' : true;
};

function addContent(row: Parameters<typeof contentItem>[0]) {
  if (!draft.value) return;
  draft.value.items = [...draft.value.items, contentItem(row)];
}

function addLink() {
  if (!draft.value) return;
  const item = linkItem();
  draft.value.items = [...draft.value.items, item];
  open.value = new Set([...open.value, item.key]);
}

const total = computed(() => (draft.value ? countItems(draft.value.items) : 0));

const errorsByKey = computed(() =>
  draft.value ? itemErrors(draft.value.items, errors.value) : new Map<string, string>(),
);
const errorFor = (key: string) => errorsByKey.value.get(key) ?? null;

async function save() {
  if (!draft.value || readOnly.value || !isDirty.value) return;
  const current = draft.value;
  await form.submit(async () => {
    const saved = await menuActions.save(
      requireSpace(),
      id.value,
      {
        name: current.name.trim(),
        machineName: technicalName(current.machineName, { final: true }),
        description: current.description.trim() || null,
      },
      current.items.map(toItemInput),
    );
    form.markSaved();
    toast.success(`Saved "${saved.name}"`);
  });
}

async function remove() {
  if (!draft.value) return;
  const { name, machineName } = draft.value;
  return confirmAndRun(
    {
      title: 'Delete this menu?',
      message: `A site asking for "${machineName}" will get nothing. The documents themselves stay.`,
      confirmLabel: 'Delete menu',
      danger: true,
    },
    async () => {
      await menuActions.remove(requireSpace(), id.value);
      form.markSaved();
      await router.replace('/menus');
    },
    { success: `Deleted "${name}"` },
  );
}
</script>

<template>
  <PageState
    :ready="Boolean(draft)"
    :loading="isLoading"
    :error="notFound ? null : loadError"
    :retry="refetch"
    :not-found="notFound"
    loading-label="Loading menu..."
    not-found-title="Menu not found"
    not-found-icon="menu"
    back-to="/menus"
    back-label="All menus"
  >
  <div v-if="draft" class="mb-page">
    <EditorHeader :title="draft.name || 'Menu'" eyebrow="Menu">
      <template #badge>
        <StatusBadge v-if="readOnly" status="read-only" />
        <StatusBadge v-else-if="isDirty" status="unsaved" />
      </template>
      <SaveButton v-if="!readOnly" :saving="saving" :disabled="!isDirty" @click="save" />
      <button v-if="!readOnly" type="button" class="mb-btn-ghost-danger" title="Delete menu" @click="remove">
        <Icon name="trash" /> Delete
      </button>
    </EditorHeader>

    <div v-if="otherErrors.length" class="mb-callout mb-4" role="alert">
      <p v-for="message in otherErrors" :key="message">{{ message }}</p>
    </div>

    <EditorLayout>
      <!-- Entries. -->
      <section class="mb-card flex min-w-0 flex-col p-0!">
        <header class="border-b border-surface-200 px-4 py-3 dark:border-surface-800">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 class="flex items-center gap-2 text-sm font-bold">
              Entries
              <span class="mb-badge">{{ total }}</span>
            </h2>
            <span class="flex-1" />
            <div v-if="!readOnly" class="flex items-center gap-2">
              <ContentPicker label="Add document" trigger-icon="doc" :filter="pickable" @pick="addContent" />
              <button type="button" class="mb-btn-outline" @click="addLink">
                <Icon name="external" /> Add link
              </button>
            </div>
          </div>
          <p class="mt-1.5 mb-meta">
            <template v-if="readOnly">What the site renders, top to bottom.</template>
            <template v-else>Drag the <Icon name="drag" class="inline mb-icon-sm align-[-2px]" /> handle to reorder. Drop between entries to order them, onto an entry to nest under it.</template>
          </p>
        </header>

        <div class="mb-surface-inset flex-1 px-3 py-2 sm:px-4">
          <EmptyState
            v-if="!draft.items.length"
            compact
            icon="menu"
            title="Nothing in this menu yet"
            description="Add a document from the space, or a link to anywhere, then drag entries under one another to build the levels."
          />
          <MenuItemTree
            v-else
            :items="draft.items"
            :depth="0"
            :parent-key="null"
            :read-only="readOnly"
            :error-for="errorFor"
            :open="open"
            @op="apply"
            @toggle="toggleOpen"
          />
        </div>

        <footer class="border-t border-surface-200 px-4 py-2.5 mb-meta dark:border-surface-800">
          Showing the <span class="font-semibold text-surface-700 dark:text-surface-300">{{ spaces.locale }}</span> translation. A document with no translation in a language is left out of the menu the site fetches for that language.
        </footer>
      </section>

      <!-- Menu details and usage. -->
      <template #aside>
        <div class="mb-card space-y-4">
          <h2 class="text-sm font-bold">Details</h2>
          <TextField v-model="draft.name" label="Name" :readonly="readOnly" :error="fieldError(['name'])" />
          <TextField
            label="Technical name"
            :model-value="draft.machineName"
            class="mb-input-mono"
            :readonly="readOnly"
            :error="fieldError(['machineName'])"
            :hint="fieldError(['machineName']) ? undefined : 'What a site asks for; changing it breaks a site that already does.'"
            @update:model-value="draft.machineName = technicalName(String($event ?? ''))"
            @blur="draft.machineName = technicalName(draft.machineName, { final: true })"
          />
          <TextareaField v-model="draft.description" label="Description" rows="3" :readonly="readOnly" placeholder="Where this menu is shown" />
        </div>

        <div class="mb-card space-y-3">
          <h2 class="text-sm font-bold">Fetching it</h2>
          <dl class="space-y-2 text-xs">
            <div>
              <dt class="mb-eyebrow text-2xs">REST</dt>
              <dd class="mt-0.5 overflow-x-auto rounded-control bg-surface-100 px-2.5 py-1.5 font-mono text-surface-800 dark:bg-surface-800 dark:text-surface-200">GET /v1/menus/{{ draft.machineName || '...' }}</dd>
            </div>
            <div>
              <dt class="mb-eyebrow text-2xs">GraphQL</dt>
              <dd class="mt-0.5 overflow-x-auto rounded-control bg-surface-100 px-2.5 py-1.5 font-mono text-surface-800 dark:bg-surface-800 dark:text-surface-200">menu(name: "{{ draft.machineName || '...' }}")</dd>
            </div>
          </dl>
          <p class="mb-meta">
            Both return the entries as a tree, in this order, for the language asked for.
          </p>
        </div>
      </template>
    </EditorLayout>
  </div>
  </PageState>
</template>
