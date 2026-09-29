import { CONTROL_CATALOGUE, controlEntry, type ErrorDetail, ManabloxError } from '@manablox/core';
import type { ControlSettings, SpaceGroupRef } from '../service.js';

/** Group names of the grouped settings body, e.g. `features`, `snapshots` or `plugins`. */
const GROUPS = new Set([
  ...Object.keys(CONTROL_CATALOGUE)
    .filter((key) => key.includes('.'))
    .map((key) => key.slice(0, key.indexOf('.'))),
  'plugins',
]);

/**
 * Flattens a settings body to stored keys. Top-level stored keys pass as they are; an object
 * under a group name (`features`, `limits`, `snapshots`, ...) becomes `<group>.<key>`.
 */
export function flattenControlSettings(body: Record<string, unknown>): ControlSettings {
  const out: ControlSettings = {};
  const issues: ErrorDetail[] = [];
  const put = (key: string, value: unknown, path: string[]) => {
    if (Object.hasOwn(out, key)) {
      issues.push({ key: 'control.key.duplicate', path, params: { key } });
      return;
    }
    out[key] = value;
  };
  for (const [key, value] of Object.entries(body)) {
    if (controlEntry(key) || !GROUPS.has(key) || !isPlainObject(value)) {
      put(key, value, [key]);
      continue;
    }
    for (const [inner, innerValue] of Object.entries(value)) {
      put(`${key}.${inner}`, innerValue, [key, inner]);
    }
  }
  if (issues.length > 0) throw ManabloxError.validation(issues);
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A group ref from a path or scope: a group id, or `ext:<externalId>`. */
export function parseGroupRef(ref: string): SpaceGroupRef {
  if (ref.startsWith('ext:')) return { externalId: ref.slice(4) };
  if (!UUID.test(ref)) throw ManabloxError.notFound('spaceGroup.notFound', { id: ref });
  return { id: ref };
}

/** `id` when it is a UUID; otherwise the space is not found. */
export function spaceId(id: string): string {
  if (!UUID.test(id)) throw ManabloxError.notFound('space.notFound', { spaceId: id });
  return id;
}

/** `id` when it is a UUID; otherwise the user is not found. */
export function userId(id: string): string {
  if (!UUID.test(id)) throw ManabloxError.notFound('user.notFound', { id });
  return id;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
