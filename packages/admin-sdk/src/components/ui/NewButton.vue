<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import { useRouter } from 'vue-router';
import { useShortcuts } from '../../composables/useShortcuts';
import { shortcutHint } from '../../lib/shortcuts';
import Icon from '../Icon.vue';

/**
 * A page's "new" button: opens `to` or emits `click`, and `n` (or `keys`) does the same,
 * listed in the shortcut help. Hidden, with its shortcut, while `enabled` is false.
 */
const props = withDefaults(
  defineProps<{
    /** What it creates, e.g. `New menu`; the tooltip and the shortcut help say it too. */
    label: string;
    to?: RouteLocationRaw | undefined;
    enabled?: boolean;
    keys?: string;
    icon?: string;
  }>(),
  { to: undefined, enabled: true, keys: 'n', icon: 'plus' },
);
const emit = defineEmits<{ click: [] }>();
const router = useRouter();

function run() {
  if (props.to !== undefined) void router.push(props.to);
  else emit('click');
}

useShortcuts(() => [{ keys: props.keys, label: props.label, enabled: () => props.enabled, run }]);
</script>

<template>
  <template v-if="enabled">
    <RouterLink v-if="to !== undefined" :to="to" class="mb-btn-primary" :title="shortcutHint(keys, label)">
      <Icon :name="icon" /> <slot>{{ label }}</slot>
    </RouterLink>
    <button v-else type="button" class="mb-btn-primary" :title="shortcutHint(keys, label)" @click="run">
      <Icon :name="icon" /> <slot>{{ label }}</slot>
    </button>
  </template>
</template>
