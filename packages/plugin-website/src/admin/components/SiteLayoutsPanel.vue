<script setup lang="ts">
import { Select, useSpaceStore } from '@manablox/admin-sdk';
import type { SiteSettingsDesign } from '@manablox/site';
import { computed } from 'vue';
import { layoutOf, withLayout } from '../model/site-settings';
import { designRoute } from '../model/status';

/** Which layout each content type's pages render in. */
const props = defineProps<{
  site: SiteSettingsDesign;
  /** Layout designs of the space, `default` included. */
  layouts: ReadonlyArray<{ key: string; label: string }>;
  /** Layouts page designs pick, by content type id; they win over this assignment. */
  pagePicks?: Readonly<Record<string, string>>;
  readOnly?: boolean;
}>();

const labelOf = (key: string) =>
  props.layouts.find((layout) => layout.key === key)?.label ?? `${key} (missing)`;
const emit = defineEmits<{ update: [site: SiteSettingsDesign, group?: string] }>();

const spaces = useSpaceStore();
const types = computed(() => spaces.creatableKinds);

const options = computed(() => {
  const list = props.layouts.map((layout) => ({ value: layout.key, label: layout.label }));
  if (!list.some((option) => option.value === 'default')) {
    list.unshift({ value: 'default', label: 'Default layout' });
  }
  // A stored key whose layout was removed stays visible until it is changed.
  for (const key of new Set(Object.values(props.site.layouts))) {
    if (!list.some((option) => option.value === key)) {
      list.push({ value: key, label: `${key} (missing)` });
    }
  }
  return list;
});

function assign(typeId: string, key: string) {
  emit('update', { ...props.site, layouts: withLayout(props.site.layouts, typeId, key) });
}
</script>

<template>
  <div class="ws:space-y-3">
    <p class="mb-hint">
      A layout is the frame around a page: header, menus and footer. Every content type uses the
      default layout unless you pick another here, or its page design picks one.
    </p>
    <p v-if="types.length === 0" class="ws:text-sm ws:text-surface-500">This space has no content types yet.</p>
    <ul v-else class="mb-list-divided">
      <li v-for="type in types" :key="type.id" class="ws:flex ws:flex-wrap ws:items-center ws:justify-between ws:gap-2 ws:py-2">
        <span class="ws:min-w-0 ws:truncate ws:text-sm">{{ type.label }}</span>
        <span v-if="pagePicks?.[type.id]" class="ws:flex ws:min-w-0 ws:items-center ws:gap-2 ws:text-sm">
          <span class="ws:truncate">{{ labelOf(pagePicks[type.id] as string) }}</span>
          <RouterLink :to="designRoute('page', type.id) ?? '/design/pages'" class="mb-btn-ghost mb-btn-sm" title="The page design picks this layout; change it there">
            Set in the page design
          </RouterLink>
        </span>
        <Select
          v-else
          class="ws:w-56 ws:max-w-full"
          :model-value="layoutOf(site, type.id)"
          :options="options"
          :disabled="readOnly"
          :aria-label="`Layout for ${type.label}`"
          @update:model-value="assign(type.id, $event)"
        />
      </li>
    </ul>
  </div>
</template>
