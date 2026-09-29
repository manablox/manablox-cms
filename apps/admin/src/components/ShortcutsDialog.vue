<script setup lang="ts">
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import Kbd from '@manablox/admin-sdk/components/ui/Kbd.vue';
import { helpOpen, isMac, shortcutGroups } from '@manablox/admin-sdk/lib/shortcuts';
import { computed } from 'vue';

/** Lists the live shortcut registry; unavailable shortcuts are dimmed, not hidden. */
const groups = computed(() => shortcutGroups.value.filter((group) => group.shortcuts.length > 0));
</script>

<template>
  <Dialog
    v-if="helpOpen"
    title="Keyboard shortcuts"
    width="max-w-2xl"
    dismissable
    @close="helpOpen = false"
  >
    <p class="text-sm text-surface-500">
      What the keyboard does on this page. The ones held with
      <span class="font-semibold">{{ isMac ? 'Command' : 'Ctrl' }}</span> or
      <span class="font-semibold">{{ isMac ? 'Option' : 'Alt' }}</span> work while you are
      typing; the single-letter ones wait until you leave the field.
    </p>

    <!-- CSS columns, not a grid, since sections differ greatly in length. -->
    <div class="mt-4 gap-x-8 sm:columns-2">
      <section v-for="group in groups" :key="group.name" class="mb-5 break-inside-avoid">
        <h3 class="mb-eyebrow mb-2">{{ group.name }}</h3>
        <ul class="mb-list-divided">
          <li
            v-for="shortcut in group.shortcuts"
            :key="`${group.name}:${shortcut.keys}:${shortcut.label}`"
            class="flex items-center gap-3 py-1.5"
            :class="shortcut.available ? '' : 'opacity-45'"
          >
            <span class="min-w-0 flex-1 text-sm">{{ shortcut.label }}</span>
            <Kbd :keys="shortcut.keys" />
          </li>
        </ul>
      </section>
    </div>

    <p v-if="!groups.length" class="py-6 text-center text-sm text-surface-500">
      This page has no shortcuts of its own.
    </p>
  </Dialog>
</template>
