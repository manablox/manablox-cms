<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SettingsPage from '@manablox/admin-sdk/components/layout/SettingsPage.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import SettingsAccordion, {
  type SettingsAccordionItem,
} from '@manablox/admin-sdk/components/ui/SettingsAccordion.vue';
import Tip from '@manablox/admin-sdk/components/ui/Tip.vue';
import { downloadBlob, downloadFile } from '@manablox/admin-sdk/lib/download';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref, toRef, watch } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import {
  type ConfigSelection,
  configKinds,
  describeKinds,
  everyKind,
  kindEntries,
} from '../config-kinds';
import { type Space, spaces, useConfigInventory, useTransferInventory } from '../queries';
import {
  everything,
  type TransferSection,
  type TransferSelection,
  transferSections,
} from '../transfer-sections';
import ConfigPicker from './ConfigPicker.vue';
import TransferPicker from './TransferPicker.vue';

/** Export a space, or its admin-built content types as `manablox.config.ts` source. */
const props = defineProps<{ space: Space }>();

const exporting = ref(false);
const generating = ref(false);
const error = ref<string | null>(null);
const note = ref<string | null>(null);

const all = transferSections().map((s) => s.kind);
const selection = ref<TransferSelection>(everything(all));

const { data: inventory } = useTransferInventory(toRef(() => props.space.id));

const { data: configInventory } = useConfigInventory(toRef(() => props.space.id));
const configSelection = ref<ConfigSelection>(everyKind());
const kinds = computed(() => configKinds(configInventory.value));
// The providers' kinds are picked too once the inventory names them.
const stopPicking = watch(
  configInventory,
  (held) => {
    if (!held) return;
    const picked = new Set(configSelection.value.kinds);
    for (const kind of held.plugins) picked.add(kind.kind);
    configSelection.value = { ...configSelection.value, kinds: [...picked] };
    queueMicrotask(() => stopPicking());
  },
  { immediate: true },
);

/** What the generated config would hold. */
const configSummary = computed(() => {
  const held = configInventory.value;
  if (!held) return 'Reading what this space has...';
  const counts = Object.fromEntries(
    kinds.value
      .filter((kind) => configSelection.value.kinds.includes(kind.id))
      .map((kind) => [
        kind.id,
        configSelection.value.ids[kind.id]?.length ?? kindEntries(held, kind.id).length,
      ]),
  );
  const described = describeKinds(counts, kinds.value);
  return described ? `${described}.` : 'Nothing picked yet.';
});

const hasConfig = computed(() =>
  kinds.value.some(
    (kind) =>
      configSelection.value.kinds.includes(kind.id) &&
      (configSelection.value.ids[kind.id]?.length ??
        kindEntries(configInventory.value, kind.id).length) > 0,
  ),
);

/** Asset files decide the format; picking the archive adds the asset records. */
const format = computed<'json' | 'archive'>(() =>
  selection.value.sections.includes('files') ? 'archive' : 'json',
);

function setFormat(next: 'json' | 'archive') {
  const sections = new Set<TransferSection>(selection.value.sections);
  if (next === 'archive') {
    sections.add('assets');
    sections.add('files');
  } else {
    sections.delete('files');
  }
  selection.value = {
    ...selection.value,
    sections: all.filter((id) => sections.has(id)),
  };
}

const summary = computed(() => {
  const picked = selection.value.sections.length;
  const narrowed =
    Object.keys(selection.value.ids).length +
    Object.values(selection.value.contents).filter((filter) => filter?.length).length;
  const parts = [`${picked} of ${all.length} sections`];
  if (narrowed) parts.push(`${narrowed} narrowed`);
  parts.push(format.value === 'archive' ? 'as a zip archive' : 'as a JSON file');
  return `${parts.join(', ')}. The space's own settings always travel.`;
});

const open = ref<string[]>(['export']);
/** The include list is shown on demand; everything travels by default. */
const picking = ref(false);
const fullCopy = everything(all).sections;
const isEverything = computed(
  () =>
    selection.value.sections.length === fullCopy.length &&
    fullCopy.every((section) => selection.value.sections.includes(section)) &&
    !Object.keys(selection.value.ids).length &&
    !Object.values(selection.value.contents).some((filter) => filter?.length),
);
const sections = computed<SettingsAccordionItem[]>(() => [
  {
    value: 'export',
    label: 'Download a copy of this space',
    icon: 'download',
    description: 'Everything is included unless you leave parts out.',
    summary: `${isEverything.value ? 'Full copy' : `${selection.value.sections.length} of ${all.length} parts`}, ${format.value === 'archive' ? 'zip archive' : 'JSON file'}`,
  },
  {
    value: 'config',
    label: 'Export as code',
    icon: 'file-code',
    description: 'For developers: what was built here as a manablox.config.ts file.',
    badge: { label: 'Advanced' },
  },
]);

