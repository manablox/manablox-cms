import type { ManabloxConfig } from '@manablox/core';
import { manabloxFields } from '@manablox/fields';

/**
 * What every process shares: the plugins every config loads, such as the field types, and
 * the code-defined content types. Every config imports it, so the delivery API exposes
 * exactly the types the admin edits. Types created in the admin live in the database and
 * need no entry here, so a new project starts with none: add one here only when a frontend
 * depends on its exact shape. The feature plugins are in manablox.plugins.ts.
 */
export const plugins: NonNullable<ManabloxConfig['plugins']> = [manabloxFields()];

export const contentTypes: NonNullable<ManabloxConfig['contentTypes']> = [];
