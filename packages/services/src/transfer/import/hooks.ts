import type { Manablox } from '@manablox/core/node';
import type { ExportedMenu, ExportedRedirect } from '../format.js';

/** The rows of an import that single creates run a `before...` hook for. */
export interface ImportHookRows {
  menus: ExportedMenu[];
  redirects: ExportedRedirect[];
}

/**
 * Runs the per-row `before...` hooks of the single creates, before anything is written, so a
 * refusal leaves nothing behind. Hooks without a handler are skipped.
 */
export async function runImportHooks(
  manablox: Manablox,
  spaceId: string,
  rows: ImportHookRows,
): Promise<void> {
  const { hooks } = manablox;
  const context = { manablox, spaceId };
  if (hooks.has('menu:beforeCreate')) {
    for (const menu of rows.menus) {
      await hooks.run(
        'menu:beforeCreate',
        { spaceId, name: menu.name, machineName: menu.machineName },
        context,
      );
    }
  }
  if (hooks.has('redirect:beforeCreate')) {
    for (const redirect of rows.redirects) {
      await hooks.run(
        'redirect:beforeCreate',
        { spaceId, locale: redirect.locale, fromPath: redirect.fromPath, source: redirect.source },
        context,
      );
    }
  }
}
