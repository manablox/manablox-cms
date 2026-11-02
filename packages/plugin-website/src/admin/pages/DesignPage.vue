<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PageDesigner from '../components/PageDesigner.vue';

/** `/design/pages/:typeId`: one content type's page designer. */
const route = useRoute();
const typeId = computed(() => String(route.params.typeId ?? ''));
</script>

<template>
  <PageDesigner :key="typeId" :type-id="typeId" />
</template>
