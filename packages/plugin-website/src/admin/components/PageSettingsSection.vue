<script setup lang="ts">
import { FormField, Select } from '@manablox/admin-sdk';
import type { PageDesign } from '@manablox/site';
import { computed } from 'vue';
import type { DesignField } from '../model/bindings';
import { type SeoPart, seoFieldOptions, withPageLayout, withSeo } from '../model/page-design';

/** The page design's layout and the fields its description and share image come from. */
const props = defineProps<{
  page: PageDesign;
  fields: readonly DesignField[];
  /** Layout designs of the space, `default` included. */
  layouts: ReadonlyArray<{ key: string; label: string }>;
  /** The layout the site settings assign to this type. */
  siteLayout: string;
  readOnly: boolean;
}>();
const emit = defineEmits<{ update: [page: PageDesign, group?: string] }>();

const labelOf = (key: string) =>
  props.layouts.find((layout) => layout.key === key)?.label ?? `${key} (missing)`;

const layoutOptions = computed(() => {
  const list = [
    { value: '', label: `As in Site settings: ${labelOf(props.siteLayout)}` },
    ...props.layouts.map((layout) => ({ value: layout.key, label: layout.label })),
  ];
  const own = props.page.layout;
  if (own && !props.layouts.some((layout) => layout.key === own))
    list.push({ value: own, label: `${own} (missing, the default layout shows)` });
  return list;
});

const seoOptions = (part: SeoPart) => [
  { value: '', label: part === 'image' ? "The site's share image" : "The site's description" },
  ...seoFieldOptions(props.fields, part),
];

function setSeo(part: SeoPart, fieldId: string) {
  emit('update', withSeo(props.page, part, fieldId || null));
}
</script>

<template>
  <div class="ws:space-y-3">
    <FormField label="Layout" hint="The header, menus and footer around these pages.">
      <template #default="{ id }">
        <Select
          :id="id"
          :model-value="page.layout ?? ''"
          :options="layoutOptions"
          :disabled="readOnly"
          @update:model-value="emit('update', withPageLayout(page, $event))"
        />
      </template>
    </FormField>
    <FormField label="Search description from" hint="Shortened to 160 characters; empty fields use the site's.">
      <template #default="{ id }">
        <Select :id="id" :model-value="page.seo?.description ?? ''" :options="seoOptions('description')" :disabled="readOnly" @update:model-value="setSeo('description', $event)" />
      </template>
    </FormField>
    <FormField label="Share image from" hint="Shown when a page is shared; empty fields use the site's.">
      <template #default="{ id }">
        <Select :id="id" :model-value="page.seo?.image ?? ''" :options="seoOptions('image')" :disabled="readOnly" @update:model-value="setSeo('image', $event)" />
      </template>
    </FormField>
  </div>
</template>
