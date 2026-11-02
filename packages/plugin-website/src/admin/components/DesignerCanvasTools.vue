<script setup lang="ts">
import { Select, Switch } from '@manablox/admin-sdk';
import { computed } from 'vue';

/** The element designers' canvas controls: the language of static text and free resizing. */
const props = defineProps<{ locales: readonly string[]; readOnly: boolean }>();
const locale = defineModel<string>('locale', { required: true });
const exact = defineModel<boolean>('exact', { required: true });

const localeOptions = computed(() =>
  props.locales.map((entry) => ({ value: entry, label: entry.toUpperCase() })),
);
</script>

<template>
  <Select v-if="locales.length > 1" v-model="locale" :options="localeOptions" variant="sm" class="ws:!w-20" aria-label="Language of the static text" title="Language of the text you type into elements" />
  <Switch v-if="!readOnly" v-model="exact" compact>
    <span class="ws:text-2xs ws:text-surface-600 ws:dark:text-surface-400" title="Off: dragging an element's edge on the preview snaps to the theme's widths and spacing. On: any pixel size.">Free resize</span>
  </Switch>
  <span v-if="$slots.default" class="ws:min-w-0 ws:truncate ws:text-2xs ws:text-surface-500"><slot /></span>
</template>
