<script setup lang="ts" generic="T extends string | number | null">
import {
  SelectContent,
  SelectGroup,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';
import { computed } from 'vue';
import Icon from '../Icon.vue';
import type { SelectOption } from './types';

export type { SelectOption };

/** reka-ui select; emits the chosen option's own value. `''` and `null` map to a sentinel, since reka rejects empty values. */
const model = defineModel<T>({ required: true });
const props = withDefaults(
  defineProps<{
    options: readonly SelectOption<T>[];
    id?: string | undefined;
    placeholder?: string;
    disabled?: boolean | undefined;
    variant?: 'default' | 'sm';
    /** Accessible name when there is no label. */
    ariaLabel?: string | undefined;
    /** Extra trigger classes. */
    class?: string | undefined;
  }>(),
  { variant: 'default', placeholder: '-' },
);

const NONE = ' none';

const keyOf = (value: unknown) =>
  value === '' || value === null || value === undefined ? NONE : String(value);

const items = computed(() =>
  props.options.map((option) => ({ ...option, key: keyOf(option.value) })),
);

/** Runs of options under their group heading; ungrouped runs have none. */
const sections = computed(() => {
  const out: { label: string | undefined; items: typeof items.value }[] = [];
  for (const item of items.value) {
    const last = out.at(-1);
    if (last && last.label === item.group) last.items.push(item);
    else out.push({ label: item.group, items: [item] });
  }
  return out;
});

/** Prose wraps at a fixed width instead of widening the list. */
const hasDescriptions = computed(() => props.options.some((option) => option.description));

const selected = computed(() => {
  const key = keyOf(model.value);
  return items.value.find((item) => item.key === key);
});

const inner = computed({
  get: () => keyOf(model.value),
  set: (key: string) => {
    const item = items.value.find((option) => option.key === key);
    if (item) model.value = item.value;
  },
});

const triggerClass = computed(() => {
  switch (props.variant) {
    case 'sm':
      return 'mb-input mb-input-sm';
    default:
      return 'mb-input';
  }
});
</script>

<template>
  <SelectRoot v-model="inner" :disabled="disabled">
    <SelectTrigger
      :id="id"
      :aria-label="ariaLabel"
      class="flex cursor-pointer items-center gap-2 text-left data-[placeholder]:text-surface-400"
      :class="[triggerClass, props.class]"
    >
      <!-- The label from `options`: reka keeps an item's first text, so late labels would go stale. -->
      <SelectValue :placeholder="placeholder" class="min-w-0 flex-1 truncate">{{ selected?.label ?? placeholder }}</SelectValue>
      <SelectIcon as-child>
        <Icon name="down" :class="'mb-icon shrink-0 text-surface-400'" />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="6"
        class="mb-popover mb-anim-pop min-w-[var(--reka-select-trigger-width)]"
        :class="hasDescriptions
          ? 'max-h-[min(28rem,var(--reka-select-content-available-height))] w-[max(var(--reka-select-trigger-width),20rem)] max-w-[var(--reka-select-content-available-width)]'
          : 'max-h-[min(18rem,var(--reka-select-content-available-height))]'"
        style="transform-origin: var(--reka-select-content-transform-origin)"
      >
        <SelectViewport>
          <SelectGroup v-for="(section, index) in sections" :key="section.label ?? `-${index}`">
          <SelectLabel v-if="section.label" class="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-surface-500 uppercase">{{ section.label }}</SelectLabel>
          <SelectItem
            v-for="item in section.items"
            :key="item.key"
            :value="item.key"
            class="mb-menu-item relative cursor-pointer select-none"
            :class="item.description ? 'items-start py-1.5' : item.hint ? 'items-start' : ''"
            style="padding-left: calc(var(--mb-control-px-sm) * 2 + var(--mb-icon))"
          >
            <!-- Full row height so the tick stays centred on two-line rows. -->
            <SelectItemIndicator
              class="absolute inset-y-0 flex items-center text-brand-600 dark:text-brand-300"
              style="left: var(--mb-control-px-sm)"
            >
              <Icon name="check" class="mb-icon-sm" />
            </SelectItemIndicator>
            <!-- `#leading` puts a picture before an option's text, like a theme's swatch. -->
            <slot name="leading" :option="item" />
            <span class="min-w-0 flex-1">
              <SelectItemText class="block truncate">{{ item.label }}</SelectItemText>
              <span v-if="item.hint" class="block truncate font-mono text-2xs text-surface-500">{{ item.hint }}</span>
              <span v-if="item.description" class="line-clamp-2 block mb-meta">{{ item.description }}</span>
            </span>
          </SelectItem>
          </SelectGroup>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
