<script setup lang="ts">
import { useGreetings } from './greetings';

defineProps<{ spaceId: string }>();
const { data } = useGreetings();
</script>

<template>
  <p>Hello keeps {{ data?.length ?? 0 }} greetings here.</p>
</template>
