<script setup lang="ts">
import {
  confirm,
  EditorHeader,
  EmptyState,
  FormField,
  Icon,
  PageState,
  RadioCard,
  SegmentedControl,
  Select,
  useEditorShortcuts,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import {
  generateMenuDesign,
  type MenuDesign,
  type MenuPreset,
  type StyleRules,
  type ThemeDesign,
  validateSiteDesign,
} from '@manablox/site';
import { computed, ref, watch } from 'vue';
import {
  collapses,
  LEVEL_PARTS,
  levelRules,
  MENU_PRESETS,
  type MenuLevelPart,
  MOBILE_BEHAVIOURS,
  MOBILE_BREAKPOINTS,
  maxDepth,
  presetDesign,
  withDepth,
  withLevelRules,
  withMobile,
  withPreset,
  withRootRules,
} from '../model/menu-design';
import { sampleDocument, samplePage } from '../model/site-preview';
import { useSiteDesign, useSiteDesigns } from '../queries';
import { useDesignDraft } from '../useDesignDraft';
import { useDesignPreview } from '../useDesignPreview';
import { useSiteContext } from '../useSiteContext';
import DesignCanvas from './DesignCanvas.vue';
import DesignDraftNotices from './DesignDraftNotices.vue';
import DesignerActions from './DesignerActions.vue';
import DesignerLayout from './DesignerLayout.vue';
import DesignerToolbar from './DesignerToolbar.vue';
import LocalizedTextField from './LocalizedTextField.vue';
import PaneSection from './PaneSection.vue';
import SiteModePanel from './SiteModePanel.vue';
import StyleInspector from './StyleInspector.vue';

/** The menu designer: a preset, how deep it goes, styles per level and the mobile toggle. */
const props = defineProps<{
  designKey: string;
  /** Menus of the space. */
  menus: ReadonlyArray<{ id: string; name: string; machineName: string }>;
}>();
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canWrite, canPublish, canSwitch, canvasOrigin } = site;
const readOnly = computed(() => !canWrite.value);

const key = computed(() => props.designKey);
const ownMenu = computed(() => props.menus.find((menu) => menu.machineName === key.value) ?? null);

const menu = useDesignDraft('menu', key, {
  readOnly,
  fallback: () => (ownMenu.value ? generateMenuDesign(ownMenu.value) : null),
});
const { draft, query } = menu;
const themeQuery = useSiteDesign('theme', 'default');
const theme = computed(() => (themeQuery.data.value?.data as ThemeDesign | undefined) ?? null);
const designs = useSiteDesigns();
const name = computed(
  () =>
    ownMenu.value?.name ??
    (designs.data.value ?? []).find((entry) => entry.kind === 'menu' && entry.key === key.value)
      ?.label ??
    key.value,
);
const exists = computed(() => Boolean(ownMenu.value || query.data.value?.design));

useEditorShortcuts({
  save: () => void menu.save(),
  undo: menu.undo,
  redo: menu.redo,
  canUndo: () => menu.canUndo.value,
  canRedo: () => menu.canRedo.value,
});

function update(next: MenuDesign, group?: string) {
  menu.update(next, group);
}

const breakpoint = ref<BlockBreakpoint>('desktop');
const locale = ref(spaces.locale);
const locales = computed(() => spaces.current?.locales ?? [locale.value]);

// The menu whose entries the canvas shows.
const shown = ref(ownMenu.value?.machineName ?? props.menus[0]?.machineName ?? '');
watch(
  () => props.menus,
  (list) => {
    if (!list.some((entry) => entry.machineName === shown.value))
      shown.value = ownMenu.value?.machineName ?? list[0]?.machineName ?? '';
  },
);
const menuOptions = computed(() =>
  props.menus.map((entry) => ({ value: entry.machineName, label: entry.name })),
);

const preview = useDesignPreview({
  locale: () => locale.value,
  theme: () => theme.value,
  page: () => ({ key: 'sample', design: samplePage(locale.value) }),
  menuDesign: () => (draft.value ? { key: key.value, design: draft.value } : null),
  extraMenu: () => shown.value || undefined,
  document: () => sampleDocument('sample'),
  documentType: () => null,
  sample: () => true,
  focus: () => ({ kind: 'menu', key: key.value, menu: shown.value || undefined }),
});

