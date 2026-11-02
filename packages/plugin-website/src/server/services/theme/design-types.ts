import type { ContentTypeDefinition, TypeScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type DesignTypeRef,
  designFieldPaths,
  remapDesignFields,
  type SiteDesignData,
} from '@manablox/site';

/** A bundle design's type reference: id, machine name and field paths. */
export function typeRef(type: ContentTypeDefinition): DesignTypeRef {
  return { id: type.id, name: type.name, fields: designFieldPaths(type.fields) };
}

/**
 * The type a block or page design styles in `spaceId` (a space or its environment): by id,
 * then by machine name. `null` when it has no fitting type.
 */
export function resolveDesignType(
  manablox: Manablox,
  spaceId: TypeScope,
  kind: 'block' | 'page',
  key: string,
  ref: DesignTypeRef | undefined,
): ContentTypeDefinition | null {
  const types = manablox.contentTypes
    .forSpace(spaceId)
    .filter(
      (type) =>
        !type.isSystem && (kind === 'block' ? type.kind === 'block' : type.kind === 'content'),
    );
  const id = ref?.id ?? key;
  const name = ref?.name ?? key;
  return (
    types.find((type) => type.id === id) ??
    types.find((type) => type.id === key) ??
    types.find((type) => type.name === name) ??
    null
  );
}

/** Rebinds a design to the target type's field ids when they differ from the source's. */
export function fitDesign(
  kind: 'block' | 'page',
  data: unknown,
  ref: DesignTypeRef | undefined,
  type: ContentTypeDefinition,
): unknown {
  if (!ref?.fields || ref.id === type.id) return data;
  return remapDesignFields(
    kind,
    data as SiteDesignData<'block' | 'page'>,
    ref.fields,
    designFieldPaths(type.fields),
  );
}
