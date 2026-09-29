<script setup lang="ts">
import { CREDENTIAL_KIND_SPECS } from '@manablox/core';
import { computed, ref } from 'vue';
import Icon from '../../../components/Icon.vue';
import FormField from '../../../components/ui/FormField.vue';
import Select, { type SelectOption } from '../../../components/ui/Select.vue';
import { type CredentialKind, useCredentials } from '../queries';
import CredentialDialog from './CredentialDialog.vue';

/** Picks a credential of the given kinds, or adds one, which is then picked. */
const model = defineModel<string | null>({ required: true });
const props = withDefaults(
  defineProps<{
    kinds: CredentialKind[];
    spaceId: string | null;
    label?: string;
    /** Offers "None" first. */
    optional?: boolean;
    readOnly?: boolean;
    error?: string | null | undefined;
    hint?: string;
  }>(),
  {
    label: 'Credential',
    optional: false,
    readOnly: false,
    error: null,
    hint: 'Stored encrypted; never shown again and never written to a run log.',
  },
);

const { data: credentials } = useCredentials(() => props.spaceId);
const adding = ref(false);

const matching = computed(() =>
  (credentials.value ?? []).filter((credential) => props.kinds.includes(credential.kind)),
);

const options = computed((): SelectOption<string | null>[] => [
  ...(props.optional ? [{ value: null, label: 'None' }] : []),
  ...matching.value.map((credential) => ({
    value: credential.id,
    label: credential.name,
    hint: credential.hint ? `...${credential.hint}` : CREDENTIAL_KIND_SPECS[credential.kind].label,
  })),
]);
</script>

<template>
  <FormField :label="label" :error="error" v-slot="{ id }">
    <div class="flex gap-2">
      <Select
        :id="id"
        v-model="model"
        :options="options"
        class="flex-1"
        placeholder="Choose a credential"
        :disabled="readOnly"
      />
      <button v-if="!readOnly" type="button" class="mb-btn-ghost shrink-0" @click="adding = true">
        <Icon name="plus" /> Add
      </button>
    </div>
    <p v-if="!matching.length" class="mb-hint">
      None of this kind yet. Add one - it is stored encrypted and never comes back to this browser.
    </p>
    <p v-else class="mb-hint">{{ hint }}</p>
  </FormField>

  <CredentialDialog
    v-if="adding && spaceId"
    :space-id="spaceId"
    :credential="null"
    :kinds="kinds"
    @saved="model = $event.id"
    @close="adding = false"
  />
</template>
