<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import SectionIntro from '@manablox/admin-sdk/components/ui/SectionIntro.vue';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import { shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import PluginSlot from '~/components/PluginSlot';

/** The `/types` landing; the list is the shell's side column. */
const spaces = useSpaceStore();
const canWrite = useCan('contentType:write');

const kinds = computed(() => [
  {
    id: 'content' as const,
    title: 'Document types',
    count: spaces.creatableKinds.length,
    icon: 'doc',
    tile: 'clay' as const,
    blurb:
      'Each document in the tree is one of these. They can have a slug, be published and appear in menus.',
    to: '/types/new',
    keys: 'n',
    label: 'New document type',
  },
  {
    id: 'block' as const,
    title: 'Block types',
    count: spaces.blockKinds.length,
    icon: 'blocks',
    tile: 'ochre' as const,
    blurb:
      "Reusable pieces that editors stack inside a document's block field. They have no URL of their own.",
    to: '/types/new?kind=block',
    keys: 'b',
    label: 'New block type',
  },
]);

// One key per kind, in card order.
const router = useRouter();
useShortcuts(() => [
  {
    keys: 'b',
    label: 'New block type',
    enabled: canWrite,
    run: () => void router.push('/types/new?kind=block'),
  },
]);
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Content types"
      description="What can be written in this space. Pick a type on the left to edit it, or start a new one here."
    >
      <PluginSlot id="contentType.list.actions" :props="{}" />
      <NewButton label="New document type" to="/types/new" :enabled="canWrite" />
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2">
      <section v-for="kind in kinds" :key="kind.id" class="mb-card">
        <SectionIntro :icon="kind.icon" :title="kind.title" :count="kind.count" :tile="kind.tile" :blurb="kind.blurb" stacked>
          <template v-if="canWrite" #actions>
            <RouterLink :to="kind.to" class="mb-btn-outline" :title="shortcutHint(kind.keys, kind.label)">
              <Icon name="plus" /> {{ kind.label }}
            </RouterLink>
          </template>
        </SectionIntro>
      </section>
    </div>

    <p class="mt-6 mb-meta">
      Types marked <span class="mb-badge">code</span> come from <code class="font-mono">manablox.config.ts</code> and are read-only here.
      Both kinds behave identically everywhere else.
    </p>
  </div>
</template>
