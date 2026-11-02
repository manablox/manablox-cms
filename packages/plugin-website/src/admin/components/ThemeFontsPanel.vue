<script setup lang="ts">
import { DropdownMenu, FormField, Icon, plural, Select, TextField } from '@manablox/admin-sdk';
import {
  BUNDLED_FONTS,
  bundledFont,
  type FontFamily,
  type FontRole,
  type ThemeFonts,
} from '@manablox/site';
import { computed, ref } from 'vue';
import { FONT_ROLES, SOURCE_LABELS, withFamily, withoutFamily } from '../model/fonts';
import FontUploadDialog from './FontUploadDialog.vue';
import GoogleFontDialog from './GoogleFontDialog.vue';

/** Font families of the theme and which one each role uses. */
const props = defineProps<{ fonts: ThemeFonts; spaceId: string; readOnly?: boolean }>();
const emit = defineEmits<{ update: [fonts: ThemeFonts, group?: string] }>();

const adding = ref(false);
const dialog = ref<'google' | 'upload' | null>(null);

const familyOptions = computed(() =>
  props.fonts.families.map((family) => ({
    value: family.id,
    label: family.name,
    hint: SOURCE_LABELS[family.source],
  })),
);
const bundledLeft = computed(() =>
  BUNDLED_FONTS.filter((font) => !props.fonts.families.some((family) => family.id === font.id)),
);
const rolesOf = (id: string) =>
  FONT_ROLES.filter((entry) => props.fonts.roles[entry.role] === id).map((entry) => entry.label);

function setRole(role: FontRole, id: string) {
  emit('update', { ...props.fonts, roles: { ...props.fonts.roles, [role]: id } });
}

function add(family: FontFamily) {
  emit('update', withFamily(props.fonts, family));
  adding.value = false;
  dialog.value = null;
}

function setFallback(family: FontFamily, fallback: string | number | null | undefined) {
  emit(
    'update',
    withFamily(props.fonts, { ...family, fallback: String(fallback ?? '') }),
    `fallback:${family.id}`,
  );
}

const weightsOf = (family: FontFamily) =>
  [
    ...new Set(
      family.files.map((file) => `${file.weight}${file.style === 'italic' ? ' italic' : ''}`),
    ),
  ].join(', ');
</script>

<template>
  <div class="ws:space-y-6">
    <section class="ws:space-y-3">
      <h3 class="ws:text-sm ws:font-bold">Roles</h3>
      <FormField v-for="entry in FONT_ROLES" :key="entry.role" :label="entry.label" :hint="entry.hint">
        <template #default="{ id }">
          <Select
            :id="id"
            :model-value="fonts.roles[entry.role]"
            :options="familyOptions"
            :disabled="readOnly"
            @update:model-value="setRole(entry.role, $event)"
          />
        </template>
      </FormField>
    </section>

    <section class="ws:space-y-3">
      <div class="ws:flex ws:items-center ws:gap-2">
        <h3 class="ws:flex-1 ws:text-sm ws:font-bold">Families</h3>
        <DropdownMenu v-if="!readOnly" v-model:open="adding" align="end" class="ws:w-72">
          <template #trigger>
            <button type="button" class="mb-btn-ghost mb-btn-sm">
              <Icon name="plus" class="mb-icon-sm" /> Add font
              <Icon name="down" class="mb-icon-sm ws:opacity-60" />
            </button>
          </template>
          <div>
            <p class="mb-menu-label">Built in</p>
            <button
              v-for="font in bundledLeft"
              :key="font.id"
              type="button"
              class="mb-menu-item ws:w-full ws:text-left"
              @click="add(bundledFont(font.id))"
            >
              {{ font.name }}
            </button>
            <p v-if="bundledLeft.length === 0" class="ws:px-3 ws:py-1 mb-meta">All added.</p>
            <div class="mb-menu-separator" />
            <button type="button" class="mb-menu-item ws:w-full ws:text-left" @click="dialog = 'google'; adding = false">
              <Icon name="globe" class="mb-icon-sm" /> From Google Fonts...
            </button>
            <button type="button" class="mb-menu-item ws:w-full ws:text-left" @click="dialog = 'upload'; adding = false">
              <Icon name="upload" class="mb-icon-sm" /> Upload a woff2 file...
            </button>
          </div>
        </DropdownMenu>
      </div>
      <ul class="ws:space-y-2">
        <li v-for="family in fonts.families" :key="family.id" class="mb-surface-inset ws:space-y-2 ws:rounded-control ws:p-2.5">
          <div class="ws:flex ws:items-start ws:gap-2">
            <div class="ws:min-w-0 ws:flex-1">
              <p class="ws:truncate ws:text-sm ws:font-semibold">
                {{ family.name }}
                <span class="mb-badge ws:ml-1">{{ SOURCE_LABELS[family.source] }}</span>
              </p>
              <p class="ws:truncate ws:text-2xs ws:text-surface-500">
                {{ plural(family.files.length, 'file') }}: {{ weightsOf(family) }}
                <template v-if="rolesOf(family.id).length"> - used for {{ rolesOf(family.id).join(', ').toLowerCase() }}</template>
              </p>
            </div>
            <button
              v-if="!readOnly"
              type="button"
              class="mb-btn-ghost-danger mb-btn-icon mb-btn-sm"
              :disabled="rolesOf(family.id).length > 0"
              :title="rolesOf(family.id).length ? 'Pick another font for its roles first' : 'Remove'"
              :aria-label="`Remove ${family.name}`"
              @click="emit('update', withoutFamily(fonts, family.id))"
            >
              <Icon name="trash" class="mb-icon-sm" />
            </button>
          </div>
          <TextField
            :model-value="family.fallback"
            label="Fallback"
            class="mb-input-sm mb-input-mono"
            :readonly="readOnly"
            hint="Shown while the font loads, and for characters it lacks."
            @update:model-value="setFallback(family, $event)"
          />
        </li>
      </ul>
    </section>

    <GoogleFontDialog v-if="dialog === 'google'" :space-id="spaceId" @imported="add" @close="dialog = null" />
    <FontUploadDialog v-if="dialog === 'upload'" :space-id="spaceId" :fonts="fonts" @uploaded="add" @close="dialog = null" />
  </div>
</template>
