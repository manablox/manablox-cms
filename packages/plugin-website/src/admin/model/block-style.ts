import type { BlockBreakpoint, BlockValue } from '@manablox/core';
import {
  type BlockDesign,
  type BlockInstanceDesign,
  type BlockInstanceStyle,
  type DesignSourceType,
  generateBlockDesign,
  validateInstanceStyle,
} from '@manablox/site';

/** The website plugin's key in `BlockValue.ext` and `ContentTypeDefinition.plugins`. */
const WEBSITE = 'website';

export type InstanceStyleKey = keyof BlockInstanceStyle;
export type BackgroundImage = NonNullable<BlockInstanceStyle['backgroundImage']>;

export const BACKGROUND_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export const BACKGROUND_SIZES = ['cover', 'contain', 'auto'] as const;

/**
 * The design without empty parts: unset or empty style values, an empty style and an empty
 * variant go; `undefined` when nothing is left, so the block stores no design.
 */
export function cleanInstanceDesign(
  design: BlockInstanceDesign | null | undefined,
): BlockInstanceDesign | undefined {
  if (!design) return undefined;
  const style: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(design.style ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (key === 'backgroundImage') {
      const image = value as Partial<BackgroundImage>;
      if (!image.assetId) continue;
      const out: Record<string, unknown> = { assetId: image.assetId };
      if (image.position) out.position = image.position;
      if (image.size) out.size = image.size;
      if (image.repeat) out.repeat = true;
      style[key] = out;
      continue;
    }
    style[key] = value;
  }
  const out: BlockInstanceDesign = {};
  if (design.variant) out.variant = design.variant;
  if (Object.keys(style).length > 0) out.style = style as BlockInstanceStyle;
  return out.variant || out.style ? out : undefined;
}

/** The block's design, stored at `ext.website`. */
export function instanceDesignOf(block: BlockValue): BlockInstanceDesign | undefined {
  return block.ext?.[WEBSITE] as BlockInstanceDesign | undefined;
}

/** The block with its design set, or without one when the design is empty. */
export function withInstanceDesign(
  block: BlockValue,
  design: BlockInstanceDesign | null | undefined,
): BlockValue {
  const { ext, ...rest } = block;
  const { [WEBSITE]: _previous, ...others } = ext ?? {};
  const clean = cleanInstanceDesign(design);
  const next = clean ? { ...others, [WEBSITE]: clean } : others;
  return Object.keys(next).length ? { ...rest, ext: next } : rest;
}

/** One style value changed; `undefined` or empty clears it. */
export function withStyleValue<K extends InstanceStyleKey>(
  design: BlockInstanceDesign | null | undefined,
  key: K,
  value: BlockInstanceStyle[K] | undefined,
): BlockInstanceDesign | undefined {
  return cleanInstanceDesign({
    ...design,
    style: { ...(design?.style ?? {}), [key]: value },
  });
}

/** The picked variant; empty or the default name clears it. */
export function withVariant(
  design: BlockInstanceDesign | null | undefined,
  variant: string | undefined,
  defaultVariant: string | null,
): BlockInstanceDesign | undefined {
  const picked = variant && variant !== defaultVariant ? variant : undefined;
  return cleanInstanceDesign({ ...design, variant: picked });
}

/** Whether the block is hidden at a breakpoint; toggles to a new `hide` list. */
export function toggledHide(
  hide: readonly BlockBreakpoint[] | undefined,
  breakpoint: BlockBreakpoint,
): BlockBreakpoint[] | undefined {
  const set = new Set(hide ?? []);
  if (set.has(breakpoint)) set.delete(breakpoint);
  else set.add(breakpoint);
  const order: BlockBreakpoint[] = ['desktop', 'tablet', 'mobile'];
  const next = order.filter((entry) => set.has(entry));
  return next.length ? next : undefined;
}

/** Problems of a style, by style key (`''` for the whole). */
export function instanceStyleIssues(style: BlockInstanceStyle | undefined): Record<string, string> {
  if (!style) return {};
  const result = validateInstanceStyle(style);
  if (result.ok) return {};
  const out: Record<string, string> = {};
  for (const issue of result.issues) {
    const key = issue.path.split('.')[0] ?? '';
    out[key] ??= issue.message;
  }
  return out;
}

/** The stored design of a block type, the one its code ships, or the generated one. */
export function blockDesignOf(
  stored: unknown,
  type: (DesignSourceType & { plugins?: Record<string, unknown> | undefined }) | null,
): BlockDesign | null {
  if (isBlockDesign(stored)) return stored;
  if (!type) return null;
  const code = type.plugins?.[WEBSITE];
  if (isBlockDesign(code)) return code;
  return generateBlockDesign(type);
}

/** Variant choices of a block design, the default first. */
export function variantOptions(
  design: BlockDesign | null,
): Array<{ value: string; label: string }> {
  if (!design) return [];
  const names = Object.keys(design.variants);
  names.sort((a, b) => (a === design.default ? -1 : b === design.default ? 1 : a.localeCompare(b)));
  return names.map((name) => ({
    value: name,
    label: design.variants[name]?.label || name,
  }));
}

function isBlockDesign(value: unknown): value is BlockDesign {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BlockDesign).default === 'string' &&
    typeof (value as BlockDesign).variants === 'object' &&
    (value as BlockDesign).variants !== null
  );
}
