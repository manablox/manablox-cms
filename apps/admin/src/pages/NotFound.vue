<script setup lang="ts">
import Logo from '~/components/Logo.vue';
</script>

<template>
  <div class="flex min-h-full items-center justify-center p-8">
    <div class="text-center">
      <Logo :size="64" class="mx-auto opacity-60" />
      <p class="mb-eyebrow mt-6">404</p>
      <h1 class="mb-title mt-1">That page does not exist</h1>
      <p class="mt-2 text-sm text-surface-500">The link may be old, or the document behind it was deleted.</p>
      <RouterLink to="/" class="mb-btn-primary mt-6">Back to the dashboard</RouterLink>
    </div>
  </div>
</template>
