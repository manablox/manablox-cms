<script setup lang="ts">
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed } from 'vue';
import { useRoles } from '~/features/roles/queries';

/** A select over one space's roles; custom ones only while `customRoles` is on there. */
const props = defineProps<{
  spaceId: string;
  id?: string | undefined;
  disabled?: boolean | undefined;
  variant?: 'default' | 'sm';
}>();
const model = defineModel<string>({ required: true });

const { data: list } = useRoles(() => props.spaceId);
const session = useSessionStore();

const options = computed(() => {
  const custom = session.feature('customRoles', props.spaceId).enabled;
  const offered = (list.value ?? []).filter(
    (role) => role.builtIn || custom || role.machineName === model.value,
  );
  const known = offered.map((role) => ({
    value: role.machineName,
    label: role.name,
    hint: role.builtIn ? undefined : role.machineName,
  }));
  // Show an unlisted current role by name.
  if (model.value && !known.some((option) => option.value === model.value)) {
    known.push({ value: model.value, label: model.value, hint: undefined });
  }
  return known;
});
</script>

<template>
  <Select
    :id="id"
    v-model="model"
    :options="options"
    :disabled="disabled"
    :variant="variant ?? 'default'"
  />
</template>
