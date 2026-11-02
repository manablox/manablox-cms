import { ManabloxError, type ResolvedScope, scopeSpaceId } from '@manablox/core';
import {
  findBrokenBindings,
  SITE_CODE_KEYS,
  type SiteDesignData,
  type SiteSettingsDesign,
  siteHasCode,
  type ThemeBundle,
  type ThemeBundleDesign,
  withoutSiteCode,
} from '@manablox/site';
import type { SiteDesignKindName } from '../../../shared/site.js';
import type { SiteDesignRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';
import { DEFAULT_KEY, type ThemeContext } from './context.js';
import { fitDesign, resolveDesignType } from './design-types.js';

/** What an import does with one design. */
type ThemeImportAction = 'create' | 'replace' | 'skip';

/**
 * `unknownType`: no block or content type of that id or name; `exists`: stored already and
 * `replace` is off; `excluded`: the caller left it out.
 */
type ThemeSkipReason = 'unknownType' | 'exists' | 'excluded';

interface ThemeImportEntry {
  kind: SiteDesignKindName;
  /** The key the design gets in this space. */
  key: string;
  /** The key the bundle used; differs when a type was found by name. */
  sourceKey: string;
  label: string;
  action: ThemeImportAction;
  reason?: ThemeSkipReason;
  /** Bindings to fields the target type lacks. */
  brokenBindings?: number;
}

export interface ThemeImportReport {
  name: string;
  entries: ThemeImportEntry[];
  /** Custom CSS, head or body code left out for lack of `design:code`. */
  codeSkipped: boolean;
  /** Referenced assets (fonts, logo, backgrounds) this space does not have. */
  missingAssets: string[];
}

export interface ThemeImportOptions {
  /** Overwrites stored drafts; off keeps them. Default on. */
  replace?: boolean | undefined;
  /** `kind:key` of bundle designs to leave out (`theme:default`, `site:default` included). */
  skip?: readonly string[] | undefined;
  /** Whether the caller holds `design:code`; without it code fields keep their current value. */
  allowCode?: boolean | undefined;
}

/** A resolved design, ready to write. */
export interface PlannedDesign extends ThemeImportEntry {
  data: unknown;
}

/** Adds a design to the plan; the action follows from what is stored unless given. */
type AddPlanned = (entry: Omit<PlannedDesign, 'action'>, action?: ThemeImportAction) => void;

/** Resolves every design of a bundle against the space. */
export async function planImport(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
  bundle: ThemeBundle,
  options: ThemeImportOptions,
): Promise<{ report: ThemeImportReport; planned: PlannedDesign[] }> {
  const spaceId = scopeSpaceId(scope);
  const space = await ctx.repos.spaces.findById(spaceId);
  if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
  const stored = new Map(
    (await websiteRepos(ctx.repos).designs.listBySpace(scope)).map((row) => [
      `${row.kind}:${row.key}`,
      row,
    ]),
  );
  const planned: PlannedDesign[] = [];
  const add = planner(planned, stored, options);
  let codeSkipped = false;

  if (bundle.theme) {
    add({
      kind: 'theme',
      key: DEFAULT_KEY,
      sourceKey: DEFAULT_KEY,
      label: 'Theme',
      data: bundle.theme,
    });
  }
  if (bundle.site) {
    const current = stored.get(`site:${DEFAULT_KEY}`)?.draft as SiteSettingsDesign | undefined;
    const fitted = siteForImport(bundle.site, current, options.allowCode ?? false);
    codeSkipped = fitted.codeSkipped;
    add({
      kind: 'site',
      key: DEFAULT_KEY,
      sourceKey: DEFAULT_KEY,
      label: 'Site',
      data: { ...fitted.site, layouts: remapLayouts(ctx, scope, fitted.site.layouts) },
    });
  }
  for (const design of bundle.designs) planDesign(ctx, scope, design, add);

  const report: ThemeImportReport = {
    name: bundle.name ?? '',
    entries: planned.map(({ data: _data, ...entry }) => entry),
    codeSkipped,
    missingAssets: await missingAssets(
      ctx,
      spaceId,
      planned.filter((entry) => entry.action !== 'skip').map((entry) => entry.data),
    ),
  };
  return { report, planned };
}

function planner(
  planned: PlannedDesign[],
  stored: Map<string, SiteDesignRow>,
  options: ThemeImportOptions,
): AddPlanned {
  const replace = options.replace ?? true;
  const skip = new Set(options.skip ?? []);
  return (entry, action) => {
    const row = stored.get(`${entry.kind}:${entry.key}`);
    const excluded = skip.has(`${entry.kind}:${entry.sourceKey}`);
    const resolved: ThemeImportAction =
      action ?? (excluded || (row && !replace) ? 'skip' : row ? 'replace' : 'create');
    planned.push({
      ...entry,
      action: resolved,
      ...(resolved === 'skip' && !entry.reason
        ? { reason: excluded ? ('excluded' as const) : ('exists' as const) }
        : {}),
    });
  };
}

/** The bundle's site settings; without `design:code` code fields keep what the space has. */
function siteForImport(
  site: SiteSettingsDesign,
  current: SiteSettingsDesign | undefined,
  allowCode: boolean,
): { site: SiteSettingsDesign; codeSkipped: boolean } {
  if (allowCode) return { site, codeSkipped: false };
  return {
    site: { ...withoutSiteCode(site), ...pickCode(current) },
    codeSkipped: siteHasCode(site) && codeFields(site) !== codeFields(current),
  };
}

/** Plans one bundle design; block and page designs are fitted to the space's types. */
function planDesign(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
  design: ThemeBundleDesign,
  add: AddPlanned,
): void {
  const label = design.name || design.key;
  if (design.kind !== 'block' && design.kind !== 'page') {
    add({ kind: design.kind, key: design.key, sourceKey: design.key, label, data: design.data });
    return;
  }
  const type = resolveDesignType(ctx.manablox, scope, design.kind, design.key, design.type);
  if (!type) {
    add(
      {
        kind: design.kind,
        key: design.key,
        sourceKey: design.key,
        label: design.type?.name ?? label,
        reason: 'unknownType',
        data: null,
      },
      'skip',
    );
    return;
  }
  const data = fitDesign(design.kind, design.data, design.type, type);
  const broken = findBrokenBindings(data as SiteDesignData<'block' | 'page'>, type).length;
  add({
    kind: design.kind,
    key: type.id,
    sourceKey: design.key,
    label: design.name || type.label,
    data,
    ...(broken ? { brokenBindings: broken } : {}),
  });
}

/** Keeps layout assignments of content types this space has. */
function remapLayouts(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
  layouts: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [typeId, layout] of Object.entries(layouts ?? {})) {
    const type = resolveDesignType(ctx.manablox, scope, 'page', typeId, undefined);
    if (type) out[type.id] = layout;
  }
  return out;
}

async function missingAssets(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
  values: unknown[],
): Promise<string[]> {
  const spaceId = scopeSpaceId(scope);
  const ids = [...collectAssetRefs(values)];
  if (!ids.length) return [];
  const found = new Set((await ctx.repos.assets.listByIds(ids, spaceId)).map((row) => row.id));
  return ids.filter((id) => !found.has(id));
}

function pickCode(site: SiteSettingsDesign | undefined): Partial<SiteSettingsDesign> {
  const out: Partial<Record<(typeof SITE_CODE_KEYS)[number], string>> = {};
  for (const key of SITE_CODE_KEYS) {
    const value = site?.[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

const codeFields = (site: SiteSettingsDesign | undefined): string =>
  JSON.stringify(SITE_CODE_KEYS.map((key) => site?.[key] ?? ''));

/** Every `assetId`, logo, favicon and share image a set of designs references. */
function collectAssetRefs(values: unknown[]): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 64 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (
        (key === 'assetId' || key === 'favicon' || key === 'ogImage') &&
        typeof entry === 'string'
      )
        ids.add(entry);
      else walk(entry, depth + 1);
    }
  };
  for (const value of values) walk(value, 0);
  ids.delete('');
  return ids;
}
