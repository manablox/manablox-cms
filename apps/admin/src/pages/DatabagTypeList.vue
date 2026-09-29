<script setup lang="ts">
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import SectionIntro from '@manablox/admin-sdk/components/ui/SectionIntro.vue';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';

/** The `/databag-types` landing; the list is the shell's side column. */
const spaces = useSpaceStore();
const canWrite = useCan('contentType:write');
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Databag types"
      description="The shape of each databag. Pick a type on the left to edit its fields, or start a new one here."
    >
      <NewButton label="New databag type" to="/databag-types/new" :enabled="canWrite" />
    </PageHeader>

    <section class="mb-card">
      <SectionIntro icon="database" title="Databag types" :count="spaces.dataKinds.length" stacked>
        A databag holds flat records, such as products, team members or FAQs. Its entries
        have a title and the fields defined here, can be translated, published and
        referenced from documents, but never appear in the content tree or in menus and
        have no URL of their own. Editors browse them under
        <RouterLink to="/databags" class="underline">Databags</RouterLink>.
      </SectionIntro>
    </section>

    <p class="mt-6 mb-meta">
      Types marked <span class="mb-badge">code</span> come from <code class="font-mono">manablox.config.ts</code> and are read-only here.
    </p>
  </div>
</template>
