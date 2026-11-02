<script setup lang="ts">
import { ChipToggle, FormDialog, runWrite, TextField } from '@manablox/admin-sdk';
import type { FontFamily } from '@manablox/site';
import { computed, ref, useId } from 'vue';
import { GOOGLE_FONTS, googleFallback } from '../model/fonts';
import { design } from '../queries';

/**
 * Picks a Google Fonts family and its styles. The server downloads the files into the
 * space's assets, so the site never loads anything from Google.
 */
const props = defineProps<{ spaceId: string }>();
const emit = defineEmits<{ close: []; imported: [family: FontFamily] }>();

const family = ref('');
const weights = ref(new Set<number>([400, 700]));
const italic = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
const listId = useId();

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const known = computed(() =>
  GOOGLE_FONTS.find((entry) => entry.family.toLowerCase() === family.value.trim().toLowerCase()),
);
const variants = computed(() =>
  [...weights.value].flatMap((weight) => [
    { weight, style: 'normal' as const },
    ...(italic.value ? [{ weight, style: 'italic' as const }] : []),
  ]),
);

function toggle(weight: number, on: boolean) {
  const next = new Set(weights.value);
  if (on) next.add(weight);
  else next.delete(weight);
  weights.value = next;
}

async function submit(): Promise<boolean> {
  let imported: FontFamily | null = null;
  const ok = await runWrite(
    async () => {
      imported = await design.importGoogleFont(props.spaceId, {
        family: known.value?.family ?? family.value.trim(),
        variants: variants.value,
        fallback: googleFallback(known.value?.category),
      });
    },
    { error, busy, success: `Added ${known.value?.family ?? family.value.trim()}` },
  );
  if (ok && imported) emit('imported', imported);
  return ok;
}
</script>

<template>
  <FormDialog
    title="Add a Google font"
    submit-label="Download and add"
    busy-label="Downloading..."
    :busy="busy"
    :disabled="!family.trim() || variants.length === 0 || variants.length > 18"
    width="max-w-lg"
    @submit="submit"
    @close="emit('close')"
  >
    <div class="ws:space-y-4">
      <TextField
        v-model="family"
        label="Font family"
        placeholder="Playfair Display"
        :list="listId"
        autocomplete="off"
        hint="Type the family name as fonts.google.com shows it. The files are copied into this space's assets once, so visitors never load anything from Google."
      />
      <datalist :id="listId">
        <option v-for="entry in GOOGLE_FONTS" :key="entry.family" :value="entry.family">{{ entry.category }}</option>
      </datalist>

      <fieldset>
        <legend class="mb-label">Weights</legend>
        <div class="ws:flex ws:flex-wrap ws:gap-1.5">
          <ChipToggle
            v-for="weight in WEIGHTS"
            :key="weight"
            :model-value="weights.has(weight)"
            mono
            @update:model-value="toggle(weight, $event)"
          >
            {{ weight }}
          </ChipToggle>
        </div>
        <p class="mb-hint">Pick only what the design uses; each style is a file visitors download.</p>
      </fieldset>

      <ChipToggle v-model="italic">Italic styles too</ChipToggle>

      <p v-if="variants.length > 18" class="mb-error">Pick at most 18 styles.</p>
      <div v-if="error" class="mb-callout" role="alert">
        {{ error }}
        <template v-if="error.includes('file type')"> Font files need <code>font/woff2</code> in the instance's <code>ALLOWED_MIME_TYPES</code>, and in the space's upload limits when it narrows them.</template>
      </div>
    </div>
  </FormDialog>
</template>
