import { runWrite } from '@manablox/admin-sdk';
import { computed, type Ref, ref, shallowRef } from 'vue';
import type { AiDesignInput, AiDesignRun } from './admin-api';

/**
 * A design job's state: prompt, provider, busy flag, error and answer. `design` gets the
 * trimmed prompt and the provider when one is picked.
 */
export function useDesignRun<T>(
  design: (input: AiDesignInput) => Promise<T>,
  options: { ready?: () => boolean } = {},
): AiDesignRun<T> {
  const provider = ref('');
  const prompt = ref('');
  const busy = ref(false);
  const note = ref<string | null>(null);
  const result = shallowRef<T | null>(null) as Ref<T | null>;
  const ready = computed(() => (options.ready ? options.ready() : Boolean(prompt.value.trim())));

  async function run() {
    if (!ready.value || busy.value) return;
    await runWrite(
      async () => {
        result.value = await design({
          prompt: prompt.value.trim(),
          ...(provider.value ? { providerKind: provider.value } : {}),
        });
      },
      { busy, error: note },
    );
  }

  return { provider, prompt, busy, note, result, ready, run };
}
