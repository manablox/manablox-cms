<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import {
  usePendingApprovals,
  useRecentContent,
} from '@manablox/admin-sdk/features/content/queries';
import { relativeTime } from '@manablox/admin-sdk/lib/format';
import { localeName } from '@manablox/admin-sdk/lib/locales';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';

/** The space overview. Colour is reserved for status and the primary action. */
const spaces = useSpaceStore();
const session = useSessionStore();

const { data: contents, isPending, error, refetch } = useRecentContent(() => spaces.locale);

const figures = computed(() => [
  { label: 'Documents', value: contents.value?.total ?? 0, to: '/content', icon: 'doc' },
  { label: 'Content types', value: spaces.creatableKinds.length, to: '/types', icon: 'tree' },
  { label: 'Block types', value: spaces.blockKinds.length, to: '/types', icon: 'blocks' },
  { label: 'Databags', value: spaces.dataKinds.length, to: '/databags', icon: 'database' },
  {
    label: 'Languages',
    value: spaces.current?.locales.length ?? 0,
    to: '/settings',
    icon: 'globe',
  },
]);

const creatable = computed(() => spaces.creatableKinds.filter((type) => type.isVisibleInTree));
const canWrite = useCan('content:write');
const canPublish = useCan('content:publish');
// Only reviewers have a queue.
const {
  data: approvalPages,
  hasNextPage: hasMoreApprovals,
  isFetchingNextPage: loadingMoreApprovals,
  fetchNextPage: fetchMoreApprovals,
} = usePendingApprovals(canPublish);
/** Loaded rows and the total. */
const pendingApprovals = computed(
  () => approvalPages.value?.pages.flatMap((page) => page.items) ?? [],
);
const pendingApprovalCount = computed(() => approvalPages.value?.pages[0]?.total ?? 0);
const canDefine = useCan('contentType:write');
const canUpload = useCan('asset:write');
const canNavigate = useCan('menu:write');

/** Startable document types for the single `New document` row; with one type it links directly. */
const newDocument = computed(() => (canWrite.value ? creatable.value : []));
const showNewDocument = ref(false);

/** Entries of the databags, or defining the first one. */
const databagShortcut = computed(() => {
  if (spaces.dataKinds.length && canWrite.value) {
    return [{ key: 'databags', to: '/databags', icon: 'database', label: 'Add databag entries' }];
  }
  if (!spaces.dataKinds.length && canDefine.value) {
    return [
      { key: 'databags', to: '/databag-types/new', icon: 'database', label: 'Define a databag' },
    ];
  }
  return [];
});

/** The shortcuts this person may use. */
const shortcuts = computed(() => [
  ...(canDefine.value
    ? [{ key: 'type', to: '/types/new', icon: 'blocks', label: 'Define a content type' }]
    : []),
  ...databagShortcut.value,
  ...(canUpload.value
    ? [{ key: 'assets', to: '/assets', icon: 'upload', label: 'Upload assets' }]
    : []),
  ...(canNavigate.value
    ? [{ key: 'menus', to: '/menus', icon: 'list', label: 'Edit the navigation' }]
    : []),
]);

/** Greetings by the hour they start from. */
const GREETINGS: [from: number, text: string][] = [
  [18, 'Good evening'],
  [12, 'Good afternoon'],
  [5, 'Good morning'],
  [0, 'Good night'],
];

const greeting = computed(() => {
  const hour = new Date().getHours();
  const time = GREETINGS.find(([from]) => hour >= from)?.[1] ?? 'Hello';
  const name = session.me?.name?.split(' ')[0];
  return name ? `${time}, ${name}` : time;
});

/** Cell borders of the figures strip: 2 columns, 3 from `sm`, one row from `lg`. */
function figureBorders(index: number): string[] {
  const out: string[] = [];
  if (index >= 2) out.push('max-sm:border-t');
  if (index % 2 === 1) out.push('max-sm:border-l');
  if (index >= 3) out.push('sm:max-lg:border-t');
  if (index % 3 !== 0) out.push('sm:max-lg:border-l');
  if (out.length) out.push('border-surface-200 dark:border-surface-800');
  return out;
}

/** The frontend's bare host. */
const siteHost = computed(() => {
  const url = spaces.current?.url;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
});
</script>

