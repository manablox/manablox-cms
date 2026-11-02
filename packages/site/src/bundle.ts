import type { FieldDefinition } from '@manablox/core';
import { subFieldsOf } from './generate.js';
import type { StarterTheme } from './themes/base.js';
import { designRoots, walkNodes } from './tree.js';
import type {
  PageDesign,
  SiteDesignData,
  SiteIssue,
  SiteSettingsDesign,
  SiteValidationResult,
  ThemeDesign,
} from './types.js';
import { clone, isRecord } from './util.js';
import { validateSiteDesign } from './validate.js';

/** Marks a theme bundle file; stray JSON is refused. */
export const THEME_BUNDLE_FORMAT = 'manablox-theme';
/** Unknown versions are refused. */
export const THEME_BUNDLE_VERSION = 1;

/** Theme and site travel as their own members; these travel in `designs`. */
export const THEME_BUNDLE_DESIGN_KINDS = ['block', 'page', 'layout', 'menu'] as const;
export type ThemeBundleDesignKind = (typeof THEME_BUNDLE_DESIGN_KINDS)[number];

export const MAX_BUNDLE_DESIGNS = 500;

/** Fields of the `site` design that carry CSS or HTML; importing them needs `design:code`. */
export const SITE_CODE_KEYS = ['customCss', 'headCode', 'bodyEndCode'] as const;

/** The type a block or page design was made for, so another space can find its own. */
export interface DesignTypeRef {
  /** Type id where the design came from; code-defined types keep theirs across instances. */
  id?: string;
  /** Machine name, matched when the id is unknown. */
  name: string;
  /** Field id path to field name path, e.g. `<id>.<subId>` to `quotes.quote`. */
  fields?: Record<string, string>;
}

export interface ThemeBundleDesign<K extends ThemeBundleDesignKind = ThemeBundleDesignKind> {
  kind: K;
  /** Block and page: the type id or machine name. Layout and menu: the design key. */
  key: string;
  name?: string;
  type?: DesignTypeRef;
  data: SiteDesignData<K>;
}

/** A portable theme: tokens, designs and site settings, without domains. */
export interface ThemeBundle {
  format: typeof THEME_BUNDLE_FORMAT;
  version: typeof THEME_BUNDLE_VERSION;
  name?: string;
  description?: string;
  exportedAt?: string;
  theme?: ThemeDesign | null;
  designs: ThemeBundleDesign[];
  site?: SiteSettingsDesign | null;
}

const BUNDLE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,99}$/;
const TYPE_NAME = /^[a-z][a-zA-Z0-9_-]{0,63}$/;

/** Checks a theme bundle and every design in it; issue paths point into the file. */
export function validateThemeBundle(value: unknown): SiteValidationResult<ThemeBundle> {
  const issues: SiteIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const nested = (prefix: string, list: SiteIssue[]) => {
    for (const issue of list) add(issue.path ? `${prefix}.${issue.path}` : prefix, issue.message);
  };

  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  if (value.format !== THEME_BUNDLE_FORMAT) {
    return { ok: false, issues: [{ path: 'format', message: 'is not a Manablox theme' }] };
  }
  if (value.version !== THEME_BUNDLE_VERSION) {
    add('version', `must be ${THEME_BUNDLE_VERSION}`);
    return { ok: false, issues };
  }
  for (const key of Object.keys(value)) {
    if (
      ![
        'format',
        'version',
        'name',
        'description',
        'exportedAt',
        'theme',
        'designs',
        'site',
      ].includes(key)
    )
      add(key, 'is not allowed');
  }
  for (const key of ['name', 'description', 'exportedAt'] as const) {
    const text = value[key];
    if (text !== undefined && !(typeof text === 'string' && text.length <= 2000))
      add(key, 'must be a string of at most 2000 characters');
  }

  if (value.theme !== undefined && value.theme !== null) {
    const result = validateSiteDesign('theme', value.theme);
    if (!result.ok) nested('theme', result.issues);
  }
  if (value.site !== undefined && value.site !== null) {
    const result = validateSiteDesign('site', value.site);
    if (!result.ok) nested('site', result.issues);
  }

  if (!Array.isArray(value.designs)) add('designs', 'must be a list');
  else {
    if (value.designs.length > MAX_BUNDLE_DESIGNS)
      add('designs', `holds at most ${MAX_BUNDLE_DESIGNS} designs`);
    const seen = new Set<string>();
    value.designs.slice(0, MAX_BUNDLE_DESIGNS).forEach((entry, index) => {
      const path = `designs.${index}`;
      if (!isRecord(entry)) {
        add(path, 'must be an object');
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!['kind', 'key', 'name', 'type', 'data'].includes(key))
          add(`${path}.${key}`, 'is not allowed');
      }
      const kind = entry.kind;
      if (!(THEME_BUNDLE_DESIGN_KINDS as readonly unknown[]).includes(kind)) {
        add(`${path}.kind`, `must be one of ${THEME_BUNDLE_DESIGN_KINDS.join(', ')}`);
        return;
      }
      if (!(typeof entry.key === 'string' && BUNDLE_KEY.test(entry.key))) {
        add(`${path}.key`, 'must be a design key');
      } else if (seen.has(`${kind}:${entry.key}`)) {
        add(`${path}.key`, 'is listed twice');
      } else seen.add(`${kind}:${entry.key}`);
      if (entry.name !== undefined && !(typeof entry.name === 'string' && entry.name.length <= 200))
        add(`${path}.name`, 'must be a string of at most 200 characters');
      if (entry.type !== undefined) checkTypeRef(`${path}.type`, entry.type, add);
      const result = validateSiteDesign(kind as ThemeBundleDesignKind, entry.data);
      if (!result.ok) nested(`${path}.data`, result.issues);
    });
  }

  return issues.length === 0
    ? { ok: true, value: value as unknown as ThemeBundle }
    : { ok: false, issues };
}

