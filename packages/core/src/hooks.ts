/** The hook bus: awaited handlers in priority order. */

/** Return a new payload to transform it, or nothing to leave it untouched. */
export type HookHandler<Payload, Context> = (
  payload: Payload,
  context: Context,
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the "leave the payload alone" signal
) => Payload | void | Promise<Payload | void>;

export interface HookRegistration<Payload, Context> {
  handler: HookHandler<Payload, Context>;
  /** Lower runs first. Defaults to 100. */
  priority: number;
  /** Origin of the hook, for diagnostics - plugin name or 'config'. */
  source: string;
  /** Insertion index, used to keep equal priorities stable. */
  seq: number;
}

/** `{ hookName: [payload, context] }`. A mapped type, so interfaces can satisfy it. */
export type HookMap = { [key: string]: [payload: unknown, context: unknown] };
export type AnyHookMap<M> = { [K in keyof M]: [payload: unknown, context: unknown] };

export type HookPayload<M extends HookMap, K extends keyof M> = M[K][0];
export type HookContext<M extends HookMap, K extends keyof M> = M[K][1];

export interface HookBusOptions {
  /** Called when a handler throws; return true to swallow, false/undefined to rethrow. */
  // biome-ignore lint/suspicious/noConfusingVoidType: returning nothing means "rethrow"
  onError?: (error: unknown, hook: string, source: string) => boolean | void;
}

export class HookBus<M extends AnyHookMap<M>> {
  private readonly registry = new Map<keyof M, HookRegistration<unknown, unknown>[]>();
  private readonly options: HookBusOptions;
  private seq = 0;
  private sorted = new Set<keyof M>();

  constructor(options: HookBusOptions = {}) {
    this.options = options;
  }

  on<K extends keyof M & string>(
    hook: K,
    handler: HookHandler<HookPayload<M, K>, HookContext<M, K>>,
    options: { priority?: number; source?: string } = {},
  ): () => void {
    const list = this.registry.get(hook) ?? [];
    const registration: HookRegistration<unknown, unknown> = {
      handler: handler as HookHandler<unknown, unknown>,
      priority: options.priority ?? 100,
      source: options.source ?? 'config',
      seq: this.seq++,
    };
    list.push(registration);
    this.registry.set(hook, list);
    this.sorted.delete(hook);

    return () => {
      const current = this.registry.get(hook);
      if (!current) return;
      const index = current.indexOf(registration);
      if (index >= 0) current.splice(index, 1);
      this.sorted.delete(hook);
    };
  }

  has<K extends keyof M & string>(hook: K): boolean {
    return (this.registry.get(hook)?.length ?? 0) > 0;
  }

  /** Runs the handlers in order, threading the payload through. */
  async run<K extends keyof M & string>(
    hook: K,
    payload: HookPayload<M, K>,
    context: HookContext<M, K>,
  ): Promise<HookPayload<M, K>> {
    const list = this.ordered(hook);
    if (list.length === 0) return payload;

    let current = payload;
    for (const registration of list) {
      try {
        const result = await registration.handler(current, context);
        if (result !== undefined) current = result as HookPayload<M, K>;
      } catch (error) {
        const swallowed = this.options.onError?.(error, hook, registration.source);
        if (swallowed !== true) throw error;
      }
    }
    return current;
  }

  /** Runs every handler with the same payload; errors go to `onError` and are never thrown. */
  async observe<K extends keyof M & string>(
    hook: K,
    payload: HookPayload<M, K>,
    context: HookContext<M, K>,
  ): Promise<void> {
    for (const registration of this.ordered(hook)) {
      try {
        await registration.handler(payload, context);
      } catch (error) {
        this.options.onError?.(error, hook, registration.source);
      }
    }
  }

  /** Fire-and-observe variant for lifecycle events with no payload to transform. */
  async emit<K extends keyof M & string>(hook: K, context: HookContext<M, K>): Promise<void> {
    await this.run(hook, undefined as HookPayload<M, K>, context);
  }

  private ordered<K extends keyof M & string>(hook: K): HookRegistration<unknown, unknown>[] {
    const list = this.registry.get(hook);
    if (!list) return [];
    if (!this.sorted.has(hook)) {
      list.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.sorted.add(hook);
    }
    return list;
  }

  /** Diagnostics: which sources registered handlers for which hooks. */
  describe(): Record<string, { source: string; priority: number }[]> {
    const out: Record<string, { source: string; priority: number }[]> = {};
    for (const [hook, list] of this.registry) {
      out[String(hook)] = this.ordered(hook as keyof M & string).map((r) => ({
        source: r.source,
        priority: r.priority,
      }));
      void list;
    }
    return out;
  }
}
