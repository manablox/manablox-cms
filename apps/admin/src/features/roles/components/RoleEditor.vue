<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EditorHeader from '@manablox/admin-sdk/components/layout/EditorHeader.vue';
import SettingsBlock from '@manablox/admin-sdk/components/layout/SettingsBlock.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import Tip from '@manablox/admin-sdk/components/ui/Tip.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { useContentTypes } from '@manablox/admin-sdk/features/content-types/queries';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { ALWAYS_GRANTED, isDocumentType } from '@manablox/core';
import { computed, type Ref, watch } from 'vue';
import PermissionPicker from '~/components/PermissionPicker.vue';
import { type Role, roles } from '../queries';

/** Edits a role; built-in roles are shown read only. */
const props = defineProps<{
  spaceId: string;
  role: Role;
  canWrite: boolean;
}>();
const emit = defineEmits<{ saved: [role: Role]; deleted: [] }>();

const { data: types } = useContentTypes(() => props.spaceId);

const readOnly = computed(() => !props.canWrite || props.role.builtIn);

interface Draft {
  name: string;
  machineName: string;
  description: string;
  permissions: Set<string>;
}

function fromRole(role: Role): Draft {
  return {
    name: role.name,
    machineName: role.machineName,
    description: role.description ?? '',
    permissions: new Set(role.permissions ?? ALWAYS_GRANTED),
  };
}

/** Sorts the grant `Set` into JSON for comparison. */
function serialise(value: Draft): string {
  return JSON.stringify({ ...value, permissions: [...value.permissions].sort() });
}
const form = useDraftForm<Draft>({ serialise });
const { isDirty, saving } = form;
form.load(fromRole(props.role));
const draft = form.draft as Ref<Draft>;
watch(
  () => props.role,
  (role) => form.load(fromRole(role)),
);

// --- permissions ------------------------------------------------------------------

/** Documents and databags; blocks are covered by their document's permissions. */
const documentTypes = computed(() => (types.value ?? []).filter(isDocumentType));

// --- errors ---------------------------------------------------------------------------

const fieldError = form.fieldError;
const otherErrors = computed(() =>
  form.otherErrors((path) => ['name', 'machineName'].includes(String(path[0]))),
);

// --- persistence ----------------------------------------------------------------------

async function save() {
  if (readOnly.value) return;
  const id = props.role.id;
  if (!id) return;
  const input = {
    name: draft.value.name.trim(),
    machineName: props.role.machineName,
    description: draft.value.description.trim() || null,
    permissions: [...draft.value.permissions],
  };
  await form.submit(async () => {
    const saved = await roles.update(props.spaceId, id, input);
    form.markSaved();
    toast.success(`Saved "${saved.name}"`);
    emit('saved', saved);
  });
}

async function remove() {
  const role = props.role;
  const id = role.id;
  if (!id) return;
  return confirmAndRun(
    {
      title: `Delete the role "${role.name}"?`,
      message: 'Only a role nobody holds can be deleted. Members keep the roles they have.',
      confirmLabel: 'Delete role',
      danger: true,
    },
    async () => {
      await roles.remove(props.spaceId, id);
      emit('deleted');
    },
    { success: `Deleted "${role.name}"` },
  );
}
</script>

<template>
  <div class="min-w-0 space-y-5">
    <EditorHeader :title="draft.name || role.name" :eyebrow="role.builtIn ? 'Built-in role' : 'Custom role'" class="mb-0!">
      <template #badge>
        <StatusBadge v-if="role.builtIn" status="built-in" />
        <StatusBadge v-else-if="!canWrite" status="read-only" />
        <StatusBadge v-else-if="isDirty" status="unsaved" />
      </template>
      <template v-if="!readOnly">
        <SaveButton :saving="saving" :disabled="!isDirty || !draft.name.trim()" @click="save" />
        <button v-if="role.id" type="button" class="mb-btn-ghost-danger" @click="remove">
          <Icon name="trash" /> Delete role
        </button>
      </template>
    </EditorHeader>

    <Tip v-if="role.builtIn" icon="lock">
      Built-in roles are the same in every space and cannot be changed. To allow a different
      set of things, create a new role with <strong>New role</strong>.
    </Tip>
    <div v-if="otherErrors.length" class="mb-callout" role="alert">
      <p v-for="message in otherErrors" :key="message">{{ message }}</p>
    </div>

    <SettingsBlock title="About this role" description="A name people recognise, and who the role is meant for.">
      <div class="mb-card grid gap-4 sm:grid-cols-2">
        <TextField
          v-model="draft.name"
          label="Name"
          placeholder="Blogger"
          :readonly="readOnly"
          :error="fieldError(['name'])"
        />
        <TextField
          label="Technical name"
          :model-value="draft.machineName"
          class="mb-input-mono"
          readonly
          :error="fieldError(['machineName'])"
          :hint="fieldError(['machineName']) ? undefined : 'Used by developers. Fixed once the role exists.'"
        />
        <TextField
          v-model="draft.description"
          label="Description"
          field-class="sm:col-span-2"
          placeholder="Who this role is for"
          :readonly="readOnly"
        />
      </div>
    </SettingsBlock>

    <SettingsBlock
      title="What this role may do"
      description="Open a group to see its permissions. The badge shows how much of each group is allowed."
    >
      <PermissionPicker
        :model-value="draft.permissions"
        :read-only="readOnly"
        :types="documentTypes"
        :always-granted="ALWAYS_GRANTED"
        :content-note="documentTypes.length
          ? 'A role that may create content types gets every action on the types it creates, so it can fill them.'
          : 'The space has no document types yet. A role that may create content types gets every action on the types it creates.'"
        @update:model-value="draft.permissions = $event"
      />
    </SettingsBlock>
  </div>
</template>
