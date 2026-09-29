<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import ScrollSentinel from '@manablox/admin-sdk/components/ScrollSentinel.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import { content, useTreeChildren } from '@manablox/admin-sdk/features/content/queries';
import { confirmChoice } from '@manablox/admin-sdk/lib/confirm';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DropLine from '~/components/DropLine.vue';
import { duplicateChoice } from '~/features/content/model/duplicate-prompt';
import { dragging } from '~/features/content/model/tree-drag';
import { expansion } from '~/features/content/model/tree-expansion';

/** One lazily loaded, paginated level of the content tree; expanded rows mount a child level. */
const props = defineProps<{
  /** `null` is the root level. */
  parentId: string | null;
  level?: number;
}>();
const emit = defineEmits<{ changed: []; folder: [parentId: string | null] }>();

const spaces = useSpaceStore();
const route = useRoute();
const router = useRouter();
/** Row whose "add child" menu is open. */
const addingUnder = ref<string | null>(null);

const { data, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
  useTreeChildren(
    () => spaces.locale,
    () => props.parentId,
  );

const nodes = computed(() => data.value?.pages.flatMap((page) => page.items) ?? []);
type TreeRow = (typeof nodes.value)[number];

function isFolder(node: TreeRow): boolean {
  return spaces.isFolder(node.content.typeId);
}

async function setHome(id: string) {
  // Clicking the current home's star clears it.
  const clearing = spaces.homeContentId === id;
  await runWrite(() => spaces.setHome(clearing ? null : id), {
    success: clearing ? 'Home page cleared' : 'Set as the home page',
  });
  emit('changed');
}

/** Tracked so the hover-only button stays visible while the request is in flight. */
const duplicating = ref<string | null>(null);
async function duplicate(node: TreeRow) {
  if (!spaces.currentId || duplicating.value) return;

  // A node with children asks whether the copy takes them along.
  let children = false;
  if (node.childCount > 0) {
    const choice = await duplicateChoice(node.content.title || 'Untitled');
    if (!choice) return;
    children = choice === 'subtree';
  }

  duplicating.value = node.content.id;
  await runWrite(() => content.duplicate(requireSpace(), node.content.id, children), {
    success: (copy) => `Copied to "${copy.title}"`,
  });
  duplicating.value = null;
  emit('changed');
}

/** A node with children asks whether to delete them or move them up. Tracked like `duplicating`. */
const removing = ref<string | null>(null);
async function remove(node: TreeRow) {
  if (!spaces.currentId || removing.value) return;
  const title = node.content.title || 'Untitled';

  const run = async (children: 'cascade' | 'reparent') => {
    await content.remove(requireSpace(), node.content.id, children);
    // Leave the editor if it shows the deleted row.
    if (route.path === `/content/${node.content.id}`) await router.replace('/content');
  };
  const feedback = { success: `Deleted "${title}"` };

  removing.value = node.content.id;
  if (node.childCount > 0) {
    const choice = await confirmChoice<'cascade' | 'reparent'>({
      title: `Delete "${title}"?`,
      message: 'It has documents beneath it. Choose what happens to them.',
      choices: [
        {
          value: 'reparent',
          label: 'Keep them, one level up',
          description: 'They take the place this document holds in the tree.',
        },
        {
          value: 'cascade',
          label: 'Delete them as well',
          description: 'Everything beneath it goes with it.',
        },
      ],
      confirmLabel: 'Delete',
      danger: true,
    });
    if (choice && (await runWrite(() => run(choice), feedback))) emit('changed');
  } else {
    const done = await confirmAndRun(
      {
        title: `Delete "${title}"?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      },
      () => run('cascade'),
      feedback,
    );
    if (done) emit('changed');
  }
  removing.value = null;
}

// The dragged id is module-scoped (`tree-drag`) since a drag crosses level instances.

const canMove = useCan('content:write');
/** The folder type has its own menu entry. */
const creatable = computed(() => spaces.creatableKinds.filter((type) => type.isVisibleInTree));
const canSetHome = useCan('space:write');
const canDelete = useCan('content:delete');

/** `into` makes a child, `before` orders among siblings. */
const dropTarget = ref<{ id: string; mode: 'into' | 'before' } | null>(null);

function onDragStart(event: DragEvent, id: string) {
  dragging.value = id;
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragEnd() {
  dragging.value = null;
  dropTarget.value = null;
}

/** Blocks self-drops; the server rejects deeper cycles. */
function allowed(targetId: string): boolean {
  return canMove.value && dragging.value !== null && dragging.value !== targetId;
}

function onDragOver(event: DragEvent, targetId: string, mode: 'into' | 'before') {
  if (!allowed(targetId)) return;
  event.preventDefault();
  dropTarget.value = { id: targetId, mode };
}

async function onDrop(event: DragEvent, node: TreeRow, mode: 'into' | 'before') {
  if (!allowed(node.content.id)) return;
  event.preventDefault();
  event.stopPropagation();

  const moved = dragging.value as string;
  dragging.value = null;
  dropTarget.value = null;

  // `into` appends via `childCount` (the level may not be loaded); `before` takes the target's index.
  const parentId = mode === 'into' ? node.content.id : props.parentId;
  const position =
    mode === 'into'
      ? node.childCount
      : nodes.value.findIndex((candidate) => candidate.content.id === node.content.id);

  // Fails e.g. for a move into its own subtree.
  const wasMoved = await runWrite(() =>
    content.move(requireSpace(), moved, parentId, Math.max(0, position)),
  );
  // Open the target so the moved row stays visible.
  if (wasMoved && mode === 'into') expansion.expand([node.content.id]);
  emit('changed');
}
</script>

<template>
  <AsyncList :pending="isPending" :error="error" :retry="refetch" :items="nodes" :rows="parentId === null ? 6 : 1">
    <template #empty>
      <EmptyState
        v-if="parentId === null"
        compact
        icon="tree"
        title="No documents yet"
        description="Use + to start one."
      />
    </template>

  <ul :class="level ? 'ml-[13px] border-l border-surface-300/70 pl-1.5 dark:border-surface-700' : ''">
    <li v-for="node in nodes" :key="node.content.id">
      <!-- Drop here to reorder; drop on the row to nest. -->
      <DropLine
        :active="dropTarget?.id === node.content.id && dropTarget?.mode === 'before'"
        @dragover="onDragOver($event, node.content.id, 'before')"
        @drop="onDrop($event, node, 'before')"
      />

      <div
        class="mb-list-item mb-list-item-sm group pr-1"
        :class="[
          dragging === node.content.id ? 'opacity-40' : '',
          dropTarget?.id === node.content.id && dropTarget?.mode === 'into'
            ? 'shadow-[inset_0_0_0_1px_var(--color-brand-500)] ring-2 ring-brand-500/30'
            : '',
          $route.path === `/content/${node.content.id}` ? 'mb-list-item-active' : '',
        ]"
        :draggable="canMove"
        @dragstart="onDragStart($event, node.content.id)"
        @dragend="onDragEnd"
        @dragover="onDragOver($event, node.content.id, 'into')"
        @drop="onDrop($event, node, 'into')"
      >
        <button
          v-if="node.childCount > 0"
          class="shrink-0 rounded-sm text-surface-500"
          :aria-label="expansion.isOpen(node.content.id) ? 'Collapse' : 'Expand'"
          @click="expansion.toggle(node.content.id)"
        >
          <Icon :name="expansion.isOpen(node.content.id) ? 'down' : 'chevron'" class="mb-icon-sm" />
        </button>
        <span v-else class="mb-icon-sm shrink-0" />

        <span v-if="canMove" class="cursor-grab text-surface-400" title="Drag to move">
          <Icon name="drag" class="mb-icon-sm" />
        </span>

        <RouterLink
          :to="`/content/${node.content.id}`"
          class="flex min-w-0 flex-1 items-center gap-1.5 font-medium"
          :title="node.content.title || 'Untitled'"
        >
          <Icon
            :name="isFolder(node) ? 'folder' : typeIcon(spaces.typeById(node.content.typeId))"
            class="mb-icon-sm shrink-0 text-surface-500"
          />
          <span class="truncate">{{ node.content.title || 'Untitled' }}</span>
        </RouterLink>

        <!-- Home star: a toggle with `space:write`, a read-only marker otherwise. -->
        <button
          v-if="canSetHome && !isFolder(node)"
          class="rounded p-0.5"
          :class="
            spaces.homeContentId === node.content.id
              ? 'text-warn-500 hover:text-surface-400'
              : 'mb-row-action text-surface-400 hover:text-warn-500'
          "
          :aria-label="
            spaces.homeContentId === node.content.id ? 'Clear home page' : 'Set as home page'
          "
          :title="
            spaces.homeContentId === node.content.id
              ? 'The home page - click to clear'
              : 'Set as home page'
          "
          @click="setHome(node.content.id)"
        >
          <Icon name="star" class="mb-icon-sm" />
        </button>
        <span
          v-else-if="!isFolder(node) && spaces.homeContentId === node.content.id"
          class="p-0.5 text-warn-500"
          title="The home page"
        >
          <Icon name="star" class="mb-icon-sm" />
        </span>

        <span
          v-if="node.content.status === 'published'"
          class="h-1.5 w-1.5 rounded-pill bg-ok-500 shadow-[0_0_6px] shadow-ok-500/80"
          title="Published"
        />

        <button
          v-if="canMove && !isFolder(node)"
          type="button"
          class="rounded p-0.5 text-surface-500 hover:text-brand-600"
          :class="{ 'mb-row-action': duplicating !== node.content.id }"
          :disabled="duplicating !== null"
          aria-label="Duplicate this page"
          title="Duplicate this page"
          @click="duplicate(node)"
        >
          <Icon name="copy" class="mb-icon-sm" />
        </button>

        <IconButton
          v-if="canDelete"
          icon="trash"
          label="Delete this document"
          danger
          class="-my-1"
          :class="{ 'mb-row-action': removing !== node.content.id }"
          :disabled="removing !== null"
          @click="remove(node)"
        />

        <DropdownMenu
          v-if="canMove"
          :open="addingUnder === node.content.id"
          align="start"
          @update:open="addingUnder = $event ? node.content.id : null"
        >
          <template #trigger>
            <button
              class="rounded p-0.5 text-surface-500 hover:text-brand-600"
              :class="{ 'mb-row-action': addingUnder !== node.content.id }"
              aria-label="Add a child page"
              title="Add a child page"
            >
              <Icon name="plus" class="mb-icon-sm" />
            </button>
          </template>
          <button
            v-if="spaces.folderType"
            type="button"
            class="mb-menu-item mb-menu-item-sm"
            @click="addingUnder = null; emit('folder', node.content.id)"
          >
            <Icon name="folder-plus" class="mb-icon-sm" />
            New folder
          </button>
          <p v-if="!creatable.length" class="mb-list-empty">No content types yet.</p>
          <RouterLink
            v-for="type in creatable"
            :key="type.id"
            :to="`/content/new/${type.id}?parent=${node.content.id}`"
            class="mb-menu-item mb-menu-item-sm"
          >
            <Icon :name="typeIcon(type)" class="mb-icon-sm shrink-0 text-surface-500" />
            {{ type.label }}
          </RouterLink>
        </DropdownMenu>
      </div>

      <ContentTree
        v-if="expansion.isOpen(node.content.id)"
        :parent-id="node.content.id"
        :level="(level ?? 0) + 1"
        @changed="emit('changed')"
        @folder="emit('folder', $event)"
      />
    </li>

    <!-- Next page on scroll. -->
    <li v-if="hasNextPage">
      <ScrollSentinel :disabled="isFetchingNextPage" @reach="fetchNextPage()" />
      <Loader v-if="isFetchingNextPage" inline class="px-2 py-1 text-xs" label="Loading more..." />
    </li>
  </ul>
  </AsyncList>
</template>
