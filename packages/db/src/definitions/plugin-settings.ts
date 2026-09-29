import { id, json, table, text, timestamp, unique, uuid } from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

/**
 * A plugin's settings of one space environment: production's row holds the space's, a
 * staging row what that environment keeps of its own.
 */
export const spacePluginSettings = table(
  'space_plugin_settings',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    /** The plugin's id. */
    plugin: text().notNull(),
    data: json<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [unique('space_plugin_settings_environment_plugin_key').on(t.environmentId, t.plugin)],
);
