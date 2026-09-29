import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';

/**
 * Props `FieldRenderer` passes to every field input. Components must declare them all, or
 * Vue falls them through as DOM attributes.
 */
export interface FieldInputProps {
  modelValue: unknown;
  settings: Record<string, unknown>;
  field: FieldDefinition;
  /** Position in the document, for error lookup. */
  path: (string | number)[];
  /** Ties the editor's `<label for>` to the input. */
  id?: string;
}
