<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SettingsPage from '@manablox/admin-sdk/components/layout/SettingsPage.vue';
import SettingsAccordion, {
  type SettingsAccordionItem,
} from '@manablox/admin-sdk/components/ui/SettingsAccordion.vue';
import { localeName } from '@manablox/admin-sdk/lib/locales';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import { type Space, spaces as spaceActions } from '../queries';
import AssetSettingsForm from './AssetSettingsForm.vue';
import SpaceForm from './SpaceForm.vue';
import SpaceImportSection from './SpaceImportSection.vue';

/** Settings -> General: the current space's name, languages, uploads and deletion. */
const props = defineProps<{ space: Space }>();
const emit = defineEmits<{ deleted: [] }>();

const session = useSessionStore();
const error = ref<string | null>(null);
const canWrite = computed(() => session.can('space:write', props.space.id));

const open = ref<string[]>(['identity']);

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

const uploadSummary = computed(() => {
  const own = props.space.settings?.assets as
    | { allowedMimeTypes?: string[]; maxFileSize?: number | null }
    | undefined;
  const types = own?.allowedMimeTypes?.length
    ? `${own.allowedMimeTypes.length} file ${own.allowedMimeTypes.length === 1 ? 'type' : 'types'}`
    : 'All allowed file types';
  const size = own?.maxFileSize
    ? `up to ${Math.round((own.maxFileSize / 1024 / 1024) * 10) / 10} MB`
    : 'instance size limit';
  return `${types}, ${size}`;
});

const sections = computed<SettingsAccordionItem[]>(() => [
  {
    value: 'identity',
    label: 'Name and website',
    icon: 'id-card',
    description: 'What the space is called and where its website lives.',
    summary: `${props.space.name}, ${host(props.space.url)}`,
  },
  {
    value: 'languages',
    label: 'Languages',
    icon: 'globe',
    description: 'The languages content is written in.',
    summary: props.space.locales
      .map((code) =>
        code === props.space.defaultLocale ? `${localeName(code)} (main)` : localeName(code),
      )
      .join(', '),
  },
  {
    value: 'uploads',
    label: 'Uploads',
    icon: 'image',
    description: 'Which files the asset library accepts, and how large they may be.',
    summary: uploadSummary.value,
  },
]);

function remove() {
  // Confirm by typing the technical name: this deletes every document.
  return confirmAndRun(
    {
      title: `Delete ${props.space.name}?`,
      message: 'This removes the space along with its content, content types and assets.',
      confirmLabel: 'Delete space',
      danger: true,
      requireText: props.space.machineName,
    },
    async () => {
      await spaceActions.remove(props.space.id);
      emit('deleted');
    },
    { success: `Deleted ${props.space.name}`, error },
  );
}
</script>

<template>
  <SettingsPage
    title="General"
    description="The basics of this space: its name, the address of its website, the languages it is written in and the files it accepts."
  >
    <template #actions>
      <span class="mb-badge-brand" title="Your role in this space">{{ session.roleIn(space.id) }}</span>
    </template>

    <!-- An unfinished import takes no edits; resume or delete it here. -->
    <SpaceImportSection v-if="space.importStatus" :space="space" @deleted="emit('deleted')" />

    <template v-else>
      <p v-if="!canWrite" class="mb-callout" role="status">
        Only the owners and admins of this space can change these settings.
      </p>

      <SettingsAccordion v-else v-model="open" :items="sections">
        <template #identity>
          <SpaceForm :key="space.id" :space="space" part="identity" />
        </template>
        <template #languages>
          <SpaceForm :key="space.id" :space="space" part="languages" />
        </template>
        <template #uploads>
          <AssetSettingsForm :key="space.id" :space="space" />
        </template>
      </SettingsAccordion>

      <PluginSlot v-if="canWrite" id="space.settings.sections" :props="{ space }" />

      <section
        v-if="session.can('space:delete', space.id)"
        class="rounded-card border border-danger-200 p-4 dark:border-danger-500/30"
        aria-labelledby="space-danger-heading"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-card bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-300">
            <Icon name="alert" class="mb-icon" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 id="space-danger-heading" class="text-sm font-semibold">Delete this space</h2>
            <p class="mb-meta">
              Removes all of its content, content types and assets for good. You will be asked to type
              <code class="font-mono">{{ space.machineName }}</code> to confirm.
            </p>
          </div>
          <button type="button" class="mb-btn-ghost-danger shrink-0" @click="remove">
            <Icon name="trash" /> Delete space
          </button>
        </div>
        <p v-if="error" class="mb-error mt-2">{{ error }}</p>
      </section>
    </template>
  </SettingsPage>
</template>
