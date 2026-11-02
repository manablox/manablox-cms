<script setup lang="ts">
import { CopyField, Icon } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { useAiCatalog } from '../queries';

/** Setup for external AI agents using the API: point them at `/llms.txt` with an API key. */
const catalog = useAiCatalog();
const guide = computed(() => catalog.data.value?.agentGuide ?? null);

const links = computed(() =>
  guide.value
    ? [
        {
          label: 'Guide for AI agents',
          url: guide.value.llms,
          hint: 'Start here: the model, the recipes, how to call.',
        },
        {
          label: 'Full reference',
          url: guide.value.llmsFull,
          hint: 'Every field type, workflow action and procedure.',
        },
        {
          label: 'OpenAPI document',
          url: guide.value.openapi,
          hint: 'The exact input schema of every procedure.',
        },
      ]
    : [],
);

const prompt = computed(() =>
  guide.value
    ? `Read ${guide.value.llms} to learn the Manablox API, then use it with the API key I give you (send it as the x-api-key header).`
    : '',
);
</script>

<template>
  <div v-if="guide">
    <p class="mb-hint ai:mb-3">
      An AI agent such as Claude Code can build content types, write documents and set up
      workflows for you through the API. Give it the guide below and an API key from
      Settings > API keys that allows only what the job needs.
    </p>
    <ul class="mb-list-divided ai:text-sm">
      <li v-for="link in links" :key="link.url" class="ai:flex ai:items-center ai:gap-3 ai:py-2">
        <div class="ai:min-w-0 ai:flex-1">
          <CopyField :value="link.url" :label="link.label" url inline />
          <p class="mb-meta">{{ link.hint }}</p>
        </div>
        <a :href="link.url" target="_blank" rel="noopener" class="mb-btn-ghost mb-btn-icon" :aria-label="`Open ${link.label}`">
          <Icon name="external" />
        </a>
      </li>
    </ul>

    <div class="ai:mt-4">
      <CopyField :value="prompt" label="A first message to the agent" multiline />
    </div>
  </div>
</template>
