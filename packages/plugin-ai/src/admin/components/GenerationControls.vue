<script setup lang="ts">
import {
  Accordion,
  Checkbox,
  FormField,
  NumberField,
  Select,
  TextField,
} from '@manablox/admin-sdk';
import type { AiProviderRef } from '../../sdk';
import { type GenerationOptions, optionsFor } from '../useGenerationOptions';
import AiProviderSelect from './AiProviderSelect.vue';

/** The generate dialog's provider, model, length and style pickers, and its document controls. */
defineProps<{
  spaceId: string;
  capability: 'text' | 'image' | 'video' | 'document';
  providerKinds: AiProviderRef[];
  /** From `useGenerationOptions`; edited in place. */
  options: GenerationOptions;
}>();
</script>

<template>
  <div v-if="providerKinds.length > 1 || options.modelOptions.length > 1" class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
    <AiProviderSelect v-model="options.kind" :space-id="spaceId" :refs="providerKinds" hint="" />
    <TextField
      v-if="options.isCustom"
      v-model="options.model"
      label="Model"
      class="mb-input-mono"
      :placeholder="options.cardModel"
      hint="Any model the server has; the space keeps its own."
    />
    <FormField v-else-if="options.modelOptions.length > 1" label="Model" hint="Just for this generation; the space keeps its own." v-slot="{ id }">
      <Select :id="id" v-model="options.model" :options="options.modelOptions" />
    </FormField>
  </div>

  <div v-if="options.pickerGroups.length || options.sizesText" class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
    <FormField v-if="options.sizesText" label="Length" v-slot="{ id }">
      <Select :id="id" :model-value="options.styles.length ?? ''" :options="options.lengthOptions" @update:model-value="options.setStyle('length', $event)" />
    </FormField>
    <div v-if="options.sizesText && options.styles.length === 'custom'" class="ai:grid ai:grid-cols-2 ai:gap-2">
      <NumberField
        v-model="options.customWords"
        label="Words"
        nullable
        :min="1"
        :max="20000"
        :placeholder="capability === 'document' ? '1200' : '80'"
      />
      <NumberField
        v-if="capability === 'document'"
        v-model="options.customBlocks"
        label="Blocks"
        nullable
        :min="1"
        :max="60"
        placeholder="auto"
      />
    </div>
    <FormField v-for="group in options.pickerGroups" :key="group.id" :label="group.label" v-slot="{ id }">
      <Select :id="id" :model-value="options.styles[group.id] ?? ''" :options="optionsFor(group)" @update:model-value="options.setStyle(group.id, $event)" />
    </FormField>
  </div>

  <Accordion
    v-if="capability === 'document'"
    :items="[{ value: 'more', label: 'More controls', hint: 'Blocks, pictures, audience, keywords' }]"
  >
    <div class="ai:space-y-3">
      <fieldset v-if="options.blockChoices.length > 1">
        <legend class="mb-label">Blocks it may use</legend>
        <div class="ai:flex ai:flex-wrap ai:gap-x-4 ai:gap-y-1.5">
          <Checkbox
            v-for="choice in options.blockChoices"
            :key="choice.id"
            :model-value="options.allowedBlocks.includes(choice.id)"
            @update:model-value="options.toggleBlock(choice.id, $event)"
          >
            {{ choice.label }}
          </Checkbox>
        </div>
        <p class="mb-hint">Leaving every one ticked lets the model choose.</p>
      </fieldset>
      <Checkbox v-model="options.includeImages">Describe pictures for the image fields</Checkbox>
      <div class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
        <TextField v-model="options.audience" label="Audience" maxlength="500" placeholder="First-time buyers, not experts" />
        <TextField
          v-model="options.keywords"
          label="Keywords"
          placeholder="solar panels, subsidy, installation"
          hint="Comma-separated, the most important first."
        />
      </div>
    </div>
  </Accordion>
</template>
