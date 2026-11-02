<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { Icon } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { useSiteAddress } from '../useSiteAddress';

/** "Visit site" in a staging environment: the environment's own address. */
const props = defineProps<AdminSlotProps['environment.address']>();

const siteUrl = useSiteAddress(() => props.environment);
const host = computed(() => {
  try {
    return siteUrl.value ? new URL(siteUrl.value).host : null;
  } catch {
    return siteUrl.value;
  }
});
</script>

<template>
  <a
    v-if="siteUrl"
    :href="siteUrl"
    target="_blank"
    rel="noreferrer"
    class="mb-btn-outline"
    :title="`Open ${host} in a new tab`"
    aria-label="Visit site"
  >
    <Icon name="external" class="mb-icon ws:text-surface-500" />
    <span class="ws:hidden ws:sm:inline">Visit site</span>
  </a>
</template>
