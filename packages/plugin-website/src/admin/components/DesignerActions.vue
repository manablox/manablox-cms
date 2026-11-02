<script setup lang="ts">
import {
  DropdownMenu,
  Icon,
  IconButton,
  runWrite,
  shortcutHint,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { SiteDesignKind } from '@manablox/site';
import { computed, ref, useSlots } from 'vue';
import type { DesignStatus } from '../model/status';
import { design as designWrites } from '../queries';
import type { DesignDraft } from '../useDesignDraft';

/**
 * Save state, undo and redo, and Publish of a designer's toolbar. The default slot holds
 * extra buttons; `more` fills the overflow menu.
 */
const props = defineProps<{
  draft: Omit<DesignDraft<SiteDesignKind>, 'draft' | 'update'>;
  status: DesignStatus;
  /** What the success message names, e.g. `the design of "Article"`. */
  what: string;
  readOnly: boolean;
  canPublish: boolean;
}>();

const spaces = useSpaceStore();
const slots = useSlots();
const publishing = ref(false);
const moreOpen = ref(false);

const saveState = computed<{ label: string; icon: string; tone: string; hint: string } | null>(
  () => {
    if (props.draft.saving.value)
      return { label: 'Saving...', icon: 'spinner', tone: 'ws:text-surface-500', hint: '' };
    if (props.draft.isDirty.value)
      return props.readOnly
        ? null
        : {
            label: 'Unsaved',
            icon: 'clock',
            tone: 'ws:text-warn-700 ws:dark:text-warn-300',
            hint: 'Saves by itself in a moment',
          };
    return props.draft.lastSavedAt.value
      ? {
          label: 'Saved',
          icon: 'check',
          tone: 'ws:text-surface-500',
          hint: 'Saved as a draft; visitors see it once you publish',
        }
      : null;
  },
);
const canPublishNow = computed(
  () =>
    props.canPublish &&
    (props.draft.isDirty.value || props.status === 'unpublished' || props.status === 'changed'),
);
const publishHint = computed(() =>
  canPublishNow.value
    ? 'Make this design visible to visitors'
    : 'Nothing new to publish: visitors already see this version',
);

async function publish() {
  const spaceId = spaces.currentId;
  if (!spaceId || !(await props.draft.save())) return;
  const id = props.draft.query.data.value?.design?.id;
  if (!id) return;
  await runWrite(() => designWrites.publish(spaceId, id), {
    busy: publishing,
    success: `Published ${props.what}`,
  });
}
</script>

<template>
  <span v-if="saveState" class="ws:mr-1 ws:inline-flex ws:items-center ws:gap-1 ws:text-xs" :class="saveState.tone" :title="saveState.hint" aria-live="polite">
    <Icon :name="saveState.icon" class="mb-icon-sm" :class="saveState.icon === 'spinner' ? 'ws:animate-spin' : ''" />
    {{ saveState.label }}
  </span>
  <div class="ws:flex ws:items-center">
    <IconButton icon="undo" label="Undo" size="md" :disabled="!draft.canUndo.value" :title="shortcutHint('mod+z', 'Undo')" @click="draft.undo()" />
    <IconButton icon="redo" label="Redo" size="md" :disabled="!draft.canRedo.value" :title="shortcutHint('shift+mod+z', 'Redo')" @click="draft.redo()" />
  </div>
  <slot />
  <DropdownMenu v-if="slots.more" v-model:open="moreOpen" align="end" class="ws:w-64">
    <template #trigger>
      <button type="button" class="mb-btn-ghost mb-btn-icon" aria-label="More actions" title="More actions">
        <Icon name="ellipsis" class="mb-icon" />
      </button>
    </template>
    <slot name="more" />
  </DropdownMenu>
  <button v-if="canPublish" type="button" class="mb-btn-primary" :disabled="!canPublishNow || publishing || Boolean(draft.conflict.value)" :title="publishHint" @click="publish">
    <Icon name="upload" /> {{ publishing ? 'Publishing...' : 'Publish' }}
  </button>
</template>
