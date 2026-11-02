<script setup lang="ts">
import { Icon, IconButton, SegmentedControl, Switch } from '@manablox/admin-sdk';
import { COLOR_ROLES, type ColorRole, type ThemeColors } from '@manablox/site';
import { computed, ref } from 'vue';
import { checkContrast, resolveColor } from '../model/color';
import { freeName, renameKey, tokenNameIssue, withoutKey } from '../model/theme';
import { colorRoleLabel } from '../model/tokens';
import ColorInput from './ColorInput.vue';

/** The palette, the semantic roles (light and optional dark) and their contrast. */
const props = defineProps<{ colors: ThemeColors; readOnly?: boolean }>();
const emit = defineEmits<{ update: [colors: ThemeColors, group?: string] }>();

const ROLE_HINTS: Record<ColorRole, string> = {
  bg: 'The page behind everything',
  surface: 'Cards, bands and panels',
  text: 'Body text',
  muted: 'Captions and secondary text',
  primary: 'Links, buttons and highlights',
  onPrimary: 'Text on primary buttons',
  border: 'Lines and outlines',
  accent: 'A second highlight color',
};

const scheme = ref<'light' | 'dark'>('light');
const hasDark = computed(() => props.colors.dark !== undefined);

// Palette.

const renameErrors = ref<Record<string, string>>({});

function setPaletteValue(name: string, value: string) {
  emit(
    'update',
    { ...props.colors, palette: { ...props.colors.palette, [name]: value } },
    `palette:${name}`,
  );
}

function renamePalette(from: string, event: Event) {
  const to = (event.target as HTMLInputElement).value.trim();
  if (to === from) return;
  const taken = Object.keys(props.colors.palette).filter((name) => name !== from);
  const issue = tokenNameIssue(to, taken, COLOR_ROLES);
  renameErrors.value = { ...renameErrors.value, [from]: issue ?? '' };
  if (issue) return;
  // Roles naming the old entry follow it.
  const follow = <T extends Partial<Record<ColorRole, string>>>(roles: T): T =>
    Object.fromEntries(
      Object.entries(roles).map(([role, value]) => [role, value === from ? to : value]),
    ) as T;
  emit('update', {
    ...props.colors,
    palette: renameKey(props.colors.palette, from, to),
    roles: follow(props.colors.roles),
    ...(props.colors.dark ? { dark: follow(props.colors.dark) } : {}),
  });
}

const usedBy = (name: string) =>
  COLOR_ROLES.filter(
    (role) => props.colors.roles[role] === name || props.colors.dark?.[role] === name,
  );

function removePalette(name: string) {
  // Roles pointing at it keep its color.
  const value = props.colors.palette[name] ?? '#000000';
  const inline = <T extends Partial<Record<ColorRole, string>>>(roles: T): T =>
    Object.fromEntries(
      Object.entries(roles).map(([role, entry]) => [role, entry === name ? value : entry]),
    ) as T;
  emit('update', {
    ...props.colors,
    palette: withoutKey(props.colors.palette, name),
    roles: inline(props.colors.roles),
    ...(props.colors.dark ? { dark: inline(props.colors.dark) } : {}),
  });
}

function addPalette() {
  const name = freeName('color', Object.keys(props.colors.palette));
  emit('update', { ...props.colors, palette: { ...props.colors.palette, [name]: '#64748b' } });
}

// Roles.

function roleValue(role: ColorRole): string | undefined {
  return scheme.value === 'dark' ? props.colors.dark?.[role] : props.colors.roles[role];
}

function setRole(role: ColorRole, value: string) {
  if (scheme.value === 'dark') {
    emit(
      'update',
      { ...props.colors, dark: { ...(props.colors.dark ?? {}), [role]: value } },
      `dark:${role}`,
    );
  } else {
    emit(
      'update',
      { ...props.colors, roles: { ...props.colors.roles, [role]: value } },
      `role:${role}`,
    );
  }
}

function clearDarkRole(role: ColorRole) {
  const dark = { ...(props.colors.dark ?? {}) };
  delete dark[role];
  emit('update', { ...props.colors, dark });
}

function setDark(on: boolean) {
  if (on) {
    emit('update', { ...props.colors, dark: {} });
    scheme.value = 'dark';
  } else {
    const { dark: _dark, ...rest } = props.colors;
    emit('update', rest);
    scheme.value = 'light';
  }
}

const checks = computed(() => checkContrast(props.colors, scheme.value));
const swatch = (role: ColorRole) => resolveColor(props.colors, role, scheme.value) ?? 'transparent';
</script>

