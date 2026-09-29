<script setup lang="ts">
import ContentPicker from '@manablox/admin-sdk/components/ContentPicker.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import {
  emptyRedirectForm,
  normaliseRedirectPath,
  type RedirectForm,
  type RedirectStatus,
  redirectFormIssues,
  redirectFormOf,
  redirectInput,
} from '../model';
import { type Redirect, redirects } from '../queries';

/** Adds or edits a redirect; saving an automatic one makes it manual. */
const props = defineProps<{
  redirect: Redirect | null;
  spaceId: string;
}>();
const emit = defineEmits<{ close: [] }>();

const spaces = useSpaceStore();

const form = useDraftForm<RedirectForm>();
form.load(props.redirect ? redirectFormOf(props.redirect) : emptyRedirectForm());
const draft = form.draft;
/** Checked in the browser once the user tried to save. */
const tried = ref(false);
/** The target document's title. */
const pickedTitle = ref<string | null>(props.redirect?.toTitle ?? null);

const local = computed(() => (draft.value ? redirectFormIssues(draft.value) : {}));
const errorFor = (field: 'fromPath' | 'toPath') =>
  form.fieldError([field]) ?? (tried.value ? (local.value[field] ?? null) : null);
const otherErrors = computed(() => form.otherErrors([['fromPath'], ['toPath'], ['locale']]));

const fromHint = computed(() => {
  const typed = draft.value?.fromPath.trim() ?? '';
  const path = normaliseRedirectPath(typed);
  if (!typed) return 'The address that no longer exists, like /old-page.';
  return path && path !== typed ? `Saved as ${path}` : 'Without the language prefix.';
});

const TARGETS = [
  { value: 'path' as const, label: 'Path or URL' },
  { value: 'document' as const, label: 'Document' },
];
const STATUSES: Array<{ value: RedirectStatus; label: string; hint: string }> = [
  { value: 301, label: '301 - moved for good', hint: 'Search engines move the old address over.' },
  { value: 302, label: '302 - temporary', hint: 'Search engines keep the old address.' },
];
const localeOptions = computed(() => [
  { value: null, label: 'Every language' },
  ...(spaces.current?.locales ?? []).map((code) => ({ value: code, label: code })),
]);
const typeIds = computed(() => spaces.creatableKinds.map((type) => type.id));

function pick(row: { localizationId: string; title: string }) {
  if (!draft.value) return;
  draft.value.toContentId = row.localizationId;
  pickedTitle.value = row.title;
}

function save() {
  const current = draft.value;
  if (!current) return false;
  tried.value = true;
  if (Object.keys(local.value).length) return false;
  return form.submit(async () => {
    const input = redirectInput(current);
    const saved = props.redirect
      ? await redirects.update(props.spaceId, props.redirect.id, input)
      : await redirects.create(props.spaceId, input);
    toast.success(`Saved the redirect from ${saved.fromPath}`);
  });
}
</script>

<template>
  <FormDialog
    :title="redirect ? `Edit redirect from ${redirect.fromPath}` : 'Add a redirect'"
    form-class="space-y-5"
    :busy="form.saving.value"
    :disabled="!draft?.fromPath.trim()"
    @submit="save"
    @close="emit('close')"
  >
    <template v-if="draft">
      <p v-if="redirect?.source === 'auto'" class="mb-callout text-xs">
        Made automatically when a document's address changed. Saving it makes it a manual redirect,
        which later publishes leave alone.
      </p>

      <TextField
        v-model="draft.fromPath"
        label="Old path"
        class="mb-input-mono"
        placeholder="/old-page"
        autocomplete="off"
        spellcheck="false"
        :hint="fromHint"
        :error="errorFor('fromPath')"
      />

      <FormField label="Send visitors to" :error="errorFor('toPath')">
        <template #default="{ id }">
          <div class="space-y-2">
            <SegmentedControl v-model="draft.target" :options="TARGETS" aria-label="Redirect target" />
            <TextField
              v-if="draft.target === 'path'"
              :id="id"
              v-model="draft.toPath"
              class="mb-input-mono"
              placeholder="/new-page or https://example.com/page"
              autocomplete="off"
              spellcheck="false"
            />
            <div v-else class="flex flex-wrap items-center gap-2">
              <span v-if="draft.toContentId" class="mb-badge max-w-full truncate">
                <Icon name="doc" class="mb-icon-sm" /> {{ pickedTitle ?? 'The chosen document' }}
              </span>
              <ContentPicker
                :type-ids="typeIds"
                :label="draft.toContentId ? 'Change' : 'Pick a document'"
                trigger-class="mb-btn-outline mb-btn-sm"
                @pick="pick"
              />
            </div>
          </div>
        </template>
        <template #hint>
          <p class="mb-hint"><template v-if="draft.target === 'document'">Follows the document's current address, in the visitor's language.</template>
          <template v-else>A path of the website or a full address elsewhere. A path that is itself redirected is followed, so visitors take one hop.</template></p>
        </template>
      </FormField>

      <div class="grid gap-3 sm:grid-cols-2">
        <FormField label="Kind" v-slot="{ id }">
          <Select :id="id" v-model="draft.status" :options="STATUSES" />
        </FormField>
        <FormField label="Language" v-slot="{ id }">
          <Select :id="id" v-model="draft.locale" :options="localeOptions" />
        </FormField>
      </div>

      <div v-if="otherErrors.length" class="mb-callout text-xs" role="alert">
        <p v-for="message in otherErrors" :key="message">{{ message }}</p>
      </div>
    </template>
  </FormDialog>
</template>
