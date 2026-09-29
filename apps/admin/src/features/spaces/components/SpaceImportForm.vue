<script setup lang="ts">
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { messageForKey } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';
import { readArchiveManifest } from '../archive';
import { spaces } from '../queries';
import {
  describeCounts,
  everything,
  inventoryFrom,
  sectionsIn,
  type TransferInventory,
  type TransferSection,
  type TransferSelection,
} from '../transfer-sections';
import TransferPicker from './TransferPicker.vue';

/** What an import did: a summary line and the changes it made to fit. */
export interface SpaceImportOutcome {
  summary: string;
  notes: string[];
}

/**
 * The space import form. The install wizard submits it with a `form="import-space"` button;
 * `embedded` renders no `<form>`, for a dialog that calls the exposed `submit`.
 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false });
const emit = defineEmits<{ imported: [outcome: SpaceImportOutcome] }>();

const file = ref<File | null>(null);
/** Whether the file parsed as an export. The parse is not kept; the file is uploaded raw. */
const ready = ref(false);
const isArchive = ref(false);
const spaceName = ref<string | null>(null);
const held = ref<Map<TransferSection, number>>(new Map());
/** The file's inventory for the picker. */
const inventory = ref<TransferInventory | null>(null);
const selection = ref<TransferSelection>(everything([]));
const busy = ref(false);
const error = ref<string | null>(null);

const available = computed(() => [...held.value.keys()]);

async function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  ready.value = false;
  isArchive.value = false;
  spaceName.value = null;
  held.value = new Map();
  inventory.value = null;
  selection.value = everything([]);
  error.value = null;
  if (!file.value) return;
  try {
    isArchive.value = looksLikeZip(file.value);
    const parsed = isArchive.value
      ? await readArchiveManifest(file.value)
      : (JSON.parse(await file.value.text()) as unknown);
    const data = parsed as { manabloxSpaceExport?: unknown; space?: { name?: unknown } } | null;
    if (typeof data?.manabloxSpaceExport !== 'number') {
      error.value = messageForKey('space.import.notAnExport');
      return;
    }
    spaceName.value = typeof data.space?.name === 'string' ? data.space.name : null;
    held.value = sectionsIn(parsed);
    inventory.value = inventoryFrom(parsed);
    selection.value = everything([...held.value.keys()]);
    ready.value = true;
  } catch {
    error.value = isArchive.value
      ? messageForKey('space.import.notAnExport')
      : 'That file is not valid JSON.';
  }
}

function looksLikeZip(picked: File): boolean {
  return picked.name.toLowerCase().endsWith('.zip') || picked.type.includes('zip');
}

/** Imports the file; resolves to success. */
async function submit(): Promise<boolean> {
  const picked = file.value;
  if (!ready.value || !picked) return false;
  let outcome: SpaceImportOutcome | null = null;
  const done = await runWrite(
    async () => {
      const result = await spaces.importFile(picked, selection.value);
      const counts: Partial<Record<TransferSection, number>> = {};
      const numbers = result as unknown as Record<string, unknown>;
      for (const section of result.sections) {
        const count =
          section === 'history' ? result.versions : (numbers[section] ?? result.plugins[section]);
        if (typeof count === 'number') counts[section] = count;
      }
      if (typeof numbers.files === 'number' && numbers.files > 0) counts.files = numbers.files;
      const summary =
        counts.contents !== undefined && result.published
          ? `Imported ${describeCounts(counts)}; ${result.published} republished.`
          : `Imported ${describeCounts(counts) || 'the space settings'}.`;
      outcome = { summary, notes: result.notes ?? [] };
      return summary;
    },
    { success: (summary) => summary, error, busy },
  );
  if (done && outcome) emit('imported', outcome);
  return done;
}

defineExpose({ ready, busy, submit });
</script>

<template>
  <component :is="embedded ? 'div' : 'form'" id="import-space" class="space-y-3" @submit.prevent="submit">
    <div>
      <TextField
        label="Export file"
        type="file"
        accept="application/json,.json,application/zip,.zip"
        required
        hint="A JSON export, or the zip archive that also carries the asset files."
        @change="onFile"
      />
    </div>
    <template v-if="ready">
      <div class="mb-surface-inset flex flex-wrap items-center justify-between gap-2 rounded-control p-2">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium">{{ spaceName ?? 'A space' }}</p>
          <p class="mb-hint">
            {{ isArchive ? 'A zip archive, asset files included.' : 'A JSON export, asset records only.' }}
          </p>
        </div>
        <span class="mb-badge">{{ isArchive ? 'Archive' : 'JSON' }}</span>
      </div>
      <div>
        <p class="mb-label mb-1">Restore</p>
        <p v-if="!available.length" class="mb-hint">The file holds only the space's settings.</p>
        <TransferPicker v-else v-model="selection" :inventory="inventory" :available="available" />
      </div>
    </template>
    <p class="mb-hint">
      The space is restored under its original id, so it cannot be imported into an
      instance that already holds it. Published documents are republished, keeping the
      date they went live at the source. Whoever imports the space owns it; members are
      not carried over. If the import stops partway, the space stays in the list, marked
      failed, to resume or delete.
    </p>
    <p v-if="error" class="mb-error">{{ error }}</p>
  </component>
</template>
