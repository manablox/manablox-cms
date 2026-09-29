import type { FeatureKey } from '@manablox/core';
import { type Component, computed, defineAsyncComponent, shallowRef } from 'vue';
import { useSessionStore } from '../stores/session';
import { useSpaceStore } from '../stores/space';

/** A module whose default export is a Vue component. */
// biome-ignore lint/suspicious/noExplicitAny: a Vue component of any props
export type SlotComponentLoader = () => Promise<{ default: any }>;

/**
 * An entry of a slot as any plugin registers it; `@manablox/admin-plugin` types each slot's
 * props and options (`AdminSlotEntry`).
 */
export interface PluginSlotEntry {
  component: SlotComponentLoader;
  key?: string;
  order?: number;
  feature?: string | null;
  permission?: string;
  label?: string;
  icon?: string;
  hint?: string;
  /** Kept while its feature is locked, for the component to draw the lock. */
  locked?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: each slot types its own props
  when?: (props: any) => boolean;
}

/** The plugin an entry came from. */
export interface PluginOwner {
  id: string;
  feature: string;
}

/** A slot entry as the admin renders it. */
export interface PluginSlotItem<E extends PluginSlotEntry = PluginSlotEntry> {
  key: string;
  plugin: string;
  component: Component;
  order: number;
  /**
   * `null` always shows it. An entry of `useSlotEntries` kept while locked names the feature
   * that is off, its plugin's or its own.
   */
  feature: string | null;
  /** The owning plugin's flag; an entry's own `feature` needs it on too. */
  pluginFeature: string;
  /** Switched off but kept to draw a lock; only in `useSlotEntries` with `locked`. */
  locked?: boolean;
  permission: string | undefined;
  label: string | undefined;
  icon: string | undefined;
  /** As registered, for the slot's own options. */
  entry: E;
}

/** An async component from a loader resolving to a module with a default export. */
export const lazyComponent = (loader: SlotComponentLoader): Component =>
  defineAsyncComponent(() => loader().then((module) => module.default));

const slots = shallowRef<Readonly<Record<string, readonly PluginSlotItem[]>>>({});

/** Adds a plugin's entry to a core slot or a plugin-declared one (`<id>:<name>`). */
export function registerSlotEntry(owner: PluginOwner, slot: string, entry: PluginSlotEntry): void {
  const list = slots.value[slot] ?? [];
  const item: PluginSlotItem = {
    key: `${owner.id}.${entry.key ?? list.length}`,
    plugin: owner.id,
    component: lazyComponent(entry.component),
    order: entry.order ?? 100,
    feature: entry.feature === undefined ? owner.feature : entry.feature,
    pluginFeature: owner.feature,
    permission: entry.permission,
    label: entry.label,
    icon: entry.icon,
    entry,
  };
  const next = [...list.filter((other) => other.key !== item.key), item];
  slots.value = { ...slots.value, [slot]: next.sort((a, b) => a.order - b.order) };
}

/** Every registered entry of `slot`, ungated. */
export function slotEntries(slot: string): readonly PluginSlotItem[] {
  return slots.value[slot] ?? [];
}

/** Slots about a space that does not exist yet; the instance decides. */
const INSTANCE_SLOTS: ReadonlySet<string> = new Set([
  'space.create.steps',
  'space.create.starters',
]);

/**
 * The entries of `slot` the viewer may see in the current space: an entry's own feature needs
 * its plugin's flag on too. `locked` keeps entries whose feature is locked, for a host that
 * draws the lock; an entry registered with `locked` is kept for its component to draw it.
 * A kept locked entry has `locked` set and names the feature that is off. Stores are read only
 * once an entry exists.
 */
export function useSlotEntries(slot: string, options: { locked?: boolean } = {}) {
  return computed<readonly PluginSlotItem[]>(() => {
    const items = slotEntries(slot);
    if (items.length === 0) return items;
    const session = useSessionStore();
    const spaceId = INSTANCE_SLOTS.has(slot) ? null : useSpaceStore().currentId;
    return items.flatMap((item) => {
      if (item.permission && !session.can(item.permission, spaceId)) return [];
      if (item.feature === null) return [item];
      const keys = new Set([item.pluginFeature, item.feature]);
      for (const key of keys) {
        const state = session.feature(key as FeatureKey, spaceId);
        if (state.enabled) continue;
        const kept = state.locked && (options.locked === true || item.entry.locked === true);
        return kept ? [{ ...item, feature: key, locked: true }] : [];
      }
      return [item];
    });
  });
}

/** A plugin-declared slot id: the declaring plugin's id, a colon and a name. */
const PLUGIN_SLOT = /^[a-z0-9][a-z0-9._-]*:[a-z][\w.-]*$/i;

const declared = new Map<string, string>();

/**
 * Declares the slot `<id>:<name>` of the plugin `owner`, for its own components to render with
 * `<PluginSlot>` and other bundles to fill. Returns the slot's id.
 */
export function declareSlot(owner: string, name: string): string {
  const id = `${owner}:${name}`;
  if (!PLUGIN_SLOT.test(id)) throw new Error(`Invalid slot name of plugin ${owner}: ${name}`);
  declared.set(id, owner);
  return id;
}

/** The plugin that declared a slot, else null (a core slot, or one nobody declared). */
export function slotOwner(slot: string): string | null {
  return declared.get(slot) ?? null;
}

const apis = shallowRef<ReadonlyMap<string, unknown>>(new Map());

/** Makes `api` what `usePluginApi(id)` returns. */
export function exposePluginApi(id: string, api: unknown): void {
  apis.value = new Map([...apis.value, [id, api]]);
}

/**
 * The api another plugin's bundle exposed in its `setup`, typed by the caller; undefined when
 * that plugin is not loaded. Bundles set up in server order, so a plugin sees the apis of the
 * plugins it requires during its own `setup`.
 */
export function usePluginApi<T = unknown>(id: string): T | undefined {
  return apis.value.get(id) as T | undefined;
}

/** Drops every entry, declaration and api; for tests. */
export function resetPluginSlots(): void {
  slots.value = {};
  declared.clear();
  apis.value = new Map();
}
