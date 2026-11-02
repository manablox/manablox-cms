/**
 * The part of the AI plugin's admin API the website's AI buttons use, from
 * `usePluginApi<AiAdminApi>('ai')`; undefined without that plugin. The website only enhances
 * AI, so it describes the shape itself and never needs the package.
 */
import type { ComputedRef, DefineSetupFnComponent, Ref, SlotsType, VNode } from 'vue';

/** What `useWand` answers: whether to show a wand, and which providers can do the job. */
interface AiWand {
  enabled: ComputedRef<boolean>;
  /** Provider refs such as `anthropic` or `custom:<slug>`. */
  kinds: ComputedRef<string[]>;
  spaceId: ComputedRef<string | null>;
}

/** What a design job gets: the prompt and the picked provider, if there is a choice. */
interface AiDesignInput {
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
interface AiDesignDialogProps {
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
  /** Whether to show a wand for a capability, and the providers that can do it. */
  useWand: (capability: 'text') => AiWand;
  /** The plugin's feature keys the website's buttons are gated by. */
  features: {
    ai: 'plugins.ai';
    designModels: 'plugins.ai.designModels';
  };
}
