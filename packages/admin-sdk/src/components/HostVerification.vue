<script setup lang="ts">
import Icon from './Icon.vue';
import CopyField from './ui/CopyField.vue';

/** How a custom host proves it belongs to this instance, as the server reports it. */
export interface HostVerificationState {
  status: 'verified' | 'pending' | 'failed';
  required: boolean;
  txtName: string;
  txtValue: string | null;
  cnameTarget: string | null;
}

/** The DNS record that verifies a host, with a "Verify now" check. */
defineProps<{
  hostname: string;
  verification: HostVerificationState;
  canManage: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ verify: [] }>();
</script>

<template>
  <div v-if="verification.status !== 'verified'" class="mb-callout mt-2 space-y-2 text-xs" role="note">
    <p>
      <template v-if="verification.status === 'failed'">No matching DNS record turned up within a week, so the automatic checks stopped. Add the record, then use Verify now.</template>
      <template v-else-if="verification.required">Not served until it is verified. Add this DNS record at the domain provider; it is checked every ten minutes.</template>
      <template v-else>Not verified yet. It is served anyway, since this installation does not ask for verification.</template>
    </p>
    <div class="space-y-1">
      <CopyField inline :value="verification.txtName" label="TXT name" />
      <CopyField v-if="verification.txtValue" inline :value="verification.txtValue" label="TXT value" />
    </div>
    <p v-if="verification.cnameTarget">
      Or point the name itself at <span class="font-mono">{{ verification.cnameTarget }}</span> with a
      <code class="font-mono">CNAME</code> record.
    </p>
    <button v-if="canManage" type="button" class="mb-btn-outline mb-btn-sm" :disabled="busy" :aria-label="`Verify ${hostname} now`" @click="emit('verify')">
      <Icon name="repeat" class="mb-icon-sm" /> {{ busy ? 'Checking...' : 'Verify now' }}
    </button>
  </div>
</template>
