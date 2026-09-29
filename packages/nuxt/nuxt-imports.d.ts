/**
 * `#imports` as Nuxt types it in an app, for this package's own typechecks. An app's
 * `nuxt typecheck` resolves the real module, so the runtime files carry no suppressions.
 */
declare module '#imports' {
  import type { PreviewDocument } from '@manablox/live-preview';
  import type { Ref } from 'vue';

  export function useNuxtApp(): object;
  export function useRuntimeConfig(): { public: Record<string, unknown> };
  export function useRoute(): { path: string };
  export function useAsyncData<T>(
    key: string,
    handler: () => Promise<T>,
  ): Promise<{ data: Ref<T | null> }>;
  export function useState<T>(key: string, init?: () => T): Ref<T>;
  export function useManabloxPreviewState(): Ref<PreviewDocument | null>;
}
