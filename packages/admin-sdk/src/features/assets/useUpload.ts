import { computed, type MaybeRefOrGetter, ref, toValue } from 'vue';
import { messageFor } from '../../lib/messages';
import { toast } from '../../lib/toast';
import { assets } from './queries';

export interface UploadOptions {
  spaceId: MaybeRefOrGetter<string | null>;
  /** Drops are ignored when false. */
  enabled: MaybeRefOrGetter<boolean>;
  /** Mime prefixes (`image/`) or exact types; anything else is refused before it is sent. */
  accept?: MaybeRefOrGetter<readonly string[] | undefined>;
  /** Called per uploaded file. */
  onUploaded?: (id: string, file: File) => void;
  /** Called once the batch is through, with the ids that landed. */
  onDone?: (ids: string[]) => void;
}

/** A file the browser typed matches one of the entries; an untyped file is left to the server. */
function isAccepted(file: File, accept: readonly string[]) {
  if (!accept.length || !file.type) return true;
  return accept.some((entry) =>
    entry.endsWith('/') ? file.type.startsWith(entry) : file.type === entry,
  );
}

/** Uploads from an input or a drop, tracking progress and refusals. One refusal does not stop the rest. */
export function useUpload(options: UploadOptions) {
  const dragging = ref(false);
  const progress = ref<{ done: number; total: number } | null>(null);
  const refused = ref<string | null>(null);
  const busy = computed(() => progress.value !== null);

  async function uploadFiles(files: FileList | File[]) {
    const spaceId = toValue(options.spaceId);
    const accept = toValue(options.accept) ?? [];
    const failures: string[] = [];
    const list = Array.from(files).filter((file) => {
      if (isAccepted(file, accept)) return true;
      failures.push(`${file.name}: this field does not take ${file.type}`);
      return false;
    });
    if ((!list.length && !failures.length) || !spaceId || !toValue(options.enabled)) return;
    progress.value = { done: 0, total: list.length };
    refused.value = null;
    const uploaded: string[] = [];
    const ids: string[] = [];
    for (const file of list) {
      try {
        const asset = await assets.upload(spaceId, file);
        uploaded.push(file.name);
        ids.push(asset.id);
        options.onUploaded?.(asset.id, file);
      } catch (err) {
        failures.push(`${file.name}: ${messageFor(err)}`);
      }
      progress.value = { done: progress.value.done + 1, total: list.length };
    }
    progress.value = null;
    if (uploaded.length) {
      toast.success(
        uploaded.length === 1 ? `Uploaded ${uploaded[0]}` : `Uploaded ${uploaded.length} files`,
      );
    }
    if (failures.length) {
      refused.value = `Not uploaded - ${failures.join('; ')}`;
      toast.error(
        failures.length === 1
          ? `Not uploaded: ${failures[0]}`
          : `${failures.length} files were not uploaded`,
      );
    }
    options.onDone?.(ids);
  }

  function onPick(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) void uploadFiles(input.files);
    input.value = '';
  }

  function onDrop(event: DragEvent) {
    dragging.value = false;
    if (event.dataTransfer?.files.length) void uploadFiles(event.dataTransfer.files);
  }

  /** `dragenter`/`dragover`: highlights only when uploads are allowed. */
  function onDragOver() {
    if (toValue(options.enabled)) dragging.value = true;
  }

  return { dragging, progress, busy, refused, uploadFiles, onPick, onDrop, onDragOver };
}
