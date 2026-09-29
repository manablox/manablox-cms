import { type ManabloxConfig, type ResolvedConfig, resolveConfig } from './config.js';
import {
  type Controls,
  DefaultControls,
  FeatureCeilings,
  type FeatureKey,
} from './controls/index.js';
import { changedPluginFeatures } from './controls/plugin-fields.js';
import { type ErrorKind, ManabloxError } from './errors.js';
import { FieldTypeRegistry } from './field-type.js';
import type { ManabloxHooks } from './hook-map.js';
import { HookBus, type HookHandler } from './hooks.js';
import { createLogging, type Logger, type Logging } from './logger.node.js';
import { type ManabloxPlugin, pluginFeatureKey, pluginId } from './plugin.js';
import { type Contribution, collectContributions } from './plugin-contributions.js';
import type { PluginContext, PluginLookup } from './plugin-extensions.js';
import { ContentTypeRegistry } from './registry.js';
import { systemContentTypes } from './system-types.js';
import type { ContentRecord, ContentTypeDefinition } from './types.js';

/** Runtime handles (database, storage, cache, queues), augmented by other packages. */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by @manablox/db, /storage, /cache
export interface ManabloxServices {}

/** Error kinds a hook throws to refuse an action on purpose. */
const REFUSAL_KINDS = new Set<ErrorKind>(['forbidden', 'conflict', 'rate_limited', 'locked']);

export type ManabloxState = 'created' | 'initialised' | 'started' | 'stopped';

/** The instance's identity, the same in every process and kept by a backup restore. */
export interface ManabloxInstance {
  /** A uuid v7, made once at the first boot. */
  readonly id: string;
}

export class Manablox {
  readonly config: ResolvedConfig;
  readonly hooks: HookBus<ManabloxHooks>;
  readonly fieldTypes: FieldTypeRegistry;
  readonly contentTypes: ContentTypeRegistry;
  readonly logger: Logger;
  readonly logging: Logging;
  readonly services: ManabloxServices = {};
  /** The configured plugins by id: their services and flags. */
  readonly plugins: PluginLookup;
  /** The plugins' feature ceilings in this process; every `Controls` resolves under them. */
  readonly ceilings = new FeatureCeilings();

  private state: ManabloxState = 'created';
  private controlsImpl: Controls = new DefaultControls(this.ceilings);
  private instanceImpl: ManabloxInstance | null = null;
  /** Plugin flags by field type. */
  private readonly pluginFlags = { fieldType: new Map<string, FeatureKey>() };
  private readonly disposers: Array<() => void | Promise<void>> = [];
  /** Plugin contexts and built services, by plugin name. */
  private readonly pluginContexts = new Map<string, PluginContext>();
  private readonly pluginServices = new Map<string, unknown>();
  /** Contributions by target plugin name, then point. */
  private readonly pluginContributions: Map<string, Map<string, Contribution[]>>;
  /** Runtime content types as last loaded from the database. */
  private committedTypes: ContentTypeDefinition[] = [];
  /**
   * Uncommitted types of open transactions, by transaction, then by the space they were
   * staged for (`''` for global types); they overlay the committed ones.
   */
  private readonly stagedTypes = new Map<object, Map<string, ContentTypeDefinition[]>>();
  /** System and config types by id, as the last full rebuild resolved them. */
  private codeTypes = new Map<string, ContentTypeDefinition>();
  /** Per space (`''` for global types), the runtime type ids the registry holds. */
  private runtimeIds = new Map<string, Set<string>>();
  /** Registry rebuilds, one at a time. */
  private rebuilding: Promise<void> = Promise.resolve();

