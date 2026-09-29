// biome-ignore-all assist/source/organizeImports: sorting would move the plugins' imports out of their marker comments.
import type { ManabloxConfig } from '@manablox/core';
// The helpers the plugins' options read the environment with; unused ones cost nothing.
import { envBoolean, envList, envNumber, envOptional, envString } from '@manablox/core';
{{slot config.imports}}
import { plugins as shared } from './content-model.ts';

/**
 * The feature plugins of this instance, on top of the ones every process shares
 * (content-model.ts). `manablox plugin install <id>` and `manablox plugin uninstall <id>`
 * add and remove the marked parts below; keep your own edits outside the markers.
 */
type Plugins = NonNullable<ManabloxConfig['plugins']>;

/** The management instance's plugins (manablox.config.ts). */
export const plugins: Plugins = [
  ...shared,
  {{slot config.plugins}}
];
{{#if publicApi}}

/**
 * The public delivery instance's (manablox.public.config.ts): only plugins that serve
 * public requests, so it loads nothing it never uses.
 */
export const publicPlugins: Plugins = [
  ...shared,
  {{slot public.plugins}}
];
{{/if}}
