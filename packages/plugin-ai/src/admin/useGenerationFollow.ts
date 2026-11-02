import { messageForKey } from '@manablox/admin-sdk';
import { onScopeDispose } from 'vue';
import { type AiGeneration, ai } from './queries';

const FIRST_POLL_MS = 1500;
const POLL_MS = 3000;

/** The message for a failed generation row. */
export function generationFailure(row: AiGeneration): string {
  return row.error
    ? messageForKey(row.error, row.errorDetail ?? undefined)
    : 'The generation failed.';
}

/**
 * Polls media generations until they settle; `null` once the owner unmounts. The server
 * keeps working either way. Request failures reject.
 */
export function useGenerationFollow(spaceId: () => string) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  onScopeDispose(() => {
    disposed = true;
    if (timer) clearTimeout(timer);
    wake?.();
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });
  }

  async function follow(id: string): Promise<AiGeneration | null> {
    await sleep(FIRST_POLL_MS);
    while (!disposed) {
      const row = (await ai.generation(spaceId(), id)) as AiGeneration;
      if (row.status === 'succeeded' || row.status === 'failed') return row;
      await sleep(POLL_MS);
    }
    return null;
  }

  return { follow };
}
