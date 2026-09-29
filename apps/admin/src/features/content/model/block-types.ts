import type { FieldContext } from '@manablox/admin-sdk/lib/field-context';
import { indexForDigit } from '@manablox/admin-sdk/lib/shortcuts';
import type { BlockValue } from '@manablox/core';

/**
 * The entry of a type list a digit key picks (1-9, 0 for the tenth). The key's default is
 * prevented once it picks one.
 */
export function typeByDigit<T>(event: KeyboardEvent, types: readonly T[]): T | undefined {
  const index = indexForDigit(event);
  const type = index === null ? undefined : types[index];
  if (type) event.preventDefault();
  return type;
}

/** A collapsed block's label: its first summary field's value, else the start of its id. */
export function blockSummary(
  block: BlockValue,
  context: Pick<FieldContext, 'typeById' | 'fieldTypeMeta'>,
): string {
  const type = context.typeById(block.type);
  for (const field of type?.fields ?? []) {
    const meta = context.fieldTypeMeta(field.type);
    if (!meta?.admin.summary) continue;
    const value = block.fields[field.name];
    if (typeof value === 'string' && value) return value;
  }
  return block.blockId.slice(0, 8);
}
