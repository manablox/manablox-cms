import { isDocumentType, ManabloxError, type ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { designRoots, validateSiteDesign, walkNodes } from '@manablox/site';
import { SITE_DESIGN_KINDS, type SiteDesignKindName } from '../../../shared/site.js';
import { websiteKeys } from '../../keys.js';
import { DEFAULT_KEY } from './context.js';

/** Fields of the `site` design only `design:code` may change. */
const SITE_CODE_FIELDS = ['customCss', 'headCode', 'bodyEndCode'] as const;

/** Keys of layouts and menu designs: letters, digits, `_` and `-`. */
const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Whether `after` changes a code field of the `site` design `before`. */
export function siteCodeChanged(
  before: unknown,
  after: unknown,
  fields: readonly string[] = SITE_CODE_FIELDS,
): boolean {
  const read = (value: unknown, field: string): string => {
    const text = (value as Record<string, unknown> | null | undefined)?.[field];
    return typeof text === 'string' ? text : '';
  };
  return fields.some((field) => read(before, field) !== read(after, field));
}

/** A value as JSON with sorted keys, so equal values compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** A design's `form` nodes by id, each with its fields, as canonical JSON. */
function forms(kind: SiteDesignKindName, data: unknown): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of designRoots(kind, data)) {
    walkNodes(root, ({ node }) => {
      if (node.el === 'form') found.set(node.id, canonical(node));
    });
  }
  return found;
}

/**
 * Refuses a draft that changes head or body-end code without `siteHeadCode`, adds a form
 * without `siteForms`, or adds, changes or removes a form without `siteForms.config`.
 */
export async function assertDesignFeatures(
  manablox: Manablox,
  spaceId: string,
  kind: SiteDesignKindName,
  before: unknown,
  after: unknown,
): Promise<void> {
  const { features } = websiteKeys;
  if (kind === 'site' && siteCodeChanged(before, after, ['headCode', 'bodyEndCode'])) {
    await manablox.controls.assertFeature(spaceId, features.headCode);
  }
  const existing = forms(kind, before);
  const next = forms(kind, after);
  if ([...next.keys()].some((id) => !existing.has(id))) {
    await manablox.controls.assertFeature(spaceId, features.forms);
  }
  const changed =
    existing.size !== next.size || [...next].some(([id, form]) => existing.get(id) !== form);
  if (changed) await manablox.controls.assertFeature(spaceId, features['forms.config']);
}

/** Theme and site designs are `default`; blocks and pages name a type of the space. */
export function assertDesignKey(
  manablox: Manablox,
  scope: string | ResolvedScope,
  kind: SiteDesignKindName,
  key: string,
): void {
  const fail = () => {
    throw ManabloxError.validation(
      [{ key: 'plugins.website.design.key.invalid', path: ['key'], params: { kind, key } }],
      'plugins.website.design.validation.failed',
    );
  };
  if (!(SITE_DESIGN_KINDS as readonly string[]).includes(kind)) fail();
  if (kind === 'theme' || kind === 'site') {
    if (key !== DEFAULT_KEY) fail();
    return;
  }
  if (kind === 'block' || kind === 'page') {
    const type = manablox.contentTypes.tryGet(key);
    const visible = type && manablox.contentTypes.inScope(type, scope);
    const fits = kind === 'block' ? type?.kind === 'block' : type?.kind === 'content';
    if (!visible || !fits || !type || type.isSystem || (kind === 'page' && !isDocumentType(type))) {
      fail();
    }
    return;
  }
  if (!KEY_PATTERN.test(key)) fail();
}

/** The validated draft, or a validation error listing every issue. */
export function validatedDesign(kind: SiteDesignKindName, data: unknown): unknown {
  const result = validateSiteDesign(kind, data);
  if (result.ok) return result.value;
  throw ManabloxError.validation(
    result.issues.map((issue) => ({
      key: 'plugins.website.design.invalid' as const,
      path: ['draft', ...issue.path.split('.').filter(Boolean)],
      params: { message: issue.message },
    })),
    'plugins.website.design.validation.failed',
  );
}
