<script setup lang="ts">
import { PageHeader, usePluginApi } from '@manablox/admin-sdk';
import { useGreetings } from './greetings';

const { data } = useGreetings();
/** `hello-extra`'s api, exposed by its bundle's setup. */
const extra = usePluginApi<{ decorate(text: string): string }>('hello-extra');
</script>

<template>
  <div class="mb-page">
    <PageHeader title="Greetings" eyebrow="Hello" description="Greetings kept per space." />
    <p v-if="extra">{{ extra.decorate('Greetings from hello') }}</p>
    <p v-for="greeting in data ?? []" :key="greeting">{{ greeting }}</p>
  </div>
</template>
