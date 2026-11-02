<script setup lang="ts">
import { FormField, Select } from '@manablox/admin-sdk';
import type { SpaceRef, ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import TokenPicker from './TokenPicker.vue';
import TokenScaleEditor from './TokenScaleEditor.vue';

/** Spacing, corner radius, shadows and container widths. */
const props = defineProps<{ theme: ThemeDesign; readOnly?: boolean }>();
const emit = defineEmits<{ update: [theme: ThemeDesign, group?: string] }>();

const widthOptions = computed(() =>
  Object.entries(props.theme.container.widths).map(([name, value]) => ({
    value: name,
    label: name,
    hint: value,
  })),
);

function set<K extends 'space' | 'radius' | 'shadow'>(
  key: K,
  value: Record<string, string>,
  group?: string,
) {
  emit('update', { ...props.theme, [key]: value }, group && `${key}:${group}`);
}

function setContainer(patch: Partial<ThemeDesign['container']>, group?: string) {
  emit('update', { ...props.theme, container: { ...props.theme.container, ...patch } }, group);
}
</script>

<template>
  <div class="ws:space-y-6">
    <section class="ws:space-y-2">
      <TokenScaleEditor :tokens="theme.space" label="Spacing" add-label="Add step" :read-only="readOnly" @update="(value, group) => set('space', value, group)" />
      <p class="ws:text-2xs ws:text-surface-500">Padding, margins and gaps pick from these steps.</p>
    </section>
    <TokenScaleEditor :tokens="theme.radius" label="Corner radius" :read-only="readOnly" @update="(value, group) => set('radius', value, group)" />
    <TokenScaleEditor :tokens="theme.shadow" kind="shadow" label="Shadows" :read-only="readOnly" @update="(value, group) => set('shadow', value, group)" />

    <section class="ws:space-y-3">
      <TokenScaleEditor
        :tokens="theme.container.widths"
        label="Container widths"
        :locked="[theme.container.default]"
        :read-only="readOnly"
        @update="(widths, group) => setContainer({ widths }, group && `container:${group}`)"
      />
      <div class="ws:grid ws:grid-cols-2 ws:gap-3">
        <FormField label="Default width" hint="Sections use it unless they pick one.">
          <template #default="{ id }">
            <Select
              :id="id"
              :model-value="theme.container.default"
              :options="widthOptions"
              :disabled="readOnly"
              @update:model-value="setContainer({ default: $event })"
            />
          </template>
        </FormField>
        <FormField label="Side padding" hint="Space between content and the screen edge.">
          <template #default="{ id }">
            <TokenPicker
              :id="id"
              :model-value="theme.container.gutter"
              group="space"
              :theme="theme"
              :disabled="readOnly"
              @update:model-value="$event && setContainer({ gutter: $event as SpaceRef })"
            />
          </template>
        </FormField>
      </div>
    </section>
  </div>
</template>
