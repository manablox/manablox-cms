<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { FeatureGate, Icon } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import SharePreviewDialog from '../components/SharePreviewDialog.vue';
import { useSiteContext } from '../useSiteContext';

/** "Share preview" in the document editor: designed sites share drafts on the site's host. */
const props = defineProps<AdminSlotProps['content.editor.actions']>();

const site = useSiteContext();
const origin = computed(() =>
  site.designed.value ? (site.liveOrigin.value ?? site.canvasOrigin.value) : null,
);
const sharing = ref(false);
</script>

<template>
  <FeatureGate
    v-if="props.document.id && origin && props.type.hasSlug"
    feature="plugins.website.shareLinks"
    label="Share preview"
    trigger-class="mb-btn-ghost"
  >
    <button
      class="mb-btn-ghost"
      title="Create a link that shows the saved draft on the site"
      @click="sharing = true"
    >
      <Icon name="link" /> Share preview
    </button>
  </FeatureGate>
  <SharePreviewDialog
    v-if="sharing && props.document.id && origin"
    :space-id="props.document.spaceId"
    :content-id="props.document.id"
    :origin="origin"
    @close="sharing = false"
  />
</template>
