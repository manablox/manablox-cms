<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import {
  tags as actions,
  type TagWithCounts,
  useTagCounts,
} from '@manablox/admin-sdk/features/tags/queries';
import { plural } from '@manablox/admin-sdk/lib/format';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';

/** Settings -> Tags: the space's vocabulary, with what carries each tag. */
const spaces = useSpaceStore();

const search = ref('');
const { data, isPending, error, refetch } = useTagCounts(search);

const canWrite = useCan('content:write');

/** The tag being renamed, and the name typed for it. */
const renaming = ref<TagWithCounts | null>(null);
const name = ref('');

/** The tag being merged away, and the tag it goes into. */
const merging = ref<TagWithCounts | null>(null);
const target = ref('');

const mergeOptions = computed(() =>
  (data.value ?? [])
    .filter((tag) => tag.id !== merging.value?.id)
    .map((tag) => ({ value: tag.id, label: tag.name })),
);

const usage = (tag: TagWithCounts): string =>
  `${plural(tag.contentCount, 'document')}, ${plural(tag.assetCount, 'asset')}`;

function startRename(tag: TagWithCounts) {
  merging.value = null;
  renaming.value = tag;
  name.value = tag.name;
}

function startMerge(tag: TagWithCounts) {
  renaming.value = null;
  merging.value = tag;
  target.value = '';
}

async function rename() {
  const spaceId = spaces.currentId;
  const tag = renaming.value;
  if (!spaceId || !tag || !name.value.trim()) return;
  const done = await runWrite(() => actions.rename(spaceId, tag.id, name.value.trim()), {
    success: `Renamed to "${name.value.trim()}"`,
  });
  if (done) renaming.value = null;
}

async function merge() {
  const spaceId = spaces.currentId;
  const tag = merging.value;
  if (!spaceId || !tag || !target.value) return;
  const into = (data.value ?? []).find((entry) => entry.id === target.value);
  const done = await runWrite(() => actions.merge(spaceId, tag.id, target.value), {
    success: `Merged "${tag.name}" into "${into?.name ?? 'the other tag'}"`,
  });
  if (done) merging.value = null;
}

function remove(tag: TagWithCounts) {
  return confirmAndRun(
    {
      title: `Delete "${tag.name}"?`,
      message: `It comes off ${usage(tag)}. Nothing else changes.`,
      confirmLabel: 'Delete tag',
      danger: true,
    },
    () => actions.remove(requireSpace(), tag.id),
    { success: `Deleted "${tag.name}"` },
  );
}
</script>

<template>
  <Panel
    title="Tags"
    description="What editors label documents and assets with. A tag is created as soon as someone types it; here it can be renamed, merged or removed."
    size="lg"
    :card="false"
  >
    <template #actions>
      <SearchField v-model="search" label="Search tags" size="sm" class="w-48 shrink-0" placeholder="Search tags..." />
    </template>

    <AsyncList
      :pending="isPending"
      :error="error"
      :retry="refetch"
      :items="data"
      empty-icon="tag"
      :empty-title="search ? 'No tag matches that' : 'No tags yet'"
      :empty-description="search ? undefined : 'Tags appear here once an editor adds one to a document or an asset.'"
      empty="block"
      item-class="py-3"
    >
      <template #item="{ item: tag }">
        <div class="flex items-center gap-3">
          <Icon name="tag" class="mb-icon-sm shrink-0 text-surface-400" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ tag.name }}</p>
            <p class="truncate mb-meta">{{ usage(tag) }}</p>
          </div>
          <template v-if="canWrite">
            <button type="button" class="mb-btn-ghost mb-btn-sm" @click="startRename(tag)">Rename</button>
            <button type="button" class="mb-btn-ghost mb-btn-sm" :disabled="(data?.length ?? 0) < 2" @click="startMerge(tag)">
              Merge
            </button>
            <IconButton icon="trash" :label="`Delete ${tag.name}`" danger @click="remove(tag)" />
          </template>
        </div>

        <form v-if="renaming?.id === tag.id" class="mt-2 flex items-center gap-2" @submit.prevent="rename">
          <TextField v-model="name" class="mb-input-sm" field-class="flex-1" aria-label="New name" maxlength="64" />
          <button type="submit" class="mb-btn-primary mb-btn-sm" :disabled="!name.trim()">Save</button>
          <button type="button" class="mb-btn-ghost mb-btn-sm" @click="renaming = null">Cancel</button>
        </form>

        <form v-if="merging?.id === tag.id" class="mt-2 flex items-center gap-2" @submit.prevent="merge">
          <Select v-model="target" :options="mergeOptions" placeholder="Merge into..." class="flex-1" />
          <button type="submit" class="mb-btn-primary mb-btn-sm" :disabled="!target">Merge</button>
          <button type="button" class="mb-btn-ghost mb-btn-sm" @click="merging = null">Cancel</button>
        </form>
      </template>
    </AsyncList>
  </Panel>
</template>
