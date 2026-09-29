<script setup lang="ts">
import Icon from '../Icon.vue';

/**
 * A square button showing only an icon: `label` names it for screen readers and, unless
 * `title` says otherwise, as its tooltip. `busy` swaps the icon for a spinner and disables it.
 */
withDefaults(
  defineProps<{
    icon: string;
    label: string;
    /** The tooltip; the label by default. */
    title?: string | undefined;
    /** A destructive action, drawn in the danger tone. */
    danger?: boolean;
    busy?: boolean;
    disabled?: boolean;
    size?: 'sm' | 'md';
    /** The icon's classes, e.g. a larger size or a rotation; `mb-icon` by default. */
    iconClass?: string;
  }>(),
  {
    title: undefined,
    danger: false,
    busy: false,
    disabled: false,
    size: 'sm',
    iconClass: 'mb-icon',
  },
);
</script>

<template>
  <button
    type="button"
    :class="[danger ? 'mb-btn-ghost-danger' : 'mb-btn-ghost', 'mb-btn-icon', size === 'sm' ? 'mb-btn-sm' : '']"
    :aria-label="label"
    :title="title ?? label"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
  >
    <Icon :name="busy ? 'spinner' : icon" :class="busy ? `${iconClass} animate-spin` : iconClass" />
  </button>
</template>
