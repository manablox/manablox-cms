<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import {
  controlBanners,
  readOnlyNotice,
  useDismissedBanners,
} from '@manablox/admin-sdk/lib/control-messages';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { BannerLevel } from '@manablox/core';
import { computed } from 'vue';

/** Under the top bar: the read-only notice, then the control-set banners, most severe first. */
const session = useSessionStore();
const spaces = useSpaceStore();

const { dismissed, dismiss } = useDismissedBanners(computed(() => session.me?.id ?? null));

const SEVERITY: Record<BannerLevel, number> = { danger: 0, warning: 1, info: 2 };

const TONES: Record<BannerLevel, string> = {
  danger:
    'border-danger-300 bg-danger-50 text-danger-900 dark:border-danger-500/40 dark:bg-danger-500/10 dark:text-danger-100',
  warning:
    'border-warn-300 bg-warn-50 text-warn-950 dark:border-warn-500/40 dark:bg-warn-500/10 dark:text-warn-100',
  info: 'border-iris-300 bg-iris-50 text-iris-900 dark:border-iris-500/40 dark:bg-iris-500/10 dark:text-iris-100',
};

const readOnly = computed(() => readOnlyNotice(session.me, spaces.currentId));

const banners = computed(() =>
  controlBanners(session.me, spaces.currentId)
    .filter((banner) => !(banner.dismissible && dismissed.value.has(banner.id)))
    .sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]),
);
</script>

<template>
  <div v-if="readOnly || banners.length" data-testid="control-banners">
    <div
      v-if="readOnly"
      class="flex items-start gap-2 border-b px-4 py-2 text-sm"
      :class="TONES.warning"
      role="status"
    >
      <Icon name="lock" class="mb-icon-sm mt-0.5 shrink-0" />
      <p class="min-w-0 flex-1">
        <span class="font-semibold">{{ readOnly.scope === 'instance' ? 'This instance is read-only.' : 'This space is read-only.' }}</span>
        Changes are not saved.
        <template v-if="readOnly.message">{{ readOnly.message }}</template>
      </p>
    </div>
    <div
      v-for="banner in banners"
      :key="banner.id"
      class="flex items-start gap-2 border-b px-4 py-2 text-sm"
      :class="TONES[banner.level]"
      :role="banner.level === 'info' ? 'status' : 'alert'"
    >
      <Icon :name="banner.level === 'info' ? 'info' : 'alert'" class="mb-icon-sm mt-0.5 shrink-0" />
      <p class="min-w-0 flex-1 whitespace-pre-line">
        {{ banner.text }}
        <a v-if="banner.link" :href="banner.link" target="_blank" rel="noopener noreferrer" class="ml-1 font-medium underline">Learn more</a>
      </p>
      <IconButton v-if="banner.dismissible" icon="x" label="Dismiss" class="-my-1 shrink-0" @click="dismiss(banner.id)" />
    </div>
  </div>
</template>
