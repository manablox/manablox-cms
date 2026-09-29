<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import { featureLabel, lockedNotice } from '@manablox/admin-sdk/lib/features';
import { computed } from 'vue';

/** The feature a refused write names; mounted once at the root. */
const title = computed(() =>
  lockedNotice.value ? `${featureLabel(lockedNotice.value.feature)} is locked` : '',
);

function dismiss(): void {
  lockedNotice.value = null;
}
</script>

<template>
  <Dialog v-if="lockedNotice" :title="title" width="max-w-md" dismissable @close="dismiss">
    <p class="text-sm">{{ lockedNotice.message ?? 'It is not available here at the moment, so the change was not saved.' }}</p>
    <template #footer="{ close }">
      <button type="button" class="mb-btn-ghost" @click="close">Close</button>
      <a v-if="lockedNotice.link" :href="lockedNotice.link" target="_blank" rel="noopener" class="mb-btn-primary">
        See how to unlock <Icon name="external" class="mb-icon-sm" />
      </a>
    </template>
  </Dialog>
</template>
