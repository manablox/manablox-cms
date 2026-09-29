<script lang="ts">
import { addIcon, Icon as IconifyIcon, setCustomIconLoader } from '@iconify/vue';
import { ICON_NAMES, SUBJECT_ICON_NAMES } from '../lib/icon-names';
import { EAGER_ICONS } from '../lib/icons/eager';

/** Names with a colon pass straight to Iconify; the rest are lucide icons under the `mb` prefix. */
const KNOWN = new Set(ICON_NAMES);
const SUBJECTS = new Set(SUBJECT_ICON_NAMES);

for (const [name, data] of Object.entries(EAGER_ICONS)) addIcon(`mb:${name}`, data);

// The other icons live in two packs, each fetched once on the first icon it holds.
setCustomIconLoader(async (name) => {
  const pack = SUBJECTS.has(name)
    ? await import('../lib/icons/subjects')
    : await import('../lib/icons/actions');
  return pack.default[name] ?? null;
}, 'mb');
</script>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; class?: string }>();

const icon = computed(() =>
  props.name.includes(':') ? props.name : `mb:${KNOWN.has(props.name) ? props.name : 'chevron'}`,
);
</script>

<template>
  <IconifyIcon :icon="icon" :class="props.class ?? 'mb-icon'" aria-hidden="true" />
</template>