// What the style inspector edits.
type Target = 'root' | 'toggle' | 'panel' | `level:${number}`;
const target = ref<Target>('level:0');
const part = ref<MenuLevelPart>('link');
const depth = computed(() => draft.value?.depth ?? 1);
const targetOptions = computed(() => {
  const list: Array<{ value: Target; label: string }> = [{ value: 'root', label: 'Whole menu' }];
  for (let level = 0; level < depth.value; level++)
    list.push({ value: `level:${level}`, label: level === 0 ? 'Top level' : `Level ${level + 1}` });
  if (draft.value && collapses(draft.value))
    list.push(
      { value: 'toggle', label: 'Mobile: menu button' },
      { value: 'panel', label: 'Mobile: opened menu' },
    );
  return list;
});
watch(targetOptions, (options) => {
  if (!options.some((option) => option.value === target.value)) target.value = 'level:0';
});
const level = computed(() =>
  target.value.startsWith('level:') ? Number(target.value.slice('level:'.length)) : null,
);
const partOptions = LEVEL_PARTS.map((entry) => ({ value: entry.value, label: entry.label }));
const partInfo = computed(() => LEVEL_PARTS.find((entry) => entry.value === part.value));

const rules = computed<StyleRules | undefined>(() => {
  const current = draft.value;
  if (!current) return undefined;
  if (level.value !== null) return levelRules(current, level.value, part.value);
  if (target.value === 'root') return current.root;
  return target.value === 'toggle' ? current.mobile.toggle : current.mobile.panel;
});
const states = computed(() =>
  level.value !== null ? (partInfo.value?.states ?? false) : target.value === 'toggle',
);

function setRules(next: StyleRules | undefined) {
  const current = draft.value;
  if (!current) return;
  const group = `style:${target.value}:${part.value}`;
  if (level.value !== null) update(withLevelRules(current, level.value, part.value, next), group);
  else if (target.value === 'root') update(withRootRules(current, next), group);
  else update(withMobile(current, { [target.value]: next }), group);
}

const depthOptions = computed(() =>
  Array.from({ length: maxDepth(draft.value?.preset ?? 'list') }, (_, index) => ({
    value: index + 1,
    label: index === 0 ? '1 level' : `${index + 1} levels`,
  })),
);

async function startFromPreset(preset: MenuPreset) {
  const ok = await confirm({
    title: 'Start over from this preset?',
    message: 'Every level style and the mobile settings are replaced. Undo brings them back.',
    confirmLabel: 'Start over',
  });
  if (ok) update(presetDesign(preset));
}

const issues = computed(() => {
  if (!draft.value) return [];
  const result = validateSiteDesign('menu', draft.value);
  return result.ok ? [] : result.issues;
});

const status = computed(() => query.data.value?.status ?? 'generated');

function retry() {
  void settings.refetch();
  void query.refetch();
  void themeQuery.refetch();
}
</script>

