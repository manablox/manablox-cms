<script setup lang="ts">
import {
  ContentPicker,
  Icon,
  Loader,
  RadioCard,
  runWrite,
  useContentByIds,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { SiteLocaleStrategy } from '../../sdk';
import { LOCALE_STRATEGIES } from '../model/site-settings';
import { site as actions } from '../queries';

/** The 404 page and the locale strategy: space settings, live as soon as they are saved. */
const props = defineProps<{
  spaceId: string;
  localeStrategy: SiteLocaleStrategy;
  notFoundContentId: string | null;
  /** Holds `space:write`. */
  canEdit: boolean;
}>();

const spaces = useSpaceStore();
const busy = ref(false);
const multilingual = computed(() => (spaces.current?.locales.length ?? 1) > 1);
const typeIds = computed(() => spaces.creatableKinds.map((type) => type.id));

const ids = computed(() => (props.notFoundContentId ? [props.notFoundContentId] : []));
const notFound = useContentByIds(ids);
const notFoundDoc = computed(() => notFound.data.value?.[0] ?? null);

function save(input: { localeStrategy?: SiteLocaleStrategy; notFoundContentId?: string | null }) {
  return runWrite(() => actions.setSettings(props.spaceId, input), {
    busy,
    success: 'Saved - the site uses it right away',
  });
}
</script>

<template>
  <div class="ws:space-y-6">
    <p v-if="!canEdit" class="mb-callout ws:text-xs">These are space settings; changing them needs the right to edit the space.</p>

    <section class="ws:space-y-2">
      <span class="mb-label">Page not found</span>
      <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-2">
        <span v-if="notFoundContentId && notFoundDoc" class="mb-badge ws:max-w-full ws:truncate">
          <Icon name="doc" class="mb-icon-sm" /> {{ notFoundDoc.title }}
        </span>
        <Loader v-else-if="notFoundContentId && notFound.isPending.value" inline class="ws:text-sm" />
        <span v-else-if="notFoundContentId" class="mb-badge-warn">The chosen document no longer exists</span>
        <span v-else class="ws:text-sm ws:text-surface-500">A generated page with a link home</span>
        <template v-if="canEdit">
          <ContentPicker
            :type-ids="typeIds"
            :label="notFoundContentId ? 'Change' : 'Pick a document'"
            trigger-class="mb-btn-outline mb-btn-sm"
            @pick="save({ notFoundContentId: $event.id })"
          />
          <button v-if="notFoundContentId" type="button" class="mb-btn-ghost mb-btn-sm" :disabled="busy" @click="save({ notFoundContentId: null })">
            Use the generated page
          </button>
        </template>
      </div>
      <p class="mb-hint">
        Shown with status 404 when an address has no page. The document must be published; its
        translation is used in each language.
      </p>
    </section>

    <section class="ws:space-y-2">
      <span class="mb-label">Languages in addresses</span>
      <div class="ws:grid ws:gap-2">
        <RadioCard
          v-for="option in LOCALE_STRATEGIES"
          :key="option.value"
          :model-value="localeStrategy"
          :value="option.value"
          name="locale-strategy"
          :title="option.label"
          :hint="option.hint"
          :disabled="!canEdit || busy"
          @update:model-value="save({ localeStrategy: $event })"
        />
      </div>
      <p v-if="!multilingual" class="mb-hint">This space has one language, so addresses never carry a prefix.</p>
    </section>
  </div>
</template>
