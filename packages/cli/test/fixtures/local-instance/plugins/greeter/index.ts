import { definePlugin } from '@manablox/core';

/** A local plugin: no package.json, so it names its CLI module itself. */
export const greeterPlugin = () =>
  definePlugin({
    name: 'greeter',
    // Resolved from the config's folder.
    cli: './plugins/greeter/cli.ts',
  });
