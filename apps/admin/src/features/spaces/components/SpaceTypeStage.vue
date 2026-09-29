<script setup lang="ts">
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import { type FeatureKey, SPACE_BLOCKS, SPACE_TEMPLATES, type SpaceBlockId } from '@manablox/core';
import { computed } from 'vue';
import type { SlotItem } from '~/lib/plugins/registry';
import type { SiteType } from '../useSpaceStarters';

type StarterItem = SlotItem<'space.create.starters'>;

/**
 * The space form's website type stage: the types and plugin starters, the sections of the
 * `custom` type or those a type brings, and a picked starter's own options.
 */
defineProps<{
  siteTypes: { value: SiteType; title: string; hint: string }[];
  lockedStarters: StarterItem[];
  /** The picked plugin starter, while one is. */
  starter: StarterItem | null;
  starterProps: (item: StarterItem) => Record<string, unknown>;
}>();

const siteType = defineModel<SiteType>('siteType', { required: true });
/** The sections of the `custom` type. */
const blocks = defineModel<SpaceBlockId[]>('blocks', { required: true });

const chosenType = computed(() => SPACE_TEMPLATES.find((entry) => entry.id === siteType.value));
const blockName = (id: string) => SPACE_BLOCKS.find((entry) => entry.id === id)?.name ?? id;

function toggleBlock(id: SpaceBlockId, on: boolean) {
  blocks.value = on ? [...blocks.value, id] : blocks.value.filter((entry) => entry !== id);
}
</script>

<template>
  <fieldset class="sm:col-span-2">
    <legend class="mb-label">Type of website</legend>
    <p class="mb-2 text-2xs text-surface-500">
      Brings the content types, example pages and a main menu.
    </p>
    <div class="grid gap-2 sm:grid-cols-3">
      <RadioCard
        v-for="entry in siteTypes"
        :key="entry.value"
        v-model="siteType"
        name="s-type"
        :value="entry.value"
        :title="entry.title"
        :hint="entry.hint"
      />
    </div>
    <div v-if="lockedStarters.length" class="mt-2 flex flex-wrap gap-2">
      <FeatureLock
        v-for="item in lockedStarters"
        :key="item.key"
        :feature="item.feature as FeatureKey"
        :label="item.entry.starter.title"
        instance
      />
    </div>
  </fieldset>

  <fieldset v-if="siteType === 'custom'" class="sm:col-span-2">
    <legend class="mb-label">Sections</legend>
    <p class="mb-2 text-2xs text-surface-500">
      The blocks your pages are built from. The home page shows one of each with example content.
    </p>
    <div class="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
      <Checkbox
        v-for="entry in SPACE_BLOCKS"
        :key="entry.id"
        :model-value="blocks.includes(entry.id)"
        align="start"
        @update:model-value="toggleBlock(entry.id, $event)"
      >
        <span class="flex items-start gap-2">
          <Icon :name="entry.icon" class="mt-0.5 shrink-0 text-surface-400" />
          <span>
            <span class="block font-medium">{{ entry.name }}</span>
            <span class="block text-2xs text-surface-500">{{ entry.description }}</span>
          </span>
        </span>
      </Checkbox>
    </div>
  </fieldset>
  <div v-else-if="chosenType && chosenType.blocks.length" class="sm:col-span-2">
    <p class="mb-label">Sections</p>
    <ul class="flex flex-wrap gap-1.5" aria-label="Sections">
      <li
        v-for="id in chosenType.blocks"
        :key="id"
        class="rounded-pill border border-surface-200 px-2 py-0.5 text-2xs text-surface-600 dark:border-surface-700 dark:text-surface-300"
      >
        {{ blockName(id) }}
      </li>
    </ul>
  </div>

  <div v-if="starter" class="sm:col-span-2">
    <component :is="starter.component" v-bind="starterProps(starter)" />
  </div>
</template>
