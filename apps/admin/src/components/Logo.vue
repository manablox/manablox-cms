<script setup lang="ts">
import { WORDMARK_PATH } from '~/components/logo-wordmark';

/**
 * The Manablox mark, optionally with the wordmark; `public/logo.svg` is the same drawing.
 * Shown on the sign-in screen and in the navigation; deliberately not configurable.
 */
withDefaults(
  defineProps<{
    /** Pixel height. */
    size?: number;
    /** Wordmark in `currentColor`. */
    wordmark?: boolean;
    /** White brace for the brand-coloured panel. */
    onBrand?: boolean;
  }>(),
  { size: 32, wordmark: false, onBrand: false },
);
</script>

<template>
  <svg
    :height="size"
    :width="wordmark ? (size * 290) / 64 : size"
    :viewBox="wordmark ? '0 0 290 64' : '0 0 64 64'"
    role="img"
    aria-label="Manablox"
    class="shrink-0"
  >
    <path
      d="M29 6C19.5 6 17 9 17 16v9c0 4.5-2 7-7 7 5 0 7 2.5 7 7v9c0 7 2.5 10 12 10"
      fill="none"
      :stroke="onBrand ? '#ffffff' : '#ea7111'"
      stroke-width="7.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <rect x="36" y="21" width="22" height="22" rx="5.5" fill="#a23ffb" />

    <path v-if="wordmark" transform="translate(76 48)" fill="currentColor" :d="WORDMARK_PATH" />
  </svg>
</template>
