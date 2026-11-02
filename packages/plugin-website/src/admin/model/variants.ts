import {
  type BlockDesign,
  type BlockPreset,
  type BlockVariant,
  cloneWithNewIds,
  collectNodeIds,
  type DesignSourceType,
  generateBlockDesign,
  generateBlockPreset,
} from '@manablox/site';

/** Most variants a block design holds, as validation allows. */
const MAX_VARIANTS = 20;

/** Every node id of a design; variants share one namespace. */
export function designIds(design: BlockDesign): Set<string> {
  const ids = new Set<string>();
  for (const variant of Object.values(design.variants))
    for (const id of collectNodeIds(variant.root)) ids.add(id);
  return ids;
}

/** Variants in a stable order: the default first, then by label. */
export function variantList(design: BlockDesign): Array<{ name: string; label: string }> {
  return Object.entries(design.variants)
    .map(([name, variant]) => ({ name, label: variant.label || name }))
    .sort((a, b) =>
      a.name === design.default
        ? -1
        : b.name === design.default
          ? 1
          : a.label.localeCompare(b.label),
    );
}

/** A variant key from a label: letters, digits, `-` and `_`, unique in the design. */
export function variantName(label: string, design: BlockDesign): string {
  const slug =
    label
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 48) || 'variant';
  const base = /^[a-z0-9]/.test(slug) ? slug : `v-${slug}`;
  let name = base;
  for (let n = 2; Object.hasOwn(design.variants, name); n++) name = `${base}-${n}`;
  return name;
}

export const canAddVariant = (design: BlockDesign): boolean =>
  Object.keys(design.variants).length < MAX_VARIANTS;

/** Adds a variant under a name made from its label; returns the name. */
export function addVariant(
  design: BlockDesign,
  variant: BlockVariant,
): { design: BlockDesign; name: string } {
  const name = variantName(variant.label, design);
  return { design: { ...design, variants: { ...design.variants, [name]: variant } }, name };
}

/** How a new variant starts: the generated tree, a preset, or empty. */
export type VariantStart = 'generated' | 'blank' | BlockPreset;

/** A new variant for a type, with ids not used elsewhere in the design. */
export function newVariant(
  design: BlockDesign,
  type: DesignSourceType,
  start: VariantStart,
  label: string,
): BlockVariant {
  const taken = designIds(design);
  if (start === 'blank') {
    const root = cloneWithNewIds(
      { id: 'root', el: 'stack', style: { base: { gap: 'space:4' } }, children: [] },
      taken,
    );
    return { label, root };
  }
  if (start === 'generated') {
    const generated = generateBlockDesign(type).variants.default as BlockVariant;
    return { label, root: cloneWithNewIds(generated.root, taken) };
  }
  return { ...generateBlockPreset(type, start, { taken }), label };
}

export function duplicateVariant(
  design: BlockDesign,
  name: string,
): { design: BlockDesign; name: string } | null {
  const source = design.variants[name];
  if (!source || !canAddVariant(design)) return null;
  const root = cloneWithNewIds(source.root, designIds(design));
  return addVariant(design, { label: `${source.label} copy`, root });
}

export function relabelVariant(design: BlockDesign, name: string, label: string): BlockDesign {
  const variant = design.variants[name];
  if (!variant) return design;
  return {
    ...design,
    variants: { ...design.variants, [name]: { ...variant, label: label.slice(0, 100) } },
  };
}

/** Removes a variant; the default one stays. */
export function removeVariant(design: BlockDesign, name: string): BlockDesign | null {
  if (name === design.default || !design.variants[name]) return null;
  const variants = { ...design.variants };
  delete variants[name];
  return { ...design, variants };
}

/** Replaces one variant's tree, keeping its label. */
export function withVariantRoot(
  design: BlockDesign,
  name: string,
  root: BlockVariant['root'],
): BlockDesign {
  const variant = design.variants[name];
  if (!variant) return design;
  return { ...design, variants: { ...design.variants, [name]: { ...variant, root } } };
}
