/**
 * A plugin's rows in the data lifecycle: environment copies and promotes, space transfers and
 * snapshots, retention, limit counters and host names. `@manablox/services` adds the parts;
 * see https://dev.manablox.io/extending/data-providers/.
 */
export interface PluginDataProvider {
  /** Unique per instance: `<plugin id>.<name>`, e.g. `hello.greetings`. */
  kind: string;
}
