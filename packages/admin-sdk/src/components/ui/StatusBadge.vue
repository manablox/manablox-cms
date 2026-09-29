<script setup lang="ts">
import { computed } from 'vue';

/** Status pill with a fixed vocabulary; use a plain `mb-badge` otherwise. */
type Status =
  | 'read-only'
  | 'unsaved'
  | 'live'
  | 'draft'
  | 'new'
  | 'on'
  | 'off'
  | 'code'
  | 'built-in'
  | 'changed'
  | 'importing'
  | 'failed';

const props = defineProps<{ status: Status; title?: string | undefined }>();

const TONE: Record<Status, string> = {
  'read-only': 'mb-badge',
  unsaved: 'mb-badge-warn',
  live: 'mb-badge-ok',
  draft: 'mb-badge',
  new: 'mb-badge',
  on: 'mb-badge-ok',
  off: 'mb-badge',
  code: 'mb-badge',
  'built-in': 'mb-badge',
  changed: 'mb-badge-warn',
  importing: 'mb-badge-brand',
  failed: 'mb-badge-danger',
};
const LABEL: Record<Status, string> = {
  'read-only': 'read only',
  unsaved: 'unsaved',
  live: 'live',
  draft: 'draft',
  new: 'new',
  on: 'on',
  off: 'off',
  code: 'code',
  'built-in': 'built in',
  changed: 'changed',
  importing: 'importing',
  failed: 'failed',
};

const tone = computed(() => TONE[props.status]);
const label = computed(() => LABEL[props.status]);
</script>

<template>
  <span :class="tone" :title="title">{{ label }}</span>
</template>
