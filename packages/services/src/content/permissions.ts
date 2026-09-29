import type { ContentTypeDefinition, FieldDefinition } from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import type { Actor } from './types.js';

export function hasRole(actor: Actor | null, roles: string[] | undefined): boolean {
  if (!roles || roles.length === 0) return true;
  if (!actor) return false;
  return roles.some((role) => actor.roles.includes(role));
}

const readRestrictedByFields = new WeakMap<readonly FieldDefinition[], FieldDefinition[]>();

/** The type's role-gated fields, computed once per fields list. */
export function readRestrictedFields(contentType: ContentTypeDefinition): FieldDefinition[] {
  let restricted = readRestrictedByFields.get(contentType.fields);
  if (!restricted) {
    restricted = contentType.fields.filter((field) => field.readRoles?.length);
    readRestrictedByFields.set(contentType.fields, restricted);
  }
  return restricted;
}

/** Strips the fields an actor may not read. The row is not mutated. */
export function applyReadPermissions(
  row: ContentRow,
  contentType: ContentTypeDefinition,
  actor: Actor | null,
): ContentRow {
  const restricted = readRestrictedFields(contentType);
  if (restricted.length === 0) return row;

  const fields = { ...row.fields };
  for (const field of restricted) {
    if (!hasRole(actor, field.readRoles)) delete fields[field.name];
  }
  return { ...row, fields };
}

/** Fields the actor may not write keep their stored values. */
export function mergeWritableFields(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  contentType: ContentTypeDefinition,
  actor: Actor | null,
): Record<string, unknown> {
  const restricted = contentType.fields.filter((field) => field.writeRoles?.length);
  if (restricted.length === 0) return incoming;

  const out = { ...incoming };
  for (const field of restricted) {
    if (!hasRole(actor, field.writeRoles)) out[field.name] = stored[field.name];
  }
  return out;
}
