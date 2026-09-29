<script setup lang="ts">
import AuthScene from '~/components/AuthScene.vue';
import Logo from '~/components/Logo.vue';
import ThemeToggle from '~/components/ThemeToggle.vue';

/**
 * Split layout for login and install: brand panel with the scene, form on the right. On
 * large screens it fills the window and only the form column scrolls.
 */
withDefaults(
  defineProps<{
    /** Width of the form column: `wide` for forms, `xl` for galleries. */
    size?: 'narrow' | 'wide' | 'xl';
  }>(),
  { size: 'narrow' },
);
const WIDTHS = { narrow: 'max-w-sm', wide: 'max-w-2xl', xl: 'max-w-3xl' } as const;
</script>

<template>
  <div class="grid min-h-full lg:h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <section
      class="relative isolate flex flex-col overflow-hidden bg-brand-600 p-8 text-white [--auth-panel:var(--color-brand-600)] lg:p-12 dark:bg-brand-800 dark:[--auth-panel:var(--color-brand-800)]"
    >
      <!-- Scene structure, scrim for copy contrast, then the flow layer masked away from the copy.
           Paint order stacks them; hidden below `lg`. -->
      <div class="pointer-events-none absolute inset-y-0 -right-[8%] hidden w-[78%] lg:block">
        <AuthScene layer="structure" />
      </div>
      <div
        class="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,var(--auth-panel)_0%,var(--auth-panel)_32%,color-mix(in_oklab,var(--auth-panel)_58%,transparent)_60%,transparent_92%)]"
      />
      <div
        class="pointer-events-none absolute inset-y-0 -right-[8%] hidden w-[78%] [mask-image:linear-gradient(100deg,transparent_0%,transparent_26%,black_54%)] lg:block"
      >
        <AuthScene layer="flow" />
      </div>

      <RouterLink to="/" class="relative" aria-label="Manablox">
        <Logo :size="34" wordmark on-brand />
      </RouterLink>

      <!-- `my-auto` keeps the logo at the top and centres the copy below it. -->
      <div class="relative my-auto py-12 lg:py-0">
        <slot name="panel" />
      </div>
    </section>

    <!-- `m-auto` centres a short form and lets a tall one start at the top and scroll. -->
    <section class="relative flex flex-col px-6 pt-6 lg:overflow-y-auto lg:px-12 lg:pt-12">
      <div class="absolute top-4 right-4"><ThemeToggle /></div>
      <div class="m-auto w-full pb-6 lg:pb-12" :class="WIDTHS[size]">
        <slot />
      </div>
    </section>
  </div>
</template>
