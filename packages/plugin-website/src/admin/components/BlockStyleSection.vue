<script setup lang="ts">
import {
  AssetPicker,
  Checkbox,
  FormField,
  Icon,
  IconButton,
  Select,
  useAssetsByIds,
  useFieldContext,
} from '@manablox/admin-sdk';
import type { BlockBreakpoint, BlockValue } from '@manablox/core';
import { type BlockInstanceDesign, defaultTheme, type ThemeDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import {
  BACKGROUND_POSITIONS,
  BACKGROUND_SIZES,
  type BackgroundImage,
  blockDesignOf,
  type InstanceStyleKey,
  instanceDesignOf,
  instanceStyleIssues,
  toggledHide,
  variantOptions,
  withStyleValue,
  withVariant,
} from '../model/block-style';
import { useSiteDesign } from '../queries';
import { useSiteContext } from '../useSiteContext';
import TokenPicker from './TokenPicker.vue';

/**
 * "Style this block" on a designed site: variant and the instance overrides stored in
 * `block.ext.website`. Renders nothing on spaces with an external frontend.
 */
const props = withDefaults(
  defineProps<{
    block: BlockValue;
    readOnly?: boolean;
    /** Folded behind a disclosure, for the form editor's block panels. */
    collapsible?: boolean;
  }>(),
  { readOnly: false, collapsible: false },
);
const emit = defineEmits<{ 'update:design': [BlockInstanceDesign | undefined] }>();

const context = useFieldContext();
const site = useSiteContext();
const type = computed(() => context.value.typeById(props.block.type));

const themeQuery = useSiteDesign('theme', () => (site.canRead.value ? 'default' : ''));
const blockQuery = useSiteDesign('block', () =>
  site.canRead.value && site.designed.value ? props.block.type : '',
);
const theme = computed(
  () => (themeQuery.data.value?.data as ThemeDesign | null | undefined) ?? defaultTheme(),
);
const blockDesign = computed(() =>
  blockDesignOf(blockQuery.data.value?.data, type.value as Parameters<typeof blockDesignOf>[1]),
);
const variants = computed(() => variantOptions(blockDesign.value));
const defaultVariant = computed(() => blockDesign.value?.default ?? null);

const design = computed(() => instanceDesignOf(props.block));
const style = computed(() => design.value?.style ?? {});
const issues = computed(() => instanceStyleIssues(design.value?.style));
const hasDesign = computed(() => Boolean(design.value?.variant || design.value?.style));

/** Controls hand over plain strings; validation reports what does not fit. */
function set(key: InstanceStyleKey, value: unknown) {
  emit('update:design', withStyleValue(design.value, key, value as never));
}
function setVariant(value: string) {
  emit('update:design', withVariant(design.value, value, defaultVariant.value));
}
function setImage(patch: Partial<BackgroundImage> | null) {
  const current = style.value.backgroundImage;
  if (patch === null || (!current && !patch.assetId)) {
    set('backgroundImage', undefined);
    return;
  }
  set('backgroundImage', { ...(current ?? { assetId: '' }), ...patch });
}
function toggleHide(breakpoint: BlockBreakpoint) {
  set('hide', toggledHide(style.value.hide, breakpoint));
}

const picking = ref(false);
const imageIds = computed(() =>
  style.value.backgroundImage?.assetId ? [style.value.backgroundImage.assetId] : [],
);
const imageRows = useAssetsByIds(imageIds);
const imageName = computed(() => imageRows.data.value?.[0]?.filename ?? 'Image');

const variantSelectOptions = computed(() =>
  variants.value.map((option) => ({
    value: option.value,
    label: option.value === defaultVariant.value ? `${option.label} (default)` : option.label,
  })),
);
const ALIGN_OPTIONS = [
  { value: '', label: 'Design default' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];
const WIDTH_OPTIONS = [
  { value: '', label: 'Design default' },
  { value: 'contained', label: 'Contained' },
  { value: 'full', label: 'Full width' },
];
const POSITION_OPTIONS = BACKGROUND_POSITIONS.map((value) => ({
  value,
  label: `${value[0]?.toUpperCase()}${value.slice(1)}`,
}));
const SIZE_OPTIONS = BACKGROUND_SIZES.map((value) => ({
  value,
  label: value === 'auto' ? 'Original size' : `${value[0]?.toUpperCase()}${value.slice(1)}`,
}));
const SPACING: Array<{ key: 'paddingY' | 'paddingX' | 'gap'; label: string }> = [
  { key: 'paddingY', label: 'Space above and below' },
  { key: 'paddingX', label: 'Space left and right' },
  { key: 'gap', label: 'Gap between elements' },
];
const BREAKPOINTS: Array<{ value: BlockBreakpoint; label: string }> = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'mobile', label: 'Mobile' },
];
</script>

