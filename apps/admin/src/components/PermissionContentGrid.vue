<script setup lang="ts">
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import { computed } from 'vue';

/** Content grants as a grid: actions across, types down, with the broad row on top. */
const props = defineProps<{
  grants: ReadonlySet<string>;
  readOnly: boolean;
  types: Array<{ id: string; label: string; name: string; hint?: string | undefined }>;
  actions: readonly string[];
  /** Column heading of an action. */
  actionLabel: (action: string) => string;
  note?: string | undefined;
}>();
const emit = defineEmits<{ set: [grant: string, on: boolean] }>();

const has = (grant: string) => props.grants.has(grant);

/** A grant for one type, or the broad one that implies it. */
function typeState(action: string, typeId: string): { on: boolean; implied: boolean } {
  if (has(`content:${action}`)) return { on: true, implied: true };
  return { on: has(`content:${action}:${typeId}`), implied: false };
}

/** Grants for unlisted types, kept visible and removable. */
const strayTypeGrants = computed(() => {
  const known = new Set(props.types.map((type) => type.id));
  return [...props.grants].filter((grant) => {
    const parts = grant.split(':');
    return parts.length === 3 && parts[0] === 'content' && !known.has(parts[2] as string);
  });
});
</script>

<template>
  <div class="overflow-x-auto">
    <table class="mb-table">
      <thead>
        <tr>
          <th class="mb-th pr-3">Content type</th>
          <th v-for="action in actions" :key="action" class="mb-th px-3 text-center">{{ actionLabel(action) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr class="mb-tr font-medium">
          <td class="mb-td pr-3">
            All content types
            <span class="block text-xs font-normal text-surface-500">Every type there is now or later.</span>
          </td>
          <td v-for="action in actions" :key="action" class="mb-td px-3 text-center">
            <Checkbox
              :model-value="has(`content:${action}`)"
              :disabled="readOnly"
              :aria-label="`${action} all content types`"
              @update:model-value="emit('set', `content:${action}`, $event)"
            />
          </td>
        </tr>
        <tr v-for="type in types" :key="type.id" class="mb-tr">
          <td class="mb-td pr-3">
            {{ type.label }}
            <span class="block font-mono text-2xs text-surface-500">
              {{ type.name }}<template v-if="type.hint"> - {{ type.hint }}</template>
            </span>
          </td>
          <td v-for="action in actions" :key="action" class="mb-td px-3 text-center">
            <Checkbox
              :model-value="typeState(action, type.id).on"
              :disabled="readOnly || typeState(action, type.id).implied"
              :aria-label="`${action} ${type.label}${type.hint ? ` in ${type.hint}` : ''}`"
              @update:model-value="emit('set', `content:${action}:${type.id}`, $event)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-if="note" class="mb-hint mt-2">{{ note }}</p>
  <ul v-if="strayTypeGrants.length" class="mt-2 space-y-1 mb-meta">
    <li v-for="grant in strayTypeGrants" :key="grant" class="flex items-center gap-2">
      <code class="font-mono">{{ grant }}</code> names a type that is not listed here.
      <button v-if="!readOnly" type="button" class="underline" @click="emit('set', grant, false)">Remove</button>
    </li>
  </ul>
</template>
