<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import BlockDesigner from '../components/BlockDesigner.vue';

/** `/design/blocks/:typeId`: one block type's designer. */
const route = useRoute();
const typeId = computed(() => String(route.params.typeId ?? ''));
</script>

<template>
  <BlockDesigner :key="typeId" :type-id="typeId" />
</template>
