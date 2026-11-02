<script setup lang="ts">
import { FormField, Select, Switch, TextField, useCan, useMenus } from '@manablox/admin-sdk';
import type { DesignNode } from '@manablox/site';
import { computed } from 'vue';
import { designRoute } from '../model/status';
import { useSiteDesigns } from '../queries';
import { useDesignerContext } from '../useDesignerContext';

/** Options of the layout-only elements: which menu and menu design, the logo link, languages. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const { readOnly } = useDesignerContext();

const canReadMenus = useCan('menu:read');
const menus = useMenus();
const designs = useSiteDesigns();

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const menuName = computed(() => str(props.node.props?.menu));
const designKey = computed(() => str(props.node.props?.design));

const menuOptions = computed(() => {
  const list = (menus.data.value ?? []).map((menu) => ({
    value: menu.machineName,
    label: menu.name,
    hint: menu.machineName,
  }));
  if (menuName.value && !list.some((option) => option.value === menuName.value))
    list.unshift({
      value: menuName.value,
      label: `${menuName.value} (missing)`,
      hint: 'not found',
    });
  return list;
});

const designOptions = computed(() => {
  const keys = new Set(
    (designs.data.value ?? []).filter((entry) => entry.kind === 'menu').map((entry) => entry.key),
  );
  const list = [...keys]
    .filter((key) => key !== menuName.value)
    .map((key) => ({ value: key, label: key }));
  list.unshift({ value: '', label: "The menu's own design" });
  if (designKey.value && !keys.has(designKey.value))
    list.push({ value: designKey.value, label: `${designKey.value} (generated)` });
  return list;
});
const editedDesign = computed(() => designKey.value || menuName.value);

function setProp(key: string, value: unknown) {
  if (readOnly.value) return;
  const next = { ...props.node.props };
  if (value === undefined || value === '' || value === null) delete next[key];
  else next[key] = value;
  emit('update', { ...props.node, props: next }, `props:${props.node.id}:${key}`);
}

const DISPLAYS = [
  { value: '', label: 'Language names (English, Deutsch)' },
  { value: 'code', label: 'Codes (EN, DE)' },
];
</script>

<template>
  <div class="ws:space-y-4">
    <template v-if="node.el === 'slot'">
      <p class="mb-hint">
        Each page renders here with its page design. A layout has exactly one, so it cannot be
        removed or copied; move it where the page belongs.
      </p>
    </template>

    <template v-else-if="node.el === 'menu'">
      <FormField label="Menu" :hint="canReadMenus ? 'The entries come from Menus in the sidebar.' : 'You cannot see the menus of this space.'">
        <template #default="{ id }">
          <Select :id="id" :model-value="menuName" :options="menuOptions" placeholder="Pick a menu" :disabled="readOnly" @update:model-value="setProp('menu', $event)" />
        </template>
      </FormField>
      <FormField label="Looks like" hint="A menu design: bar, dropdown, columns, mobile toggle and styles.">
        <template #default="{ id }">
          <Select :id="id" :model-value="designKey" :options="designOptions" :disabled="readOnly" @update:model-value="setProp('design', $event)" />
        </template>
      </FormField>
      <RouterLink v-if="editedDesign" :to="designRoute('menu', editedDesign) ?? '/design/menus'" class="mb-btn-outline mb-btn-sm">
        Edit this menu design
      </RouterLink>
    </template>

    <template v-else-if="node.el === 'logo'">
      <p class="mb-hint">
        Shows the logo from <RouterLink to="/design/site" class="ws:underline">Site settings</RouterLink>, or the site name when there is none.
      </p>
      <Switch :model-value="node.props?.link !== false" :disabled="readOnly" @update:model-value="setProp('link', $event ? undefined : false)">
        <span class="ws:text-sm">Links to the home page</span>
      </Switch>
    </template>

    <FormField v-else-if="node.el === 'localeSwitch'" label="Shows">
      <template #default="{ id }">
        <Select :id="id" :model-value="str(node.props?.display)" :options="DISPLAYS" :disabled="readOnly" @update:model-value="setProp('display', $event)" />
      </template>
    </FormField>

    <p v-else-if="node.el === 'breadcrumbs'" class="mb-hint">
      Shows the path from the home page to the page, taken from the menus. It stays hidden on the home page.
    </p>

    <TextField
      v-else-if="node.el === 'searchLink'"
      :model-value="str(node.props?.href)"
      label="Search page address"
      hint="/search, or a full https address."
      :disabled="readOnly"
      @update:model-value="setProp('href', $event)"
    />
  </div>
</template>
