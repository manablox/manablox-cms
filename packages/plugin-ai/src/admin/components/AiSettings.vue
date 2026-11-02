<script setup lang="ts">
import {
  Accordion,
  AsyncList,
  EmptyState,
  formatDateTime,
  Icon,
  messageForKey,
  Pager,
  SettingsAccordion,
  type SettingsAccordionItem,
  SettingsBlock,
  SettingsPage,
  Tip,
  useCan,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { AI_DEFAULT_LENGTHS, type AiCapability, type AiProviderMeta } from '../../sdk';
import { useAiCatalog, useAiGenerations, useAiProviders, useAiSettings } from '../queries';
import AiAgentGuide from './AiAgentGuide.vue';
import AiCustomProviderForm from './AiCustomProviderForm.vue';
import AiLengthsForm from './AiLengthsForm.vue';
import AiProviderForm from './AiProviderForm.vue';
import AiProviderRow from './AiProviderRow.vue';

/** The AI settings tab: the space's providers (keys are per space) and its generations. */
const spaces = useSpaceStore();

const catalogQuery = useAiCatalog();
const providersQuery = useAiProviders();
const generationsQuery = useAiGenerations();

const canConfigure = useCan('ai:configure');
/** Hosted providers; self-hosted ones are listed separately. */
const providers = computed(() =>
  (catalogQuery.data.value?.providers ?? []).filter((meta) => meta.kind !== 'custom'),
);
const savedFor = (kind: string) => providersQuery.data.value?.find((row) => row.kind === kind);

const custom = computed(() =>
  (providersQuery.data.value ?? []).filter((row) => row.kind === 'custom'),
);
const takenSlugs = computed(() => custom.value.map((row) => row.slug));

/** One accordion row. */
type Row = {
  value: string;
  label: string;
  detail: string;
  mono: boolean;
  icon: string;
  capabilities: readonly AiCapability[];
  status: { label: string; on: boolean };
};

const ON = { label: 'On', on: true };
const OFF = { label: 'Off', on: false };

const hostedRows = computed<(Row & { meta: AiProviderMeta })[]>(() =>
  providers.value.map((meta) => {
    const saved = savedFor(meta.kind);
    return {
      value: meta.kind,
      label: meta.label,
      detail: meta.description,
      mono: false,
      icon: 'cloud',
      capabilities: meta.capabilities,
      status: !saved?.hasKey ? { label: 'Not set up', on: false } : saved.enabled ? ON : OFF,
      meta,
    };
  }),
);

/** The row key for a new self-hosted model. */
const NEW = 'new';
const adding = ref(false);
const customRows = computed<Row[]>(() => [
  ...(adding.value
    ? [
        {
          value: NEW,
          label: 'New self-hosted model',
          detail: 'A model you run yourself, reached over HTTP.',
          mono: false,
          icon: 'plus',
          capabilities: [],
          status: { label: 'Not saved', on: false },
        },
      ]
    : []),
  ...custom.value.map((row) => ({
    value: row.id,
    label: row.label,
    detail: `custom:${row.slug}`,
    mono: true,
    icon: 'server',
    capabilities: row.config?.capabilities ?? [],
    status: row.enabled ? ON : OFF,
  })),
]);

const hostedOpen = ref<string | undefined>();
const customOpen = ref<string | undefined>();

function startAdding() {
  adding.value = true;
  customOpen.value = NEW;
}
function stopAdding() {
  adding.value = false;
  if (customOpen.value === NEW) customOpen.value = undefined;
}

const settingsQuery = useAiSettings();
const catalogReady = computed(() => Boolean(catalogQuery.data.value?.agentGuide));

const extrasOpen = ref<string[]>([]);
const extras = computed<SettingsAccordionItem[]>(() => [
  {
    value: 'lengths',
    label: 'Lengths',
    icon: 'align-left',
    description: 'The short, medium and long choices offered when generating.',
    summary: (settingsQuery.data.value?.lengths ?? AI_DEFAULT_LENGTHS)
      .map((preset) => preset.label)
      .join(', '),
  },
  ...(catalogReady.value
    ? [
        {
          value: 'agent',
          label: 'Work with an AI agent',
          icon: 'sparkles',
          description: 'Let an outside agent build and write in this space through the API.',
        },
      ]
    : []),
  {
    value: 'generations',
    label: 'Recent generations',
    icon: 'clock',
    description: 'What was generated in this space, and whether it worked.',
    summary: `${generationsQuery.total.value ?? 0} so far`,
  },
]);

const onCount = computed(
  () => [...hostedRows.value, ...customRows.value].filter((row) => row.status.on).length,
);
</script>

<template>
  <SettingsPage
    v-if="spaces.currentId"
    title="AI"
    description="Let this space write text and create images with AI. Connect at least one provider, then use the magic wand buttons in the editor."
  >
    <template #actions>
      <span :class="onCount ? 'mb-badge-ok' : 'mb-badge'">{{ onCount }} switched on</span>
    </template>

    <p v-if="!canConfigure" class="mb-callout" role="status">
      You can see what is set up here, but only a role with "Configure providers" may change it.
    </p>
    <Tip v-else-if="!onCount && !providersQuery.isPending.value">
      Nothing is switched on yet. Open a provider below, paste the API key you got from that
      company, tick <strong>Offer this provider in the editor</strong> and save. The key is
      kept for this space only.
    </Tip>

    <SettingsBlock
      title="Providers"
      description="Companies whose AI does the work. Claude and ChatGPT write text; Google creates images and video."
    >
      <Accordion v-model="hostedOpen" :items="hostedRows" variant="cards" keep-mounted>
        <template #trigger="{ item }">
          <AiProviderRow
            :label="item.label"
            :detail="item.detail"
            :mono="item.mono"
            :icon="item.icon"
            :capabilities="item.capabilities"
            :status="item.status"
          />
        </template>
        <template #default="{ item }">
          <AiProviderForm
            :space-id="spaces.currentId"
            :meta="item.meta"
            :saved="savedFor(item.value)"
            :can-configure="canConfigure"
          />
        </template>
      </Accordion>
    </SettingsBlock>

    <SettingsBlock
      title="Self-hosted models"
      description="A model you run yourself, such as Ollama, LM Studio, vLLM or any OpenAI-compatible server."
    >
      <template #actions>
        <button v-if="canConfigure && !adding" type="button" class="mb-btn-outline" @click="startAdding">
          <Icon name="plus" /> Add a model
        </button>
      </template>

      <Accordion v-if="customRows.length" v-model="customOpen" :items="customRows" variant="cards" keep-mounted>
        <template #trigger="{ item }">
          <AiProviderRow
            :label="item.label"
            :detail="item.detail"
            :mono="item.mono"
            :icon="item.icon"
            :capabilities="item.capabilities"
            :status="item.status"
          />
        </template>
        <template #default="{ item }">
          <AiCustomProviderForm
            :space-id="spaces.currentId"
            :saved="custom.find((row) => row.id === item.value)"
            :can-configure="canConfigure"
            :taken="takenSlugs"
            @done="stopAdding"
          />
        </template>
      </Accordion>
      <EmptyState v-else icon="server" title="No self-hosted models yet" compact />
      <p class="mb-hint">
        A server on your private network must be listed in the instance's allowed AI hosts
        (<code class="ai:font-mono">AI_ALLOWED_HOSTS</code>) before it can be reached.
      </p>
    </SettingsBlock>

    <SettingsBlock title="More options">
      <SettingsAccordion v-model="extrasOpen" :items="extras">
        <template #lengths>
          <AiLengthsForm :space-id="spaces.currentId" :can-configure="canConfigure" />
        </template>
        <template #agent>
          <AiAgentGuide />
        </template>
        <template #generations>
          <div class="ai:mb-3 ai:flex ai:justify-end">
            <Pager v-model:page="generationsQuery.page.value" :total="generationsQuery.total.value" :page-size="generationsQuery.pageSize" />
          </div>
          <AsyncList
            :pending="generationsQuery.isPending.value"
            :error="generationsQuery.error.value"
            :retry="generationsQuery.refetch"
            :items="generationsQuery.data.value?.items"
            list-class="ai:text-sm"
            item-class="ai:flex ai:items-start ai:gap-3 ai:py-2"
            empty="bare"
            empty-title="Nothing generated in this space yet."
          >
            <template #item="{ item: row }">
              <Icon
                :name="row.status === 'failed' ? 'fail' : row.status === 'succeeded' ? 'ok' : 'spinner'"
                :class="`ai:mt-0.5 ai:shrink-0 ${row.status === 'failed' ? 'ai:text-danger-500' : row.status === 'succeeded' ? 'ai:text-ok-500' : 'ai:animate-spin ai:text-surface-400'}`"
              />
              <div class="ai:min-w-0 ai:flex-1">
                <p class="ai:truncate">{{ row.prompt }}</p>
                <p class="mb-meta">
                  {{ row.kind }} - {{ row.providerKind }} {{ row.model }} - {{ formatDateTime(row.createdAt) }}
                  <span v-if="row.error" class="ai:text-danger-500">
                    - {{ messageForKey(row.error, row.errorDetail ?? undefined) }}
                  </span>
                </p>
              </div>
            </template>
          </AsyncList>
        </template>
      </SettingsAccordion>
    </SettingsBlock>
  </SettingsPage>
</template>
