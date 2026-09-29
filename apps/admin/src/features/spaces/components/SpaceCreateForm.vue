<script setup lang="ts">
import type { SpaceAddressField } from '@manablox/admin-plugin';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import LocalePicker from '@manablox/admin-sdk/components/ui/LocalePicker.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { localeName } from '@manablox/admin-sdk/lib/locales';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import {
  DEFAULT_SPACE_BLOCKS,
  SPACE_TEMPLATES,
  type SpaceBlockId,
  type SpaceTemplateId,
} from '@manablox/core';
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useDerivedName } from '~/composables/useDerivedName';
import { useFocusFirstField } from '~/composables/useFocusFirstField';
import { spaces } from '../queries';
import { type SiteType, useSpaceStarters } from '../useSpaceStarters';
import { useSpaceSteps } from '../useSpaceSteps';
import SpaceTypeStage from './SpaceTypeStage.vue';

/**
 * The space creation form in stages: the space, then for a preconfigured space its website
 * type, then the stages plugin steps ask for. The install wizard submits it
 * with a `form="new-space"` button; `embedded` renders no `<form>`, for a dialog that calls
 * the exposed `submit`. A submit before the last stage moves on to the next.
 */
const props = withDefaults(
  defineProps<{
    /** Preselects a preconfigured space with the basic setup, for the empty state's second button. */
    starter?: boolean;
    embedded?: boolean;
  }>(),
  { starter: false, embedded: false },
);
const emit = defineEmits<{ created: [name: string] }>();

// No dialog focuses it in the install wizard.
useFocusFirstField(useTemplateRef<HTMLElement>('root'), true);

const error = ref<string | null>(null);
const busy = ref(false);
/** `manablox frontend`'s default (Astro) website. */
const FRONTEND_URL = 'http://localhost:3005';

const form = ref({
  name: '',
  machineName: '',
  url: FRONTEND_URL,
  defaultLocale: 'en',
  locales: ['en'],
});
/** The address field's label and hint, as a plugin step describes it. */
const addressText = ref<{ label: string; hint: string } | null>(null);
const address: SpaceAddressField = {
  get value() {
    return form.value.url;
  },
  default: FRONTEND_URL,
  set(value) {
    form.value.url = value;
  },
  describe(text) {
    addressText.value = text;
  },
};

/** An empty space, or a preconfigured one: a website type's model, pages and menu. */
const STARTS = [
  {
    value: 'empty',
    title: 'Empty space',
    hint: 'No types, documents or menus. Build the model yourself.',
  },
  {
    value: 'preset',
    title: 'Preconfigured',
    hint: 'A type of website with its sections, example pages and a menu, ready to fill.',
  },
] as const;
type Start = (typeof STARTS)[number]['value'];
const start = ref<Start>(props.starter ? 'preset' : 'empty');

const siteType = ref<SiteType>(props.starter ? 'basic' : 'business');
const chosenType = computed(() => SPACE_TEMPLATES.find((entry) => entry.id === siteType.value));
/** The sections of the `custom` type. */
const blocks = ref<SpaceBlockId[]>([...DEFAULT_SPACE_BLOCKS]);
const { starter, starterDraft, starterProps, lockedStarters, siteTypes } =
  useSpaceStarters(siteType);

/** The technical name tracks the space name until somebody edits it by hand. */
const derived = useDerivedName({
  read: () => form.value.machineName,
  write: (value) => {
    form.value.machineName = value;
  },
});

function onNameInput(value: string) {
  form.value.name = value;
  derived.onLabelInput(value);
}

/** Keeps the default locale among the selected ones. */
watch(
  () => form.value.locales,
  (locales) => {
    if (locales.length && !locales.includes(form.value.defaultLocale)) {
      form.value.defaultLocale = locales[0] as string;
    }
  },
);

