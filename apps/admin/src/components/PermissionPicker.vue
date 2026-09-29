<script setup lang="ts">
import CheckCard from '@manablox/admin-sdk/components/ui/CheckCard.vue';
import SettingsAccordion, {
  type SettingsAccordionItem,
} from '@manablox/admin-sdk/components/ui/SettingsAccordion.vue';
import { withInSet } from '@manablox/admin-sdk/lib/collections';
import { computed, ref } from 'vue';
import PermissionContentGrid from '~/components/PermissionContentGrid.vue';
import { useRoleCatalog } from '~/features/roles/queries';
import { pluginPermissionIcon } from '~/lib/plugins/registry';

/** Permission toggles by group, content as a type grid. Shared by roles and API keys; the caller owns the set. */
interface PickerType {
  id: string;
  label: string;
  name: string;
  /** The type's space, when types span several. */
  hint?: string | undefined;
}

const props = defineProps<{
  modelValue: ReadonlySet<string>;
  readOnly: boolean;
  types: PickerType[];
  /** Grants shown ticked and locked. */
  alwaysGranted?: readonly string[];
  /** The note under the content grid. */
  contentNote?: string;
  /** Plain sections instead of collapsible cards. */
  dense?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: Set<string>] }>();

const { data: catalog } = useRoleCatalog();
const always = computed(() => props.alwaysGranted ?? []);

const has = (grant: string) => props.modelValue.has(grant);
function set(grant: string, on: boolean) {
  if (props.readOnly) return;
  emit('update:modelValue', withInSet(props.modelValue, grant, on));
}

/** The groups other than content, which has its own grid. */
const plainGroups = computed(() =>
  (catalog.value?.groups ?? []).filter((group) => group.id !== 'content'),
);
const contentGroup = computed(
  () => catalog.value?.groups.find((group) => group.id === 'content') ?? null,
);
const contentActions = computed(() => catalog.value?.contentActions ?? []);

const actionLabel = (action: string): string =>
  contentGroup.value?.permissions.find((p) => p.id === `content:${action}`)?.label ?? action;

const GROUP_ICONS: Record<string, string> = {
  content: 'doc',
  space: 'settings',
  contentType: 'blocks',
  asset: 'image',
  menu: 'menu',
  redirect: 'branch',
  user: 'users',
  role: 'shield',
  audit: 'activity',
};

type Group = NonNullable<typeof contentGroup.value>;

/** How much of a group is granted, as a badge. */
function groupBadge(granted: number, total: number): SettingsAccordionItem['badge'] {
  if (!granted) return { label: 'None' };
  if (granted === total) return { label: 'All', tone: 'ok' };
  return { label: `${granted} of ${total}`, tone: 'warn' };
}

const contentBadge = computed<SettingsAccordionItem['badge']>(() => {
  const broad = contentActions.value.filter((action) => has(`content:${action}`)).length;
  if (broad === contentActions.value.length && broad) return { label: 'All', tone: 'ok' };
  const any = [...props.modelValue].some((grant) => grant.startsWith('content:'));
  return any ? { label: 'Some', tone: 'warn' } : { label: 'None' };
});

const sections = computed<(SettingsAccordionItem & { group: Group })[]>(() => [
  ...(contentGroup.value
    ? [
        {
          value: 'content',
          label: contentGroup.value.label,
          icon: GROUP_ICONS.content as string,
          description: contentGroup.value.description,
          badge: contentBadge.value,
          group: contentGroup.value,
        },
      ]
    : []),
  ...plainGroups.value.map((group) => ({
    value: group.id,
    label: group.label,
    icon:
      GROUP_ICONS[group.id] ??
      pluginPermissionIcon(group.id) ??
      (group.id.startsWith('plugins.') ? 'blocks' : 'shield'),
    description: group.description,
    badge: groupBadge(
      group.permissions.filter((permission) => has(permission.id)).length,
      group.permissions.length,
    ),
    group,
  })),
]);
const open = ref<string[]>(['content']);

/** Grants or clears every permission of a group; locked ones stay. */
function setGroup(group: Group, on: boolean) {
  if (props.readOnly) return;
  const next = new Set(props.modelValue);
  for (const permission of group.permissions) {
    if (always.value.includes(permission.id)) continue;
    if (on) next.add(permission.id);
    else next.delete(permission.id);
  }
  emit('update:modelValue', next);
}

/** Every action on every content type, or none. */
function setAllContent(on: boolean) {
  if (props.readOnly) return;
  const next = new Set([...props.modelValue].filter((grant) => !grant.startsWith('content:')));
  if (on) for (const action of contentActions.value) next.add(`content:${action}`);
  emit('update:modelValue', next);
}
</script>

<template>
  <SettingsAccordion v-if="!dense" v-model="open" :items="sections">
    <template v-for="section in sections" :key="section.value" #[section.value]>
      <div v-if="!readOnly" class="mb-3 flex flex-wrap gap-2">
        <button type="button" class="mb-btn-outline mb-btn-sm" @click="section.value === 'content' ? setAllContent(true) : setGroup(section.group, true)">
          Allow all
        </button>
        <button type="button" class="mb-btn-ghost mb-btn-sm" @click="section.value === 'content' ? setAllContent(false) : setGroup(section.group, false)">
          Allow none
        </button>
      </div>
      <template v-if="section.value === 'content'">
        <PermissionContentGrid
          :grants="modelValue"
          :read-only="readOnly"
          :types="types"
          :actions="contentActions"
          :action-label="actionLabel"
          :note="contentNote"
          @set="set"
        />
      </template>
      <ul v-else class="grid gap-2 sm:grid-cols-2">
        <li v-for="permission in section.group.permissions" :key="permission.id">
          <CheckCard
            :model-value="has(permission.id)"
            :title="permission.label"
            :hint="permission.description || (always.includes(permission.id) ? 'Always on: the admin cannot open the space without it.' : undefined)"
            :disabled="readOnly || always.includes(permission.id)"
            @update:model-value="set(permission.id, $event)"
          />
        </li>
      </ul>
    </template>
  </SettingsAccordion>

  <div v-else class="mb-list-divided space-y-4">
    <!-- Content: actions across, types down. -->
    <section v-if="contentGroup" class="py-3">
      <h3 class="text-sm font-bold">{{ contentGroup.label }}</h3>
      <p class="mb-3 text-sm text-surface-500">{{ contentGroup.description }}</p>
      <PermissionContentGrid
        :grants="modelValue"
        :read-only="readOnly"
        :types="types"
        :actions="contentActions"
        :action-label="actionLabel"
        :note="contentNote"
        @set="set"
      />
    </section>

    <div class="grid gap-4 pt-4 sm:grid-cols-2">
      <section v-for="group in plainGroups" :key="group.id">
        <h3 class="text-sm font-bold">{{ group.label }}</h3>
        <p class="mb-3 text-sm text-surface-500">{{ group.description }}</p>
        <ul class="space-y-2">
          <li v-for="permission in group.permissions" :key="permission.id">
            <CheckCard
              :model-value="has(permission.id)"
              :title="permission.label"
              :hint="permission.description || (always.includes(permission.id) ? 'Always on: the admin cannot open the space without it.' : undefined)"
              :disabled="readOnly || always.includes(permission.id)"
              @update:model-value="set(permission.id, $event)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