function checkTypeRef(path: string, value: unknown, add: (path: string, message: string) => void) {
  if (!isRecord(value)) {
    add(path, 'must be an object');
    return;
  }
  for (const key of Object.keys(value)) {
    if (!['id', 'name', 'fields'].includes(key)) add(`${path}.${key}`, 'is not allowed');
  }
  if (value.id !== undefined && !(typeof value.id === 'string' && value.id.length <= 100))
    add(`${path}.id`, 'must be a type id');
  if (!(typeof value.name === 'string' && TYPE_NAME.test(value.name)))
    add(`${path}.name`, 'must be a machine name');
  if (value.fields !== undefined) {
    if (!isRecord(value.fields)) add(`${path}.fields`, 'must be an object');
    else if (
      Object.entries(value.fields).some(
        ([id, name]) => id.length > 300 || typeof name !== 'string' || name.length > 300,
      )
    )
      add(`${path}.fields`, 'must map field ids to field names');
  }
}

/** Whether a site design sets custom CSS, head or body code. */
export function siteHasCode(site: unknown): boolean {
  if (!isRecord(site)) return false;
  return SITE_CODE_KEYS.some((key) => typeof site[key] === 'string' && site[key] !== '');
}

/** A copy of a site design without custom CSS, head and body code. */
export function withoutSiteCode<T>(site: T): T {
  if (!isRecord(site)) return site;
  const copy = { ...site };
  for (const key of SITE_CODE_KEYS) delete copy[key];
  return copy as T;
}

type PathField = Pick<FieldDefinition, 'id' | 'name' | 'type' | 'settings'>;

/** Field id paths to name paths, repeater sub-fields included, for `DesignTypeRef.fields`. */
export function designFieldPaths(fields: readonly PathField[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (
    list: readonly PathField[],
    idPrefix: string,
    namePrefix: string,
    depth: number,
  ) => {
    for (const field of list) {
      const id = idPrefix ? `${idPrefix}.${field.id}` : field.id;
      const name = namePrefix ? `${namePrefix}.${field.name}` : field.name;
      out[id] = name;
      if (field.type === 'repeater' && depth < 3) walk(subFieldsOf(field), id, name, depth + 1);
    }
  };
  walk(fields, '', '', 0);
  return out;
}

/**
 * A copy of a block or page design whose bindings point at the target type's field ids,
 * matched by field name; the longest known head of a path is mapped, so fields of related
 * documents (`<content field>.<name>`) keep their tail. Paths unknown on either side stay.
 */
export function remapDesignFields<K extends 'block' | 'page'>(
  kind: K,
  data: SiteDesignData<K>,
  from: Record<string, string>,
  to: Record<string, string>,
): SiteDesignData<K> {
  const byName = new Map(Object.entries(to).map(([id, name]) => [name, id]));
  const map = (path: string): string => {
    if (path.startsWith('$')) return path;
    const segments = path.split('.');
    for (let length = segments.length; length > 0; length--) {
      const name = from[segments.slice(0, length).join('.')];
      const target = name === undefined ? undefined : byName.get(name);
      if (target !== undefined) return [target, ...segments.slice(length)].join('.');
    }
    return path;
  };
  const copy = clone(data);
  for (const root of designRoots(kind, copy)) {
    walkNodes(root, ({ node }) => {
      if (node.bind && typeof node.bind.field === 'string') node.bind.field = map(node.bind.field);
      if (node.visibility && typeof node.visibility.whenField === 'string')
        node.visibility.whenField = map(node.visibility.whenField);
    });
  }
  const seo = kind === 'page' ? (copy as PageDesign).seo : undefined;
  if (seo) {
    if (seo.description) seo.description = map(seo.description);
    if (seo.image) seo.image = map(seo.image);
  }
  return copy;
}

/** A built-in starter theme as a bundle: its theme and menu designs. */
export function starterBundle(starter: StarterTheme): ThemeBundle {
  return {
    format: THEME_BUNDLE_FORMAT,
    version: THEME_BUNDLE_VERSION,
    name: starter.name,
    description: starter.description,
    theme: clone(starter.theme),
    designs: Object.entries(starter.menus).map(([key, data]) => ({
      kind: 'menu' as const,
      key,
      data: clone(data),
    })),
    site: null,
  };
}
