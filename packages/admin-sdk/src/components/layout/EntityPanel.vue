<script setup lang="ts" generic="T extends { id: string }">
import { computed, type Ref, unref } from 'vue';
import { useRoute } from 'vue-router';
import { type PanelKey, usePanel } from '../../composables/usePanel';
import Icon from '../Icon.vue';
import AsyncList from '../ui/AsyncList.vue';
import IconButton from '../ui/IconButton.vue';
import NavList from '../ui/NavList.vue';
import NavListItem from '../ui/NavListItem.vue';
import SidePanel from './SidePanel.vue';

/** @public A list query's fields, exported for the generic component's declaration. */
export interface EntityPanelQuery<T> {
  data: Ref<readonly T[] | undefined>;
  isPending: Ref<boolean>;
  error: Ref<unknown>;
  refetch: () => unknown;
}

/** Resizable side list of entities (menus, templates, spaces, plugins' own) beside their editor. */
const props = withDefaults(
  defineProps<{
    /** Heading and list aria-label. */
    label: string;
    to: string;
    panelKey: PanelKey;
    /** Default row icon; `itemIcon` overrides. */
    icon: string;
    /** The list query; `items`, `pending`, `error` and `retry` override its fields. */
    query?: EntityPanelQuery<T> | undefined;
    items?: readonly T[] | undefined;
    pending?: boolean | undefined;
    error?: unknown;
    retry?: (() => unknown) | undefined;
    emptyTitle: string;
    emptyDescription: string;
    itemTo: (item: T) => string;
    itemIcon?: (item: T) => string;
    /** Defaults to matching the route's `:id`. */
    active?: (item: T) => boolean;
    /** Names the compact `+` button; it shows with `createTo` or an `@create` listener. */
    createLabel?: string | undefined;
    createTo?: string | undefined;
    /** Hides the `+` button, such as without the write permission. */
    canCreate?: boolean;
    onCreate?: (() => unknown) | undefined;
  }>(),
  {
    pending: undefined,
    canCreate: true,
  },
);

const route = useRoute();
const panel = usePanel(props.panelKey);

const listItems = computed(() => props.items ?? unref(props.query?.data));
const listPending = computed(() => props.pending ?? unref(props.query?.isPending) ?? false);
const listError = computed(() => props.error ?? unref(props.query?.error));
const listRetry = computed(() => props.retry ?? props.query?.refetch);
const showCreate = computed(
  () =>
    props.canCreate !== false && Boolean(props.createLabel && (props.createTo || props.onCreate)),
);

const isActive = (item: T): boolean =>
  props.active ? props.active(item) : route.params.id === item.id;
</script>

<template>
  <SidePanel :label="label" :to="to" :resize="panelKey" @hide="panel.toggle()">
    <template #action>
      <slot name="action" />
      <template v-if="showCreate">
        <RouterLink
          v-if="createTo"
          :to="createTo"
          class="mb-btn-ghost mb-btn-icon mb-btn-sm -my-1"
          :aria-label="createLabel"
          :title="createLabel"
        >
          <Icon name="plus" class="mb-icon" />
        </RouterLink>
        <IconButton v-else icon="plus" :label="createLabel ?? ''" class="-my-1" @click="onCreate?.()" />
      </template>
    </template>

    <AsyncList
      :pending="listPending"
      :error="listError"
      :retry="listRetry"
      :items="listItems"
      :empty-icon="icon"
      :empty-title="emptyTitle"
      :empty-description="emptyDescription"
    >
      <NavList :aria-label="label">
        <NavListItem
          v-for="item in listItems"
          :key="item.id"
          :to="itemTo(item)"
          :active="isActive(item)"
          :icon="itemIcon ? itemIcon(item) : icon"
          compact
        >
          <slot name="item" :item="item" />
          <template #trailing>
            <slot name="trailing" :item="item" />
          </template>
        </NavListItem>
      </NavList>
    </AsyncList>
  </SidePanel>
</template>
