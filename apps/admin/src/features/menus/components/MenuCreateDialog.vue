<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { menus } from '@manablox/admin-sdk/features/menus/queries';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { technicalName } from '@manablox/core';
import { useRouter } from 'vue-router';
import { useDerivedName } from '~/composables/useDerivedName';

/** Creates a menu from a name and technical name, then opens the editor. */
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const form = useDraftForm<{ name: string; machineName: string }>();
form.load({ name: '', machineName: '' });
const draft = form.draft;
const derived = useDerivedName({
  read: () => draft.value?.machineName ?? '',
  write: (value) => {
    if (draft.value) draft.value.machineName = value;
  },
});

function onNameInput(value: string) {
  if (!draft.value) return;
  draft.value.name = value;
  derived.onLabelInput(value);
}

/** Resolves true once created and opened, which closes the dialog. */
async function create(): Promise<boolean> {
  const current = draft.value;
  if (!current?.name.trim()) return false;
  let created: { id: string; name: string } | null = null;
  const ok = await form.submit(async () => {
    created = await menus.create({
      spaceId: requireSpace(),
      name: current.name.trim(),
      machineName: technicalName(current.machineName || current.name, { final: true }),
    });
  });
  const menu = created as { id: string; name: string } | null;
  if (!ok || !menu) return false;
  toast.success(`Created "${menu.name}"`);
  await router.push(`/menus/${menu.id}`);
  return true;
}
</script>

<template>
  <FormDialog
    v-if="draft"
    title="New menu"
    submit-label="Create menu"
    busy-label="Creating..."
    :busy="form.saving.value"
    :disabled="!draft.name.trim()"
    form-class="grid gap-4 sm:grid-cols-2"
    @submit="create"
    @close="emit('close')"
  >
      <TextField
        label="Name"
        :model-value="draft.name"
        placeholder="Main navigation"
        required
        :error="form.fieldError(['name'])"
        @update:model-value="onNameInput(String($event ?? ''))"
      />
      <TextField
        label="Technical name"
        :model-value="draft.machineName"
        class="mb-input-mono"
        placeholder="main"
        :error="form.fieldError(['machineName'])"
        @update:model-value="derived.onNameInput(String($event ?? ''))"
        @blur="derived.onNameBlur()"
      >
        <template v-if="!form.fieldError(['machineName'])" #hint>
          <p class="mb-hint">
            What a site asks for: <code class="font-mono">menu("{{ draft.machineName || 'main' }}")</code>.
          </p>
        </template>
      </TextField>
  </FormDialog>
</template>
