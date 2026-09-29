import { content } from '@manablox/admin-sdk/features/content/queries';
import {
  isPending,
  type ScheduleWindow,
  saveScheduleWindow,
} from '@manablox/admin-sdk/lib/schedule';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';

/**
 * A document's publish state, kept outside the draft. Publishing by hand clears
 * `publishAt` (unpublishing clears `unpublishAt`), as the scheduler does.
 */
interface PublishingTarget {
  spaceId: string;
  id: string;
  title: string;
}

export interface PublishingOptions {
  /** The document being edited, or `null` while one is loading or being created. */
  target: () => PublishingTarget | null;
  /** Unsaved edits; publishing saves first. */
  isDirty: () => boolean;
  /** Saves and resolves to success; the caller reports failures. */
  save: () => Promise<boolean>;
  /** Shows "Saved", "Published", "Unpublished". */
  setStatus: (status: string | null) => void;
}

export function usePublishing(options: PublishingOptions) {
  /** `savedSincePublish` means a published document has something new to publish. */
  const isPublished = ref(false);
  const savedSincePublish = ref(false);
  const schedule = ref<ScheduleWindow>({ publishAt: null, unpublishAt: null });
  const showSchedule = ref(false);
  const savingSchedule = ref(false);

  const scheduled = computed(() => isPending(schedule.value));
  /** Never published, or changed since. */
  const canPublishNow = computed(
    () => !isPublished.value || savedSincePublish.value || options.isDirty(),
  );

  /** State for a new document or a failed load. */
  function reset(): void {
    isPublished.value = false;
    savedSincePublish.value = false;
    schedule.value = { publishAt: null, unpublishAt: null };
  }

  /** Takes the state of a freshly loaded document. */
  function adopt(row: {
    status: string;
    publishAt: Date | null;
    unpublishAt: Date | null;
    publishedAt?: Date | null;
    updatedAt?: Date | null;
  }): void {
    isPublished.value = row.status === 'published';
    schedule.value = { publishAt: row.publishAt, unpublishAt: row.unpublishAt };
    savedSincePublish.value =
      isPublished.value &&
      Boolean(row.publishedAt) &&
      Boolean(row.updatedAt) &&
      (row.updatedAt as Date).getTime() > (row.publishedAt as Date).getTime();
  }

  /** Called after a successful save. */
  function saved(): void {
    if (isPublished.value) savedSincePublish.value = true;
  }

  /** Published outside the editor, e.g. by an approval. */
  function publishedElsewhere(): void {
    isPublished.value = true;
    savedSincePublish.value = false;
  }

  async function publish(): Promise<void> {
    if (options.isDirty() && !(await options.save())) return;
    const target = options.target();
    if (!target) return;
    await runWrite(
      async () => {
        await content.publish(target.spaceId, target.id);
        isPublished.value = true;
        savedSincePublish.value = false;
        schedule.value = { ...schedule.value, publishAt: null };
        options.setStatus('Published');
      },
      { success: `Published "${target.title || 'Untitled'}"` },
    );
  }

  async function unpublish(): Promise<void> {
    const target = options.target();
    if (!target) return;
    await runWrite(
      async () => {
        await content.unpublish(target.spaceId, target.id);
        isPublished.value = false;
        savedSincePublish.value = false;
        schedule.value = { ...schedule.value, unpublishAt: null };
        options.setStatus('Unpublished');
      },
      { success: 'Unpublished - the live site no longer shows it' },
    );
  }

  async function saveSchedule(window: ScheduleWindow): Promise<void> {
    const target = options.target();
    if (!target) return;
    await saveScheduleWindow(
      (dates) => content.schedule(target.spaceId, target.id, dates),
      window,
      {
        busy: savingSchedule,
        noun: 'Schedule',
        onSaved: (row) => {
          schedule.value = { publishAt: row.publishAt, unpublishAt: row.unpublishAt };
          showSchedule.value = false;
        },
      },
    );
  }

  return {
    isPublished,
    savedSincePublish,
    schedule,
    showSchedule,
    savingSchedule,
    scheduled,
    canPublishNow,
    reset,
    adopt,
    saved,
    publishedElsewhere,
    publish,
    unpublish,
    saveSchedule,
  };
}
