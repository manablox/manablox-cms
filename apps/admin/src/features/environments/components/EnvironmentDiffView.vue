<script setup lang="ts">
import type { DiffView } from '@manablox/admin-sdk/features/environments/model';

/** What a promote changes in production: types with their fields, then the other kinds. */
defineProps<{ view: DiffView }>();
</script>

<template>
  <div class="space-y-4 text-sm" data-testid="environment-diff">
    <p v-if="view.empty" class="text-surface-500">Production already matches this environment - nothing would change.</p>

    <section v-if="view.types.length">
      <h3 class="mb-label">Content types</h3>
      <ul class="mb-list mb-list-divided rounded-card border border-surface-200 dark:border-surface-800">
        <li v-for="type in view.types" :key="type.id" class="px-3 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">{{ type.label }}</span>
            <code class="font-mono mb-meta">{{ type.name }}</code>
            <span :class="type.badge.tone">{{ type.badge.text }}</span>
            <span v-if="type.documents" class="mb-meta">{{ type.documents }}</span>
          </div>
          <ul v-if="type.fields.length" class="mt-1.5 space-y-1 border-l-2 border-surface-200 pl-3 dark:border-surface-700">
            <li v-for="field in type.fields" :key="field.name" class="flex flex-wrap items-center gap-2 text-xs">
              <span class="font-medium">{{ field.label }}</span>
              <code class="font-mono text-surface-500">{{ field.name }}</code>
              <span :class="field.badge.tone">{{ field.badge.text }}</span>
              <code v-if="field.types" class="font-mono">{{ field.types }}</code>
              <span v-if="field.documents" :class="field.breaking ? 'font-medium text-warn-800 dark:text-warn-200' : 'text-surface-500'">{{ field.documents }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </section>

    <section v-for="kind in view.kinds" :key="kind.kind">
      <h3 class="mb-label">{{ kind.label }} <span class="font-normal text-surface-500">- {{ kind.summary }}</span></h3>
      <ul class="flex flex-wrap gap-1.5">
        <li v-for="item in kind.items" :key="item.id" class="flex items-center gap-1.5 rounded-control border border-surface-200 px-2 py-0.5 text-xs dark:border-surface-800">
          <span class="max-w-60 truncate">{{ item.label }}</span>
          <span :class="item.badge.tone">{{ item.badge.text }}</span>
        </li>
        <li v-if="kind.more" class="px-1 py-0.5 mb-meta">and more</li>
      </ul>
    </section>
  </div>
</template>
