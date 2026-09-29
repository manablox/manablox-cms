import type { AdminFieldComponents } from '@manablox/admin-plugin';
import { type Component, defineAsyncComponent } from 'vue';

/** Maps field type `admin.input` / `admin.settings` keys to components; plugins add more. */
const inputs: Record<string, Component> = {
  string: defineAsyncComponent(() => import('~/components/fields/StringField.vue')),
  richtext: defineAsyncComponent(() => import('~/components/fields/RichTextField.vue')),
  number: defineAsyncComponent(() => import('~/components/fields/NumberField.vue')),
  boolean: defineAsyncComponent(() => import('~/components/fields/BooleanField.vue')),
  date: defineAsyncComponent(() => import('~/components/fields/DateField.vue')),
  select: defineAsyncComponent(() => import('~/components/fields/SelectField.vue')),
  link: defineAsyncComponent(() => import('~/components/fields/LinkField.vue')),
  asset: defineAsyncComponent(() => import('~/components/fields/AssetField.vue')),
  content: defineAsyncComponent(() => import('~/components/fields/ContentField.vue')),
  user: defineAsyncComponent(() => import('~/components/fields/UserField.vue')),
  block: defineAsyncComponent(() => import('~/components/fields/BlockField.vue')),
  blocks: defineAsyncComponent(() => import('~/components/fields/BlocksField.vue')),
  repeater: defineAsyncComponent(() => import('~/components/fields/RepeaterField.vue')),
  template: defineAsyncComponent(() => import('~/components/fields/TemplateField.vue')),
  databag: defineAsyncComponent(() => import('~/components/fields/DatabagField.vue')),
};

const settings: Record<string, Component> = {};

export function registerFieldComponents(extra: AdminFieldComponents): void {
  for (const [key, loader] of Object.entries(extra.inputs ?? {})) {
    inputs[key] = defineAsyncComponent(loader);
  }
  for (const [key, loader] of Object.entries(extra.settings ?? {})) {
    settings[key] = defineAsyncComponent(loader);
  }
}

export function inputComponent(key: string): Component | null {
  return inputs[key] ?? null;
}

export function settingsComponent(key: string): Component | null {
  return settings[key] ?? null;
}

/** Every registered input key. */
export const registeredInputKeys = () => Object.keys(inputs);
