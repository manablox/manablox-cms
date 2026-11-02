<script setup lang="ts">
import { PageState, useCan, useMenus } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import MenuDesigner from '../components/MenuDesigner.vue';

/** `/design/menus/:key`: one menu design's designer, once the menus are known. */
const route = useRoute();
const key = computed(() => String(route.params.key ?? ''));
const canReadMenus = useCan('menu:read');
const menus = useMenus();
const ready = computed(() => !canReadMenus.value || !menus.isPending.value);
</script>

<template>
  <PageState class="ws:h-full" :loading="!ready" loading-label="Loading the menu design...">
    <MenuDesigner :key="key" :design-key="key" :menus="menus.data.value ?? []" />
  </PageState>
</template>
