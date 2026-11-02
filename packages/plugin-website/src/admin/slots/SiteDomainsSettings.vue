<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import {
  AsyncList,
  confirmAndRun,
  FeatureGate,
  HostVerification,
  Icon,
  requireSpace,
  runWrite,
  SectionIntro,
  useCan,
  useEnvironmentChoice,
  useFeature,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import DomainDialog from '../components/DomainDialog.vue';
import { domainUrl } from '../model/site-domains';
import { site as actions, type SiteDomain } from '../queries';
import { useSiteContext } from '../useSiteContext';

/** Settings -> API hosts: host names the designed site answers on. */
const props = defineProps<AdminSlotProps['space.domains']>();

const { settings, domains } = useSiteContext();
const canManage = useCan('website:domains');
/** Adding and changing domains can be locked; the existing ones serve on. */
const domainsFeature = useFeature('plugins.website.domains');
const canChange = computed(() => canManage.value && domainsFeature.value.enabled);
/** Domains belong to one environment; the list shows the open one's. */
const environment = useEnvironmentChoice();

const editing = ref<SiteDomain | null>(null);
const creating = ref(false);
/** The domain a "Verify now" check runs for. */
const verifying = ref<string | null>(null);

const rows = computed(() =>
  [...(domains.data.value ?? [])].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      (a.locale ?? '').localeCompare(b.locale ?? '') ||
      a.hostname.localeCompare(b.hostname),
  ),
);
const primaryOf = (domain: SiteDomain) =>
  rows.value.find((row) => row.isPrimary && row.locale === domain.locale) ?? null;
const openUrl = (domain: SiteDomain) => domainUrl(domain.hostname, settings.data.value?.siteUrl);

async function verify(domain: SiteDomain) {
  verifying.value = domain.id;
  try {
    await runWrite(() => actions.verifyDomain(requireSpace(), domain.id), {
      success: (row) =>
        row.verification.status === 'verified'
          ? `${domain.hostname} is verified`
          : `No matching DNS record for ${domain.hostname} yet`,
    });
  } finally {
    verifying.value = null;
  }
}

function remove(domain: SiteDomain) {
  return confirmAndRun(
    {
      title: `Remove ${domain.hostname}?`,
      message: domain.isPrimary
        ? 'It is a primary domain: links and the sitemap move to another domain of the same language, or to whatever host a visitor uses. Visitors on it get a "site not found" page.'
        : 'Visitors on it get a "site not found" page.',
      confirmLabel: 'Remove domain',
      danger: true,
    },
    () => actions.deleteDomain(requireSpace(), domain.id),
    { success: `Removed ${domain.hostname}` },
  );
}
</script>