  constructor(config: ManabloxConfig) {
    this.config = resolveConfig(config);
    this.logging = createLogging(this.config.logging);
    this.logger = this.logging.logger;
    // Registered first so it runs last; other disposers may still log.
    this.disposers.push(() => this.logging.close());

    this.hooks = new HookBus<ManabloxHooks>({
      onError: (error, hook, source) => {
        if (ManabloxError.is(error) && REFUSAL_KINDS.has(error.kind)) {
          this.logger.debug({ err: error, hook, source }, 'hook handler refused');
          return;
        }
        this.logger.error({ err: error, hook, source }, 'hook handler failed');
      },
    });

    this.fieldTypes = new FieldTypeRegistry();
    this.contentTypes = new ContentTypeRegistry(this.fieldTypes);
    this.plugins = this.createPluginLookup();
    this.pluginContributions = collectContributions(this.config.plugins, (plugin, target) =>
      this.logger.debug({ plugin, target }, 'contributions skipped: target plugin not configured'),
    );

    for (const fieldType of this.config.fieldTypes) {
      this.fieldTypes.register(fieldType);
    }

    for (const plugin of this.config.plugins) {
      this.pluginContexts.set(plugin.name, this.createPluginContext(plugin));
      const feature = pluginFeatureKey(plugin);
      for (const fieldType of plugin.fieldTypes ?? []) {
        this.pluginFlags.fieldType.set(fieldType.name, feature);
      }
      for (const registration of plugin.hooks?.(this.plugin(plugin.name)) ?? []) {
        this.hooks.on(
          registration.hook,
          this.gated(feature, registration.handler as HookHandler<unknown, unknown>) as never,
          {
            source: plugin.name,
            ...(registration.priority !== undefined ? { priority: registration.priority } : {}),
          },
        );
      }
    }

    if (this.pluginFlags.fieldType.size > 0) {
      this.hooks.on(
        'content:beforeValidate',
        (input, context) => this.assertPluginFields(input.spaceId, input.fields, context),
        {
          source: 'controls',
        },
      );
    }
  }

  /** The plugin flag a field type answers to; `undefined` for built-ins. */
  pluginFeature(kind: 'fieldType', name: string): FeatureKey | undefined {
    return this.pluginFlags[kind].get(name);
  }

  /** A loaded plugin's context: its id, logger, controls and, once built, its services. */
  plugin<S = unknown>(name: string): PluginContext<S> {
    const context = this.pluginContexts.get(name);
    if (!context) throw new Error(`Plugin not loaded: ${name}`);
    return context as PluginContext<S>;
  }

