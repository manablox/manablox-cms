import { type Contribution, ManabloxError, type ResolvedScope, scopeSpaceId } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { ThemeBundle } from '@manablox/site';
import { designAuditor } from '../audit.js';
import type { ThemeDefinition } from '../theme-define.js';
import { assertBundle } from './theme/code.js';
import type { ThemeContext } from './theme/context.js';
import { exportThemeBundle, type ThemeExportOptions } from './theme/export.js';
import { planImport, type ThemeImportOptions, type ThemeImportReport } from './theme/plan.js';
import {
  type StarterOptions,
  type StarterThemeSummary,
  starterBundle,
  starterThemes,
  withPreset,
} from './theme/starters.js';
import { writeImport } from './theme/write.js';

/**
 * Theme bundles and the starter gallery: export a space's designs as a portable file, preview
 * and import one as drafts, list and apply built-in and code themes. The parts live in
 * `theme/`.
 */
export class SiteThemeService {
  private readonly ctx: ThemeContext;

  constructor(
    manablox: Manablox,
    repos: Repositories,
    /** The code themes on in a space, each with the id of the plugin that brings it. */
    codeThemes: (spaceId: string) => Promise<readonly Contribution<ThemeDefinition>[]>,
  ) {
    this.ctx = { manablox, repos, audit: designAuditor(repos), codeThemes };
  }

  /** The space's designs as a bundle; generated designs are implied and left out. */
  exportBundle(
    scope: string | ResolvedScope,
    options: ThemeExportOptions = {},
  ): Promise<ThemeBundle> {
    return exportThemeBundle(this.ctx, scope, options);
  }

  /** What importing `payload` would write, without writing. */
  async previewImport(
    scope: string | ResolvedScope,
    payload: unknown,
    options: ThemeImportOptions = {},
  ): Promise<ThemeImportReport> {
    const { report } = await planImport(this.ctx, scope, assertBundle(payload), options);
    return report;
  }

  /** Writes a bundle's designs as drafts in one transaction; publishing stays a separate step. */
  async importBundle(
    scope: string | ResolvedScope,
    payload: unknown,
    options: ThemeImportOptions = {},
    actorId: string | null = null,
  ): Promise<ThemeImportReport> {
    const bundle = assertBundle(payload);
    const { report, planned } = await planImport(this.ctx, scope, bundle, options);
    await writeImport(this.ctx, scope, report, planned, actorId);
    return report;
  }

  /** The starter gallery of a space: built-in themes, then code themes targeting it. */
  starterThemes(scope: string | ResolvedScope): Promise<StarterThemeSummary[]> {
    return starterThemes(this.ctx, scope);
  }

  /**
   * Writes a starter theme's designs as drafts, with a design preset's designs on top when
   * one is named; `replace` off keeps stored designs.
   */
  async applyStarter(
    scope: string | ResolvedScope,
    id: string,
    options: StarterOptions = {},
    actorId: string | null = null,
  ): Promise<ThemeImportReport> {
    const spaceId = scopeSpaceId(scope);
    const space = await this.ctx.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    let bundle = await starterBundle(this.ctx, id, space);
    if (options.preset)
      bundle = withPreset(this.ctx, bundle, options.preset, scope, space.defaultLocale);
    const { report, planned } = await planImport(this.ctx, scope, bundle, {
      ...options,
      replace: options.replace ?? false,
    });
    await writeImport(this.ctx, scope, report, planned, actorId);
    return report;
  }
}
