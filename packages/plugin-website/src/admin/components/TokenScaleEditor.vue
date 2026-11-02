<script setup lang="ts">
import { Icon, IconButton } from '@manablox/admin-sdk';
import { isSize } from '@manablox/site';
import { ref } from 'vue';
import { freeName, renameKey, tokenNameIssue, withoutKey } from '../model/theme';

/**
 * Named tokens of one group (spacing, radius, shadows, widths): rename, change, add and
 * remove. Designs refer to tokens by name, so a rename leaves them pointing nowhere.
 */
const props = withDefaults(
  defineProps<{
    tokens: Record<string, string>;
    /** `size`: a length with a unit; `shadow`: a box-shadow. */
    kind?: 'size' | 'shadow';
    label: string;
    addLabel?: string;
    /** Names that cannot be renamed or removed, such as the default container. */
    locked?: readonly string[];
    readOnly?: boolean;
  }>(),
  { kind: 'size', addLabel: 'Add', locked: () => [], readOnly: false },
);
const emit = defineEmits<{ update: [tokens: Record<string, string>, group?: string] }>();

const errors = ref<Record<string, string>>({});
const SHADOW = /^[a-zA-Z0-9#.,()%\s/-]{1,200}$/;
const valid = (value: string) => (props.kind === 'shadow' ? SHADOW.test(value) : isSize(value));

function setValue(name: string, event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (!valid(value)) {
    errors.value = {
      ...errors.value,
      [name]:
        props.kind === 'shadow'
          ? 'Use a CSS box-shadow value.'
          : 'Use a number with a unit, like 1.5rem.',
    };
    return;
  }
  errors.value = { ...errors.value, [name]: '' };
  emit('update', { ...props.tokens, [name]: value }, `value:${name}`);
}

function rename(from: string, event: Event) {
  const to = (event.target as HTMLInputElement).value.trim();
  if (to === from) return;
  const issue = tokenNameIssue(
    to,
    Object.keys(props.tokens).filter((name) => name !== from),
  );
  errors.value = { ...errors.value, [from]: issue ?? '' };
  if (!issue) emit('update', renameKey(props.tokens, from, to));
}

function add() {
  const names = Object.keys(props.tokens);
  const last = names.at(-1);
  const name = freeName(props.kind === 'shadow' ? 'shadow' : 'new', names);
  emit('update', {
    ...props.tokens,
    [name]:
      (last && props.tokens[last]) ||
      (props.kind === 'shadow' ? '0 1px 2px rgb(0 0 0 / 0.1)' : '1rem'),
  });
}
</script>

<template>
  <div class="ws:space-y-2">
    <div class="ws:flex ws:items-center ws:gap-2">
      <h4 class="ws:flex-1 ws:text-xs ws:font-bold">{{ label }}</h4>
      <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" @click="add">
        <Icon name="plus" class="mb-icon-sm" /> {{ addLabel }}
      </button>
    </div>
    <div v-for="(value, name) in tokens" :key="name" class="ws:space-y-0.5">
      <div class="ws:grid ws:grid-cols-[6rem_minmax(0,1fr)_auto] ws:items-center ws:gap-2">
        <input
          class="mb-input mb-input-mono mb-input-sm"
          :value="name"
          :aria-label="`${label}: name of ${name}`"
          :disabled="readOnly || locked.includes(name)"
          spellcheck="false"
          @change="rename(name, $event)"
        />
        <input
          class="mb-input mb-input-mono mb-input-sm"
          :class="errors[name] ? 'mb-invalid' : ''"
          :value="value"
          :aria-label="`${label}: ${name}`"
          :disabled="readOnly"
          spellcheck="false"
          @change="setValue(name, $event)"
        />
        <IconButton
          v-if="!readOnly"
          icon="trash"
          :label="`Remove ${name}`"
          danger
          :disabled="locked.includes(name)"
          @click="emit('update', withoutKey(tokens, name))"
        />
      </div>
      <p v-if="errors[name]" class="mb-error">{{ errors[name] }}</p>
    </div>
  </div>
</template>
