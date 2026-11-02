import {
  type DesignNode,
  designRoots,
  findNode,
  generateBlockDesign,
  type SiteDesignKind,
  type SiteRenderInput,
} from '@manablox/site';

export interface ParsedRef {
  kind: SiteDesignKind;
  key: string;
  id: string;
}

/** Splits `<designKind>:<designKey>:<nodeId>`; neither part contains a colon. */
export function parseNodeRef(ref: string | null | undefined): ParsedRef | null {
  const parts = ref?.split(':');
  if (parts?.length !== 3 || parts.some((part) => !part)) return null;
  return { kind: parts[0] as SiteDesignKind, key: parts[1] as string, id: parts[2] as string };
}

/** The trees of the design a node belongs to, as the input carries them. */
function rootsOf(input: SiteRenderInput, kind: SiteDesignKind, key: string): DesignNode[] {
  if (kind === 'page' && input.page?.key === key) return designRoots('page', input.page.design);
  if (kind === 'layout' && input.layout?.key === key)
    return designRoots('layout', input.layout.design);
  if (kind === 'block') {
    const stored = input.blockDesigns?.[key];
    if (stored) return designRoots('block', stored);
    const type = input.contentTypes?.[key];
    return type ? designRoots('block', generateBlockDesign(type)) : [];
  }
  return [];
}

/** A node and its parent in the input's designs. */
export function findDesignNode(
  input: SiteRenderInput,
  ref: string | null | undefined,
): { node: DesignNode; parent: DesignNode | null; index: number } | null {
  const parsed = parseNodeRef(ref);
  if (!parsed) return null;
  for (const root of rootsOf(input, parsed.kind, parsed.key)) {
    const found = findNode(root, parsed.id);
    if (found) return { node: found.node, parent: found.parent, index: found.index };
  }
  return null;
}
