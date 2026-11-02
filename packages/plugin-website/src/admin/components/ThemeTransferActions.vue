<script setup lang="ts">
import { DropdownMenu, downloadFile, Icon, runWrite } from '@manablox/admin-sdk';
import { ref } from 'vue';
import { bundleFilename } from '../model/theme-bundle';
import { themes } from '../queries';
import ThemeGalleryDialog from './ThemeGalleryDialog.vue';
import ThemeImportDialog from './ThemeImportDialog.vue';

/** Theme gallery, export and import of the design overview. */
const props = defineProps<{ spaceId: string; spaceName: string; canWrite: boolean }>();

const exportOpen = ref(false);
const exporting = ref(false);
const importing = ref(false);
const gallery = ref(false);

async function download(variant: 'published' | 'draft') {
  await runWrite(
    async () => {
      const bundle = await themes.export(props.spaceId, variant);
      downloadFile(
        bundleFilename(props.spaceName, variant),
        'application/json',
        `${JSON.stringify(bundle, null, 2)}\n`,
      );
    },
    { busy: exporting },
  );
}
</script>

<template>
  <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-2">
    <button v-if="canWrite" type="button" class="mb-btn-outline mb-btn-sm" @click="gallery = true">
      <Icon name="palette" class="mb-icon-sm" /> Theme gallery
    </button>
    <button v-if="canWrite" type="button" class="mb-btn-outline mb-btn-sm" @click="importing = true">
      <Icon name="upload" class="mb-icon-sm" /> Import theme
    </button>
    <DropdownMenu :open="exportOpen" @update:open="exportOpen = $event">
      <template #trigger>
        <button type="button" class="mb-btn-outline mb-btn-sm" :disabled="exporting">
          <Icon :name="exporting ? 'spinner' : 'download'" class="mb-icon-sm" :class="exporting ? 'ws:animate-spin' : ''" /> Export theme
        </button>
      </template>
      <button type="button" class="mb-menu-item" @click="download('published')">
        Published designs
      </button>
      <button type="button" class="mb-menu-item" @click="download('draft')">
        Drafts, as they are now
      </button>
    </DropdownMenu>

    <ThemeGalleryDialog v-if="gallery" :space-id="spaceId" @close="gallery = false" />
    <ThemeImportDialog v-if="importing" :space-id="spaceId" @close="importing = false" />
  </div>
</template>
