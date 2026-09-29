<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../Icon.vue';

/**
 * Save button; disabled while saving to prevent double saves. With `icon` the icon turns into
 * a spinner while saving and the label stays unless `savingLabel` is given; the default slot
 * replaces the label.
 */
const props = withDefaults(
  defineProps<{
    saving: boolean;
    disabled?: boolean;
    label?: string;
    /** `Saving...` by default; the label when there is an icon. */
    savingLabel?: string | undefined;
    icon?: string | undefined;
    /** `outline` beside another primary, `ghost` in a toolbar, `danger` for a destructive submit. */
    variant?: 'primary' | 'outline' | 'ghost' | 'danger';
    type?: 'button' | 'submit';
  }>(),
  {
    disabled: false,
    label: 'Save',
    savingLabel: undefined,
    icon: undefined,
    variant: 'primary',
    type: 'button',
  },
);
const emit = defineEmits<{ click: [] }>();

const text = computed(() =>
  props.saving ? (props.savingLabel ?? (props.icon ? props.label : 'Saving...')) : props.label,
);

const VARIANTS = {
  primary: 'mb-btn-primary',
  outline: 'mb-btn-outline',
  ghost: 'mb-btn-ghost',
  danger: 'mb-btn-danger',
};
</script>

<template>
  <button
    :type="type"
    :class="VARIANTS[variant]"
    :disabled="disabled || saving"
    @click="emit('click')"
  >
    <Icon v-if="icon" :name="saving ? 'spinner' : icon" :class="saving ? 'mb-icon animate-spin' : 'mb-icon'" />
    <slot>{{ text }}</slot>
  </button>
</template>
