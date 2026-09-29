<script setup lang="ts">
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import LocalePicker from '@manablox/admin-sdk/components/ui/LocalePicker.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { localeName } from '@manablox/admin-sdk/lib/locales';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { type Ref, watch } from 'vue';
import { type Space, spaces as spaceActions } from '../queries';

/** One part of a space's settings, saving only its own fields. The technical name is fixed. */
const props = defineProps<{ space: Space; part: 'identity' | 'languages' }>();
const emit = defineEmits<{ saved: [] }>();

const spaces = useSpaceStore();

interface Draft {
  name: string;
  url: string;
  defaultLocale: string;
  locales: string[];
}
const editor = useDraftForm<Draft>();
editor.load({
  name: props.space.name,
  url: props.space.url,
  defaultLocale: props.space.defaultLocale,
  locales: [...props.space.locales],
});
const form = editor.draft as Ref<Draft>;
const { isDirty, saving } = editor;

/** Keeps the default locale among the selected ones. */
watch(
  () => form.value.locales,
  (locales) => {
    if (locales.length && !locales.includes(form.value.defaultLocale)) {
      form.value.defaultLocale = locales[0] as string;
    }
  },
);

async function save() {
  await editor.submit(async () => {
    // No `machineName`: it keys the GraphQL schema and public API pinning.
    const { name, url, defaultLocale, locales } = form.value;
    await spaceActions.update(
      props.space.id,
      props.part === 'identity' ? { name, url } : { defaultLocale, locales },
    );
    editor.markSaved();
    toast.success(props.part === 'identity' ? 'Name and address saved' : 'Languages saved');
    emit('saved');
  });
}
</script>

<template>
  <form class="grid max-w-xl content-start gap-4" @submit.prevent="save">
    <template v-if="part === 'identity'">
      <TextField v-model="form.name" label="Name" hint="Shown in the space switcher and across the admin." required />
      <TextField
        v-model="form.url"
        label="Website address"
        type="url"
        hint="Where the website that shows this content lives. Previews and the Visit site button open it."
        required
      />
      <TextField
        label="Technical name"
        :model-value="space.machineName"
        class="mb-input-mono"
        hint="Used by developers to reach this space through the API. It cannot be changed."
        readonly
      />
      <p v-if="space.id === spaces.currentId" class="mb-hint">
        Home page:
        <strong>{{ spaces.homeContentId ? 'set, marked with a star in the content tree' : 'none set yet' }}</strong>.
      </p>
    </template>

    <template v-else>
      <FormField label="Languages" hint="Every language picked here gets its own version of each document." v-slot="{ id }">
        <LocalePicker :id="id" v-model="form.locales" />
      </FormField>
      <FormField label="Main language" hint="Shown when a document has no translation in the language asked for." v-slot="{ id }">
        <Select
          :id="id"
          v-model="form.defaultLocale"
          :options="form.locales.map((code) => ({ value: code, label: localeName(code), hint: code }))"
        />
      </FormField>
    </template>

    <p v-for="message in editor.otherErrors([])" :key="message" class="mb-error">{{ message }}</p>
    <div>
      <SaveButton type="submit" :saving="saving" :disabled="!isDirty" label="Save changes" />
    </div>
  </form>
</template>
