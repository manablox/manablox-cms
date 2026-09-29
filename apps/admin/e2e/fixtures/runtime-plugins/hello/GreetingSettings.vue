<script setup lang="ts">
import type { Space } from '@manablox/admin-sdk';
import { useGreetings } from './greetings';

defineProps<{ space: Space }>();
const { data } = useGreetings();
</script>

<template>
  <section class="mb-card" aria-label="Greetings">
    <h2>Greetings</h2>
    <p class="mb-hint">{{ space.name }} has {{ data?.length ?? 0 }} greetings.</p>
  </section>
</template>
