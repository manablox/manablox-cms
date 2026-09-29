import { computed, type InjectionKey, inject, type MaybeRefOrGetter, provide, toValue } from 'vue';
import type { ContentTypeSummary, FieldTypeMeta } from './api-types';

/** What a field input needs from its editor, injected so any provider can host inputs. */
export interface FieldContext {
  /** Scope for pickers. */
  spaceId: string | null;
  locale: string;
  errorFor: (path: (string | number)[]) => string | null;
  /** Whether an error sits at the path or anywhere inside it. */
  errorUnder: (path: (string | number)[]) => boolean;
  readOnly: boolean;
  typeById: (id: string) => ContentTypeSummary | null;
  typeByName: (name: string) => ContentTypeSummary | null;
  /** Every block type of the space, for blocks fields without `types`. */
  blockTypes: () => ContentTypeSummary[];
  fieldTypeMeta: (name: string) => FieldTypeMeta | null;
  /** Blocks show the plugins' `block.inspector` entries, as in the document editor. */
  blockInspectors?: boolean;
  /**
   * What an editor adds for plugins' inputs and `field.actions` entries, by name; e.g. a
   * document editor's `document` (a `FieldContextDocument`). Absent keys mean the editor has
   * none.
   */
  extensions?: Readonly<Record<string, unknown>>;
}

/** A document editor's `extensions.document`: the document around the fields, as it is now. */
export interface FieldContextDocument {
  type: ContentTypeSummary | null;
  title: string;
  /** The draft's values by field name. */
  fields: Readonly<Record<string, unknown>>;
}

const KEY: InjectionKey<() => FieldContext> = Symbol('field-context');

/** Provided by the document owner; the getter keeps it reactive. */
export function provideFieldContext(context: MaybeRefOrGetter<FieldContext>): void {
  provide(KEY, () => toValue(context));
}

/** Fallback for inputs rendered outside an editor. */
const NONE: FieldContext = {
  spaceId: null,
  locale: 'en',
  errorFor: () => null,
  errorUnder: () => false,
  readOnly: false,
  typeById: () => null,
  typeByName: () => null,
  blockTypes: () => [],
  fieldTypeMeta: () => null,
};

export function useFieldContext() {
  const get = inject(KEY, () => NONE);
  return computed(() => get());
}
