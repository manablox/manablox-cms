<script setup lang="ts">
import { Radio } from '@manablox/admin-sdk';
import type { DesignPreset, ThemeDesign, Tone } from '@manablox/site';
import { computed } from 'vue';
import { resolveColor } from '../../model/color';

/** A design preset to pick: a small wireframe of its page in the chosen theme's colors. */
const model = defineModel<string>({ required: true });
const props = defineProps<{
  preset: Pick<DesignPreset, 'id' | 'name' | 'description' | 'look'>;
  theme: ThemeDesign;
  name: string;
}>();

const color = (role: string) => resolveColor(props.theme.colors, role) ?? 'transparent';
const look = computed(() => props.preset.look);

function tone(value: Tone): { background: string; color: string } {
  switch (value) {
    case 'surface':
      return { background: color('surface'), color: color('text') };
    case 'primary':
      return { background: color('primary'), color: color('onPrimary') };
    case 'gradient':
      return {
        background: `linear-gradient(135deg, ${color('primary')}, color-mix(in srgb, ${color('accent')} 45%, ${color('primary')}))`,
        color: color('onPrimary'),
      };
    case 'ink':
      return { background: color('text'), color: color('bg') };
    default:
      return { background: color('bg'), color: color('text') };
  }
}

const media = computed(
  () =>
    `linear-gradient(135deg, ${color('primary')}, color-mix(in srgb, ${color('accent')} 70%, transparent))`,
);
const radius = computed(() =>
  look.value.radius === '0' ? '0' : look.value.radius === 'radius:sm' ? '1px' : '3px',
);
const floating = computed(() => look.value.header.kind === 'floating');
const hero = computed(() => look.value.hero);
/** A panel hero sits on the page with its own colored box. */
const heroBand = computed(() => (hero.value === 'panel' ? tone('bg') : tone(look.value.heroTone)));
const panel = computed(() =>
  look.value.heroTone === 'bg' || look.value.heroTone === 'surface'
    ? {
        background: `linear-gradient(135deg, color-mix(in srgb, ${color('primary')} 18%, ${color('surface')}), color-mix(in srgb, ${color('accent')} 22%, ${color('surface')}))`,
        color: color('text'),
      }
    : tone(look.value.heroTone),
);
const card = computed(() => {
  switch (look.value.card) {
    case 'elevated':
      return { background: color('surface'), boxShadow: '0 1px 3px rgb(0 0 0 / 0.15)' };
    case 'bordered':
      return { background: color('bg'), border: `1px solid ${color('border')}` };
    case 'outlined':
      return {
        background: color('bg'),
        border: `1px solid ${color('text')}`,
        boxShadow: `1px 1px 0 ${color('text')}`,
      };
    case 'tinted':
      return { background: `color-mix(in srgb, ${color('primary')} 10%, ${color('bg')})` };
    case 'accent':
      return {
        background: color('surface'),
        borderTop: `2px solid ${color('primary')}`,
      };
    default:
      return {};
  }
});
const cards = computed(() => (look.value.columns === 2 ? 2 : 3));
const menuItem = (n: number) => {
  const current = n === 1;
  switch (look.value.menu.style) {
    case 'pill':
      return {
        background: current ? color('primary') : 'currentColor',
        opacity: current ? 1 : 0.45,
      };
    case 'boxed':
      return {
        background: current ? 'currentColor' : 'transparent',
        outline: '1px solid currentColor',
        opacity: current ? 1 : 0.55,
      };
    default:
      return { background: 'currentColor', opacity: current ? 1 : 0.45 };
  }
};
</script>

