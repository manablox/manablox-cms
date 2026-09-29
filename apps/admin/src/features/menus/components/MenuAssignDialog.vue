<script setup lang="ts">
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import {
  menus as menuActions,
  useMenuPlacements,
} from '@manablox/admin-sdk/features/menus/queries';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, watch } from 'vue';

/** Puts one document into any number of menus, each at a chosen spot. */
const props = defineProps<{
  localizationId: string;
  /** The document's title, for the empty state and the toast. */
  title: string;
  readOnly?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const spaces = useSpaceStore();

const { data, isPending, error, refetch } = useMenuPlacements(
  () => props.localizationId,
  () => spaces.locale,
  true,
);

type Option = NonNullable<typeof data.value>[number];
type Entry = Option['entries'][number];

/** One menu's row; `parentId` is `''` at the top level, `index` counts siblings without this document. */
interface Row {
  menuId: string;
  selected: boolean;
  parentId: string;
  index: number;
}

const form = useDraftForm<{ rows: Row[] }>();
const draft = form.draft;

watch(
  data,
  (loaded) => {
    if (!loaded) return;
    form.load(
      {
        rows: loaded.map((option) => ({
          menuId: option.menu.id,
          selected: option.placement !== null,
          parentId: option.placement?.parentId ?? '',
          index: option.placement?.index ?? countRoots(option.entries),
        })),
      },
      { keepEdits: true },
    );
  },
  { immediate: true },
);

/** Top-level entries, minus this document's own: where a new entry lands by default. */
function countRoots(entries: Entry[]): number {
  return entries.filter((entry) => entry.parentId === null && !entry.isSelf).length;
}

const rowFor = (menuId: string) => draft.value?.rows.find((row) => row.menuId === menuId);

/** This document's entry and everything under it: it cannot be nested inside itself. */
function blockedIn(entries: Entry[]): Set<string> {
  const blocked = new Set(entries.filter((entry) => entry.isSelf).map((entry) => entry.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of entries) {
      if (entry.parentId && blocked.has(entry.parentId) && !blocked.has(entry.id)) {
        blocked.add(entry.id);
        grew = true;
      }
    }
  }
  return blocked;
}

function parentOptions(option: Option) {
  const blocked = blockedIn(option.entries);
  return [
    { value: '', label: 'Top level' },
    ...option.entries
      .filter((entry) => !blocked.has(entry.id))
      .map((entry) => ({ value: entry.id, label: `${'- '.repeat(entry.depth)}${entry.label}` })),
  ];
}

/** The entries this document would sit among, in menu order. */
function siblings(option: Option, parentId: string): Entry[] {
  return option.entries.filter(
    (entry) =>
      (entry.parentId ?? '') === parentId &&
      !entry.isSelf &&
      !blockedIn(option.entries).has(entry.id),
  );
}

function positionOptions(option: Option, parentId: string) {
  const list = siblings(option, parentId);
  return [
    { value: 0, label: list.length ? 'First' : 'Only entry' },
    ...list.map((entry, index) => ({ value: index + 1, label: `After "${entry.label}"` })),
  ];
}

function setParent(option: Option, parentId: string) {
  const row = rowFor(option.menu.id);
  if (!row) return;
  row.parentId = parentId;
  // A new branch appends, rather than jumping to a spot the reader did not pick.
  row.index = siblings(option, parentId).length;
}

function setSelected(option: Option, selected: boolean) {
  const row = rowFor(option.menu.id);
  if (!row) return;
  row.selected = selected;
  if (selected && option.placement === null) {
    row.parentId = '';
    row.index = countRoots(option.entries);
  }
}

const chosen = computed(() => draft.value?.rows.filter((row) => row.selected).length ?? 0);

async function save(close: () => void) {
  if (!draft.value || !spaces.currentId || props.readOnly) return;
  const spaceId = spaces.currentId;
  const placements = draft.value.rows
    .filter((row) => row.selected)
    .map((row) => ({ menuId: row.menuId, parentId: row.parentId || null, index: row.index }));
  const ok = await form.submit(async () => {
    await menuActions.setPlacements(spaceId, props.localizationId, placements);
  });
  if (!ok) return;
  form.markSaved();
  toast.success(
    placements.length
      ? `"${props.title}" is in ${placements.length} menu${placements.length === 1 ? '' : 's'}`
      : `"${props.title}" is in no menu`,
  );
  close();
}
</script>

<template>
  <Dialog title="In menus" width="max-w-2xl" @close="emit('close')">
    <template #default="{ close }">
      <p class="mb-3 mb-meta">
        Pick the menus this document belongs to and where it sits in each. Unticking a menu takes it out; its sub-entries move up in its place.
      </p>

      <AsyncList
        :pending="isPending || !draft"
        :items="data"
        :error="error"
        :retry="refetch"
        :rows="3"
        empty="block"
        empty-icon="menu"
        empty-title="No menus in this space yet"
        empty-description="Create a menu first, then this document can be placed in it."
      >
        <template #empty-actions>
          <RouterLink to="/menus" class="mb-btn-outline" @click="close">Go to Menus</RouterLink>
        </template>

        <template #default="{ items }">
          <ul class="space-y-2">
            <li
              v-for="option in items"
              :key="option.menu.id"
              class="rounded-card border border-surface-200 p-3 dark:border-surface-700"
              :class="rowFor(option.menu.id)?.selected ? 'bg-surface-50 dark:bg-surface-800/40' : ''"
            >
              <Checkbox
                :model-value="rowFor(option.menu.id)?.selected ?? false"
                :disabled="readOnly"
                align="start"
                @update:model-value="setSelected(option, $event)"
              >
                <span class="min-w-0">
                  <span class="block truncate font-medium">{{ option.menu.name }}</span>
                  <span class="block truncate font-mono text-2xs text-surface-500">{{ option.menu.machineName }}</span>
                </span>
              </Checkbox>

              <div v-if="rowFor(option.menu.id)?.selected" class="mt-3 grid gap-3 sm:grid-cols-2">
                <FormField label="Nested under" v-slot="{ id }">
                  <Select
                    :id="id"
                    variant="sm"
                    :model-value="rowFor(option.menu.id)?.parentId ?? ''"
                    :options="parentOptions(option)"
                    :disabled="readOnly"
                    @update:model-value="setParent(option, $event)"
                  />
                </FormField>
                <FormField label="Position" v-slot="{ id }">
                  <Select
                    :id="id"
                    variant="sm"
                    :model-value="rowFor(option.menu.id)?.index ?? 0"
                    :options="positionOptions(option, rowFor(option.menu.id)?.parentId ?? '')"
                    :disabled="readOnly"
                    @update:model-value="(value) => { const row = rowFor(option.menu.id); if (row) row.index = value; }"
                  />
                </FormField>
              </div>
            </li>
          </ul>
        </template>
      </AsyncList>
    </template>

    <template #footer="{ close }">
      <span class="mr-auto self-center mb-meta">{{ chosen }} selected</span>
      <button type="button" class="mb-btn-ghost" @click="close">Cancel</button>
      <SaveButton
        v-if="!readOnly"
        :saving="form.saving.value"
        :disabled="!form.isDirty.value"
        label="Save menus"
        saving-label="Saving..."
        @click="save(close)"
      />
    </template>
  </Dialog>
</template>
