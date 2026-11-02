<script setup lang="ts">
import {
  assets,
  FormDialog,
  FormField,
  runWrite,
  SegmentedControl,
  Select,
  TextField,
} from '@manablox/admin-sdk';
import type { FontFamily, ThemeFonts } from '@manablox/site';
import { computed, ref } from 'vue';
import { familyFromFilename, styleFromFilename } from '../model/fonts';

/** Uploads a woff2 file as an asset and adds it to a family of the theme. */
const props = defineProps<{ spaceId: string; fonts: ThemeFonts }>();
const emit = defineEmits<{ close: []; uploaded: [family: FontFamily] }>();

const file = ref<File | null>(null);
const name = ref('');
const weight = ref(400);
const style = ref<'normal' | 'italic'>('normal');
const error = ref<string | null>(null);
const busy = ref(false);

const WEIGHT_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((value) => ({
  value,
  label: String(value),
}));
const STYLE_OPTIONS = [
  { value: 'normal' as const, label: 'Normal' },
  { value: 'italic' as const, label: 'Italic' },
];

const NAME = /^[a-zA-Z0-9 _-]{1,80}$/;
const idOf = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34) || 'font';
const existing = computed(() =>
  props.fonts.families.find(
    (family) => family.source === 'asset' && family.name === name.value.trim(),
  ),
);
const nameError = computed(() =>
  name.value.trim() && !NAME.test(name.value.trim())
    ? 'Use letters, digits, spaces, - and _.'
    : null,
);

function onFile(event: Event) {
  const picked = (event.target as HTMLInputElement).files?.[0] ?? null;
  file.value = picked;
  if (!picked) return;
  if (!name.value.trim()) name.value = familyFromFilename(picked.name);
  const guess = styleFromFilename(picked.name);
  weight.value = guess.weight;
  style.value = guess.style;
}

async function submit(): Promise<boolean> {
  const upload = file.value;
  if (!upload) return false;
  let family: FontFamily | null = null;
  const ok = await runWrite(
    async () => {
      const asset = await assets.upload(props.spaceId, upload);
      const entry = { assetId: asset.id, weight: weight.value, style: style.value };
      const base = existing.value;
      const taken = new Set(props.fonts.families.map((item) => item.id));
      let id = idOf(name.value);
      if (['body', 'heading', 'mono'].includes(id)) id = `${id}-font`;
      while (!base && taken.has(id)) id = `${id}-2`;
      family = base
        ? {
            ...base,
            files: [
              ...base.files.filter((f) => !(f.weight === entry.weight && f.style === entry.style)),
              entry,
            ],
          }
        : {
            id,
            name: name.value.trim(),
            source: 'asset',
            files: [entry],
            fallback: 'system-ui, sans-serif',
          };
    },
    { error, busy, success: `Uploaded ${upload.name}` },
  );
  if (ok && family) emit('uploaded', family);
  return ok;
}
</script>

<template>
  <FormDialog
    title="Upload a font"
    submit-label="Upload"
    busy-label="Uploading..."
    :busy="busy"
    :disabled="!file || !name.trim() || Boolean(nameError)"
    width="max-w-lg"
    @submit="submit"
    @close="emit('close')"
  >
    <div class="ws:space-y-4">
      <FormField label="Font file" hint="A .woff2 file. Upload one file per weight and style.">
        <template #default="{ id }">
          <input :id="id" type="file" accept=".woff2,font/woff2" class="mb-input" @change="onFile" />
        </template>
      </FormField>
      <TextField
        v-model="name"
        label="Family name"
        placeholder="Acme Sans"
        :error="nameError"
        :hint="existing ? 'Adds this file to the family of that name.' : 'Files with the same family name form one family.'"
      />
      <div class="ws:grid ws:grid-cols-2 ws:gap-3">
        <FormField label="Weight">
          <template #default="{ id }">
            <Select :id="id" v-model="weight" :options="WEIGHT_OPTIONS" />
          </template>
        </FormField>
        <div>
          <span id="font-style-label" class="mb-label">Style</span>
          <SegmentedControl v-model="style" :options="STYLE_OPTIONS" labelledby="font-style-label" />
        </div>
      </div>
      <div v-if="error" class="mb-callout" role="alert">
        {{ error }}
        <template v-if="error.includes('file type')"> Font files need <code>font/woff2</code> in the instance's <code>ALLOWED_MIME_TYPES</code>, and in the space's upload limits when it narrows them.</template>
      </div>
    </div>
  </FormDialog>
</template>
