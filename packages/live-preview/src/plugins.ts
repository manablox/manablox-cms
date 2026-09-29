import type { PluginMessage } from './protocol.js';

/** Routes plugin messages to their handlers by plugin and name. */
export function createPluginHandlers() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const key = (plugin: string, name: string) => `${plugin}\u0000${name}`;
  return {
    on(plugin: string, name: string, handler: (payload: unknown) => void): () => void {
      const id = key(plugin, name);
      const set = handlers.get(id) ?? new Set();
      handlers.set(id, set);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    dispatch(message: PluginMessage): void {
      for (const handler of [...(handlers.get(key(message.plugin, message.name)) ?? [])])
        handler(message.payload);
    },
  };
}