  /** Adds runtime handles to a plugin's context; `services` is what its `services` built. */
  providePlugin(name: string, fields: Record<string, unknown>): void {
    const context = this.plugin(name);
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'services') this.pluginServices.set(name, value);
      else Object.defineProperty(context, key, { value, enumerable: true, configurable: true });
    }
  }

  private createPluginLookup(): PluginLookup {
    const byId = new Map<string, ManabloxPlugin>();
    for (const plugin of this.config.plugins) {
      const id = pluginId(plugin.name);
      if (!byId.has(id)) byId.set(id, plugin);
    }
    const get = ((id: string) => {
      const plugin = byId.get(id);
      return plugin ? this.pluginServices.get(plugin.name) : undefined;
    }) as PluginLookup['get'];
    return {
      has: (id: string) => byId.has(id),
      get,
      require: ((id: string) => {
        const services = get(id);
        if (services === undefined) {
          throw new Error(
            byId.has(id)
              ? `The ${id} plugin has no services yet.`
              : `The ${id} plugin is not configured.`,
          );
        }
        return services;
      }) as PluginLookup['require'],
      isOn: async (id, spaceId) => {
        const plugin = byId.get(id);
        if (!plugin) return false;
        return (await this.controls.feature(spaceId, pluginFeatureKey(plugin))).enabled;
      },
    };
  }

  /** A plugin's `contributions`: all of a point's, or those on in a space. */
  private contributionsOf(plugin: ManabloxPlugin): PluginContext['contributions'] {
    const own = pluginId(plugin.name);
    const list = (point: string) => this.pluginContributions.get(plugin.name)?.get(point) ?? [];
    const onIn = async (point: string, spaceId: string | null) => {
      const entries = list(point);
      if (entries.length === 0 || !(await this.plugins.isOn(own, spaceId))) return [];
      const on = new Map<string, boolean>([[own, true]]);
      const out: Contribution[] = [];
      for (const entry of entries) {
        if (!on.has(entry.plugin))
          on.set(entry.plugin, await this.plugins.isOn(entry.plugin, spaceId));
        if (on.get(entry.plugin)) out.push(entry);
      }
      return out;
    };
    return ((point: string, ...space: [spaceId?: string | null]) =>
      space.length === 0
        ? list(point)
        : onIn(point, space[0] ?? null)) as PluginContext['contributions'];
  }

  private createPluginContext(plugin: ManabloxPlugin): PluginContext {
    const controls = () => this.controls;
    const services = this.pluginServices;
    // The server adds its handles with `providePlugin`.
    return {
      id: pluginId(plugin.name),
      name: plugin.name,
      manablox: this,
      plugins: this.plugins,
      contributions: this.contributionsOf(plugin),
      logger: this.logger.child({ plugin: plugin.name }),
      get controls() {
        return controls();
      },
      get services() {
        if (!services.has(plugin.name)) {
          throw new Error(`The services of plugin ${plugin.name} are not built yet.`);
        }
        return services.get(plugin.name);
      },
    } as unknown as PluginContext;
  }

  /** A plugin hook handler that skips in spaces where its flag is off; spaceless hooks run. */
  private gated(
    feature: FeatureKey,
    handler: HookHandler<unknown, unknown>,
  ): HookHandler<unknown, unknown> {
    return async (payload, context) => {
      const spaceId = hookSpaceId(payload, context);
      if (spaceId && !(await this.controls.feature(spaceId, feature)).enabled) return undefined;
      return handler(payload, context);
    };
  }

  /** Refuses changed plugin field values, at any depth, where the flag is off. */
  private async assertPluginFields(
    spaceId: string,
    fields: Record<string, unknown>,
    context: { contentType: ContentTypeDefinition; previous?: ContentRecord | null },
  ): Promise<void> {
    const flags = changedPluginFeatures(
      this.contentTypes,
      this.pluginFlags.fieldType,
      context.contentType,
      fields,
      context.previous?.fields,
    );
    for (const feature of flags) await this.controls.assertFeature(spaceId, feature);
  }

  /** Feature flags, limits and usage; catalogue defaults until a store is installed. */
  get controls(): Controls {
    return this.controlsImpl;
  }

  setControls(controls: Controls): void {
    this.controlsImpl = controls;
  }

  /** The instance's identity; throws until the server has loaded it from the database. */
  get instance(): ManabloxInstance {
    if (!this.instanceImpl) throw new Error('The instance id is not loaded yet.');
    return this.instanceImpl;
  }

  setInstance(instance: ManabloxInstance): void {
    this.instanceImpl = Object.freeze({ id: instance.id });
  }

  get status(): ManabloxState {
    return this.state;
  }

  /** Registers a teardown callback, run in reverse order by `stop()`. */
  onDispose(fn: () => void | Promise<void>): void {
    this.disposers.push(fn);
  }

  /** Builds the registry from code types plus `runtimeContentTypes` from the database. */
  async init(runtimeContentTypes: ContentTypeDefinition[] = []): Promise<this> {
    if (this.state !== 'created') return this;
    const context = { manablox: this };

    await this.hooks.emit('before:init', context);

    this.committedTypes = runtimeContentTypes;
    await this.rebuild();

    this.state = 'initialised';
    await this.hooks.emit('after:init', context);

    this.logger.info(
      {
        fieldTypes: this.fieldTypes.names.length,
        contentTypes: this.contentTypes.all.length,
        plugins: this.config.plugins.map((p) => p.name),
      },
      'manablox initialised',
    );

    return this;
  }

  /** The system types; one whose field types are unregistered is skipped, not fatal. */
  private resolveSystemContentTypes(): ContentTypeDefinition[] {
    const out: ContentTypeDefinition[] = [];
    for (const type of systemContentTypes) {
      const missing = type.fields.find((field) => !this.fieldTypes.has(field.type));
      if (missing) {
        this.logger.warn(
          { contentType: type.name, fieldType: missing.type },
          'system content type skipped: its field type is not registered',
        );
        continue;
      }
      out.push(type);
    }
    return out;
  }

  async start(): Promise<this> {
    if (this.state === 'started') return this;
    if (this.state === 'created') await this.init();

    const context = { manablox: this };
    await this.hooks.emit('before:start', context);
    this.state = 'started';
    await this.hooks.emit('after:start', context);
    return this;
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    await this.hooks.emit('before:stop', { manablox: this });

    for (const dispose of [...this.disposers].reverse()) {
      try {
        await dispose();
      } catch (error) {
        this.logger.error({ err: error }, 'disposer failed');
      }
    }

    this.state = 'stopped';
  }

  /**
   * Reloads the committed runtime content types, e.g. after an import. `synced` marks a reload
   * that follows another process's change, so it is not announced again. Types staged by
   * open transactions stay on top.
   */
  async reload(
    runtimeContentTypes: ContentTypeDefinition[],
    options: { synced?: boolean } = {},
  ): Promise<void> {
    this.committedTypes = runtimeContentTypes;
    await this.rebuild();
    this.logger.debug({ schemaVersion: this.contentTypes.schemaVersion }, 'registry reloaded');
    await this.hooks.run(
      'registry:afterReload',
      { synced: options.synced ?? false },
      { manablox: this },
    );
  }

  /**
   * Reloads the committed runtime types of one space (`null`: the global ones) after the
   * admin creates, edits or deletes one; every other space's stay as they are. Announced
   * like `reload`, with the space.
   */
  async reloadSpace(
    spaceId: string | null,
    types: ContentTypeDefinition[],
    options: { synced?: boolean } = {},
  ): Promise<void> {
    this.committedTypes = [
      ...this.committedTypes.filter((type) => type.spaceId !== spaceId),
      ...types.filter((type) => type.spaceId === spaceId),
    ];
    await this.rebuildSpace(spaceId);
    this.logger.debug(
      { schemaVersion: this.contentTypes.schemaVersion, spaceId },
      'registry reloaded',
    );
    await this.hooks.run(
      'registry:afterReload',
      { synced: options.synced ?? false, spaceId },
      { manablox: this },
    );
  }

  /**
   * Puts the types an open transaction sees in one space (`key` names the transaction) over
   * the committed ones until `unstage`; types it deleted stay until it commits. True for a
   * new `key`.
   */
  async stage(
    key: object,
    spaceId: string | null,
    types: ContentTypeDefinition[],
  ): Promise<boolean> {
    const added = !this.stagedTypes.has(key);
    const bySpace = this.stagedTypes.get(key) ?? new Map<string, ContentTypeDefinition[]>();
    bySpace.set(spaceId ?? '', types);
    this.stagedTypes.set(key, bySpace);
    await this.rebuildSpace(spaceId);
    return added;
  }

  /** Drops a transaction's staged types once it has ended. */
  async unstage(key: object): Promise<void> {
    const bySpace = this.stagedTypes.get(key);
    if (!bySpace) return;
    this.stagedTypes.delete(key);
    for (const space of bySpace.keys()) await this.rebuildSpace(space === '' ? null : space);
  }

  /** Sets the registry from code, committed and staged types, after any rebuild in flight. */
  private rebuild(): Promise<void> {
    return this.queue(async () => {
      const runtime = new Map(this.committedTypes.map((type) => [type.id, type]));
      for (const bySpace of this.stagedTypes.values()) {
        for (const types of bySpace.values()) {
          for (const type of types) runtime.set(type.id, type);
        }
      }
      const code = [...this.resolveSystemContentTypes(), ...this.config.contentTypes];
      const merged = await this.hooks.run('registry:contentTypes', [...code, ...runtime.values()], {
        manablox: this,
      });
      this.contentTypes.setAll(merged);
      this.contentTypes.validate();
      this.codeTypes = new Map(code.map((type) => [type.id, type]));
      this.runtimeIds = new Map();
      for (const type of runtime.values()) this.runtimeIdsOf(type.spaceId).add(type.id);
    });
  }

  /**
   * `rebuild` for one space's runtime types: the registry swaps only those (a code type a
   * removed one stood in for comes back). A `registry:contentTypes` handler sees the whole
   * list, so with one registered every change rebuilds everything.
   */
  private rebuildSpace(spaceId: string | null): Promise<void> {
    if (this.hooks.has('registry:contentTypes')) return this.rebuild();
    return this.queue(async () => {
      const runtime = new Map<string, ContentTypeDefinition>();
      for (const type of this.committedTypes) {
        if (type.spaceId === spaceId) runtime.set(type.id, type);
      }
      for (const bySpace of this.stagedTypes.values()) {
        for (const type of bySpace.get(spaceId ?? '') ?? []) runtime.set(type.id, type);
      }
      const previous = this.runtimeIdsOf(spaceId);
      const gone = [...previous].filter((id) => !runtime.has(id));
      const restored = gone.flatMap((id) => this.codeTypes.get(id) ?? []);
      this.contentTypes.replace(
        gone.filter((id) => !this.codeTypes.has(id)),
        [...restored, ...runtime.values()],
      );
      this.runtimeIds.set(spaceId ?? '', new Set(runtime.keys()));
    });
  }

  private runtimeIdsOf(spaceId: string | null): Set<string> {
    let ids = this.runtimeIds.get(spaceId ?? '');
    if (!ids) {
      ids = new Set();
      this.runtimeIds.set(spaceId ?? '', ids);
    }
    return ids;
  }

  /** Runs `work` after the rebuild in flight, one at a time. */
  private queue(work: () => Promise<void>): Promise<void> {
    const run = this.rebuilding.catch(() => {}).then(work);
    this.rebuilding = run;
    return run;
  }
}

/** The space a hook runs for: its context's, else its payload's. */
function hookSpaceId(payload: unknown, context: unknown): string | null {
  const own = (context as { spaceId?: unknown } | null)?.spaceId;
  if (typeof own === 'string') return own;
  const carried = (payload as { spaceId?: unknown } | null)?.spaceId;
  return typeof carried === 'string' ? carried : null;
}

export function createManablox(config: ManabloxConfig): Manablox {
  return new Manablox(config);
}