<template>
  <PageState
    class="ws:h-full"
    :loading="settings.isPending.value || (designed && (query.isPending.value || themeQuery.isPending.value))"
    :error="settings.error.value ?? query.error.value ?? themeQuery.error.value"
    :retry="retry"
    loading-label="Loading the menu design..."
  >
    <div v-if="!canRead" class="mb-page-wide">
      <EmptyState icon="lock" title="No access to the design" description="Someone who manages this space's roles can give you design rights." />
    </div>

    <div v-else-if="!designed && spaces.currentId && settings.data.value" class="mb-page-wide ws:space-y-4">
      <EditorHeader title="Menu design" eyebrow="Design" />
      <SiteModePanel :space-id="spaces.currentId" :mode="settings.data.value.mode" :can-switch="canSwitch" :frontend-url="spaces.current?.url" />
    </div>

    <div v-else-if="!exists" class="mb-page-wide">
      <EmptyState icon="menu" title="No such menu design" description="There is no menu of this name and no stored design under it.">
        <RouterLink to="/design/menus" class="mb-btn-outline">All menu designs</RouterLink>
      </EmptyState>
    </div>

    <DesignerLayout v-else-if="draft && theme && spaces.currentId" left-label="Menu kind" right-label="Menu style">
      <template #toolbar>
        <DesignerToolbar :title="name" kind="Menu design" icon="menu" :back="{ to: '/design/menus', label: 'Menus' }" :status="status" :read-only="readOnly">
          <DesignerActions :draft="menu" :status="status" :what="`the menu design &quot;${name}&quot;`" :read-only="readOnly" :can-publish="canPublish" />
        </DesignerToolbar>
      </template>

      <template #notices>
        <DesignDraftNotices :draft="menu" what="this menu design" />
      </template>

      <template #left>
        <PaneSection id="menu-kind" title="Kind of menu" icon="menu">
          <div class="ws:grid ws:gap-1.5">
            <RadioCard
              v-for="option in MENU_PRESETS"
              :key="option.value"
              :model-value="draft.preset"
              :value="option.value"
              name="menu-preset"
              :title="option.label"
              :hint="option.hint"
              :disabled="readOnly"
              @update:model-value="update(withPreset(draft, $event))"
            />
          </div>
          <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" title="Replace the styles with the preset's" @click="startFromPreset(draft.preset)">
            <Icon name="reset" class="mb-icon-sm" /> Use the preset's styles
          </button>
          <FormField label="Shows">
            <template #default="{ id }">
              <Select :id="id" :model-value="draft.depth" :options="depthOptions" :disabled="readOnly" @update:model-value="update(withDepth(draft, $event))" />
            </template>
          </FormField>
        </PaneSection>
        <PaneSection id="menu-mobile" title="On phones and tablets" icon="smartphone">
          <div class="ws:grid ws:gap-1.5">
            <RadioCard
              v-for="option in MOBILE_BEHAVIOURS"
              :key="option.value"
              :model-value="draft.mobile.behaviour"
              :value="option.value"
              name="menu-mobile"
              :title="option.label"
              :hint="option.hint"
              :disabled="readOnly"
              @update:model-value="update(withMobile(draft, { behaviour: $event }))"
            />
          </div>
          <template v-if="collapses(draft)">
            <FormField label="Collapses on">
              <template #default="{ id }">
                <Select :id="id" :model-value="draft.mobile.breakpoint" :options="MOBILE_BREAKPOINTS" :disabled="readOnly" @update:model-value="update(withMobile(draft, { breakpoint: $event }))" />
              </template>
            </FormField>
            <LocalizedTextField
              :model-value="draft.mobile.label"
              label="Button label"
              hint="Read out by screen readers; the button shows a menu icon."
              :locales="locales"
              :locale="locale"
              :read-only="readOnly"
              @update:model-value="update(withMobile(draft, { label: $event }), 'mobile-label')"
            />
          </template>
        </PaneSection>
      </template>

      <template #center>
        <DesignCanvas
          v-model:breakpoint="breakpoint"
          flush
          :site-url="canvasOrigin"
          :payload="preview.payload.value"
          read-only
          :title="`Menu design ${name}`"
        >
          <template #tools>
            <Select v-if="menuOptions.length > 1" v-model="shown" :options="menuOptions" variant="sm" class="ws:!w-44" aria-label="Menu shown on the canvas" title="Which menu's entries the preview shows" />
            <span v-if="menuOptions.length === 0" class="ws:truncate ws:text-2xs ws:text-surface-500">
              No menus yet; <RouterLink to="/menus" class="ws:underline">create one</RouterLink> to see entries here.
            </span>
            <span v-else class="ws:truncate ws:text-2xs ws:text-surface-500">Pick tablet or phone to try the small-screen menu.</span>
          </template>
        </DesignCanvas>
      </template>

      <template #right>
        <div class="ws:space-y-1">
          <h2 class="ws:text-sm ws:font-bold">Style</h2>
          <p class="mb-meta">Pick a part of the menu, then set its colors, spacing and text.</p>
        </div>
        <FormField label="Part">
          <template #default="{ id }">
            <Select :id="id" v-model="target" :options="targetOptions" />
          </template>
        </FormField>
        <template v-if="level !== null">
          <SegmentedControl v-model="part" :options="partOptions" aria-label="Part of the level" />
          <p class="mb-hint">{{ partInfo?.hint }}</p>
        </template>
        <StyleInspector
          :key="`${target}:${part}`"
          :model-value="rules"
          :theme="theme"
          :breakpoint="level !== null && part === 'current' ? 'desktop' : breakpoint"
          :states="states"
          :read-only="readOnly"
          @update:model-value="setRules"
        />
        <PaneSection v-if="issues.length" id="checks" title="Checks" icon="list-checks" :summary="`${issues.length} to look at`" summary-tone="warn">
          <ul class="ws:space-y-0.5 ws:text-xs ws:text-danger-700 ws:dark:text-danger-300">
            <li v-for="(issue, index) in issues.slice(0, 12)" :key="index"><span class="ws:font-mono">{{ issue.path }}</span> {{ issue.message }}</li>
          </ul>
        </PaneSection>
      </template>
    </DesignerLayout>
  </PageState>
</template>
