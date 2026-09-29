<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';
import SpaceCreateForm from '~/features/spaces/components/SpaceCreateForm.vue';
import SpaceImportForm, {
  type SpaceImportOutcome,
} from '~/features/spaces/components/SpaceImportForm.vue';
import { beginInstall, endInstall } from '~/features/users/install';
import { useSlotItems } from '~/lib/plugins/registry';

/**
 * The first-run wizard: owner account, then a first space (skippable), whose later form
 * stages (website type, plugin stages) are steps of their own.
 */
const session = useSessionStore();
const spaces = useSpaceStore();
const router = useRouter();

type Step = 'account' | 'space' | 'done';
const step = ref<Step>('account');
/** The chosen space form, if any. */
const source = ref<'create' | 'import' | null>(null);
const importForm = useTemplateRef('importForm');
const createForm = useTemplateRef('createForm');
const top = useTemplateRef<HTMLElement>('top');

/** The later stages of the space form (website type, plugin stages) count as steps of their own. */
const formStage = computed(() =>
  source.value === 'create' ? (createForm.value?.stage ?? 'space') : 'space',
);
const later = computed(() => formStage.value !== 'space');
const current = computed(() => (step.value === 'space' ? formStage.value : step.value));
/** Create steps of plugins with a stage of their own. */
const createSteps = useSlotItems('space.create.steps');
const stageSteps = computed(() => createSteps.value.filter((item) => item.entry.stage));
/** What the plugin stages add to the welcome text. */
const welcome = computed(() =>
  stageSteps.value.flatMap((item) => (item.entry.stage?.welcome ? [item.entry.stage.welcome] : [])),
);
const formStepLabel = (id: string): string =>
  id === 'type'
    ? 'Website type'
    : (stageSteps.value.find((item) => item.key === id)?.entry.stage?.label ?? id);
const STEPS = computed(() => [
  { id: 'account', label: 'Administrator' },
  { id: 'space', label: 'First space' },
  // Before the choice, a preconfigured space with every plugin stage is expected.
  ...(source.value === 'import'
    ? []
    : (createForm.value?.stages ?? ['space', 'type', ...stageSteps.value.map((item) => item.key)])
        .filter((id) => id !== 'space')
        .map((id) => ({ id, label: formStepLabel(id) }))),
  { id: 'done', label: 'Ready' },
]);
const stepIndex = computed(() => STEPS.value.findIndex((s) => s.id === current.value));
/** Counts the steps after the account, which the heading numbers. */
const stepOf = computed(() => `Step ${stepIndex.value} of ${STEPS.value.length - 2}`);
/** Plugin stages get the widest layout. */
const size = computed(() =>
  stageSteps.value.some((item) => item.key === current.value)
    ? 'xl'
    : step.value === 'space' && source.value
      ? 'wide'
      : 'narrow',
);

// A new stage starts at the top of the scrolling column.
watch(current, async () => {
  await nextTick();
  top.value?.scrollIntoView({ block: 'start' });
});

/* --- step 1: the account ------------------------------------------------------------ */

const name = ref('');
const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function createAccount() {
  const done = await runWrite(
    () => session.signUp(email.value, password.value, name.value || email.value),
    { error, busy },
  );
  if (!done) return;
  // `setupNeeded` is now false; the flag keeps the router on the wizard.
  beginInstall();
  step.value = 'space';
}

/* --- step 2: the space -------------------------------------------------------------- */

const SOURCES = [
  {
    id: 'create' as const,
    icon: 'blocks',
    title: 'Create a space',
    hint: 'Start empty, or with a working content model and a few published pages.',
  },
  {
    id: 'import' as const,
    icon: 'upload',
    title: 'Import a space',
    hint: 'Restore a JSON export, or the zip archive that also carries the asset files.',
  },
];

/** What an import changed to fit, shown on the last step. */
const importNotes = ref<string[]>([]);

async function onSpaceReady(outcome?: SpaceImportOutcome) {
  importNotes.value = outcome?.notes ?? [];
  await spaces.refresh();
  step.value = 'done';
}

/* --- leaving ------------------------------------------------------------------------ */

async function finish() {
  endInstall();
  await router.replace('/');
}

async function skip() {
  toast.info('You can add a space any time from Settings.');
  await finish();
}
</script>

