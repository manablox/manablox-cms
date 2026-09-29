<script setup lang="ts">
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import ScheduleFields from '@manablox/admin-sdk/components/ui/ScheduleFields.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { type Asset, assets, imageEditsOf } from '@manablox/admin-sdk/features/assets/queries';
import { COPIED_URL, copyText } from '@manablox/admin-sdk/lib/clipboard';
import { formatBytes, formatDateTime } from '@manablox/admin-sdk/lib/format';
import {
  isPending,
  type ScheduleWindow,
  saveScheduleWindow,
} from '@manablox/admin-sdk/lib/schedule';
import { useFeature } from '@manablox/admin-sdk/lib/space';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, type Ref, ref, watch } from 'vue';
import TagInput from '~/components/TagInput.vue';
import AssetSpaces from './AssetSpaces.vue';
import ImageEditor from './ImageEditor.vue';

/** The selected asset: look, name, alt, use, remove. */
const props = defineProps<{
  asset: Asset;
  spaceId: string;
  canWrite: boolean;
  canDelete: boolean;
  /** Inside a dialog, which carries the name and the close button itself. */
  embedded?: boolean;
}>();
const emit = defineEmits<{ close: []; deleted: [] }>();

const edits = computed(() => imageEditsOf(props.asset.meta));
/** Whether the image has any edits. */
const hasEdits = computed(
  () =>
    Boolean(edits.value.crop || edits.value.focalPoint) ||
    edits.value.rotate !== 0 ||
    edits.value.flipHorizontal ||
    edits.value.flipVertical ||
    edits.value.effect !== 'none',
);
const isImage = computed(
  () => props.asset.mimeType.startsWith('image/') && Boolean(props.asset.width),
);
const editing = ref(false);

const spaces = useSpaceStore();
/** Also in another space, so deleting only removes it from this one. */
const shared = computed(() => props.asset.spaceIds.length > 1);
const showSpaces = computed(() => props.canWrite && (spaces.spaces.length > 1 || shared.value));

interface AssetForm {
  name: string;
  alt: string;
  tags: string[];
}

const editor = useDraftForm<AssetForm>();
const form = editor.draft as Ref<AssetForm>;
watch(
  () => props.asset,
  (asset) =>
    editor.load({
      name: asset.name,
      alt: asset.alt ?? '',
      tags: asset.tags.map((tag) => tag.name),
    }),
  { immediate: true },
);

async function save() {
  await editor.submit(async () => {
    await assets.update(props.spaceId, props.asset.id, {
      name: form.value.name,
      alt: form.value.alt || null,
      // Tags are left alone while the feature is off.
      ...(tagsFeature.value.enabled ? { tags: form.value.tags } : {}),
    });
    editor.markSaved();
    toast.success('Asset saved');
  });
}

/** The availability window; outside it the media route stops serving the asset. */
const schedule = computed<ScheduleWindow>(() => ({
  publishAt: props.asset.publishAt,
  unpublishAt: props.asset.unpublishAt,
}));
const scheduled = computed(() => isPending(schedule.value));
/** Saved dates stay clearable while scheduling is off. */
const hasWindow = computed(() => Boolean(props.asset.publishAt || props.asset.unpublishAt));
const savingSchedule = ref(false);
const showSchedule = ref(false);
const scheduleFeature = useFeature('scheduledPublishing');
const tagsFeature = useFeature('tags');

function saveSchedule(window: ScheduleWindow) {
  return saveScheduleWindow(
    (dates) => assets.schedule(props.spaceId, props.asset.id, dates),
    window,
    { busy: savingSchedule, noun: 'Availability' },
  );
}

const copied = ref(false);
async function copyUrl() {
  if (!props.asset.url) return;
  const url = new URL(props.asset.url, window.location.origin).href;
  if (!(await copyText(url, COPIED_URL))) return;
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}

function remove() {
  const others = props.asset.spaceIds.length - 1;
  const name = props.asset.name;
  return confirmAndRun(
    shared.value
      ? {
          title: `Remove ${name} from this space?`,
          message: `It stays in the ${others === 1 ? 'other space' : `${others} other spaces`} that hold it; only this space loses it. Documents here that use it keep a dangling reference.`,
          confirmLabel: 'Remove from this space',
          danger: true,
        }
      : {
          title: `Delete ${name}?`,
          message:
            'The original and every generated variant are removed from storage. Documents that use it keep a dangling reference.',
          confirmLabel: 'Delete asset',
          danger: true,
        },
    async () => {
      const removed = await assets.remove(props.spaceId, props.asset.id, props.asset.spaceIds);
      emit('deleted');
      return removed;
    },
    {
      success: (removed) =>
        removed === 'space' ? `Removed ${name} from this space` : `Deleted ${name}`,
    },
  );
}
</script>