<template>
  <component
    :is="collapsible ? 'details' : 'div'"
    v-if="site.designed.value"
    class="group ws:space-y-3"
    :class="collapsible ? 'ws:mt-3 ws:border-t ws:border-surface-200 ws:pt-3 ws:dark:border-surface-700' : ''"
    data-block-style
  >
    <summary v-if="collapsible" class="ws:cursor-pointer ws:text-sm ws:font-medium ws:text-surface-600 ws:dark:text-surface-300">
      Style this block<span v-if="hasDesign" class="mb-badge-brand ws:ml-2">customized</span>
    </summary>
    <div class="ws:flex ws:items-center ws:gap-2">
      <h3 class="mb-eyebrow ws:flex-1">{{ collapsible ? 'Overrides' : 'Style this block' }}</h3>
      <RouterLink
        v-if="site.canRead.value"
        :to="`/design/blocks/${block.type}`"
        class="mb-btn-ghost mb-btn-sm"
        aria-label="Edit block design"
        title="Edit the design of every block of this type"
      >
        <Icon name="file-pen" class="mb-icon-sm" /> Edit block design
      </RouterLink>
      <button
        v-if="!readOnly"
        type="button"
        class="mb-btn-ghost mb-btn-sm"
        :disabled="!hasDesign"
        title="Back to the block design"
        @click="emit('update:design', undefined)"
      >
        <Icon name="reset" class="mb-icon-sm" /> Reset
      </button>
    </div>
    <p v-if="issues['']" class="ws:text-xs ws:text-danger-600">{{ issues[''] }}</p>

    <FormField v-if="variants.length > 1" label="Variant">
      <template #default="{ id }">
        <Select
          :id="id"
          :model-value="design?.variant ?? defaultVariant ?? ''"
          :options="variantSelectOptions"
          :disabled="readOnly"
          @update:model-value="setVariant(String($event))"
        />
      </template>
    </FormField>

    <FormField label="Background" :error="issues.background">
      <template #default="{ id }">
        <TokenPicker
          :id="id"
          :model-value="style.background"
          group="color"
          :theme="theme"
          aria-label="Background"
          :disabled="readOnly"
          @update:model-value="set('background', $event)"
        />
      </template>
    </FormField>

    <FormField label="Background image" :error="issues.backgroundImage">
      <div v-if="style.backgroundImage?.assetId" class="ws:space-y-2">
        <div class="ws:flex ws:items-center ws:gap-2">
          <span class="ws:min-w-0 ws:flex-1 ws:truncate ws:text-sm">{{ imageName }}</span>
          <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" @click="picking = true">Change</button>
          <IconButton v-if="!readOnly" icon="x" label="Remove background image" title="Remove" danger @click="setImage(null)" />
        </div>
        <div class="ws:grid ws:grid-cols-2 ws:gap-2">
          <Select
            :model-value="style.backgroundImage.position ?? 'center'"
            :options="POSITION_OPTIONS"
            aria-label="Image position"
            :disabled="readOnly"
            @update:model-value="setImage({ position: $event })"
          />
          <Select
            :model-value="style.backgroundImage.size ?? 'cover'"
            :options="SIZE_OPTIONS"
            aria-label="Image size"
            :disabled="readOnly"
            @update:model-value="setImage({ size: $event })"
          />
        </div>
        <Checkbox
          :model-value="style.backgroundImage.repeat === true"
          :disabled="readOnly"
          @update:model-value="setImage({ repeat: $event })"
        >
          Repeat the image
        </Checkbox>
      </div>
      <button v-else-if="!readOnly" type="button" class="mb-btn-outline mb-btn-sm" @click="picking = true">
        <Icon name="image" class="mb-icon-sm" /> Choose an image
      </button>
      <p v-else class="mb-meta">None</p>
    </FormField>

    <div class="ws:grid ws:gap-3 ws:sm:grid-cols-2">
      <FormField v-for="entry in SPACING" :key="entry.key" :label="entry.label" :error="issues[entry.key]">
        <template #default="{ id }">
          <TokenPicker
            :id="id"
            :model-value="style[entry.key]"
            group="space"
            :extra="['0']"
            :theme="theme"
            :disabled="readOnly"
            @update:model-value="set(entry.key, $event)"
          />
        </template>
      </FormField>
      <FormField label="Text alignment" :error="issues.textAlign">
        <template #default="{ id }">
          <Select
            :id="id"
            :model-value="style.textAlign ?? ''"
            :options="ALIGN_OPTIONS"
            :disabled="readOnly"
            @update:model-value="set('textAlign', $event || undefined)"
          />
        </template>
      </FormField>
      <FormField label="Width" :error="issues.width">
        <template #default="{ id }">
          <Select
            :id="id"
            :model-value="style.width ?? ''"
            :options="WIDTH_OPTIONS"
            :disabled="readOnly"
            @update:model-value="set('width', $event || undefined)"
          />
        </template>
      </FormField>
    </div>

    <FormField label="Hide on" :error="issues.hide">
      <div class="ws:flex ws:flex-wrap ws:gap-4">
        <Checkbox
          v-for="entry in BREAKPOINTS"
          :key="entry.value"
          :model-value="(style.hide ?? []).includes(entry.value)"
          :disabled="readOnly"
          @update:model-value="toggleHide(entry.value)"
        >
          {{ entry.label }}
        </Checkbox>
      </div>
    </FormField>

    <AssetPicker
      v-if="picking"
      :accept="['image/']"
      :used="imageIds"
      @select="setImage({ assetId: $event[0] ?? '' }); picking = false"
      @close="picking = false"
    />
  </component>
</template>
