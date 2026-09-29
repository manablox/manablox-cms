<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { computed, ref } from 'vue';

/** The built-in columns every document has. Computed: a type without a slug has no `permalink`. */
const props = withDefaults(
  defineProps<{
    hasSlug: boolean;
    isPublishable: boolean;
    canBeVisibleInMenu: boolean;
    /** Databag entries have no place in the tree. */
    inTree?: boolean;
  }>(),
  { inTree: true },
);

const open = ref(false);

const fields = computed(() => {
  const out = [{ name: 'title', type: 'Text', note: "The document's name in the tree and lists." }];

  if (props.hasSlug) {
    out.push(
      { name: 'slug', type: 'Text', note: 'Derived from the title when left empty.' },
      {
        name: 'permalink',
        type: 'Text',
        note: "Read-only. The slug joined onto the ancestors' path.",
      },
    );
  }
  if (props.isPublishable) {
    out.push(
      { name: 'status', type: 'draft | published | archived', note: 'Set by the publish action.' },
      { name: 'publishedAt', type: 'Date', note: 'Read-only. Stamped on the first publish.' },
    );
  }
  if (props.canBeVisibleInMenu) {
    out.push({
      name: 'visibleInMenu',
      type: 'Boolean',
      note: 'Whether navigation queries return it.',
    });
  }

  if (props.inTree) {
    out.push({
      name: 'parentId, position',
      type: 'Reference, Number',
      note: 'Placement in the content tree.',
    });
  }
  out.push(
    {
      name: 'locale',
      type: 'Text',
      note: 'One row per translation, tied together by a localization id.',
    },
    {
      name: 'createdAt, updatedAt, version',
      type: 'Date, Date, Number',
      note: 'Read-only. Maintained on every write.',
    },
  );
  return out;
});
</script>

<template>
  <div class="mb-card">
    <button
      class="flex w-full items-center gap-2 text-left"
      :aria-expanded="open"
      aria-controls="built-in-fields"
      @click="open = !open"
    >
      <Icon
        name="chevron"
        class="mb-icon-sm shrink-0 text-surface-500 transition-transform"
        :class="open ? 'rotate-90' : ''"
      />
      <h2 class="flex-1 text-sm font-bold">Built-in fields</h2>
      <span class="mb-badge">{{ fields.length }}</span>
    </button>

    <div v-if="open" id="built-in-fields" class="mt-3">
      <p class="mb-hint mb-3">
        Every document of this type has these already; they follow the switches on the
        right. Do not declare a field of your own with one of these names.
      </p>
      <ul class="mb-list-divided text-sm">
        <li v-for="builtIn in fields" :key="builtIn.name" class="flex flex-wrap items-baseline gap-x-2 py-1.5">
          <code class="font-mono text-xs">{{ builtIn.name }}</code>
          <span class="mb-meta">{{ builtIn.type }}</span>
          <span class="w-full mb-meta sm:w-auto sm:flex-1 sm:text-right">
            {{ builtIn.note }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