<template>
  <aside
    :class="embedded
      ? 'flex flex-col gap-4'
      : 'mb-card mb-aside-sheet flex shrink-0 flex-col gap-4 self-start overflow-y-auto'"
  >
    <div v-if="!embedded" class="flex items-start gap-2">
      <h2 class="min-w-0 flex-1 truncate text-sm font-bold">{{ asset.name }}</h2>
      <IconButton icon="x" label="Close details" class="-mt-1 -mr-1" @click="emit('close')" />
    </div>

    <div class="flex items-center justify-center overflow-hidden rounded-control bg-surface-100 dark:bg-surface-800">
      <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.alt ?? asset.name" class="max-h-56 w-full object-contain" />
      <div v-else class="flex h-32 flex-col items-center justify-center gap-1 text-surface-500">
        <Icon name="doc" class="h-8 w-8" />
        <span class="font-mono text-xs uppercase">{{ asset.mimeType.split('/')[1] }}</span>
      </div>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt class="text-surface-500">Type</dt>
      <dd class="truncate font-mono">{{ asset.mimeType }}</dd>
      <dt class="text-surface-500">Size</dt>
      <dd>{{ formatBytes(asset.size) }}</dd>
      <template v-if="asset.width">
        <dt class="text-surface-500">Pixels</dt>
        <dd>{{ asset.width }} x {{ asset.height }}</dd>
      </template>
      <template v-if="edits.crop">
        <dt class="text-surface-500">Crop</dt>
        <dd class="tabular-nums">{{ edits.crop.width }} x {{ edits.crop.height }}</dd>
      </template>
      <template v-if="edits.focalPoint">
        <dt class="text-surface-500">Focal point</dt>
        <dd class="tabular-nums">{{ Math.round(edits.focalPoint.x * 100) }}%, {{ Math.round(edits.focalPoint.y * 100) }}%</dd>
      </template>
      <template v-if="edits.rotate || edits.flipHorizontal || edits.flipVertical">
        <dt class="text-surface-500">Orientation</dt>
        <dd class="tabular-nums">
          {{ edits.rotate }}&deg;{{ edits.flipHorizontal ? ' mirrored' : '' }}{{ edits.flipVertical ? ' flipped' : '' }}
        </dd>
      </template>
      <template v-if="edits.effect !== 'none'">
        <dt class="text-surface-500">Effect</dt>
        <dd>{{ edits.effect }}</dd>
      </template>
    </dl>

    <ul v-if="!canWrite && asset.tags.length" class="flex flex-wrap gap-1">
      <li v-for="tag in asset.tags" :key="tag.id" class="mb-badge">{{ tag.name }}</li>
    </ul>

    <button v-if="canWrite && isImage" class="mb-btn-outline w-full justify-center" @click="editing = true">
      <Icon name="crop" class="mb-icon-sm" /> {{ hasEdits ? 'Edit the image' : 'Edit image' }}
    </button>

    <form v-if="canWrite && form" class="space-y-3" @submit.prevent="save">
      <TextField v-model="form.name" label="Name" required />
      <TextField
        v-model="form.alt"
        label="Alt text"
        placeholder="What the image shows"
        hint="Read out by screen readers and used when the image cannot load."
      />
      <FormField v-if="tagsFeature.enabled" label="Tags" hint="Tags also match when searching the library.">
        <template #default="{ id }">
          <TagInput :id="id" v-model="form.tags" />
        </template>
      </FormField>
      <div v-else-if="tagsFeature.locked" class="flex items-center gap-1">
        <span class="mb-label flex-1">Tags</span>
        <FeatureLock feature="tags" :state="tagsFeature" align="end" />
      </div>
      <p v-for="message in editor.otherErrors([])" :key="message" class="mb-error">{{ message }}</p>
      <SaveButton type="submit" class="w-full justify-center" :saving="editor.saving.value" :disabled="!editor.isDirty.value" label="Save changes" />
    </form>

    <section v-if="canWrite && (!scheduleFeature.hidden || hasWindow)" class="space-y-2 border-t border-surface-200 pt-3 dark:border-surface-800">
      <div v-if="!scheduleFeature.enabled" class="flex items-center gap-2 text-xs font-bold">
        <Icon name="clock" class="mb-icon-sm" />
        <span class="flex-1">Availability</span>
        <button v-if="hasWindow" type="button" class="mb-btn-ghost" :disabled="savingSchedule" @click="saveSchedule({ publishAt: null, unpublishAt: null })">
          Clear
        </button>
        <FeatureLock v-if="scheduleFeature.locked" feature="scheduledPublishing" :state="scheduleFeature" align="end" />
      </div>
      <button
        v-else
        class="flex w-full items-center gap-2 text-left text-xs font-bold"
        :aria-expanded="showSchedule"
        @click="showSchedule = !showSchedule"
      >
        <Icon name="clock" class="mb-icon-sm" />
        <span class="flex-1">Availability</span>
        <span v-if="scheduled" class="mb-badge">scheduled</span>
        <span v-else class="text-surface-500">always</span>
      </button>
      <p v-if="asset.publishAt" class="mb-hint">Available from {{ formatDateTime(asset.publishAt) }}.</p>
      <p v-if="asset.unpublishAt" class="mb-hint">Unavailable from {{ formatDateTime(asset.unpublishAt) }}.</p>
      <ScheduleFields
        v-if="showSchedule && scheduleFeature.enabled"
        id-prefix="asset-schedule"
        :window="schedule"
        :saving="savingSchedule"
        publish-hint="The public site serves this file from this time. Leave empty for straight away."
        unpublish-hint="It stops being served at this time, whoever links to it. Leave empty to stay available."
        @save="saveSchedule"
      />
    </section>

    <AssetSpaces v-if="showSpaces" :asset="asset" :space-id="spaceId" @left="emit('deleted')" />

    <div class="grid grid-cols-2 gap-2">
      <button class="mb-btn-outline" @click="copyUrl">
        <Icon :name="copied ? 'check' : 'globe'" class="mb-icon-sm" /> {{ copied ? 'Copied' : 'Copy URL' }}
      </button>
      <a :href="asset.url ?? '#'" target="_blank" rel="noreferrer" class="mb-btn-outline">
        <Icon name="external" class="mb-icon-sm" /> Open
      </a>
    </div>
    <button v-if="canDelete" class="mb-btn-ghost-danger w-full justify-center" @click="remove">
      <Icon name="trash" /> {{ shared ? 'Remove from this space' : 'Delete asset' }}
    </button>

    <ImageEditor v-if="editing" :space-id="spaceId" :asset="asset" @close="editing = false" />
  </aside>
</template>
