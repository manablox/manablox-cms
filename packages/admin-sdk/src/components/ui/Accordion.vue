<script lang="ts">
/** An accordion section; extra fields are passed back to the slots. */
interface AccordionSection {
  /** Stable key for open state. */
  value: string;
  label: string;
  icon?: string | undefined;
  /** Right-aligned text in the row. */
  hint?: string | undefined;
  disabled?: boolean | undefined;
}
</script>

<script setup lang="ts" generic="T extends AccordionSection">
import {
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
} from 'reka-ui';
import Icon from '../Icon.vue';

/**
 * Collapsible sections. The default slot renders a body, `trigger` replaces the row label,
 * and `v-model` is the open section(s).
 */
withDefaults(
  defineProps<{
    items: readonly T[];
    defaultValue?: string | string[] | undefined;
    /** Allow several open at once. */
    multiple?: boolean;
    variant?: 'rows' | 'cards';
    /** Keep closed bodies mounted, so form drafts survive. */
    keepMounted?: boolean;
  }>(),
  { multiple: false, variant: 'rows', keepMounted: false },
);
const open = defineModel<string | string[] | undefined>();
</script>

<template>
  <AccordionRoot
    :class="['mb-accordion', variant === 'cards' && 'mb-accordion-cards']"
    :type="multiple ? 'multiple' : 'single'"
    :default-value="defaultValue as never"
    :model-value="open as never"
    :collapsible="true"
    :unmount-on-hide="!keepMounted"
    @update:model-value="open = $event"
  >
    <AccordionItem v-for="item in items" :key="item.value" :value="item.value" :disabled="item.disabled ?? false">
      <AccordionHeader as="h3">
        <AccordionTrigger class="mb-accordion-trigger">
          <Icon name="chevron" class="mb-accordion-chevron" />
          <slot name="trigger" :item="item">
            <Icon v-if="item.icon" :name="item.icon" class="mb-icon shrink-0 text-surface-400" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <span v-if="item.hint" class="shrink-0 text-2xs text-surface-500">{{ item.hint }}</span>
          </slot>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionContent class="mb-accordion-content">
        <div class="mb-accordion-body"><slot :item="item" /></div>
      </AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>
