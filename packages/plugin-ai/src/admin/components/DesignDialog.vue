<script setup lang="ts">
import { Dialog, TextareaField } from '@manablox/admin-sdk';
import type { AiDesignDialogProps } from '../admin-api';
import { useWand } from '../useWand';
import AiProviderSelect from './AiProviderSelect.vue';
import DesignButton from './DesignButton.vue';

/**
 * The frame of every "describe it" dialog: provider, prompt, the design button and the run's
 * error. The caller adds its own fields (`options` above the prompt, `form` below), the
 * answer (`result`) and what to do with it (`primary`).
 */
const props = withDefaults(defineProps<AiDesignDialogProps>(), {
  hint: undefined,
  promptClass: 'ai:min-h-28',
  width: 'max-w-3xl',
  blocked: null,
});
const emit = defineEmits<{ close: [] }>();
defineSlots<{
  options?: () => unknown;
  form?: () => unknown;
  result?: () => unknown;
  primary?: () => unknown;
}>();

const wand = useWand('text');
const run = props.run;
</script>

<template>
  <Dialog :title="title" :width="width" @close="emit('close')">
    <div class="ai:space-y-4">
      <p v-if="!wand.enabled.value" class="mb-callout" role="status">
        This space has no provider that writes text. Set one up under Settings > AI.
      </p>
      <p v-else-if="blocked" class="mb-callout" role="status">{{ blocked }}</p>
      <template v-else>
        <slot name="options" />
        <AiProviderSelect v-model="run.provider.value" :space-id="spaceId" :refs="wand.kinds.value" />
        <TextareaField
          v-model="run.prompt.value"
          :label="label"
          :class="promptClass"
          :placeholder="placeholder"
          :hint="hint"
          maxlength="12000"
          autofocus
          @keydown.meta.enter="run.run()"
          @keydown.ctrl.enter="run.run()"
        />
        <slot name="form" />
      </template>

      <p v-if="run.note.value" class="mb-callout" role="status">{{ run.note.value }}</p>

      <slot name="result" />
    </div>

    <template #footer="{ close }">
      <button type="button" class="mb-btn-ghost" @click="close">{{ run.result.value ? 'Discard' : 'Cancel' }}</button>
      <DesignButton
        :busy="run.busy.value"
        :label="run.result.value ? 'Again' : 'Design'"
        :disabled="!run.ready.value || !wand.enabled.value || Boolean(blocked)"
        @click="run.run()"
      />
      <slot name="primary" />
    </template>
  </Dialog>
</template>
