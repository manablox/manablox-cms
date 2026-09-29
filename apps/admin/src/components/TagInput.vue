<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { useTags } from '@manablox/admin-sdk/features/tags/queries';
import { computed, ref } from 'vue';

/** Tag names on a document or an asset; typing a new one creates it on save. */
const model = defineModel<string[]>({ required: true });

const props = withDefaults(
  defineProps<{
    id?: string | undefined;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { disabled: false, placeholder: 'Add a tag...' },
);

/** Longest name the server stores. */
const NAME_MAX = 64;

const query = ref('');
const focused = ref(false);
/** Set by the down arrow, so the whole vocabulary can be browsed without typing. */
const browsing = ref(false);
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);

const { data: vocabulary } = useTags();

const chosen = computed(() => new Set(model.value.map((name) => name.toLowerCase())));

/** Tags of the space that match what is typed and are not on the document yet. */
const suggestions = computed(() => {
  const term = query.value.trim().toLowerCase();
  return (vocabulary.value ?? [])
    .filter((tag) => !chosen.value.has(tag.name.toLowerCase()))
    .filter((tag) => !term || tag.name.toLowerCase().includes(term))
    .slice(0, 8);
});

/** What Enter would create: the typed name, unless a tag already spells it. */
const fresh = computed(() => {
  const name = query.value.trim().slice(0, NAME_MAX);
  if (!name || chosen.value.has(name.toLowerCase())) return null;
  const known = (vocabulary.value ?? []).some(
    (tag) => tag.name.toLowerCase() === name.toLowerCase(),
  );
  return known ? null : name;
});

/** Only while there is something to narrow by, or the arrow keys asked for the list. */
const open = computed(
  () =>
    focused.value &&
    !props.disabled &&
    (query.value.trim().length > 0 || browsing.value) &&
    (suggestions.value.length > 0 || fresh.value !== null),
);

/** Suggestions first, then the new name; the arrow keys walk this list. */
const options = computed(() => [
  ...suggestions.value.map((tag) => tag.name),
  ...(fresh.value ? [fresh.value] : []),
]);

function add(name: string) {
  const trimmed = name.trim().slice(0, NAME_MAX);
  if (!trimmed || chosen.value.has(trimmed.toLowerCase())) return;
  model.value = [...model.value, trimmed];
  query.value = '';
  active.value = 0;
  browsing.value = false;
}

function remove(name: string) {
  model.value = model.value.filter((entry) => entry !== name);
}

function commit() {
  const picked = options.value[active.value] ?? options.value[0];
  if (picked) add(picked);
}

function onBlur() {
  focused.value = false;
  browsing.value = false;
}

/** A typed comma ends a tag, as chip inputs do. */
function onInput() {
  if (!query.value.includes(',')) return;
  const [first] = query.value.split(',');
  query.value = first ?? '';
  commit();
}

/** Backspace on an empty box takes the last tag off, as chip inputs do. */
function backspace() {
  if (query.value || model.value.length === 0) return;
  model.value = model.value.slice(0, -1);
}

function move(delta: number) {
  browsing.value = true;
  const count = options.value.length;
  if (count === 0) return;
  active.value = (active.value + delta + count) % count;
}
</script>

<template>
  <div class="min-w-0">
    <ul v-if="model.length" class="mb-2 flex flex-wrap gap-1">
      <li v-for="name in model" :key="name" class="mb-badge mb-badge-brand max-w-full">
        <span class="min-w-0 truncate">{{ name }}</span>
        <button
          v-if="!disabled"
          type="button"
          class="text-brand-700 hover:text-danger-600 dark:text-brand-100"
          :aria-label="`Remove ${name}`"
          @click="remove(name)"
        >
          <Icon name="x" class="mb-icon-sm" />
        </button>
      </li>
    </ul>

    <div class="relative min-w-0">
      <input
        :id="props.id"
        ref="input"
        v-model="query"
        type="text"
        class="mb-input"
        aria-label="Add a tag"
        autocomplete="off"
        :disabled="disabled"
        :placeholder="placeholder"
        :maxlength="NAME_MAX"
        @focus="focused = true"
        @blur="onBlur"
        @input="onInput"
        @keydown.enter.prevent="commit"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.esc="browsing = false"
        @keydown.delete="backspace"
      />

      <ul
        v-if="open"
        class="mb-popover absolute inset-x-0 top-full mt-1 max-h-52 overflow-y-auto p-1 text-sm mb-z-popover"
      >
        <li v-for="(name, index) in options" :key="name">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left"
            :class="index === active ? 'bg-surface-100 dark:bg-surface-800' : ''"
            @mousedown.prevent="add(name)"
            @mouseenter="active = index"
          >
            <Icon :name="name === fresh ? 'plus' : 'tag'" class="mb-icon-sm text-surface-500" />
            <span class="min-w-0 truncate">{{ name }}</span>
            <span v-if="name === fresh" class="ml-auto text-2xs text-surface-500">new</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
