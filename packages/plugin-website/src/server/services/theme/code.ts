import { ManabloxError } from '@manablox/core';
import {
  THEME_BUNDLE_FORMAT,
  THEME_BUNDLE_VERSION,
  type ThemeBundle,
  validateThemeBundle,
} from '@manablox/site';
import type { ThemeDefinition } from '../../theme-define.js';

/** A code theme as a bundle; block and page keys are type names or ids. */
export function codeBundle(definition: ThemeDefinition): unknown {
  return {
    format: THEME_BUNDLE_FORMAT,
    version: THEME_BUNDLE_VERSION,
    name: definition.name,
    description: definition.description,
    theme: definition.theme,
    designs: definition.designs.map((design) => ({
      kind: design.kind,
      key: design.key,
      ...(design.name ? { name: design.name } : {}),
      data: design.data,
    })),
    site: definition.site,
  };
}

/** A valid bundle, or a bad request listing its first issues. */
export function assertBundle(payload: unknown): ThemeBundle {
  const result = validateThemeBundle(payload);
  if (result.ok) return result.value;
  throw ManabloxError.badRequest('plugins.website.theme.bundle.invalid', {
    issues: result.issues
      .slice(0, 10)
      .map((issue) => `${issue.path} ${issue.message}`.trim())
      .join('; '),
  });
}

/**
 * Problems of code themes, each as `<where>: <path> <message>`. Code types are resolved per
 * space when applied, so only the designs themselves are checked.
 */
export function themeProblems(definitions: readonly ThemeDefinition[]): string[] {
  const problems: string[] = [];
  for (const definition of definitions) {
    const result = validateThemeBundle(codeBundle(definition));
    if (!result.ok) {
      for (const issue of result.issues)
        problems.push(`theme ${definition.slug}: ${issue.path} ${issue.message}`);
    }
  }
  return problems;
}

/** Refuses to start with two code themes of one id. */
export function assertThemesUnique(definitions: readonly ThemeDefinition[]): void {
  const seen = new Set<string>();
  for (const { slug } of definitions) {
    if (seen.has(slug))
      throw ManabloxError.conflict('codeResource.duplicate', { kind: 'theme', slug });
    seen.add(slug);
  }
}

/** Refuses to start with an invalid code theme. */
export function assertThemesValid(definitions: readonly ThemeDefinition[]): void {
  const problems = themeProblems(definitions);
  if (problems.length) {
    throw ManabloxError.badRequest('plugins.website.theme.code.invalid', {
      issues: problems.slice(0, 20).join('; '),
    });
  }
}
