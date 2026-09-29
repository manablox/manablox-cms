<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { ALWAYS_GRANTED, technicalName } from '@manablox/core';
import { computed, ref } from 'vue';
import { useDerivedName } from '~/composables/useDerivedName';
import { type Role, roles } from '../queries';

/** Names a new role; its grants are picked in the editor afterwards. */
const props = defineProps<{ spaceId: string }>();
const emit = defineEmits<{ close: []; created: [role: Role] }>();

const form = useDraftForm<Record<string, never>>();
const { saving, fieldError } = form;
const name = ref('');
const machineName = ref('');
const description = ref('');

const derived = useDerivedName({
  read: () => machineName.value,
  write: (value) => {
    machineName.value = value;
  },
});

function onNameInput(value: string) {
  name.value = value;
  derived.onLabelInput(value);
}

const otherErrors = computed(() =>
  form.otherErrors((path) => ['name', 'machineName'].includes(String(path[0]))),
);

function submit() {
  return form.submit(async () => {
    const created = await roles.create(props.spaceId, {
      name: name.value.trim(),
      machineName: technicalName(machineName.value || name.value, { final: true }),
      description: description.value.trim() || null,
      permissions: [...ALWAYS_GRANTED],
    });
    toast.success(`Created "${created.name}"`);
    emit('created', created);
  });
}
</script>

<template>
  <FormDialog
    title="New role"
    submit-label="Create role"
    busy-label="Creating..."
    :busy="saving"
    :disabled="!name.trim()"
    form-class="space-y-3"
    :on-submit="submit"
    @close="emit('close')"
  >
    <TextField
      label="Name"
      :model-value="name"
      placeholder="Blogger"
      required
      :error="fieldError(['name'])"
      @update:model-value="onNameInput(String($event ?? ''))"
    />
    <TextField
      label="Technical name"
      :model-value="machineName"
      class="mb-input-mono"
      placeholder="blogger"
      :error="fieldError(['machineName'])"
      :hint="fieldError(['machineName']) ? undefined : 'What a membership and a field\'s read/write roles name. Fixed once the role exists.'"
      @update:model-value="derived.onNameInput(String($event ?? ''))"
      @blur="machineName = technicalName(machineName, { final: true })"
    />
    <TextField v-model="description" label="Description" placeholder="Who this role is for" />
    <p class="mb-hint">It starts with the grants every role has; tick the rest in the editor.</p>
    <div v-if="otherErrors.length" class="mb-callout" role="alert">
      <p v-for="message in otherErrors" :key="message">{{ message }}</p>
    </div>
  </FormDialog>
</template>
