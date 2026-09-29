<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { content, useTranslations } from '@manablox/admin-sdk/features/content/queries';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

/** Lists a document's translations (rows sharing a `localizationId`) and starts missing ones. */
const props = defineProps<{ spaceId: string; contentId: string }>();

const spaces = useSpaceStore();
const session = useSessionStore();
const router = useRouter();
const creating = ref<string | null>(null);
const error = ref<string | null>(null);

const { data: translations } = useTranslations(
  () => props.contentId,
  () => props.spaceId,
);

const byLocale = computed(
  () => new Map((translations.value ?? []).map((row) => [row.locale, row])),
);
const locales = computed(() => spaces.current?.locales ?? ['en']);

async function open(locale: string) {
  const existing = byLocale.value.get(locale);
  if (!existing) return;
  spaces.locale = locale;
  await router.push(`/content/${existing.id}`);
}

async function create(locale: string) {
  creating.value = locale;
  await runWrite(
    async () => {
      const row = await content.createTranslation(props.spaceId, props.contentId, locale);
      spaces.locale = locale;
      await router.push(`/content/${row.id}`);
    },
    { success: `Started the ${locale} translation`, error },
  );
  creating.value = null;
}
</script>

<template>
  <div v-if="locales.length > 1" class="flex flex-wrap items-center gap-1.5">
    <Icon name="globe" class="mb-icon-sm text-surface-500" />
    <template v-for="locale in locales" :key="locale">
      <button
        v-if="byLocale.get(locale)"
        class="rounded-pill border px-2 py-0.5 font-mono text-xs uppercase"
        :class="
          byLocale.get(locale)?.id === contentId
            ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-600/20 dark:text-brand-50'
            : 'border-surface-300 text-surface-600 dark:border-surface-700 dark:text-surface-300'
        "
        :title="`${locale} - ${byLocale.get(locale)?.status}`"
        @click="open(locale)"
      >
        {{ locale }}
        <span v-if="byLocale.get(locale)?.status === 'published'" class="text-ok-500">*</span>
      </button>

      <button
        v-else-if="session.can('content:write', spaceId)"
        class="rounded-pill border border-dashed border-surface-300 px-2 py-0.5 font-mono mb-meta uppercase hover:border-brand-500 hover:text-brand-600 dark:border-surface-700"
        :disabled="creating === locale"
        :title="`Start the ${locale} translation`"
        @click="create(locale)"
      >
        {{ creating === locale ? '...' : `+ ${locale}` }}
      </button>
    </template>
    <span v-if="error" class="mb-error text-xs">{{ error }}</span>
  </div>
</template>
