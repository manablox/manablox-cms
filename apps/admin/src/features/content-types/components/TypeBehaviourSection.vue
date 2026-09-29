<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { computed } from 'vue';
import type { ContentTypeDraft } from '../model';

/** A type's kind and flags (slug, publishing, tree, menus, approval), edited in place on `draft`. */
const props = defineProps<{
  draft: ContentTypeDraft;
  readOnly: boolean;
}>();

const isBlock = computed(() => props.draft.kind === 'block');
const isData = computed(() => props.draft.kind === 'data');
</script>

<template>
  <div class="mb-card space-y-3">
    <h2 class="text-sm font-bold">Behaviour</h2>
    <FormField v-if="!isData" label="Kind" v-slot="{ id }">
      <Select
        :id="id"
        v-model="draft.kind"
        :disabled="readOnly || Boolean(draft.id)"
        :options="[
          { value: 'content', label: 'Content', hint: 'a routable document' },
          { value: 'block', label: 'Block', hint: 'embedded in a block field' },
        ]"
      />
    </FormField>

    <template v-if="!isBlock">
      <template v-if="!isData">
        <Checkbox v-model="draft.hasSlug" :disabled="readOnly">Has a slug and permalink</Checkbox>
      </template>
      <Checkbox v-model="draft.isPublishable" :disabled="readOnly">Publishable</Checkbox>
      <template v-if="!isData">
        <Checkbox v-model="draft.isVisibleInTree" :disabled="readOnly">Visible in the content tree</Checkbox>
        <Checkbox v-model="draft.canBeVisibleInMenu" :disabled="readOnly">Can appear in menus</Checkbox>
      </template>
      <FeatureGate feature="approvals">
        <div>
          <Checkbox v-model="draft.requiresApproval" :disabled="readOnly || !draft.isPublishable" :class="draft.isPublishable ? '' : 'opacity-50'">
            Needs approval before publishing
          </Checkbox>
          <p class="mb-hint">
            Someone who can write but not publish this type asks for approval; everyone who can publish it is told, and approves or sends it back.
          </p>
        </div>
        <template #locked="{ state }">
          <div class="flex items-center gap-1">
            <Checkbox v-model="draft.requiresApproval" disabled class="opacity-50">Needs approval before publishing</Checkbox>
            <FeatureLock feature="approvals" :state="state" />
          </div>
        </template>
      </FeatureGate>
      <p v-if="isData" class="mb-hint">
        Databag entries are flat records: no slug, no place in the tree, no menu entry. A site reads them through the delivery API. Unpublishable databags stay in the admin and are never delivered.
      </p>
    </template>
    <p v-else class="mb-hint">
      Block types are embedded in another type's block field; they have no URL of their own.
    </p>
  </div>
</template>
