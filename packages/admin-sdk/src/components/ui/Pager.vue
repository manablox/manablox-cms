<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../Icon.vue';

/**
 * "1-25 of 80" with previous and next; the page counts from 0. Hidden on a single page unless
 * `always`. A `capped` total reads "of 10000+".
 */
const props = withDefaults(
  defineProps<{
    total: number;
    pageSize: number;
    /** The total stopped at a cap: there are more. */
    capped?: boolean;
    /** Shows the range even when everything fits one page. */
    always?: boolean;
    previousLabel?: string | undefined;
    nextLabel?: string | undefined;
  }>(),
  { always: false, capped: false, previousLabel: 'Previous page', nextLabel: 'Next page' },
);
const page = defineModel<number>('page', { required: true });

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const first = computed(() => (props.total ? page.value * props.pageSize + 1 : 0));
const last = computed(() => Math.min(props.total, (page.value + 1) * props.pageSize));
</script>

<template>
  <nav v-if="always || pages > 1" class="flex items-center gap-2 mb-meta" aria-label="Pages">
    <span class="tabular-nums">{{ first }}-{{ last }} of {{ total }}{{ capped ? '+' : '' }}</span>
    <template v-if="pages > 1">
      <button type="button" class="mb-btn-ghost mb-btn-icon" :disabled="page === 0" :aria-label="previousLabel" :title="previousLabel" @click="page = Math.max(0, page - 1)">
        <Icon name="chevron" class="mb-icon rotate-180" />
      </button>
      <span class="tabular-nums">{{ page + 1 }} / {{ pages }}{{ capped ? '+' : '' }}</span>
      <button type="button" class="mb-btn-ghost mb-btn-icon" :disabled="page + 1 >= pages" :aria-label="nextLabel" :title="nextLabel" @click="page = Math.min(pages - 1, page + 1)">
        <Icon name="chevron" class="mb-icon" />
      </button>
    </template>
  </nav>
</template>
