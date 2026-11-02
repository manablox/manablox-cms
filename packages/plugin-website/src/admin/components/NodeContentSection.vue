<script setup lang="ts">
import { TextField } from '@manablox/admin-sdk';
import { type DesignNode, ELEMENTS } from '@manablox/site';
import { computed } from 'vue';
import { ELEMENT_LABELS } from '../model/elements';
import { boundFieldOf, enclosingForm } from '../model/form-design';
import { LABEL_PROP, withProp } from '../model/outline';
import { useDesignerContext } from '../useDesignerContext';
import ChromeNodeSection from './ChromeNodeSection.vue';
import FormFieldSection from './FormFieldSection.vue';
import FormNodeSection from './FormNodeSection.vue';
import LocalizedTextField from './LocalizedTextField.vue';
import NodeBindingSection from './NodeBindingSection.vue';
import NodeOptionsSection from './NodeOptionsSection.vue';

/** The Content tab: binding, format, static text per locale and the element's options. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const { root, locales, locale, readOnly } = useDesignerContext();
const el = computed(() => props.node.el);
/** The input of a form bound to a field takes its texts from each field. */
const repeatedInput = computed(() => {
  if (el.value !== 'formField') return false;
  const form = root.value ? enclosingForm(root.value, props.node.id) : null;
  return Boolean(form && boundFieldOf(form));
});
const info = computed(() => ELEMENTS[el.value]);
const nodeProps = computed(() => props.node.props ?? {});

function update(next: DesignNode, group?: string) {
  if (!readOnly.value) emit('update', next, group);
}

function setProp(key: string, value: unknown) {
  update(withProp(props.node, key, value), `props:${props.node.id}:${key}`);
}

// Static text.
const TEXT_LABELS: Record<string, string> = {
  text: 'Text',
  alt: 'Alternative text',
  label: 'Label for screen readers',
  title: 'Title',
  placeholder: 'Placeholder',
  help: 'Help text',
};
/** Labels that differ per element. */
const OWN_LABELS: Partial<Record<string, Record<string, string>>> = {
  formField: { label: 'Label', placeholder: 'Placeholder, inside the empty input' },
  formSubmit: { text: 'Button text' },
  formMessage: { text: 'Message' },
  searchLink: { text: 'Link text' },
};
const textLabel = (key: string) => OWN_LABELS[el.value]?.[key] ?? TEXT_LABELS[key] ?? key;
/** The form panel edits its own texts; `label` is a screen reader name except on inputs. */
const textProps = computed(() =>
  el.value === 'form' || repeatedInput.value
    ? []
    : (info.value.textProps ?? []).filter(
        (key) =>
          key !== 'label' ||
          ['icon', 'formField', 'breadcrumbs', 'localeSwitch'].includes(el.value),
      ),
);
const textHint = (key: string) =>
  key === 'text' && props.node.bind
    ? 'Shown when the field is empty.'
    : key === 'alt'
      ? "Describes the picture; the asset's own text is used when empty."
      : key === 'label' && el.value === 'formField'
        ? "Empty uses the field's label."
        : key === 'text' && el.value === 'formMessage'
          ? "Empty uses the form's thank-you message."
          : undefined;

const str = (value: unknown) => (typeof value === 'string' ? value : '');
</script>

<template>
  <div class="ws:space-y-4">
    <NodeBindingSection :node="node" @update="update" />

    <LocalizedTextField
      v-for="key in textProps"
      :key="key"
      :model-value="nodeProps[key]"
      :label="textLabel(key)"
      :hint="textHint(key)"
      :locales="locales"
      :locale="locale"
      :multiline="key === 'text' && el === 'text'"
      :read-only="readOnly"
      @update:model-value="setProp(key, $event)"
    />

    <NodeOptionsSection :node="node" @update="update" />

    <FormNodeSection v-if="el === 'form'" :node="node" @update="update" />
    <FormFieldSection v-else-if="el === 'formField'" :node="node" @update="update" />
    <ChromeNodeSection v-else-if="info.category === 'chrome'" :node="node" @update="update" />

    <TextField
      :model-value="str(nodeProps[LABEL_PROP])"
      label="Name in Layers"
      :hint="`Only for you, to find it in the list. Empty: named after its content (${ELEMENT_LABELS[el]}).`"
      :disabled="readOnly"
      @update:model-value="setProp(LABEL_PROP, $event)"
    />
  </div>
</template>
