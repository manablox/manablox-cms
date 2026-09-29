import { onServerPrefetch, ref, type Ref, watch } from 'vue';
import { useState } from '../lib/state.js';

export interface Loaded<T> {
  data: Ref<T | null>;
  error: Ref<unknown>;
  pending: Ref<boolean>;
}

/**
 * Loads a value once per key.
 *
 * On the server the loader runs during render, and the result is written into the state
 * the page carries to the browser. In the browser the first render takes that value
 * instead of fetching; every later change of the key (a navigation) fetches.
 *
 * On the server a failure is rethrown, so the request ends as a 503 rather than a page
 * that looks empty. In the browser it is kept in `error` for the component to show.
 */
export function useLoad<T>(key: () => string, load: () => Promise<T>): Loaded<T> {
  const state = useState();
  const data = ref(null) as Ref<T | null>;
  const error = ref<unknown>(null);
  const pending = ref(false);

  async function run() {
    pending.value = true;
    error.value = null;
    try {
      data.value = await load();
      if (import.meta.env.SSR) state.data[key()] = data.value;
    } catch (caught) {
      if (import.meta.env.SSR) throw caught;
      error.value = caught;
    } finally {
      pending.value = false;
    }
  }

  if (import.meta.env.SSR) {
    onServerPrefetch(run);
  } else {
    const hydrated = state.data[key()];
    if (hydrated !== undefined) {
      data.value = hydrated as T;
      delete state.data[key()]; // used once; the next visit fetches
    } else {
      void run();
    }
    watch(key, () => void run());
  }

  return { data, error, pending };
}
