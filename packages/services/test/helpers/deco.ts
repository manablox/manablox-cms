import { definePlugin, type PluginDataIssue } from '@manablox/core';

/** Style values a block may pick: theme tokens, or breakpoints to hide at. */
const allowed = (key: string, value: unknown) =>
  key === 'hide'
    ? Array.isArray(value)
    : typeof value === 'string' && /^(color|space):/.test(value);

/** A test plugin keeping a variant and token styles per block at `ext.deco`, delivered as `design`. */
export const decoPlugin = definePlugin({
  name: 'deco',
  blocks: {
    instance: {
      validate: (value) => {
        const style = (value as { style?: Record<string, unknown> } | null)?.style ?? {};
        const issues: PluginDataIssue[] = [];
        for (const [key, entry] of Object.entries(style)) {
          if (!allowed(key, entry)) issues.push({ path: ['style', key], message: 'not allowed' });
        }
        return issues;
      },
    },
    publicApi: { field: 'design', serialize: (value) => value },
  },
});
