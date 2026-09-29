<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import { adminLinks } from '@manablox/admin-sdk/lib/control-messages';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';

/** Help menu with the control-set docs, support, billing and upgrade links; absent without any. */
const session = useSessionStore();
const links = computed(() => adminLinks(session.me));
const open = ref(false);
</script>

<template>
  <DropdownMenu v-if="links.length" v-model:open="open" align="end" class="w-56">
    <template #trigger>
      <button type="button" class="mb-btn-ghost mb-btn-icon" aria-label="Help and account links" title="Help">
        <Icon name="circle-help" class="mb-icon" />
      </button>
    </template>
    <a
      v-for="link in links"
      :key="link.key"
      :href="link.href"
      target="_blank"
      rel="noopener noreferrer"
      class="mb-menu-item w-full"
    >
      <Icon :name="link.icon" class="mb-icon-sm" />
      <span class="flex-1">{{ link.label }}</span>
      <Icon name="external" class="mb-icon-sm text-surface-400" />
    </a>
  </DropdownMenu>
</template>