<template>
  <div class="ws:mt-6 ws:space-y-4 ws:border-t ws:border-surface-200 ws:pt-6 ws:dark:border-surface-800" data-site-domains>
    <div class="ws:flex ws:flex-wrap ws:items-start ws:gap-3">
      <p class="ws:min-w-0 ws:flex-1 ws:text-sm ws:text-surface-500">
        The addresses the designed site answers on. Each one belongs to this space; a domain can also pin a language.
      </p>
      <FeatureGate v-if="canManage" feature="plugins.website.domains" label="Add domain" trigger-class="mb-btn-primary">
        <button type="button" class="mb-btn-primary" @click="creating = true">
          <Icon name="plus" /> Add domain
        </button>
      </FeatureGate>
    </div>

    <section class="ws:space-y-3">
      <SectionIntro icon="globe" tile="iris" title="Site domains" :count="rows.length" :blurb="environment.labelled.value ? `The domains of ${environment.currentName.value}; each environment has its own. The primary domain of a language is used for links, the sitemap and canonical addresses.` : 'The primary domain of a language is used for links, the sitemap and canonical addresses.'" />
      <AsyncList
        :pending="domains.isPending.value"
        :error="domains.error.value"
        :retry="domains.refetch"
        :items="rows"
        empty-icon="globe"
        empty-title="No domains yet"
        :empty-description="canManage ? 'Add one so visitors can reach the site. For a local try-out, add localhost.' : 'Someone who manages domains can add one.'"
        item-class="ws:py-3"
      >
        <template v-if="canChange" #empty-actions>
          <button type="button" class="mb-btn-primary" @click="creating = true">Add domain</button>
        </template>
        <template #item="{ item: domain }">
          <div class="ws:flex ws:flex-wrap ws:items-start ws:gap-3">
            <div class="ws:min-w-0 ws:flex-1">
              <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-2">
                <span class="ws:truncate ws:font-mono ws:text-sm">{{ domain.hostname }}</span>
                <span v-if="domain.isPrimary" class="mb-badge-ok">primary</span>
                <span v-if="domain.verification.status === 'pending'" class="mb-badge-warn">not verified</span>
                <span v-else-if="domain.verification.status === 'failed'" class="mb-badge-danger">verification failed</span>
                <span class="mb-badge">{{ domain.locale ?? 'every language' }}</span>
                <span v-if="environment.labelled.value" class="mb-badge" :title="`Serves the ${environment.currentName.value} environment`">{{ environment.currentName.value }}</span>
              </div>
              <p class="ws:mt-1 mb-meta">
                <template v-if="domain.isPrimary">Links and the sitemap use this name<template v-if="domain.locale"> for {{ domain.locale }}</template>.</template>
                <template v-else-if="domain.redirectToPrimary && primaryOf(domain)">Sends visitors on to {{ primaryOf(domain)!.hostname }} with a 301.</template>
                <template v-else-if="domain.redirectToPrimary">Would redirect, but its language has no primary domain, so it serves the site.</template>
                <template v-else>Serves the site too; canonical links point at the primary domain.</template>
              </p>
              <HostVerification :hostname="domain.hostname" :verification="domain.verification" :can-manage="canManage" :busy="verifying === domain.id" @verify="verify(domain)" />
            </div>
            <div class="ws:flex ws:max-w-full ws:flex-wrap ws:items-center ws:gap-2">
              <a :href="openUrl(domain)" target="_blank" rel="noopener" class="mb-btn-ghost" :aria-label="`Open ${domain.hostname}`">
                <Icon name="external" /> Open
              </a>
              <button v-if="canChange" type="button" class="mb-btn-ghost" :aria-label="`Edit ${domain.hostname}`" @click="editing = domain">Edit</button>
              <button v-if="canManage" type="button" class="mb-btn-ghost-danger" :aria-label="`Remove ${domain.hostname}`" @click="remove(domain)">
                <Icon name="trash" /> Remove
              </button>
            </div>
          </div>
        </template>
      </AsyncList>
    </section>

    <details class="ws:space-y-3 ws:text-sm">
      <summary class="ws:cursor-pointer ws:text-sm ws:font-semibold">Pointing a domain at the site</summary>
      <ol class="ws:list-decimal ws:space-y-2 ws:pl-5">
        <li>
          At your domain provider, add a DNS record for the name: an <code class="ws:font-mono">A</code>
          (or <code class="ws:font-mono">AAAA</code>) record with the server's IP address, or a
          <code class="ws:font-mono">CNAME</code> to the server's own host name. For the bare
          domain (example.com) most providers only allow an <code class="ws:font-mono">A</code> record.
        </li>
        <li>
          The server must send the name to the site process, which runs next to the admin (port
          3200 by default). The example setup does that with Caddy.
        </li>
        <li>
          HTTPS certificates: with Caddy's on-demand TLS, a certificate is fetched on the first
          visit. Caddy asks the site process at <code class="ws:font-mono">/_manablox/domain-check</code>
          first, so it only gets certificates for names listed here.
        </li>
        <li>
          Where the installation asks for proof of ownership, a new domain shows a
          <code class="ws:font-mono">TXT</code> record to add (or a <code class="ws:font-mono">CNAME</code>
          target). It is served once the record is found.
        </li>
        <li>DNS changes can take from minutes to a day to reach everyone. Then use Open to check.</li>
      </ol>
      <p class="mb-hint">
        Add both example.com and www.example.com, make one the primary and let the other redirect to
        it, so visitors and search engines see a single address.
      </p>
    </details>

    <DomainDialog v-if="creating" :domain="null" :domains="rows" :space-id="props.space.id" @close="creating = false" />
    <DomainDialog v-if="editing" :domain="editing" :domains="rows" :space-id="props.space.id" @close="editing = null" />
  </div>
</template>
