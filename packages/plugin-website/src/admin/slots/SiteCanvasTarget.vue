<script setup lang="ts">
import type { AdminPreviewFrame, AdminSlotProps } from '@manablox/admin-plugin';
import { plainClone, Switch, useSpaceStore } from '@manablox/admin-sdk';
import { WEBSITE_CHANNEL, type WebsiteCanvasMessages } from '@manablox/site';
import { computed, watch } from 'vue';
import { useContentCanvas } from '../useContentCanvas';

/** Frames the site canvas for a designed space and keeps it on the current designs. */
const props = defineProps<AdminSlotProps['content.preview.target']>();

const spaces = useSpaceStore();
const canvas = useContentCanvas({
  doc: () => props.document,
  contentType: () => props.type,
});
const draftDesigns = computed({
  get: () => canvas.variant.value === 'draft',
  set: (value: boolean) => {
    canvas.variant.value = value ? 'draft' : 'published';
  },
});

let frame: AdminPreviewFrame | null = null;

/** The canvas's render input with the draft as its document; false while it cannot go. */
function sendDesign(to: AdminPreviewFrame): boolean {
  const payload = canvas.payload.value;
  const document = to.document();
  if (!payload || !document) return false;
  const input = {
    ...payload.input,
    document: {
      id: document.id ?? 'draft',
      localizationId: document.id ?? 'draft',
      typeId: document.typeId,
      title: document.title,
      permalink: document.permalink,
      publishedAt: null,
      fields: document.fields,
    },
  };
  const message: WebsiteCanvasMessages['toPreview']['design'] = {
    input: plainClone(input) as unknown as Record<string, unknown>,
    css: payload.css,
    focus: null,
    readOnly: props.readOnly,
  };
  to.plugin(WEBSITE_CHANNEL).send('design', message);
  return true;
}

watch(
  () =>
    [
      canvas.resolved.value,
      canvas.designed.value,
      canvas.src.value,
      canvas.origin.value,
      canvas.generatedOnly.value,
      spaces.current?.url,
    ] as const,
  ([resolved, designed, src, origin, generatedOnly]) => {
    if (!resolved) return;
    // Without a canvas address the frontend URL stands in while there is one.
    if (!designed || (!(src && origin) && spaces.current?.url)) {
      props.preview.setTarget(null);
      return;
    }
    props.preview.setTarget({
      src: src && origin ? src : null,
      origin: origin ?? null,
      empty: 'The site has no address yet: set the site URL of the server or add a domain.',
      ...(generatedOnly ? { status: 'generated designs' } : {}),
      fields: canvas.fields,
      ready: (next) => {
        frame = next;
        sendDesign(next);
      },
    });
  },
  { immediate: true },
);

// After a design change the document follows, as on connect.
watch(canvas.payload, () => {
  if (frame && sendDesign(frame)) frame.sync();
});
</script>

<template>
  <Switch
    v-if="canvas.designed.value && !canvas.generatedOnly.value"
    v-model="draftDesigns"
    compact
    class="ws:mr-2"
    title="Show the design drafts instead of the published designs"
  >
    <span class="ws:hidden ws:text-xs ws:xl:inline">Draft designs</span>
  </Switch>
</template>
