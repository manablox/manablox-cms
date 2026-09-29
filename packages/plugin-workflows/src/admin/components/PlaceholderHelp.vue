<script setup lang="ts">
import { copyText, Icon, Popover, toast } from '@manablox/admin-sdk';
import { ref } from 'vue';
import type { PlaceholderHint } from '../model';

/** A popover of available placeholders; clicking one copies it. */
defineProps<{ hints: PlaceholderHint[] }>();

const open = ref(false);
// Constants because a literal `{{` breaks template expressions.
const BRACES = '{{ ... }}';
const EXAMPLE = '{{ path }}';
const OPEN = '{{';

async function copy(path: string) {
  const text = `{{ ${path} }}`;
  await copyText(text, { success: `Copied ${text}` });
}
</script>

<template>
  <Popover v-model:open="open" align="end" class="wf:w-80 wf:p-2">
    <template #trigger>
      <button type="button" class="mb-btn-ghost mb-btn-sm wf:-my-1 wf:font-mono" title="Placeholders you can use">
        <Icon name="braces" class="mb-icon-sm" /> {{ BRACES }}
      </button>
    </template>
    <div>
      <p class="wf:px-1.5 wf:pb-1.5 wf:text-2xs wf:text-surface-500">
        Write <span class="wf:font-mono">{{ EXAMPLE }}</span> anywhere in a text; typing <span class="wf:font-mono">{{ OPEN }}</span> suggests them as you go. Click one to copy it.
      </p>
      <ul class="wf:max-h-72 wf:overflow-auto">
        <li v-for="hint in hints" :key="hint.path">
          <button type="button" class="mb-menu-item wf:flex wf:items-baseline wf:gap-2" @click="copy(hint.path)">
            <span class="wf:shrink-0 wf:font-mono wf:text-xs">{{ hint.path }}</span>
            <span class="wf:min-w-0 wf:flex-1 wf:truncate wf:text-2xs wf:text-surface-500">{{ hint.hint }}</span>
          </button>
        </li>
      </ul>
    </div>
  </Popover>
</template>
