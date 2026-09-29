<script setup lang="ts">
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import type { Asset } from '@manablox/admin-sdk/features/assets/queries';
import AssetDetailPanel from './AssetDetailPanel.vue';

/** The Assets page's detail panel as a dialog, for editing an asset from a field. */
defineProps<{
  asset: Asset;
  spaceId: string;
  canWrite: boolean;
  canDelete: boolean;
}>();
const emit = defineEmits<{ close: []; deleted: [] }>();
</script>

<template>
  <Dialog :title="asset.name" width="max-w-md" dismissable @close="emit('close')">
    <AssetDetailPanel
      embedded
      :asset="asset"
      :space-id="spaceId"
      :can-write="canWrite"
      :can-delete="canDelete"
      @close="emit('close')"
      @deleted="emit('deleted')"
    />
  </Dialog>
</template>
