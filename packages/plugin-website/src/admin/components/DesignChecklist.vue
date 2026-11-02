<script setup lang="ts">
import { Icon, ProgressBar, useFeature } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { isDirty } from '../model/status';
import type { SiteDesignSummary } from '../queries';

/** First steps of a designed site, ticked off from what the space already has; domains while `customDomains` is on. */
const props = defineProps<{
  designs: readonly SiteDesignSummary[];
  domainCount: number;
  revision: number;
}>();

const touched = (kind: SiteDesignSummary['kind']) =>
  props.designs.some((entry) => entry.kind === kind && entry.status !== 'generated');

const domains = useFeature('customDomains');

const steps = computed(() =>
  [
    {
      title: 'Pick colors and fonts',
      hint: 'The theme sets the look of everything else.',
      to: '/design/theme',
      done: touched('theme'),
    },
    {
      title: 'Shape your pages',
      hint: 'Choose where the title, text and blocks of a page go.',
      to: '/design/pages',
      done: touched('page'),
    },
    {
      title: 'Style your blocks',
      hint: 'Give the sections editors add to pages their look.',
      to: '/design/blocks',
      done: touched('block'),
    },
    {
      title: 'Set up header and footer',
      hint: 'Logo, menu and footer live in the layout.',
      to: '/design/layouts',
      done: touched('layout') || touched('menu'),
    },
    {
      title: 'Add a domain',
      hint: 'The address visitors type to reach the site.',
      to: '/settings?tab=apiHosts',
      done: props.domainCount > 0,
    },
    {
      title: 'Publish',
      hint: 'Nothing is public until you publish it.',
      to: null,
      done: props.revision > 0 && !props.designs.some((entry) => isDirty(entry.status)),
    },
  ].filter((step) => step.to !== '/settings?tab=apiHosts' || domains.value.enabled),
);
const doneCount = computed(() => steps.value.filter((step) => step.done).length);
const next = computed(() => steps.value.find((step) => !step.done) ?? null);
</script>

<template>
  <section class="mb-card ws:space-y-3" aria-labelledby="design-checklist">
    <div class="ws:space-y-2">
      <div class="ws:flex ws:items-baseline ws:justify-between ws:gap-2">
        <h2 id="design-checklist" class="ws:text-base ws:font-bold">Getting started</h2>
        <span class="mb-meta">{{ doneCount }} of {{ steps.length }} done</span>
      </div>
      <ProgressBar :value="(doneCount / steps.length) * 100" label="Getting started progress" />
    </div>
    <ol class="ws:space-y-1">
      <li v-for="(step, index) in steps" :key="step.title">
        <component
          :is="step.to ? 'RouterLink' : 'div'"
          :to="step.to ?? undefined"
          class="ws:flex ws:items-start ws:gap-3 ws:rounded-control ws:px-2 ws:py-1.5"
          :class="[
            step.to ? 'ws:hover:bg-surface-100 ws:dark:hover:bg-surface-800' : '',
            next === step ? 'ws:bg-brand-50 ws:dark:bg-brand-900/25' : '',
          ]"
        >
          <span
            class="ws:mt-0.5 ws:flex ws:h-5 ws:w-5 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-pill ws:text-2xs ws:font-bold"
            :class="step.done ? 'ws:bg-ok-500 ws:text-white' : next === step ? 'ws:bg-brand-600 ws:text-white' : 'ws:border ws:border-surface-300 ws:text-surface-500 ws:dark:border-surface-700'"
          >
            <Icon v-if="step.done" name="check" class="mb-icon-sm" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="ws:min-w-0 ws:flex-1">
            <span class="ws:block ws:text-sm ws:font-medium" :class="step.done ? 'ws:text-surface-500 ws:line-through ws:decoration-surface-300' : ''">{{ step.title }}</span>
            <span v-if="!step.done" class="ws:block mb-meta">{{ step.hint }}</span>
          </span>
          <Icon v-if="step.to && !step.done" name="chevron" class="mb-icon-sm ws:mt-1 ws:shrink-0 ws:text-surface-400" />
        </component>
      </li>
    </ol>
  </section>
</template>
