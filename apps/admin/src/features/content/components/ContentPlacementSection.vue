<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import NumberField from '@manablox/admin-sdk/components/ui/NumberField.vue';
import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { useCan, useFeature } from '@manablox/admin-sdk/lib/space';
import { useDraftStore } from '../useDraftStore';

/** Where the open document shows: its tree position and the menus it is in. */
defineProps<{
  contentType: ContentTypeSummary;
  canWrite: boolean;
  /** The menus the document is in. */
  usedIn: readonly { id: string; name: string }[] | undefined;
}>();

const emit = defineEmits<{ assignMenus: [] }>();

const draft = useDraftStore();
const canEditMenus = useCan('menu:write');
const menusFeature = useFeature('menus');
</script>

<template>
  <div v-if="draft.doc && (contentType.isVisibleInTree || contentType.canBeVisibleInMenu)" class="mb-card space-y-4">
    <h2 class="text-sm font-bold">Placement</h2>
    <!-- Tree position; not for templates. -->
    <NumberField
      v-if="contentType.isVisibleInTree"
      :model-value="draft.doc.position"
      label="Position"
      :min="0"
      :readonly="!canWrite"
      hint="Order among its siblings in the tree."
      @update:model-value="draft.doc.position = $event ?? 0"
    />
    <div v-if="contentType.canBeVisibleInMenu && draft.doc.id && !menusFeature.hidden">
      <div class="flex items-center justify-between gap-2">
        <p class="mb-label mb-0">In menus</p>
        <FeatureGate v-if="canEditMenus" feature="menus" align="end">
          <button type="button" class="mb-btn-ghost mb-btn-sm -my-1" @click="emit('assignMenus')">
            <Icon name="menu" class="mb-icon-sm" /> {{ usedIn?.length ? 'Change' : 'Add to a menu' }}
          </button>
        </FeatureGate>
      </div>
      <ul v-if="usedIn?.length" class="mt-1.5 flex flex-wrap gap-1.5">
        <li v-for="menu in usedIn" :key="menu.id">
          <RouterLink :to="`/menus/${menu.id}`" class="mb-badge-brand hover:underline">{{ menu.name }}</RouterLink>
        </li>
      </ul>
      <p v-else class="mt-1.5 mb-meta">
        Not in any menu yet.
        <template v-if="!canEditMenus && menusFeature.enabled">
          Add it from <RouterLink to="/menus" class="underline">Menus</RouterLink>.
        </template>
      </p>
    </div>
  </div>
</template>
