<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import ChipToggle from '@manablox/admin-sdk/components/ui/ChipToggle.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import { type Asset, assets } from '@manablox/admin-sdk/features/assets/queries';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref, watch } from 'vue';

/**
 * The spaces sharing this asset. Spaces the caller is not in are hidden but kept; ones
 * they may not upload to are locked (the server checks again).
 */
const props = defineProps<{ asset: Asset; spaceId: string }>();
/** Removed from the space it was opened in. */
const emit = defineEmits<{ left: [] }>();

const session = useSessionStore();
const spaces = useSpaceStore();

const picked = ref<Set<string>>(new Set());
watch(
  () => props.asset.spaceIds,
  (ids) => {
    picked.value = new Set(ids);
  },
  { immediate: true },
);

const known = computed(() => new Set(spaces.spaces.map((space) => space.id)));
/** Count of spaces the user cannot see. */
const hidden = computed(() => props.asset.spaceIds.filter((id) => !known.value.has(id)).length);

const dirty = computed(
  () =>
    picked.value.size !== props.asset.spaceIds.length ||
    props.asset.spaceIds.some((id) => !picked.value.has(id)),
);

/** Locked without upload rights, or when it is the last space. */
function locked(spaceId: string): boolean {
  if (!session.can('asset:write', spaceId)) return true;
  return picked.value.size === 1 && picked.value.has(spaceId);
}

function toggle(spaceId: string) {
  const next = new Set(picked.value);
  if (next.has(spaceId)) next.delete(spaceId);
  else next.add(spaceId);
  picked.value = next;
}

const saving = ref(false);
function save() {
  const spaceIds = [...picked.value];
  const stays = spaceIds.includes(props.spaceId);
  return runWrite(
    async () => {
      await assets.setSpaces(props.spaceId, props.asset.id, spaceIds, props.asset.spaceIds);
      if (!stays) emit('left');
    },
    {
      success: stays ? 'Spaces saved' : `${props.asset.name} was moved out of this space`,
      busy: saving,
    },
  );
}
</script>

<template>
  <section class="space-y-2 border-t border-surface-200 pt-3 dark:border-surface-800">
    <div class="flex items-center gap-2 text-xs font-bold">
      <Icon name="globe" class="mb-icon-sm" />
      <span class="flex-1">Spaces</span>
      <span v-if="asset.spaceIds.length > 1" class="mb-badge">shared</span>
    </div>
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Spaces this asset is in">
      <ChipToggle
        v-for="space in spaces.spaces"
        :key="space.id"
        :model-value="picked.has(space.id)"
        :disabled="locked(space.id)"
        @update:model-value="toggle(space.id)"
      >
        {{ space.name }}
      </ChipToggle>
    </div>
    <p v-if="hidden" class="mb-hint">
      Also in {{ hidden }} {{ hidden === 1 ? 'space' : 'spaces' }} you are not a member of.
    </p>
    <p class="mb-hint">
      One file in every space you pick: its name, alt text and image edits are the same in all of them.
    </p>
    <SaveButton
      v-if="dirty"
      class="w-full justify-center"
      variant="outline"
      :saving="saving"
      label="Save spaces"
      @click="save"
    />
  </section>
</template>
