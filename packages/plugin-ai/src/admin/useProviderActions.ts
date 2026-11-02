import { confirmAndRun, runWrite } from '@manablox/admin-sdk';
import { type MaybeRefOrGetter, ref, toValue } from 'vue';
import type { AiProviderRef } from '../sdk';
import { aiProviders } from './queries';

/** The test call and removal of one stored provider, with their feedback. */
export function useProviderActions(options: {
  spaceId: MaybeRefOrGetter<string>;
  /** The stored provider; null while it is not saved yet. */
  ref: MaybeRefOrGetter<AiProviderRef | null>;
  label: MaybeRefOrGetter<string>;
  /** What removing deletes, for the confirm. */
  removeMessage: string;
}) {
  const testing = ref(false);
  const tested = ref<'ok' | 'failed' | null>(null);

  async function runTest() {
    const target = toValue(options.ref);
    if (!target) return;
    const label = toValue(options.label);
    tested.value = null;
    const ok = await runWrite(() => aiProviders.test(toValue(options.spaceId), target), {
      success: `${label} answered`,
      busy: testing,
    });
    tested.value = ok ? 'ok' : 'failed';
  }

  function disconnect() {
    const target = toValue(options.ref);
    if (!target) return;
    const label = toValue(options.label);
    return confirmAndRun(
      {
        title: `Remove ${label}?`,
        message: options.removeMessage,
        confirmLabel: 'Remove',
        danger: true,
      },
      () => aiProviders.remove(toValue(options.spaceId), target),
      { success: `${label} removed` },
    );
  }

  return { testing, tested, runTest, disconnect };
}
