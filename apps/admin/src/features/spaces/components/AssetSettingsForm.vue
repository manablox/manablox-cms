<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import MimeTypePicker from '@manablox/admin-sdk/components/ui/MimeTypePicker.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { useAssetLimits } from '@manablox/admin-sdk/features/assets/queries';
import { mimeTypeLabel } from '@manablox/admin-sdk/lib/mime-types';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { computed, ref, watch } from 'vue';
import { type Space, spaces } from '../queries';

/** A space's upload limits, narrowing the instance's and its controls'. At the ceiling nothing is stored. */
const props = defineProps<{ space: Space }>();

const { data: limits } = useAssetLimits(() => props.space.id);

const picked = ref<string[]>([]);
const maxMb = ref<number | null>(null);
const pristine = ref('');
const editor = useDraftForm<{ picked: string[]; maxMb: number | null }>();
const { saving } = editor;

const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
// The env ceiling narrowed by the controls; the space can only narrow further.
const instanceTypes = computed(() => limits.value?.ceiling.allowedMimeTypes ?? []);
const instanceMaxMb = computed(() =>
  limits.value ? toMb(limits.value.ceiling.maxFileSize) : null,
);

const state = computed(() =>
  JSON.stringify({ picked: [...picked.value].sort(), maxMb: maxMb.value }),
);
const isDirty = computed(() => state.value !== pristine.value);

/** Loads the space's list, or the instance's full list ticked. Re-runs when limits load or the space changes. */
watch(
  [() => props.space.settings, instanceTypes],
  ([settings, instance]) => {
    const own =
      (settings?.assets as { allowedMimeTypes?: string[]; maxFileSize?: number } | undefined) ?? {};
    picked.value = [...(own.allowedMimeTypes ?? instance)];
    maxMb.value = own.maxFileSize ? Math.round((own.maxFileSize / 1024 / 1024) * 10) / 10 : null;
    pristine.value = state.value;
  },
  { immediate: true },
);

/** Nothing narrowed. */
const sameAsInstance = computed(() => {
  const a = [...picked.value].sort();
  const b = [...instanceTypes.value].sort();
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
});

/** A type list as words: "All images, PDF document, Word document". */
const describe = (types: readonly string[] | null | undefined) =>
  types?.length ? types.map((type) => mimeTypeLabel(type)).join(', ') : null;
const instanceDescription = computed(() => describe(instanceTypes.value));
const preview = computed(() => {
  const types = limits.value?.effective.allowedMimeTypes;
  return types?.length === 0 ? 'no file type' : (describe(types) ?? 'any type');
});

/** The control-owned bounds, read-only here. */
const controlled = computed(() => {
  const controls = limits.value?.controls;
  if (!controls) return null;
  const parts = [
    controls.maxFileSize !== null ? `files up to ${toMb(controls.maxFileSize)} MB` : null,
    controls.allowedMimeTypes !== null
      ? (describe(controls.allowedMimeTypes) ?? 'no file type')
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join('; ') : null;
});

async function save() {
  await editor.submit(async () => {
    await spaces.setAssetSettings(props.space.id, {
      // Unnarrowed is stored as empty, so the space follows the instance.
      allowedMimeTypes: sameAsInstance.value ? [] : [...picked.value],
      maxFileSize: maxMb.value ? Math.round(maxMb.value * 1024 * 1024) : null,
    });
    pristine.value = state.value;
    toast.success('Upload limits saved');
  });
}
</script>

<template>
  <form class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3" @submit.prevent="save">
    <p v-if="controlled" class="mb-hint flex items-start gap-1.5 break-words">
      <Icon name="lock" class="mb-icon-sm mt-0.5 shrink-0" />
      <span>Set for this space by the instance's controls, not changeable here: {{ controlled }}. The limits below can only narrow them.</span>
    </p>
    <FormField label="Allowed file types" v-slot="{ id }">
      <MimeTypePicker :id="id" v-model="picked" :within="instanceTypes" />
      <p class="mb-hint break-words">
        <template v-if="instanceDescription">
          The instance allows {{ instanceDescription }}. Untick what this space should refuse;
          <template v-if="sameAsInstance">as long as the list is unchanged, the space follows the instance.</template>
          <template v-else>the list is now this space's own.</template>
        </template>
        <template v-else>The instance allows any type. Pick some to narrow it, or pick nothing to keep it open.</template>
        A family such as <code class="font-mono">image/</code> takes every type in it.
      </p>
    </FormField>

    <TextField
      v-model.number="maxMb"
      label="Largest file (MB)"
      type="number"
      min="0.1"
      step="0.1"
      :max="instanceMaxMb ?? undefined"
      :placeholder="instanceMaxMb ? `${instanceMaxMb} (the instance's limit)` : ''"
      :hint="instanceMaxMb ? `Empty follows the instance (${instanceMaxMb} MB).` : 'Empty follows the instance.'"
    />

    <p class="mb-hint break-words">Uploads currently accept: {{ preview }}.</p>
    <p v-for="message in editor.otherErrors([])" :key="message" class="mb-error">{{ message }}</p>
    <div>
      <SaveButton type="submit" :saving="saving" :disabled="!isDirty" label="Save limits" />
    </div>
  </form>
</template>
