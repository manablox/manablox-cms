<script setup lang="ts">
import {
  FormDialog,
  FormField,
  requireSpace,
  runWrite,
  Select,
  TextField,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LAYOUT_KEY, layoutKeyFromName } from '../model/layout-design';
import { designRoute } from '../model/status';
import { design } from '../queries';

/** A new layout or menu design: a name, its key and what it starts from. */
const props = defineProps<{
  kind: 'layout' | 'menu';
  /** Keys in use, designs and menus alike. */
  taken: readonly string[];
  /** Starting points; the first is picked. */
  sources: ReadonlyArray<{ value: string; label: string; data: () => unknown }>;
  /** Preselected starting point, e.g. for Duplicate. */
  from?: string | undefined;
  initialName?: string | undefined;
}>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const name = ref(props.initialName ?? '');
const source = ref(props.from ?? props.sources[0]?.value ?? '');
const busy = ref(false);
const tried = ref(false);

const key = computed(() => layoutKeyFromName(name.value, props.taken));
const nameError = computed(() => (tried.value && !name.value.trim() ? 'Give it a name.' : null));
const what = computed(() => (props.kind === 'layout' ? 'layout' : 'menu design'));

async function submit() {
  tried.value = true;
  const picked = props.sources.find((entry) => entry.value === source.value);
  if (!name.value.trim() || !picked || !LAYOUT_KEY.test(key.value)) return false;
  const spaceId = requireSpace();
  const ok = await runWrite(
    () =>
      design.saveDraft(spaceId, {
        kind: props.kind,
        key: key.value,
        name: name.value.trim().slice(0, 200),
        draft: picked.data(),
        expectedVersion: 0,
      }),
    { busy, success: `Created the ${what.value} "${name.value.trim()}"` },
  );
  if (ok) await router.push(designRoute(props.kind, key.value) ?? '/design');
  return Boolean(ok);
}
</script>

<template>
  <FormDialog :title="`New ${what}`" submit-label="Create" busy-label="Creating..." :busy="busy" :on-submit="submit" @close="emit('close')">
    <TextField v-model="name" label="Name" :error="nameError" :hint="name.trim() ? `Key: ${key}` : 'e.g. Landing page, Blog'" autofocus />
    <FormField label="Starts from">
      <template #default="{ id }">
        <Select :id="id" v-model="source" :options="sources.map((entry) => ({ value: entry.value, label: entry.label }))" />
      </template>
    </FormField>
  </FormDialog>
</template>
