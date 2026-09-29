<script setup lang="ts">
import { COPIED_URL, copyText } from '../../lib/clipboard';
import Icon from '../Icon.vue';
import FormField from './FormField.vue';

/**
 * A value to hand on, with a Copy button: a read-only mono input, with `inline` a line of
 * text and an icon button (e.g. in a list of values), with `multiline` a wrapped block for a
 * longer text such as a prompt. Attributes land on the input.
 */
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    value: string;
    label?: string | undefined;
    hint?: string | undefined;
    /** A URL: the toast says so. */
    url?: boolean;
    inline?: boolean;
    multiline?: boolean;
  }>(),
  { label: undefined, hint: undefined, url: false, inline: false, multiline: false },
);

const copy = () => copyText(props.value, props.url ? COPIED_URL : {});
const copyLabel = () => `Copy ${props.label ?? (props.url ? 'the URL' : 'the value')}`;
</script>

<template>
  <div v-if="inline" class="flex min-w-0 items-center gap-2">
    <span v-if="label" class="mb-meta w-28 shrink-0">{{ label }}</span>
    <code class="min-w-0 flex-1 truncate font-mono text-xs" v-bind="$attrs">{{ value }}</code>
    <button type="button" class="mb-btn-ghost mb-btn-icon mb-btn-sm shrink-0" :aria-label="copyLabel()" title="Copy" @click="copy">
      <Icon name="copy" class="mb-icon-sm" />
    </button>
  </div>
  <FormField v-else-if="multiline" :label="label" :hint="hint">
    <div class="flex items-start gap-2">
      <p class="mb-callout flex-1 font-mono text-xs" v-bind="$attrs">{{ value }}</p>
      <button type="button" class="mb-btn-outline shrink-0" :aria-label="copyLabel()" @click="copy">
        <Icon name="copy" /> Copy
      </button>
    </div>
  </FormField>
  <FormField v-else :label="label" :hint="hint" v-slot="{ id }">
    <div class="flex items-center gap-1.5">
      <input :id="id" :value="value" readonly class="mb-input mb-input-mono min-w-0 flex-1" v-bind="$attrs" @focus="($event.target as HTMLInputElement).select()" />
      <button type="button" class="mb-btn-ghost shrink-0" :aria-label="copyLabel()" @click="copy">
        <Icon name="copy" /> Copy
      </button>
    </div>
  </FormField>
</template>