<template>
  <AuthLayout :size="size">
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">Welcome to</span><br />
        your instance.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        The account that administers this instance, then the first space for your content
        to live in.
        <template v-for="sentence in welcome" :key="sentence">{{ sentence }} </template>
      </p>
      <ol class="mt-8 space-y-2 text-sm">
        <li
          v-for="(entry, i) in STEPS"
          :key="entry.id"
          class="flex items-center gap-2.5"
          :class="i === stepIndex ? 'font-semibold text-white' : 'text-brand-50'"
        >
          <span
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border text-2xs font-bold"
            :class="
              i < stepIndex
                ? 'border-white bg-white text-brand-700'
                : i === stepIndex
                  ? 'border-white text-white'
                  : 'border-white/40 text-brand-50'
            "
          >
            <Icon v-if="i < stepIndex" name="check" class="mb-icon-sm" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          {{ entry.label }}
        </li>
      </ol>
    </template>

    <span ref="top" />
    <!-- Step 1 -->
    <template v-if="step === 'account'">
      <p class="mb-eyebrow">First install</p>
      <h2 class="mb-title mt-1">Create the administrator</h2>
      <p class="mt-2 text-sm text-surface-500">
        This account becomes the instance superadmin. It is the only one that can be
        created here; the rest come from Settings once you are in.
      </p>

      <form class="mt-8 space-y-4" @submit.prevent="createAccount">
        <TextField id="i-name" v-model="name" label="Name" autocomplete="name" />
        <TextField id="i-email" v-model="email" label="Email" type="email" required autocomplete="email" />
        <TextField
          id="i-password"
          v-model="password"
          label="Password"
          type="password"
          required
          minlength="12"
          autocomplete="new-password"
          hint="At least 12 characters."
        />

        <p v-if="error" class="mb-error" role="alert">{{ error }}</p>

        <button type="submit" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy">
          {{ busy ? 'Creating...' : 'Create account' }}
        </button>
      </form>
    </template>

    <!-- Step 2 -->
    <template v-else-if="step === 'space'">
      <p class="mb-eyebrow">{{ stepOf }}</p>
      <template v-if="formStage === 'type'">
        <h2 class="mb-title mt-1">What kind of website is it?</h2>
        <p class="mt-2 text-sm text-surface-500">
          The type brings content types, example pages and a menu. Pick your own sections, or a
          kind of space one of the plugins offers.
        </p>
      </template>
      <template v-else-if="createForm?.stageIntro">
        <h2 class="mb-title mt-1">{{ createForm.stageIntro.title }}</h2>
        <p v-if="createForm.stageIntro.hint" class="mt-2 text-sm text-surface-500">{{ createForm.stageIntro.hint }}</p>
      </template>
      <template v-else>
        <h2 class="mb-title mt-1">Add your first space</h2>
        <p class="mt-2 text-sm text-surface-500">
          A space is a site or channel with its own content tree, locales and assets.
          Everything in Manablox lives inside one.
        </p>
      </template>

      <div v-if="!source" class="mt-8 space-y-2">
        <button
          v-for="entry in SOURCES"
          :key="entry.id"
          type="button"
          class="flex w-full items-start gap-3 rounded-card border border-surface-200 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:border-surface-700 dark:hover:border-brand-500 dark:hover:bg-brand-600/10"
          @click="source = entry.id"
        >
          <span class="mb-tile-clay flex h-9 w-9 shrink-0 items-center justify-center rounded-control">
            <Icon :name="entry.icon" class="mb-icon-lg" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold">{{ entry.title }}</span>
            <span class="block mb-meta">{{ entry.hint }}</span>
          </span>
        </button>

        <button type="button" class="mb-btn-ghost mt-2 w-full" @click="skip">
          Skip for now
        </button>
      </div>

      <div v-else class="mt-8">
        <SpaceCreateForm v-if="source === 'create'" ref="createForm" starter @created="onSpaceReady()" />
        <SpaceImportForm v-else ref="importForm" @imported="onSpaceReady" />

        <!-- Pinned to the bottom of the scrolling column, so it stays in reach. -->
        <div
          class="mb-z-sticky sticky bottom-0 -mx-3 mt-5 flex items-center justify-between gap-2 border-t border-surface-200 bg-surface-50/95 px-3 py-3 backdrop-blur dark:border-surface-800 dark:bg-surface-950/95"
        >
          <button type="button" class="mb-btn-ghost" @click="later ? createForm?.back() : (source = null)">Back</button>
          <button
            v-if="source === 'create'"
            type="submit"
            form="new-space"
            class="mb-btn-primary mb-btn-lg"
            :disabled="createForm?.busy"
          >
            {{
              createForm?.busy ? 'Creating...' : (createForm?.nextLabel ?? 'Create space')
            }}
          </button>
          <button
            v-else
            type="submit"
            form="import-space"
            class="mb-btn-primary mb-btn-lg"
            :disabled="!importForm?.ready || importForm?.busy"
          >
            {{ importForm?.busy ? 'Importing...' : 'Import space' }}
          </button>
        </div>
      </div>
    </template>

    <!-- Step 3 -->
    <template v-else>
      <p class="mb-eyebrow">All set</p>
      <h2 class="mb-title mt-1">Your instance is ready</h2>
      <p class="mt-2 text-sm text-surface-500">
        You are signed in as the superadmin and your first space is in place. From here,
        content types and documents live under Content, and everything else under Settings.
      </p>
      <div v-if="importNotes.length" class="mb-callout mt-4">
        <p class="font-medium">The import changed a few things to fit:</p>
        <ul class="mt-1 list-disc space-y-1 pl-5 text-sm">
          <li v-for="(note, index) in importNotes" :key="index">{{ note }}</li>
        </ul>
      </div>
      <button type="button" class="mb-btn-primary mb-btn-lg mt-8 w-full" @click="finish">
        Go to the admin
      </button>
    </template>
  </AuthLayout>
</template>
