<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { computed } from 'vue';
import SortableList from '~/components/SortableList.vue';
import { useRelationValue } from '~/composables/useRelationValue';
import { useMembers } from '~/features/spaces/queries';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string | string[] | null] }>();

const context = useFieldContext();

const { data: members } = useMembers(() => context.value.spaceId);

const relation = useRelationValue(
  () => props.modelValue,
  () => props.settings.multiple === true,
);
const { ids, multiple } = relation;

const options = computed(() =>
  (members.value ?? []).map((member) => ({
    value: member.userId,
    label: member.user.name || member.user.email,
    hint: member.user.name ? member.user.email : undefined,
  })),
);
const optionById = computed(() => new Map(options.value.map((option) => [option.value, option])));

const value = computed({
  get: () => ids.value[0] ?? null,
  set: (next: string | null) => emit('update:modelValue', next),
});

/** Always empty; choosing a person adds them to the list. */
const adding = computed({
  get: () => null as string | null,
  set: (next: string | null) => {
    if (next) emit('update:modelValue', relation.pick(next));
  },
});
const addable = computed(() => options.value.filter((option) => !ids.value.includes(option.value)));
</script>

<template>
  <div v-if="multiple" class="space-y-2">
    <SortableList
      v-if="ids.length"
      :items="ids"
      :key-of="(id) => id"
      :read-only="context.readOnly"
      @move="(from, to) => emit('update:modelValue', relation.move(from, to))"
    >
      <template #default="{ item: id }">
        <Icon name="user" class="mb-icon-sm shrink-0 text-surface-400" />
        <span class="flex-1 truncate">{{ optionById.get(id)?.label ?? 'Former member' }}</span>
        <span v-if="optionById.get(id)?.hint" class="truncate mb-meta">{{ optionById.get(id)!.hint }}</span>
      </template>
      <template #actions="{ item: id }">
        <button v-if="!context.readOnly" type="button" aria-label="Remove" @click="emit('update:modelValue', relation.remove(id))"><Icon name="x" class="mb-icon-sm" /></button>
      </template>
    </SortableList>
    <p v-else-if="context.readOnly" class="mb-hint">Nobody.</p>

    <Select
      v-if="!context.readOnly"
      :id="id"
      v-model="adding"
      placeholder="Add a person..."
      :disabled="!addable.length"
      :options="addable"
    />
  </div>

  <Select
    v-else
    :id="id"
    v-model="value"
    placeholder="Nobody"
    :disabled="context.readOnly"
    :options="[{ value: null, label: 'Nobody' }, ...options]"
  />
</template>
