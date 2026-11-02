<script setup lang="ts">
import {
  CopyField,
  Dialog,
  FormField,
  formatDateTime,
  Icon,
  runWrite,
  Select,
} from '@manablox/admin-sdk';
import { ref } from 'vue';
import { shareUrl } from '../model/canvas';
import { design } from '../queries';

/** Creates a time-limited link that shows the document's draft on the designed site. */
const props = defineProps<{ spaceId: string; contentId: string; origin: string }>();
const emit = defineEmits<{ close: [] }>();

const HOUR = 60 * 60;
const EXPIRY_OPTIONS = [
  { value: HOUR, label: '1 hour' },
  { value: 24 * HOUR, label: '1 day' },
  { value: 7 * 24 * HOUR, label: '7 days' },
  { value: 30 * 24 * HOUR, label: '30 days' },
];

const expiry = ref(24 * HOUR);
const busy = ref(false);
const link = ref<{ url: string; expiresAt: Date } | null>(null);

async function create() {
  await runWrite(
    async () => {
      const { token, expiresAt } = await design.shareLink(
        props.spaceId,
        props.contentId,
        expiry.value,
      );
      link.value = { url: shareUrl(props.origin, token), expiresAt: new Date(expiresAt) };
    },
    { busy },
  );
}
</script>

<template>
  <Dialog title="Share a preview" width="max-w-lg" dismissable @close="emit('close')">
    <div class="ws:space-y-4">
      <p class="ws:text-sm ws:text-surface-600 ws:dark:text-surface-300">
        Anyone with the link sees the saved draft of this page on the site, until the link expires.
        Unsaved changes are not included.
      </p>
      <FormField label="Link works for">
        <template #default="{ id }">
          <Select :id="id" v-model="expiry" :options="EXPIRY_OPTIONS" :disabled="busy" />
        </template>
      </FormField>
      <div v-if="link" class="ws:space-y-2">
        <CopyField :value="link.url" aria-label="Preview link" url />
        <p class="mb-hint">Expires {{ formatDateTime(link.expiresAt) }}.</p>
      </div>
    </div>
    <template #footer="{ close }">
      <button type="button" class="mb-btn-ghost ws:mr-auto" @click="close">Close</button>
      <button type="button" class="mb-btn-primary" :disabled="busy" @click="create">
        <Icon name="link" /> {{ link ? 'Create another link' : 'Create link' }}
      </button>
    </template>
  </Dialog>
</template>
