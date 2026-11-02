import { plainClone } from '@manablox/admin-sdk';
import {
  type BlockDesign,
  type BlockVariant,
  cloneWithNewIds,
  collectNodeIds,
} from '@manablox/site';
import { addVariant, canAddVariant, designIds, withVariantRoot } from './variants';

/** Variants of a proposal, the default first. */
export function proposedVariants(design: BlockDesign): Array<{ name: string; label: string }> {
  return Object.entries(design.variants)
    .map(([name, variant]) => ({ name, label: variant.label || name }))
    .sort((a, b) => (a.name === design.default ? -1 : b.name === design.default ? 1 : 0));
}

/**
 * Puts a proposed variant into `current`: as a new variant, or as the tree of `variant`.
 * Node ids are renewed where they clash with the rest of the design. `null` when no variant
 * can be added.
 */
export function applyAiVariant(
  current: BlockDesign,
  proposed: BlockVariant,
  mode: 'add' | 'replace',
  variant: string,
): { design: BlockDesign; name: string } | null {
  if (mode === 'add') {
    if (!canAddVariant(current)) return null;
    const root = cloneWithNewIds(proposed.root, designIds(current));
    return addVariant(current, { label: proposed.label || 'AI design', root });
  }
  const target = current.variants[variant];
  if (!target) return null;
  const own = collectNodeIds(target.root);
  const taken = new Set([...designIds(current)].filter((id) => !own.has(id)));
  const clash = [...collectNodeIds(proposed.root)].some((id) => taken.has(id));
  const root = clash ? cloneWithNewIds(proposed.root, taken) : plainClone(proposed.root);
  return { design: withVariantRoot(current, variant, root), name: variant };
}
