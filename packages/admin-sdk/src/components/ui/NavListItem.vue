<script setup lang="ts">
import Icon from '../Icon.vue';

/** `NavList` row: a link when `to` is set, else a button. `trailing` slot sits at the right. */
withDefaults(
  defineProps<{
    to?: string | undefined;
    active?: boolean;
    icon?: string | undefined;
    /** Tighter spacing. */
    compact?: boolean;
  }>(),
  { active: false, compact: false },
);
const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <li>
    <component
      :is="to ? 'RouterLink' : 'button'"
      :to="to"
      :type="to ? undefined : 'button'"
      class="mb-list-item"
      :class="[compact ? 'mb-list-item-sm' : '', active ? 'mb-list-item-active' : '']"
      :aria-current="active ? (to ? 'page' : 'true') : undefined"
      @click="emit('select')"
    >
      <Icon v-if="icon" :name="icon" class="mb-icon shrink-0 text-surface-400" />
      <span class="min-w-0 flex-1 truncate"><slot /></span>
      <slot name="trailing" />
    </component>
  </li>
</template>
