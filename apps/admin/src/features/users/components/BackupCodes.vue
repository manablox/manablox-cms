<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { copyText } from '@manablox/admin-sdk/lib/clipboard';
import { downloadFile } from '@manablox/admin-sdk/lib/download';
import { backupCodesText } from '../two-factor';

/** Backup codes, shown once, with copy and download. */
const props = defineProps<{ codes: readonly string[] }>();

function copy() {
  void copyText(props.codes.join('\n'), { success: 'Backup codes copied' });
}

function download() {
  downloadFile('manablox-backup-codes.txt', 'text/plain', backupCodesText(props.codes));
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-surface-500">
      Each code signs you in once if you lose your device. Keep them somewhere safe; they are
      shown only now.
    </p>
    <ul class="grid grid-cols-2 gap-2 rounded-card bg-surface-100 p-3 font-mono text-sm dark:bg-surface-800" data-testid="backup-codes">
      <li v-for="code in codes" :key="code">{{ code }}</li>
    </ul>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="mb-btn-outline mb-btn-sm" @click="copy"><Icon name="copy" class="mb-icon-sm" /> Copy</button>
      <button type="button" class="mb-btn-outline mb-btn-sm" @click="download"><Icon name="download" class="mb-icon-sm" /> Download</button>
    </div>
  </div>
</template>