const { pluginSteps, stepData, stepProps, stageSteps } = useSpaceSteps(address);
/** What the plugins send: their steps' data, a picked starter's joined to its plugin's. */
const pluginInput = computed(() => {
  const plugins = stepData();
  const picked = start.value === 'preset' ? starter.value : null;
  const data = picked?.entry.data?.(starterDraft(picked));
  if (picked && data !== undefined) {
    const step = plugins[picked.plugin];
    plugins[picked.plugin] = isRecord(step) && isRecord(data) ? { ...step, ...data } : data;
  }
  return Object.keys(plugins).length ? { plugins } : {};
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Stage = string;
const STAGE_LABELS: Record<string, string> = { space: 'Space', type: 'Website type' };
/** The website type for a preconfigured space, then the plugins' stages. */
const stages = computed<Stage[]>(() => [
  'space',
  ...(start.value === 'preset' ? ['type'] : []),
  ...stageSteps.value.map((item) => item.key),
]);
const stage = ref<Stage>('space');
/** The plugin step whose stage is open. */
const stageStep = computed(() => stageSteps.value.find((item) => item.key === stage.value) ?? null);
const labelOf = (id: Stage): string =>
  STAGE_LABELS[id] ?? stageSteps.value.find((item) => item.key === id)?.entry.stage?.label ?? id;
const stageIndex = computed(() => stages.value.indexOf(stage.value));
const nextStage = computed(() => stages.value[stageIndex.value + 1]);
const nextLabel = computed(() =>
  nextStage.value ? `Next: ${labelOf(nextStage.value).toLowerCase()}` : 'Create space',
);
const stageLabel = computed(() => labelOf(stage.value));
const first = computed(() => stageIndex.value <= 0);

function back() {
  error.value = null;
  stage.value = stages.value[stageIndex.value - 1] ?? 'space';
}

/** What `spaces.create` seeds: a website type, the picked blocks for `custom`. */
const starterInput = computed(() => {
  const type = siteType.value;
  if (start.value !== 'preset' || type.startsWith('starter:')) {
    return { starter: false as const };
  }
  return type === 'custom'
    ? { starter: type, blocks: blocks.value }
    : { starter: type as SpaceTemplateId };
});

/** Checks the current stage; resolves to an error message or `null`. */
function problem(): string | null {
  if (stage.value !== 'type') return null;
  if (siteType.value === 'custom' && !blocks.value.length) return 'Pick at least one section.';
  if (starter.value) return starter.value.entry.validate?.(starterDraft(starter.value)) ?? null;
  return null;
}

/** Moves on to the next stage, or creates the space; resolves to success. */
async function submit(): Promise<boolean> {
  error.value = problem();
  if (error.value) return false;
  if (nextStage.value) {
    stage.value = nextStage.value;
    return false;
  }
  const name = form.value.name;
  const picked = start.value === 'preset' ? starter.value : null;
  const warnings: string[] = [];
  const created = await runWrite(
    async () => {
      // The designed types are created with the space, before plugins finish it.
      const types = picked ? (picked.entry.plan?.(starterDraft(picked)) ?? []) : [];
      const space = await spaces.create({
        ...form.value,
        ...starterInput.value,
        ...pluginInput.value,
        ...(types.length ? { plan: { types } } : {}),
      });
      warnings.push(...space.warnings);
    },
    {
      success: picked?.entry.created
        ? `Space "${name}" created ${picked.entry.created(starterDraft(picked))}`
        : starterInput.value.starter
          ? `Space "${name}" created with the ${chosenType.value?.name.toLowerCase()}`
          : `Space "${name}" created`,
      error,
      busy,
    },
  );
  for (const warning of warnings) toast.info(warning);
  if (created) emit('created', name);
  return created;
}

/** The heading of a plugin step's stage, for the install wizard. */
const stageIntro = computed(() => stageStep.value?.entry.stage ?? null);

defineExpose({ busy, submit, stage, stages, stageLabel, stageIntro, nextLabel, first, back });
</script>

<template>
  <component :is="embedded ? 'div' : 'form'" id="new-space" ref="root" class="grid gap-3 sm:grid-cols-2" @submit.prevent="submit">
    <template v-if="stage === 'space'">
    <TextField id="s-name" label="Name" :model-value="form.name" required @update:model-value="onNameInput(String($event ?? ''))" />
    <!-- `-` is escaped because `pattern` uses the `v` flag. Matches the server's `machineName`. -->
    <TextField
      label="Technical name"
      :model-value="form.machineName"
      required
      pattern="[a-z][a-z0-9_\-]*"
      class="mb-input-mono"
      hint="Filled in from the name and corrected as you type - spaces become hyphens and capitals are lowered. It cannot be changed later."
      @update:model-value="derived.onNameInput(String($event ?? ''))"
      @blur="derived.onNameBlur"
    />
    <div v-for="item in pluginSteps" :key="item.key" class="sm:col-span-2">
      <component :is="item.component" v-bind="stepProps(item, 'space')" />
    </div>
    <TextField
      v-model="form.url"
      :label="addressText?.label ?? 'Frontend URL'"
      type="url"
      required
      field-class="sm:col-span-2"
      :hint="addressText?.hint ?? 'Used by the visual editor\'s preview iframe.'"
    />
    <FormField label="Locales" v-slot="{ id }">
      <LocalePicker :id="id" v-model="form.locales" />
    </FormField>
    <FormField label="Default locale" hint="Content falls back to this language when a translation is missing." v-slot="{ id }">
      <Select
        :id="id"
        v-model="form.defaultLocale"
        :options="form.locales.map((code) => ({ value: code, label: localeName(code), hint: code }))"
      />
    </FormField>
    <fieldset class="sm:col-span-2">
      <legend class="mb-label">Start with</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <RadioCard
          v-for="entry in STARTS"
          :key="entry.value"
          v-model="start"
          name="s-start"
          :value="entry.value"
          :title="entry.title"
          :hint="entry.hint"
        />
      </div>
    </fieldset>
    </template>

    <SpaceTypeStage
      v-else-if="stage === 'type'"
      v-model:site-type="siteType"
      v-model:blocks="blocks"
      :site-types="siteTypes"
      :locked-starters="lockedStarters"
      :starter="starter"
      :starter-props="starterProps"
    />

    <div v-else-if="stageStep" class="grid gap-3 sm:col-span-2">
      <component :is="stageStep.component" v-bind="stepProps(stageStep, 'own')" />
    </div>
    <p v-if="error" class="mb-error sm:col-span-2">{{ error }}</p>
  </component>
</template>