/** Downloads the export as a zip (with asset files) or JSON. */
async function exportSpace() {
  note.value = null;
  const stamp = new Date().toISOString().slice(0, 10);
  const archive = format.value === 'archive';
  const name = `${props.space.machineName}-${stamp}.manablox.${archive ? 'zip' : 'json'}`;
  const done = await runWrite(
    async () => downloadBlob(name, await spaces.exportFile(props.space.id, selection.value)),
    {
      success: archive ? `Exported ${name} with the asset files.` : `Exported ${name}.`,
      error,
      busy: exporting,
    },
  );
  if (done) note.value = archive ? `Exported ${name} with the asset files.` : `Exported ${name}.`;
}

async function downloadConfig() {
  note.value = null;
  let written = '';
  const done = await runWrite(
    async () => {
      const result = await spaces.exportConfig(props.space.id, configSelection.value);
      written = describeKinds(result.counts, kinds.value);
      if (written) {
        downloadFile(`${props.space.machineName}.config.ts`, 'text/typescript', result.code);
      }
    },
    { error, busy: generating },
  );
  if (!done) return;
  if (!written) {
    note.value = 'This space has nothing of that kind built in the admin.';
    return;
  }
  note.value = `Generated ${written}.`;
  toast.success(note.value);
}
</script>

<template>
  <SettingsPage
    title="Export and transfer"
    description="Save this space as a file, to move it to another Manablox installation or to keep as a backup. References between documents keep working in the copy."
  >
    <Tip>
      To load a file into an installation, open
      <RouterLink to="/settings?tab=spaces" class="font-medium underline">Settings > Spaces</RouterLink>
      there and click <strong>Import</strong>.
    </Tip>

    <SettingsAccordion v-model="open" :items="sections">
      <template #export>
        <ol class="space-y-5">
          <li class="space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              <span class="mb-step" aria-hidden="true">1</span>
              <span id="transfer-format">Pick the file type</span>
            </h3>
            <div class="flex flex-wrap items-center gap-3 pl-7">
              <SegmentedControl
                :model-value="format"
                labelledby="transfer-format"
                :options="[
                  { value: 'archive', label: 'Zip archive', icon: 'image' },
                  { value: 'json', label: 'JSON file', icon: 'braces' },
                ]"
                @update:model-value="setFormat"
              />
              <p class="mb-hint min-w-0 flex-1">
                {{ format === 'archive'
                  ? 'Includes the image and file uploads themselves. Pick this for a full copy.'
                  : 'Smaller, but without the uploaded files: only their names and details travel.' }}
              </p>
            </div>
          </li>

          <li class="space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              <span class="mb-step" aria-hidden="true">2</span>
              Choose what to include
            </h3>
            <div class="space-y-2 pl-7">
              <div class="flex flex-wrap items-center gap-3">
                <p class="text-sm">
                  {{ isEverything ? 'A full copy of the space.' : `Your own pick: ${selection.sections.length} of ${all.length} parts.` }}
                </p>
                <button type="button" class="mb-btn-ghost mb-btn-sm" :aria-expanded="picking" @click="picking = !picking">
                  <Icon :name="picking ? 'up' : 'down'" />
                  {{ picking ? 'Hide the list' : 'Leave some parts out' }}
                </button>
                <button v-if="!isEverything" type="button" class="mb-btn-ghost mb-btn-sm" @click="selection = everything(all)">
                  Back to a full copy
                </button>
              </div>
              <template v-if="picking">
                <p class="mb-hint">Untick what should stay behind. Rows with an arrow can be narrowed further.</p>
                <TransferPicker v-model="selection" :inventory="inventory ?? null" :available="all" />
                <PluginSlot id="transfer.sections" :props="{ spaceId: space.id }" />
              </template>
            </div>
          </li>

          <li class="space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              <span class="mb-step" aria-hidden="true">3</span>
              Download
            </h3>
            <div class="flex flex-wrap items-center gap-3 pl-7">
              <FeatureGate feature="transferExport" label="Download export" trigger-class="mb-btn-primary">
                <button
                  type="button"
                  class="mb-btn-primary"
                  :disabled="exporting || !selection.sections.length"
                  @click="exportSpace"
                >
                  <Icon name="download" />
                  {{ exporting ? 'Exporting...' : 'Download export' }}
                </button>
              </FeatureGate>
              <p class="mb-hint min-w-0 flex-1">{{ summary }}</p>
            </div>
            <p v-if="note" class="mb-hint pl-7">{{ note }}</p>
            <p v-if="error" class="mb-error pl-7">{{ error }}</p>
          </li>
        </ol>
      </template>

      <template #config>
        <div class="space-y-3">
          <p class="mb-hint">
            Writes <code class="font-mono">define*</code> source for a
            <code class="font-mono">manablox.config.ts</code>, so what was built in the admin can
            move into code, where it can be reviewed and versioned. Anything that already came
            from a config file stays where it is.
          </p>

          <ConfigPicker v-model="configSelection" :inventory="configInventory ?? null" />

          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="mb-btn-outline"
              :disabled="generating || !hasConfig"
              @click="downloadConfig"
            >
              <Icon name="code" />
              {{ generating ? 'Generating...' : 'Download config' }}
            </button>
            <p class="mb-hint min-w-0 flex-1">
              {{ configSummary }} Ids and secrets stay behind; a credential arrives as an empty
              slot to fill from the environment.
            </p>
          </div>
        </div>
      </template>
    </SettingsAccordion>
  </SettingsPage>
</template>
