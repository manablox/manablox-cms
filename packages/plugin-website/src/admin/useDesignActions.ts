import { confirmAndRun, plural, requireSpace, runWrite } from '@manablox/admin-sdk';
import { ref } from 'vue';
import { shareUrl } from './model/canvas';
import { design, type SiteDesignSummary } from './queries';

type StoredSummary = SiteDesignSummary & { id: string };

/** Publish, discard, reset and preview, each with its feedback. */
export function useDesignActions() {
  const publishing = ref(false);
  const previewing = ref(false);
  const busyId = ref<string | null>(null);

  async function publishAll() {
    const spaceId = requireSpace();
    return runWrite(() => design.publishAll(spaceId), {
      busy: publishing,
      success: (result) =>
        result.published.length
          ? `Published ${plural(result.published.length, 'design')} - the site is at revision ${result.revision}`
          : 'Nothing to publish',
    });
  }

  async function publish(entry: StoredSummary) {
    const spaceId = requireSpace();
    busyId.value = entry.id;
    await runWrite(() => design.publish(spaceId, entry.id), {
      success: `Published "${entry.label}"`,
    });
    busyId.value = null;
  }

  async function discard(entry: StoredSummary) {
    const spaceId = requireSpace();
    return confirmAndRun(
      {
        title: `Discard the draft of "${entry.label}"?`,
        message:
          entry.status === 'unpublished'
            ? 'It was never published, so it goes back to the generated design.'
            : 'The draft goes back to what the site shows now.',
        confirmLabel: 'Discard draft',
        danger: true,
      },
      () => design.discardDraft(spaceId, entry.id),
      { success: `Discarded the draft of "${entry.label}"` },
    );
  }

  async function reset(entry: StoredSummary) {
    const spaceId = requireSpace();
    return confirmAndRun(
      {
        title: `Reset "${entry.label}" to the generated design?`,
        message:
          'The stored design, its draft and its live copy are removed, and the site builds it from the content model again. Its versions go too.',
        confirmLabel: 'Reset design',
        danger: true,
      },
      () => design.reset(spaceId, entry.id),
      { success: `Reset "${entry.label}"` },
    );
  }

  /** Opens the site with every draft applied, through a share link on `origin`. */
  async function previewDrafts(origin: string) {
    const spaceId = requireSpace();
    // Opened before the await, so pop-up blockers let it through.
    const tab = window.open('about:blank', '_blank');
    const ok = await runWrite(
      async () => {
        const token = await design.shareToken(spaceId);
        if (tab) tab.location.href = shareUrl(origin, token);
      },
      { busy: previewing },
    );
    if (!ok) tab?.close();
  }

  return { publishing, previewing, busyId, publishAll, publish, discard, reset, previewDrafts };
}
