<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Accordion from '@manablox/admin-sdk/components/ui/Accordion.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import { approvals, useApproval } from '@manablox/admin-sdk/features/content/queries';
import { formatDateTime } from '@manablox/admin-sdk/lib/format';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import ApprovalNoteDialog from './ApprovalNoteDialog.vue';

/** The editor's review panel. Authors request or withdraw; reviewers approve or reject. Both means reviewer. */
const props = defineProps<{
  spaceId: string;
  contentId: string;
  /** May request review. */
  canWrite: boolean;
  /** May decide. */
  canPublish: boolean;
  isPublished: boolean;
}>();
const emit = defineEmits<{
  /** Published by an approval. */
  published: [];
}>();

const session = useSessionStore();
const {
  data: state,
  isPending,
  error,
  refetch,
} = useApproval(
  () => props.contentId,
  true,
  () => props.spaceId,
);

const pending = computed(() => state.value?.pending ?? null);
const latest = computed(() => state.value?.latest ?? null);
const isRequester = computed(() => pending.value?.requestedBy === session.me?.id);
const rejected = computed(() =>
  !pending.value && latest.value?.status === 'rejected' ? latest.value : null,
);

type Step = 'request' | 'approve' | 'reject' | null;
const dialog = ref<Step>(null);
const busy = ref(false);

const DONE: Record<Exclude<Step, null>, string> = {
  request: 'Asked for approval - whoever can publish this type has been told',
  approve: 'Approved and published',
  reject: 'Sent back to the author',
};

async function run(step: Exclude<Step, null>, note: string) {
  const value = note || null;
  await runWrite(
    async () => {
      if (step === 'request') {
        await approvals.request(props.spaceId, props.contentId, value);
      } else if (step === 'approve') {
        await approvals.approve(props.spaceId, props.contentId, value);
        emit('published');
      } else {
        await approvals.reject(props.spaceId, props.contentId, value);
      }
    },
    { success: DONE[step], busy },
  );
  dialog.value = null;
}

function withdraw() {
  return runWrite(() => approvals.withdraw(props.spaceId, props.contentId), {
    success: 'Request withdrawn',
    busy,
  });
}
</script>

<template>
  <div class="mb-card space-y-3">
    <div class="flex items-center gap-2">
      <h2 class="flex-1 text-sm font-bold">Approval</h2>
      <span v-if="pending" class="mb-badge-warn">awaiting approval</span>
      <span v-else-if="rejected" class="mb-badge-danger">sent back</span>
      <span v-else-if="latest?.status === 'approved'" class="mb-badge-ok">approved</span>
    </div>

    <AsyncList :pending="isPending" :error="error" :retry="refetch" :items="state ? [state] : []" :rows="2">
    <!-- Pending. -->
    <template v-if="pending">
      <p class="text-sm">
        <span class="font-medium">{{ pending.requestedByLabel }}</span> asked for this to be published
        <span class="text-surface-500">{{ formatDateTime(pending.requestedAt) }}</span>.
      </p>
      <blockquote v-if="pending.requestNote" class="border-l-2 border-surface-300 pl-3 text-sm text-surface-600 dark:border-surface-700 dark:text-surface-300">
        {{ pending.requestNote }}
      </blockquote>
      <div v-if="canPublish" class="flex flex-wrap gap-2">
        <button type="button" class="mb-btn-primary" :disabled="busy" @click="dialog = 'approve'">
          <Icon name="check" /> Approve and publish
        </button>
        <button type="button" class="mb-btn-outline" :disabled="busy" @click="dialog = 'reject'">
          <Icon name="reset" /> Send back
        </button>
      </div>
      <div v-else-if="isRequester && canWrite">
        <button type="button" class="mb-btn-outline" :disabled="busy" @click="withdraw">
          Withdraw the request
        </button>
      </div>
      <p v-else class="mb-hint">Waiting for someone who can publish this type.</p>
    </template>

    <!-- Nothing open: the last decision, if any. -->
    <template v-else>
      <div v-if="rejected" class="mb-callout text-sm">
        <p>
          <span class="font-medium">{{ rejected.decidedByLabel }}</span> sent this back
          <span class="text-surface-500">{{ rejected.decidedAt ? formatDateTime(rejected.decidedAt) : '' }}</span>.
        </p>
        <blockquote v-if="rejected.decisionNote" class="mt-1 border-l-2 border-surface-300 pl-3 text-surface-600 dark:border-surface-700 dark:text-surface-300">
          {{ rejected.decisionNote }}
        </blockquote>
      </div>
      <p v-else-if="latest?.status === 'approved'" class="mb-meta">
        Approved by {{ latest.decidedByLabel }}<template v-if="latest.decidedAt"> {{ formatDateTime(latest.decidedAt) }}</template>.
      </p>
      <p v-else-if="canPublish" class="mb-hint">
        Documents of this type go through review. You can publish them yourself; a request from someone who cannot shows up here.
      </p>
      <p v-else class="mb-hint">
        Documents of this type are published by someone else once you ask.
      </p>
      <FeatureGate v-if="canWrite && !canPublish" feature="approvals" label="Ask for approval" trigger-class="mb-btn-primary">
        <button type="button" class="mb-btn-primary" :disabled="busy" @click="dialog = 'request'">
          <Icon name="send" /> {{ rejected ? 'Ask again' : 'Ask for approval' }}
        </button>
      </FeatureGate>
    </template>
    </AsyncList>

    <Accordion
      v-if="(state?.history.length ?? 0) > 1"
      :items="[{ value: 'history', label: 'Earlier requests', hint: String((state?.history.length ?? 1) - 1) }]"
    >
      <ul class="mb-list">
        <li v-for="entry in state?.history.slice(1)" :key="entry.id">
          {{ entry.status }} - asked by {{ entry.requestedByLabel }} {{ formatDateTime(entry.requestedAt) }}<template v-if="entry.decidedByLabel">, decided by {{ entry.decidedByLabel }}</template>
        </li>
      </ul>
    </Accordion>

    <ApprovalNoteDialog
      v-if="dialog === 'request'"
      title="Ask for approval"
      description="Whoever can publish this type is told, and can approve or send it back."
      confirm-label="Ask for approval"
      placeholder="Anything the reviewer should know"
      @close="dialog = null"
      @confirm="run('request', $event)"
    />
    <ApprovalNoteDialog
      v-else-if="dialog === 'approve'"
      title="Approve and publish"
      description="The document goes live and the author is told."
      confirm-label="Approve and publish"
      placeholder="A word for the author"
      @close="dialog = null"
      @confirm="run('approve', $event)"
    />
    <ApprovalNoteDialog
      v-else-if="dialog === 'reject'"
      title="Send back"
      description="The author is told and can ask again once it is fixed."
      confirm-label="Send back"
      placeholder="What should change"
      :optional="false"
      danger
      @close="dialog = null"
      @confirm="run('reject', $event)"
    />
  </div>
</template>
