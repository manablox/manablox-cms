import type {
  BlockBreakpoint,
  BlockGridSettings,
  BlockLayout,
  BlockPlacement,
  BlockValue,
} from '@manablox/core';
import { type Component, type DefineComponent, defineComponent, h, shallowReactive } from 'vue';
import type { FieldDefinition } from './api-types';

/** Parts of the admin that plugins render but the SDK does not ship; the admin lends them at boot. */
export interface AdminHost {
  FieldRenderer: Component;
  FieldInput: Component;
  FieldGrid: Component;
  BlockEditor: Component;
  BlockGridBoard: Component;
  htmlToRichText: (html: string) => Promise<Record<string, unknown>>;
}

const host = shallowReactive<Partial<AdminHost>>({});

/** Lends the admin's parts; the admin calls it before it mounts. */
export function provideAdminHost(parts: AdminHost): void {
  Object.assign(host, parts);
}

type LentName = 'FieldRenderer' | 'FieldInput' | 'FieldGrid' | 'BlockEditor' | 'BlockGridBoard';

/** Renders the admin's component of that name with the given props, listeners and slots. */
const lent = (name: LentName) =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => {
        const component = host[name];
        return component ? h(component, attrs, slots) : null;
      };
    },
  });

type Path = (string | number)[];

/** A field's input as the document editor shows it; editor state comes from `provideFieldContext`. */
export const FieldRenderer = lent('FieldRenderer') as unknown as DefineComponent<{
  field: FieldDefinition;
  modelValue: unknown;
  /** Matched against the editor's error paths. */
  path: Path;
  'onUpdate:modelValue'?: (value: unknown) => void;
}>;

/** A field type's bare input, without label or `field.actions`. */
export const FieldInput = lent('FieldInput') as unknown as DefineComponent<{
  field: FieldDefinition;
  modelValue: unknown;
  path: Path;
  'onUpdate:modelValue'?: (value: unknown) => void;
}>;

/** Fields in the document editor's four-column grid. */
export const FieldGrid = lent('FieldGrid') as unknown as DefineComponent<{
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  /** Base path for error lookup. */
  path: Path;
  onUpdate?: (name: string, value: unknown) => void;
}>;

/** A block's fields, as in the blocks field. */
export const BlockEditor = lent('BlockEditor') as unknown as DefineComponent<{
  block: BlockValue;
  path: Path;
  'onUpdate:fields'?: (fields: Record<string, unknown>) => void;
}>;

/** A blocks field's grid at one breakpoint, with moving, resizing and drawing new blocks. */
export const BlockGridBoard = lent('BlockGridBoard') as unknown as DefineComponent<{
  blocks: BlockValue[];
  grid: BlockGridSettings;
  breakpoint: BlockBreakpoint;
  selectedId?: string | null | undefined;
  labelOf: (block: BlockValue) => string;
  invalidOf?: ((block: BlockValue) => boolean) | undefined;
  hideBreakpoints?: boolean;
  insertable?: boolean;
  readOnly?: boolean;
  'onUpdate:breakpoint'?: (breakpoint: BlockBreakpoint) => void;
  'onUpdate:layout'?: (blockId: string, layout: BlockLayout | undefined) => void;
  onActive?: (blockId: string) => void;
  onSelect?: (blockId: string) => void;
  onInsert?: (placement: BlockPlacement) => void;
}>;

/** A rich text field's value from `contenteditable` HTML. */
export function htmlToRichText(html: string): Promise<Record<string, unknown>> {
  if (!host.htmlToRichText) return Promise.reject(new Error('the admin lent no rich text parser'));
  return host.htmlToRichText(html);
}
