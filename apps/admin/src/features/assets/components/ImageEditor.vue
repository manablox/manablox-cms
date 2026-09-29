<script setup lang="ts">
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import { assets, imageEditsOf } from '@manablox/admin-sdk/features/assets/queries';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { ref } from 'vue';
import { useImageEdits } from '../useImageEdits';
import ImageColourPanel from './ImageColourPanel.vue';
import ImageCropPanel from './ImageCropPanel.vue';
import ImageFocalPanel from './ImageFocalPanel.vue';
import ImageOrientationPanel from './ImageOrientationPanel.vue';
import ImagePreviews from './ImagePreviews.vue';
import ImageStage from './ImageStage.vue';

/**
 * Non-destructive image edits. Crop, focal point and colour are separate modes so a drag
 * and a click never compete for the pointer. Previews use the server's maths.
 */
const props = defineProps<{
  spaceId: string;
  asset: {
    id: string;
    name: string;
    url: string | null;
    width: number | null;
    height: number | null;
    meta: Record<string, unknown>;
  };
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

const {
  rotate,
  adjust,
  effect,
  natural,
  crop,
  focal,
  hasFocal,
  RATIOS,
  ratioId,
  ratio,
  turn,
  mirroredHorizontally,
  mirroredVertically,
  mirror,
  isWholeImage,
  applyRatio,
  resetCrop,
  resetFocal,
  imageStyle,
  edits,
} = useImageEdits(
  { width: props.asset.width ?? 1, height: props.asset.height ?? 1 },
  imageEditsOf(props.asset.meta),
);

const MODES = [
  { value: 'crop', label: 'Crop' },
  { value: 'focal', label: 'Focal point' },
  { value: 'colour', label: 'Colour' },
];
const mode = ref<'crop' | 'focal' | 'colour'>('crop');

const saving = ref(false);
function save() {
  return runWrite(
    async () => {
      await assets.setImageEdits(props.spaceId, props.asset.id, edits());
      emit('saved');
      emit('close');
    },
    { success: 'Image edits saved - variants re-render on next view', busy: saving },
  );
}

const HINTS: Record<string, string> = {
  crop: 'Drag the frame or its handles. Turning the image starts the crop over.',
  focal: 'Click where the subject is. A variant that has to trim keeps this point.',
  colour: 'What you see is what every rendition will be rendered with.',
};
</script>

<template>
  <Dialog :title="`Edit ${asset.name}`" width="max-w-4xl" @close="emit('close')">
    <div class="grid gap-4 lg:grid-cols-[1fr_15rem]">
      <!-- The turned picture at fit-to-width, crop drawn over it. -->
      <div class="select-none">
        <SegmentedControl
          :model-value="mode"
          :options="MODES"
          :columns="3"
          class="mb-3"
          aria-label="What to edit"
          @update:model-value="mode = $event as typeof mode"
        />

        <ImageStage
          v-model:crop="crop"
          v-model:focal="focal"
          v-model:has-focal="hasFocal"
          :url="asset.url"
          :name="asset.name"
          :mode="mode"
          :natural="natural"
          :ratio="ratio"
          :image-style="imageStyle"
        />

        <p class="mt-2 text-center mb-meta">{{ HINTS[mode] }}</p>
      </div>

      <div class="space-y-4 text-sm">
        <!-- Orientation is shown in every mode. -->
        <ImageOrientationPanel
          :rotate="rotate"
          :mirrored-horizontally="mirroredHorizontally"
          :mirrored-vertically="mirroredVertically"
          @turn="turn"
          @mirror="mirror"
        />

        <ImageCropPanel
          v-if="mode === 'crop'"
          v-model:ratio-id="ratioId"
          :ratios="RATIOS"
          :crop="crop"
          :is-whole-image="isWholeImage"
          @ratio="applyRatio"
          @reset="resetCrop"
        />

        <ImageFocalPanel v-else-if="mode === 'focal'" :focal="focal" :has-focal="hasFocal" @reset="resetFocal" />

        <ImageColourPanel v-else v-model:adjust="adjust" v-model:effect="effect" />

        <ImagePreviews
          :url="asset.url"
          :crop="crop"
          :focal="focal"
          :has-focal="hasFocal"
          :natural="natural"
          :image-style="imageStyle"
        />
      </div>
    </div>

    <template #footer="{ close }">
      <button type="button" class="mb-btn-ghost" @click="close">Cancel</button>
      <SaveButton :saving="saving" label="Save edits" @click="save" />
    </template>
  </Dialog>
</template>
