<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { content } from '@manablox/admin-sdk/features/content/queries';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';

/** Names a new folder, created in every locale of the space. */
const props = defineProps<{ parentId: string | null }>();
const emit = defineEmits<{ close: []; created: [] }>();

const spaces = useSpaceStore();
const form = useDraftForm<{ title: string }>();
form.load({ title: '' });
const draft = form.draft;

/** Resolves true once created, which closes the dialog. */
async function create(): Promise<boolean> {
  const title = draft.value?.title.trim();
  if (!title) return false;
  const ok = await form.submit(async () => {
    await content.createFolder(requireSpace(), spaces.locale, title, props.parentId);
  });
  if (!ok) return false;
  toast.success(`Created "${title}"`);
  emit('created');
  return true;
}
</script>

<template>
  <FormDialog
    v-if="draft"
    title="New folder"
    submit-label="Create folder"
    busy-label="Creating..."
    :busy="form.saving.value"
    :disabled="!draft.title.trim()"
    @submit="create"
    @close="emit('close')"
  >
    <TextField
      v-model="draft.title"
      label="Name"
      placeholder="Campaigns"
      required
      :error="form.fieldError(['title'])"
      :hint="
        form.fieldError(['title'])
          ? undefined
          : 'A folder groups documents in the tree. It adds nothing to their addresses, and it is created in every language of the space.'
      "
    />
  </FormDialog>
</template>
