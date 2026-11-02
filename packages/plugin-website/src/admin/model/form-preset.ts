import {
  type BlockDesign,
  collectNodeIds,
  type DesignSourceType,
  generateBlockDesign,
} from '@manablox/site';
import { type FormSourceType, newForm } from './form-design';

/** A block's generated design with a form for `databag` below its fields. */
export function fixedFormDesign(
  type: DesignSourceType,
  databag: FormSourceType,
  locale: string,
): BlockDesign {
  const design = generateBlockDesign(type);
  const variant = design.variants[design.default];
  if (!variant) return design;
  const form = newForm(databag, collectNodeIds(variant.root), locale);
  variant.root = { ...variant.root, children: [...(variant.root.children ?? []), form] };
  return design;
}