<template>
  <div class="mb-page">
    <div class="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div class="min-w-0">
        <p class="mb-eyebrow mb-1">{{ greeting }}</p>
        <h1 class="mb-title">{{ spaces.current?.name }}</h1>
        <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-500">
          <span class="font-mono text-xs">{{ spaces.current?.machineName }}</span>
          <a
            v-if="spaces.current?.url"
            :href="spaces.current.url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1 hover:text-surface-700 hover:underline dark:hover:text-surface-300"
          >
            {{ siteHost }}
            <Icon name="external" class="mb-icon-sm" />
          </a>
        </p>
      </div>
      <div class="flex-1" />
      <div class="flex flex-wrap items-center gap-2">
        <RouterLink to="/content" class="mb-btn-outline">
          <Icon name="tree" /> Content
        </RouterLink>
        <RouterLink
          v-if="canWrite && creatable.length === 1"
          :to="`/content/new/${creatable[0]?.id}`"
          class="mb-btn-primary"
        >
          <Icon name="plus" /> New {{ creatable[0]?.label }}
        </RouterLink>
      </div>
    </div>

    <!-- Figures strip; each cell links to its section. -->
    <div class="mb-card grid grid-cols-2 divide-surface-200 p-0 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x dark:divide-surface-800">
      <RouterLink
        v-for="(figure, index) in figures"
        :key="figure.label"
        :to="figure.to"
        class="group flex items-start justify-between gap-3 px-5 py-4 transition hover:bg-surface-50 dark:hover:bg-surface-800/60"
        :class="figureBorders(index)"
      >
        <span class="min-w-0">
          <span class="block text-2xs font-semibold tracking-[0.12em] text-surface-500 uppercase">
            {{ figure.label }}
          </span>
          <span class="mt-1.5 block font-display text-3xl font-bold tabular-nums text-surface-950 dark:text-surface-50">
            {{ figure.value }}
          </span>
        </span>
        <span class="mb-surface-inset flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-surface-500 transition group-hover:text-surface-700 dark:group-hover:text-surface-300">
          <Icon :name="figure.icon" class="mb-icon" />
        </span>
      </RouterLink>
    </div>

    <!-- Pending work before recent changes. -->
    <section v-if="pendingApprovals.length" class="mb-card mt-6 p-0">
      <div class="flex items-center border-b border-surface-200 px-5 py-3 dark:border-surface-800">
        <h2 class="text-sm font-bold">Waiting for your approval</h2>
        <span class="mb-badge-warn ml-2">{{ pendingApprovalCount }}</span>
      </div>
      <ul class="mb-list-divided px-5 py-2">
        <li v-for="item in pendingApprovals" :key="item.id">
          <RouterLink :to="`/content/${item.contentId}`" class="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800/60">
            <span class="mb-tile-sand flex h-8 w-8 shrink-0 items-center justify-center rounded-control">
              <Icon name="hourglass" class="mb-icon" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-200">
                {{ item.content.title || 'Untitled' }}
              </span>
              <span class="block truncate mb-meta">
                {{ spaces.typeById(item.typeId)?.label }} - asked by {{ item.requestedByLabel }}<template v-if="item.requestNote">: {{ item.requestNote }}</template>
              </span>
            </span>
            <span class="hidden mb-meta tabular-nums sm:block">{{ relativeTime(item.requestedAt) }}</span>
          </RouterLink>
        </li>
      </ul>
      <div v-if="hasMoreApprovals" class="border-t border-surface-200 px-5 py-3 text-center dark:border-surface-800">
        <button
          type="button"
          class="mb-btn-outline mb-btn-sm"
          :disabled="loadingMoreApprovals"
          @click="fetchMoreApprovals()"
        >
          {{ loadingMoreApprovals ? 'Loading...' : `Show more (${pendingApprovalCount - pendingApprovals.length} left)` }}
        </button>
      </div>
    </section>

    <div class="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <!-- `minmax(0, 1fr)` lets long titles truncate instead of widening the column. -->
      <section class="mb-card min-w-0 p-0">
        <div class="flex items-center border-b border-surface-200 px-5 py-3 dark:border-surface-800">
          <h2 class="text-sm font-bold">Recently updated</h2>
          <span v-if="spaces.locale" class="ml-2 font-mono text-2xs font-semibold text-surface-500 uppercase">
            {{ spaces.locale }}
          </span>
          <div class="flex-1" />
          <RouterLink to="/content" class="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
            Open the tree
          </RouterLink>
        </div>

        <div class="px-5 py-4">
          <AsyncList
            :pending="isPending"
            :error="error"
            :retry="refetch"
            :items="contents?.items"
            :rows="5"
            empty-icon="doc"
            empty-title="Nothing written yet"
            :empty-description="creatable.length ? 'Start a document from the list on the right.' : 'Define a content type first, then documents can follow.'"
            list-class="-my-1"
          >
            <template #item="{ item }">
              <RouterLink :to="`/content/${item.id}`" class="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800/60">
                <span class="mb-surface-inset flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-surface-500">
                  <Icon :name="typeIcon(spaces.typeById(item.typeId))" class="mb-icon" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-200">
                    {{ item.title || 'Untitled' }}
                  </span>
                  <span class="block truncate mb-meta">
                    <span>{{ spaces.typeById(item.typeId)?.label }}</span>
                    <span v-if="item.permalink" class="font-mono"> - /{{ item.permalink }}</span>
                  </span>
                </span>
                <span class="hidden mb-meta tabular-nums sm:block">{{ relativeTime(item.updatedAt) }}</span>
                <span :class="item.status === 'published' ? 'mb-badge-ok' : 'mb-badge'">
                  {{ item.status }}
                </span>
              </RouterLink>
            </template>
          </AsyncList>
        </div>
      </section>

      <aside class="space-y-6">
        <section class="mb-card p-0">
          <h2 class="border-b border-surface-200 px-5 py-3 text-sm font-bold dark:border-surface-800">Start something</h2>
          <ul class="px-3 py-2">
            <li v-if="newDocument.length === 1">
              <RouterLink :to="`/content/new/${newDocument[0]?.id}`" class="mb-menu-item flex items-center gap-2.5">
                <Icon :name="typeIcon(newDocument[0])" class="mb-icon-sm text-surface-500" />
                New {{ newDocument[0]?.label }}
              </RouterLink>
            </li>
            <li v-else-if="newDocument.length">
              <DropdownMenu v-model:open="showNewDocument" align="start" class="w-56">
                <template #trigger>
                  <button type="button" class="mb-menu-item flex w-full items-center gap-2.5">
                    <Icon name="plus" class="mb-icon-sm text-surface-500" />
                    <span class="flex-1 text-left">New document</span>
                    <Icon name="down" class="mb-icon-sm text-surface-500" />
                  </button>
                </template>
                <RouterLink
                  v-for="type in newDocument"
                  :key="type.id"
                  :to="`/content/new/${type.id}`"
                  class="mb-menu-item flex items-center gap-2.5"
                >
                  <Icon :name="typeIcon(type)" class="mb-icon-sm shrink-0 text-surface-500" />
                  <span class="truncate">{{ type.label }}</span>
                </RouterLink>
              </DropdownMenu>
            </li>
            <li v-for="item in shortcuts" :key="item.key">
              <RouterLink :to="item.to" class="mb-menu-item flex items-center gap-2.5">
                <Icon :name="item.icon" class="mb-icon-sm text-surface-500" />
                {{ item.label }}
              </RouterLink>
            </li>
          </ul>
          <p v-if="canWrite && !creatable.length" class="mb-hint px-5 pb-3">
            Documents need a content type first.
          </p>
        </section>

        <section class="mb-card p-0">
          <h2 class="border-b border-surface-200 px-5 py-3 text-sm font-bold dark:border-surface-800">
            {{ (spaces.current?.locales.length ?? 0) > 1 ? 'Languages' : 'Language' }}
          </h2>
          <div class="px-5 py-4">
            <div v-if="(spaces.current?.locales.length ?? 0) > 1" class="flex flex-wrap gap-1.5">
              <button
                v-for="code in spaces.current?.locales ?? []"
                :key="code"
                type="button"
                class="rounded-control border px-2 py-0.5 font-mono text-xs font-semibold uppercase transition"
                :class="spaces.locale === code
                  ? 'border-surface-900 bg-surface-900 text-surface-0 dark:border-surface-100 dark:bg-surface-100 dark:text-surface-900'
                  : 'border-surface-300 text-surface-600 hover:border-surface-400 dark:border-surface-700 dark:text-surface-300'"
                :title="localeName(code)"
                @click="spaces.locale = code"
              >
                {{ code }}
              </button>
            </div>
            <p v-else class="text-sm">
              {{ localeName(spaces.current?.defaultLocale ?? '') }}
              <span class="font-mono mb-meta">{{ spaces.current?.defaultLocale }}</span>
            </p>
            <p class="mb-hint mt-2">
              {{ (spaces.current?.locales.length ?? 0) > 1
                ? 'The tree and every list show one language at a time.'
                : 'More languages can be added under Settings.' }}
            </p>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>
