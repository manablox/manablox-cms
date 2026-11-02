<script setup lang="ts">
import { Dialog, Icon, messageFor, runWrite, Switch, TextField } from '@manablox/admin-sdk';
import { ref, watch } from 'vue';
import { readBundleText } from '../model/theme-bundle';
import { type ThemeImportReport, themes } from '../queries';
import ThemeImportTable from './ThemeImportTable.vue';

/**
 * Imports a theme file: previews what each design would do, lets the user leave entries out
 * and writes the rest as drafts.
 */
const props = defineProps<{ spaceId: string }>();
const emit = defineEmits<{ close: [] }>();

const bundle = ref<unknown>(null);
const bundleName = ref<string | null>(null);
const fileError = ref<string | null>(null);
const replace = ref(true);
const skip = ref<string[]>([]);
const preview = ref<ThemeImportReport | null>(null);
const previewing = ref(false);
const result = ref<ThemeImportReport | null>(null);
const importing = ref(false);
const error = ref<string | null>(null);

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null;
  bundle.value = null;
  bundleName.value = null;
  preview.value = null;
  skip.value = [];
  fileError.value = null;
  if (!file) return;
  const read = readBundleText(await file.text());
  if (!read.ok) {
    fileError.value = read.error;
    return;
  }
  bundle.value = read.bundle;
  bundleName.value = read.name;
  await refresh();
}

/** Each change of the choices asks again, so the table shows what the server would do. */
let asked = 0;
async function refresh() {
  if (bundle.value === null) return;
  const ask = ++asked;
  previewing.value = true;
  error.value = null;
  try {
    const report = await themes.previewImport(props.spaceId, bundle.value, {
      replace: replace.value,
      skip: skip.value,
    });
    if (ask === asked) preview.value = report;
  } catch (caught) {
    if (ask !== asked) return;
    preview.value = null;
    fileError.value = messageFor(caught);
  } finally {
    if (ask === asked) previewing.value = false;
  }
}
watch([replace, skip], () => void refresh());

async function run() {
  if (bundle.value === null) return;
  await runWrite(
    async () => {
      result.value = await themes.import(props.spaceId, bundle.value, {
        replace: replace.value,
        skip: skip.value,
      });
    },
    { busy: importing, error, success: 'Imported the theme as drafts' },
  );
}

const writes = (report: ThemeImportReport | null) =>
  (report?.entries ?? []).filter((entry) => entry.action !== 'skip').length;
</script>

<template>
  <Dialog title="Import a theme" width="max-w-2xl" @close="emit('close')">
    <div class="ws:space-y-4">
      <template v-if="result">
        <ThemeImportTable :report="result" done />
        <p class="mb-hint">Nothing is live yet: look the designs over, then publish them from the overview.</p>
      </template>
      <template v-else>
        <TextField
          label="Theme file"
          type="file"
          accept="application/json,.json"
          hint="A .json file exported from the design overview of any Manablox space."
          :error="fileError ?? undefined"
          @change="onFile"
        />
        <template v-if="bundle !== null">
          <Switch v-model="replace">Replace designs this space already has</Switch>
          <p v-if="bundleName" class="mb-meta">From "{{ bundleName }}"</p>
          <ThemeImportTable v-if="preview" v-model:skip="skip" :report="preview" choosable />
          <p v-else-if="previewing" class="ws:text-sm ws:text-surface-500">Checking the file...</p>
        </template>
        <p v-if="error" class="mb-callout" role="status">{{ error }}</p>
      </template>
    </div>

    <template #footer="{ close }">
      <button type="button" :class="result ? 'mb-btn-primary' : 'mb-btn-ghost'" @click="close">{{ result ? 'Done' : 'Cancel' }}</button>
      <button
        v-if="!result"
        type="button"
        class="mb-btn-primary"
        :disabled="!preview || previewing || importing || writes(preview) === 0"
        @click="run"
      >
        <Icon v-if="importing" name="spinner" class="ws:animate-spin" />
        {{ importing ? 'Importing...' : 'Import as drafts' }}
      </button>
    </template>
  </Dialog>
</template>