<template>
  <div
    class="ws:flex ws:cursor-pointer ws:flex-col ws:gap-2 ws:rounded-control ws:border ws:p-2 ws:text-sm ws:transition"
    @click="model = preset.id"
    :class="
      model === preset.id
        ? 'ws:border-brand-500 ws:bg-brand-50 ws:dark:border-brand-400 ws:dark:bg-brand-600/15'
        : 'ws:border-surface-200 ws:hover:border-surface-300 ws:dark:border-surface-700 ws:dark:hover:border-surface-600'
    "
  >
    <span
      class="ws:flex ws:h-32 ws:flex-col ws:overflow-hidden ws:rounded-sm ws:border ws:border-surface-200 ws:dark:border-surface-700"
      :style="{ background: color('bg') }"
      aria-hidden="true"
    >
      <span
        v-if="look.header.strip"
        class="ws:h-0.5 ws:shrink-0"
        :style="{ background: `linear-gradient(90deg, ${color('primary')}, ${color('accent')})` }"
      />
      <span class="ws:shrink-0" :class="floating ? 'ws:px-1.5 ws:pt-1' : ''">
        <span
          class="ws:flex ws:gap-1 ws:px-2 ws:py-1"
          :class="[
            look.header.kind === 'centered' ? 'ws:flex-col ws:items-center' : 'ws:items-center ws:justify-between',
            floating ? 'ws:rounded-sm ws:shadow-sm' : '',
          ]"
          :style="{
            ...tone(look.header.tone),
            ...(look.header.border && !floating ? { borderBottom: `1px solid ${color('border')}` } : {}),
          }"
        >
          <span class="ws:h-1 ws:w-6 ws:rounded-pill" :style="{ background: 'currentColor' }" />
          <span class="ws:flex ws:gap-1">
            <span v-for="n in 3" :key="n" class="ws:h-1 ws:w-2.5 ws:rounded-pill" :style="menuItem(n)" />
          </span>
        </span>
      </span>

      <!-- Hero -->
      <span class="ws:flex ws:shrink-0 ws:flex-col" :style="heroBand">
        <span v-if="hero === 'fullbleed'" class="ws:flex ws:flex-col ws:items-center ws:gap-0.5 ws:px-2 ws:pt-2 ws:pb-1.5">
          <span class="ws:h-1.5 ws:w-14 ws:rounded-pill" :style="{ background: 'currentColor' }" />
          <span class="ws:h-1 ws:w-10 ws:rounded-pill ws:opacity-50" :style="{ background: 'currentColor' }" />
        </span>
        <span v-if="hero === 'fullbleed'" class="ws:h-5 ws:w-full" :style="{ background: media }" />
        <span
          v-else-if="hero === 'panel'"
          class="ws:m-1.5 ws:flex ws:items-center ws:gap-2 ws:p-1.5"
          :class="look.mirror ? 'ws:flex-row-reverse' : ''"
          :style="{ ...panel, borderRadius: radius }"
        >
          <span class="ws:flex ws:flex-1 ws:flex-col ws:gap-0.5">
            <span class="ws:h-1.5 ws:w-12 ws:rounded-pill" :style="{ background: 'currentColor' }" />
            <span class="ws:h-1 ws:w-8 ws:rounded-pill ws:opacity-50" :style="{ background: 'currentColor' }" />
          </span>
          <span class="ws:size-6 ws:shrink-0" :style="{ background: media, borderRadius: radius }" />
        </span>
        <span v-else-if="hero === 'statement'" class="ws:flex ws:flex-col ws:gap-1 ws:px-2 ws:py-2">
          <span class="ws:h-2 ws:w-4/5 ws:rounded-pill" :style="{ background: 'currentColor' }" />
          <span class="ws:flex ws:items-end ws:gap-2">
            <span class="ws:h-1 ws:w-8 ws:shrink-0 ws:rounded-pill ws:opacity-50" :style="{ background: 'currentColor' }" />
            <span class="ws:h-4 ws:flex-1" :style="{ background: media, borderRadius: radius }" />
          </span>
        </span>
        <span v-else-if="hero === 'compact'" class="ws:flex ws:items-center ws:justify-between ws:gap-2 ws:px-2 ws:py-1.5">
          <span class="ws:flex ws:flex-col ws:gap-0.5">
            <span class="ws:h-1.5 ws:w-12 ws:rounded-pill" :style="{ background: 'currentColor' }" />
            <span class="ws:h-1 ws:w-9 ws:rounded-pill ws:opacity-50" :style="{ background: 'currentColor' }" />
          </span>
          <span class="ws:size-4 ws:shrink-0" :style="{ background: media, borderRadius: radius }" />
        </span>
        <span
          v-else
          class="ws:flex ws:gap-2 ws:px-2 ws:py-2"
          :class="{
            'ws:items-center': hero === 'split' || hero === 'portrait',
            'ws:flex-row-reverse': hero === 'split' && look.mirror,
            'ws:flex-col ws:items-center': hero === 'display',
            'ws:flex-col': hero === 'editorial',
          }"
        >
          <span
            v-if="hero === 'portrait'"
            class="ws:size-6 ws:shrink-0 ws:rounded-pill"
            :style="{ background: media, border: `1px solid ${color('bg')}` }"
          />
          <span class="ws:flex ws:flex-1 ws:flex-col ws:gap-0.5" :class="hero === 'display' ? 'ws:items-center' : ''">
            <span class="ws:h-1.5 ws:w-14 ws:rounded-pill" :style="{ background: 'currentColor' }" />
            <span class="ws:h-1 ws:w-10 ws:rounded-pill ws:opacity-50" :style="{ background: 'currentColor' }" />
          </span>
          <span v-if="hero === 'editorial'" class="ws:h-px ws:w-full ws:opacity-40" :style="{ background: 'currentColor' }" />
          <span
            v-if="hero === 'split'"
            class="ws:h-7 ws:w-10 ws:shrink-0"
            :style="{ background: media, borderRadius: radius }"
          />
          <span
            v-if="hero === 'display' || hero === 'editorial'"
            class="ws:h-3 ws:w-full"
            :style="{ background: media, borderRadius: radius }"
          />
        </span>
      </span>

      <!-- Lists -->
      <span v-if="look.list === 'grid'" class="ws:grid ws:flex-1 ws:gap-1 ws:px-2 ws:py-1.5" :style="{ gridTemplateColumns: `repeat(${cards}, minmax(0, 1fr))` }">
        <span
          v-for="n in cards"
          :key="n"
          class="ws:flex ws:flex-col ws:overflow-hidden"
          :style="{ ...card, borderRadius: radius }"
        >
          <span class="ws:h-3" :style="{ background: media }" />
          <span class="ws:m-0.5 ws:h-0.5 ws:w-2/3 ws:rounded-pill" :style="{ background: color('text') }" />
        </span>
      </span>
      <span v-else class="ws:flex ws:flex-1 ws:flex-col ws:px-2 ws:py-1">
        <span
          v-for="n in 3"
          :key="n"
          class="ws:flex ws:items-center ws:gap-1.5 ws:py-0.5"
          :style="{ borderTop: `1px solid ${color('border')}` }"
        >
          <span
            v-if="look.list === 'rows'"
            class="ws:h-2.5 ws:w-4 ws:shrink-0"
            :style="{ background: media, borderRadius: radius }"
          />
          <span class="ws:h-0.5 ws:flex-1 ws:rounded-pill" :style="{ background: color('text'), maxWidth: '60%' }" />
          <span v-if="look.list === 'index'" class="ws:ml-auto ws:h-0.5 ws:w-1.5" :style="{ background: color('primary') }" />
        </span>
      </span>
      <span class="ws:h-2.5 ws:shrink-0" :style="tone(look.footer.tone)" />
    </span>
    <span class="ws:flex ws:flex-col ws:gap-0.5">
      <Radio v-model="model" :name="name" :value="preset.id">
        <span class="ws:font-medium">{{ preset.name }}</span>
      </Radio>
      <span class="ws:block ws:text-2xs ws:text-surface-500">{{ preset.description }}</span>
    </span>
  </div>
</template>