<template>
  <div class="ws:space-y-6">
    <section class="ws:space-y-3">
      <div class="ws:flex ws:items-center ws:gap-2">
        <h3 class="ws:flex-1 ws:text-sm ws:font-bold">Roles</h3>
        <SegmentedControl
          v-if="hasDark"
          v-model="scheme"
          :options="[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]"
          aria-label="Color scheme"
        />
      </div>
      <p class="mb-meta">
        Designs use these roles, so changing one here restyles the whole site. A role can name a palette color or hold its own.
        <template v-if="scheme === 'dark'"> Empty dark roles keep their light color.</template>
      </p>
      <div v-for="role in COLOR_ROLES" :key="role" class="ws:grid ws:grid-cols-[7rem_minmax(0,1fr)] ws:items-center ws:gap-x-3 ws:gap-y-0.5">
        <label :for="`role-${role}`" class="ws:text-sm ws:font-medium">
          {{ colorRoleLabel(role) }}
          <span class="ws:block ws:text-2xs ws:font-normal ws:text-surface-500">{{ ROLE_HINTS[role] }}</span>
        </label>
        <div class="ws:flex ws:items-center ws:gap-1">
          <ColorInput
            :id="`role-${role}`"
            class="ws:flex-1"
            :model-value="roleValue(role)"
            :palette="colors.palette"
            :aria-label="colorRoleLabel(role)"
            :placeholder="scheme === 'dark' ? colors.roles[role] : undefined"
            :disabled="readOnly"
            @update:model-value="setRole(role, $event)"
          />
          <IconButton
            v-if="scheme === 'dark' && colors.dark?.[role] && !readOnly"
            icon="x"
            :label="`Use the light ${colorRoleLabel(role)} color`"
            title="Use the light color"
            @click="clearDarkRole(role)"
          />
        </div>
      </div>
      <Switch :model-value="hasDark" :disabled="readOnly" @update:model-value="setDark">
        <span class="ws:block ws:text-sm ws:font-bold">Dark color scheme</span>
        <span class="ws:block ws:text-2xs ws:text-surface-500">Visitors whose system is set to dark see these roles instead.</span>
      </Switch>
    </section>

    <section class="ws:space-y-2" aria-labelledby="contrast-heading">
      <h3 id="contrast-heading" class="ws:text-sm ws:font-bold">Contrast {{ hasDark ? `(${scheme})` : '' }}</h3>
      <ul class="ws:space-y-1">
        <li v-for="check in checks" :key="`${check.text}-${check.background}`" class="ws:flex ws:items-center ws:gap-2 ws:text-xs">
          <span
            class="ws:flex ws:h-6 ws:w-9 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-control ws:border ws:border-surface-200 ws:text-xs ws:font-bold ws:dark:border-surface-700"
            :style="{ background: swatch(check.background), color: swatch(check.text) }"
            aria-hidden="true"
          >Aa</span>
          <span class="ws:min-w-0 ws:flex-1 ws:truncate">{{ check.label }}</span>
          <span class="ws:font-mono ws:tabular-nums">{{ check.ratio === null ? '-' : `${check.ratio.toFixed(1)}:1` }}</span>
          <span v-if="check.ok === null" class="mb-badge" title="This color format cannot be checked here">unknown</span>
          <span v-else-if="check.ok" class="mb-badge-ok">ok</span>
          <span v-else class="mb-badge-warn" :title="`Needs ${check.needs === 'aa' ? '4.5' : '3'}:1 to be easy to read`">low</span>
        </li>
      </ul>
    </section>

    <section class="ws:space-y-3">
      <div class="ws:flex ws:items-center ws:gap-2">
        <h3 class="ws:flex-1 ws:text-sm ws:font-bold">Palette</h3>
        <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" @click="addPalette">
          <Icon name="plus" class="mb-icon-sm" /> Add color
        </button>
      </div>
      <p class="mb-meta">Named colors the roles can point at. Renaming one updates the roles that use it.</p>
      <div v-for="(value, name) in colors.palette" :key="name" class="ws:space-y-0.5">
        <div class="ws:grid ws:grid-cols-[7rem_minmax(0,1fr)_auto] ws:items-center ws:gap-2">
          <input
            class="mb-input mb-input-mono mb-input-sm"
            :class="renameErrors[name] ? 'mb-invalid' : ''"
            :value="name"
            :aria-label="`Name of ${name}`"
            :disabled="readOnly"
            spellcheck="false"
            @change="renamePalette(name, $event)"
          />
          <ColorInput :model-value="value" :aria-label="`Color ${name}`" :disabled="readOnly" @update:model-value="setPaletteValue(name, $event)" />
          <IconButton
            v-if="!readOnly"
            icon="trash"
            :label="`Remove ${name}`"
            :title="usedBy(name).length ? `Used by ${usedBy(name).map(colorRoleLabel).join(', ')}; they keep its color` : 'Remove'"
            danger
            @click="removePalette(name)"
          />
        </div>
        <p v-if="renameErrors[name]" class="mb-error">{{ renameErrors[name] }}</p>
      </div>
    </section>
  </div>
</template>
