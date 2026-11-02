/**
 * What other bundles get from `usePluginApi<AiAdminApi>('ai')`; undefined without the plugin.
 * Published types-only as `@manablox/plugin-ai/admin-api`.
 */
// The package's own entry, so the published file resolves it too.
import type { AiCapability, AiProviderRef } from '@manablox/plugin-ai/sdk';
import type { ComputedRef, DefineSetupFnComponent, Ref, SlotsType, VNode } from 'vue';

/** What `useWand` answers: whether to show a wand, and which providers can do the job. */
export interface AiWand {
  enabled: ComputedRef<boolean>;
  kinds: ComputedRef<AiProviderRef[]>;
  spaceId: ComputedRef<string | null>;
}

/** What a design job gets: the prompt and the picked provider, if there is a choice. */
export interface AiDesignInput {
  prompt: string;
  providerKind?: string;
}

/** A design job's state for `DesignDialog`, from `useDesignRun`. */
export interface AiDesignRun<T> {
  provider: Ref<string>;
  prompt: Ref<string>;
  busy: Ref<boolean>;
  /** Why the last run failed, else null. */
  note: Ref<string | null>;
  result: Ref<T | null>;
  /** Whether a run may start; a non-empty prompt by default. */
  ready: ComputedRef<boolean>;
  /** Runs the job; its answer lands in `result`. */
  run(): Promise<void>;
}

/** Props of `DesignDialog`. */
export interface AiDesignDialogProps {
  title: string;
  spaceId: string;
  run: AiDesignRun<unknown>;
  /** The prompt field's label, placeholder and hint. */
  label: string;
  placeholder: string;
  hint?: string | undefined;
  /** The prompt field's height, e.g. `ai:min-h-28` in the caller's prefix. */
  promptClass?: string | undefined;
  /** A Tailwind max width; `max-w-3xl` by default. */
  width?: string | undefined;
  /** Shown instead of the form, e.g. what the space lacks. */
  blocked?: string | null | undefined;
}

type Slot = () => VNode[];

export interface AiAdminApi {
  /**
   * The "describe it" dialog: provider, prompt, the design button and the run's error; slots
   * `options` (above the prompt), `form` (below it), `result` and `primary` (footer buttons
   * after the design button). Emits `close`.
   */
  DesignDialog: DefineSetupFnComponent<
    AiDesignDialogProps,
    { close: () => true },
    SlotsType<{ options?: Slot; form?: Slot; result?: Slot; primary?: Slot }>
  >;
  /** A design job's state for `DesignDialog`; `ready` overrides the non-empty prompt rule. */
  useDesignRun: <T>(
    design: (input: AiDesignInput) => Promise<T>,
    options?: { ready?: () => boolean },
  ) => AiDesignRun<T>;
  /** Magic around a button while the model works, in a `relative` box. */
  Sparkles: DefineSetupFnComponent<{ active: boolean }>;
  /** Provider picker for design jobs, shown when there is a choice; `v-model` is the provider ref. */
  ProviderSelect: DefineSetupFnComponent<
    { spaceId: string; refs: string[]; hint?: string; modelValue: string },
    { 'update:modelValue': (value: string) => true }
  >;
  /** A wand opening the generate dialog; emits `text` or `asset` with the result. */
  WandButton: DefineSetupFnComponent<
    {
      capability: Extract<AiCapability, 'text' | 'image' | 'video'>;
      context?: Record<string, unknown> | undefined;
      label?: string | undefined;
      /** `icon`: square button; `button`: labelled. */
      variant?: 'icon' | 'button';
    },
    { text: (value: string) => true; asset: (assetId: string) => true }
  >;
  /** Whether to show a wand for a capability, and the providers that can do it. */
  useWand: (capability: AiCapability) => AiWand;
  /** Any text field's value as plain text, for model context. */
  fieldToText: (type: string, value: unknown) => string;
  /** The plugin's feature keys. */
  features: {
    ai: 'plugins.ai';
    images: 'plugins.ai.images';
    video: 'plugins.ai.video';
    designModels: 'plugins.ai.designModels';
    designSpace: 'plugins.ai.designSpace';
  };
}
