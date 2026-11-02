<script setup lang="ts">
import { FormField, Select, Switch, TextField } from '@manablox/admin-sdk';
import {
  BUTTON_VARIANTS,
  type DesignNode,
  EMBED_PROVIDERS,
  type StyleProps,
  type StyleRules,
} from '@manablox/site';
import { computed } from 'vue';
import { SITE_ICONS } from '../model/elements';
import { withProp } from '../model/outline';
import { useDesignerContext } from '../useDesignerContext';

/** The options of one kind of element: heading level, link target, image fit and the like. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const { theme, readOnly } = useDesignerContext();
const el = computed(() => props.node.el);
const nodeProps = computed(() => props.node.props ?? {});

function update(next: DesignNode, group?: string) {
  if (!readOnly.value) emit('update', next, group);
}

function setProp(key: string, value: unknown) {
  update(withProp(props.node, key, value), `props:${props.node.id}:${key}`);
}

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6].map((level) => ({
  value: level,
  label: `Level ${level} (h${level})`,
}));
const TEXT_TAGS = [
  'p',
  'span',
  'div',
  'small',
  'strong',
  'em',
  'blockquote',
  'pre',
  'code',
  'address',
  'figcaption',
].map((tag) => ({ value: tag, label: tag }));
const TARGETS = [
  { value: '', label: 'Same tab' },
  { value: '_blank', label: 'New tab' },
];
const VARIANTS = BUTTON_VARIANTS.map((variant) => ({
  value: variant,
  label: `${variant[0]?.toUpperCase()}${variant.slice(1)}`,
}));
const PROVIDERS = EMBED_PROVIDERS.map((provider) => ({ value: provider, label: provider }));
const ICONS = SITE_ICONS.map((name) => ({ value: name, label: name }));
const containerChoices = computed(() => [
  { value: '', label: 'Theme default' },
  ...Object.keys(theme.value?.container?.widths ?? {}).map((name) => ({
    value: name,
    label: name,
  })),
]);
const ASPECTS = ['', '1/1', '4/3', '3/2', '16/9', '21/9', '3/4', '2/3', '9/16'].map((value) => ({
  value,
  label: value || "Picture's own",
}));
const FITS = ['', 'cover', 'contain', 'fill', 'none', 'scale-down'].map((value) => ({
  value,
  label: value || 'Default (cover)',
}));

/** Image aspect and fit live in the desktop style, where the renderer reads them. */
function setBaseStyle(key: 'aspectRatio' | 'objectFit', value: string) {
  const base: Record<string, unknown> = { ...(props.node.style?.base ?? {}) };
  if (value) base[key] = value;
  else delete base[key];
  const style: StyleRules = { ...props.node.style };
  if (Object.keys(base).length) style.base = base as StyleProps;
  else delete style.base;
  const next: DesignNode = { ...props.node };
  if (Object.keys(style).length) next.style = style;
  else delete next.style;
  update(next);
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');
</script>

<template>
  <FormField v-if="el === 'heading'" label="Level" hint="Keep one level 1 heading per page, then go down in order.">
    <template #default="{ id }">
      <Select :id="id" :model-value="(nodeProps.level as number | undefined) ?? 2" :options="HEADING_LEVELS" :disabled="readOnly" @update:model-value="setProp('level', $event)" />
    </template>
  </FormField>

  <FormField v-if="el === 'text'" label="Shown as">
    <template #default="{ id }">
      <Select :id="id" :model-value="str(nodeProps.as) || 'p'" :options="TEXT_TAGS" :disabled="readOnly" @update:model-value="setProp('as', $event === 'p' ? undefined : $event)" />
    </template>
  </FormField>

  <FormField v-if="el === 'formSubmit'" label="Style">
    <template #default="{ id }">
      <Select :id="id" :model-value="str(nodeProps.variant) || 'primary'" :options="VARIANTS" :disabled="readOnly" @update:model-value="setProp('variant', $event)" />
    </template>
  </FormField>

  <template v-if="el === 'button' || el === 'link'">
    <FormField v-if="el === 'button'" label="Style">
      <template #default="{ id }">
        <Select :id="id" :model-value="str(nodeProps.variant) || 'primary'" :options="VARIANTS" :disabled="readOnly" @update:model-value="setProp('variant', $event)" />
      </template>
    </FormField>
    <TextField
      :model-value="str(nodeProps.href)"
      label="Address"
      :hint="node.bind ? 'Used when the field holds no link.' : 'https://..., /a-page, mailto: or tel:'"
      :disabled="readOnly"
      @update:model-value="setProp('href', $event)"
    />
    <FormField label="Opens in">
      <template #default="{ id }">
        <Select :id="id" :model-value="str(nodeProps.target)" :options="TARGETS" :disabled="readOnly" @update:model-value="setProp('target', $event)" />
      </template>
    </FormField>
  </template>

  <template v-if="el === 'image'">
    <FormField label="Aspect ratio">
      <template #default="{ id }">
        <Select :id="id" :model-value="str(node.style?.base?.aspectRatio)" :options="ASPECTS" :disabled="readOnly" @update:model-value="setBaseStyle('aspectRatio', $event)" />
      </template>
    </FormField>
    <FormField label="Fit" hint="How the picture fills a box of another shape.">
      <template #default="{ id }">
        <Select :id="id" :model-value="str(node.style?.base?.objectFit)" :options="FITS" :disabled="readOnly" @update:model-value="setBaseStyle('objectFit', $event)" />
      </template>
    </FormField>
    <TextField :model-value="str(nodeProps.sizes)" label="Sizes" hint="How wide it shows, for picking the file size, e.g. (max-width: 640px) 100vw, 50vw." :disabled="readOnly" @update:model-value="setProp('sizes', $event)" />
    <Switch :model-value="nodeProps.loading === 'eager'" :disabled="readOnly" @update:model-value="setProp('loading', $event ? 'eager' : undefined)">
      <span class="ws:text-sm">Load right away (for pictures at the top of a page)</span>
    </Switch>
  </template>

  <template v-if="el === 'video'">
    <Switch :model-value="nodeProps.controls !== false" :disabled="readOnly" @update:model-value="setProp('controls', $event ? undefined : false)">
      <span class="ws:text-sm">Show controls</span>
    </Switch>
    <Switch :model-value="nodeProps.autoplay === true" :disabled="readOnly" @update:model-value="setProp('autoplay', $event || undefined)">
      <span class="ws:text-sm">Play on its own (muted)</span>
    </Switch>
    <Switch :model-value="nodeProps.loop === true" :disabled="readOnly" @update:model-value="setProp('loop', $event || undefined)">
      <span class="ws:text-sm">Loop</span>
    </Switch>
  </template>

  <FormField v-if="el === 'icon'" label="Icon">
    <template #default="{ id }">
      <Select :id="id" :model-value="str(nodeProps.name) || 'star'" :options="ICONS" :disabled="readOnly" @update:model-value="setProp('name', $event)" />
    </template>
  </FormField>

  <template v-if="el === 'embed'">
    <FormField label="Provider">
      <template #default="{ id }">
        <Select :id="id" :model-value="str(nodeProps.provider) || 'youtube'" :options="PROVIDERS" :disabled="readOnly" @update:model-value="setProp('provider', $event)" />
      </template>
    </FormField>
    <TextField :model-value="str(nodeProps.url)" label="Address" hint="The https address of the video, map or track." :disabled="readOnly" @update:model-value="setProp('url', $event)" />
  </template>

  <FormField v-if="el === 'section'" label="Content width">
    <template #default="{ id }">
      <Select :id="id" :model-value="str(nodeProps.container)" :options="containerChoices" :disabled="readOnly" @update:model-value="setProp('container', $event)" />
    </template>
  </FormField>

  <TextField v-if="el === 'blocks'" :model-value="str(nodeProps.variant)" label="Variant for every block" hint="Leave empty so each block uses its own choice." :disabled="readOnly" @update:model-value="setProp('variant', $event)" />
</template>
