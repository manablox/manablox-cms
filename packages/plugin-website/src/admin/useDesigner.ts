import { useSpaceStore } from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import type { DesignNode, ElementKind, SiteDesignKind, ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import { type DesignField, repeatsAround } from './model/bindings';
import type { FormSourceType } from './model/form-design';
import { useCanvasEdits } from './useCanvasEdits';
import { provideDesigner } from './useDesignerContext';
import { useDesignerEdits } from './useDesignerEdits';
import { useDesignerInsert } from './useDesignerInsert';
import { useDesignerSelection } from './useDesignerSelection';

export interface DesignerOptions {
  designKind: SiteDesignKind;
  designKey: () => string;
  /** The tree being edited; a block edits one variant's root. */
  root: () => DesignNode | null;
  setRoot: (root: DesignNode, group?: string) => void;
  /** Fields bindings can point at. */
  fields: () => readonly DesignField[];
  /** Locale static text is written in. */
  locale: () => string;
  locales: () => readonly string[];
  theme: () => ThemeDesign | null;
  breakpoint: () => BlockBreakpoint;
  /** Canvas resizes keep raw sizes instead of snapping to tokens. */
  advanced: () => boolean;
  readOnly: () => boolean;
  /** Ids used anywhere in the design; block variants share one namespace. */
  takenIds: () => Set<string>;
  /** Why an edit is refused, e.g. removing a layout's slot; shown as an error. */
  refuse?: {
    remove?: (root: DesignNode, id: string) => string | null;
    duplicate?: (root: DesignNode, id: string) => string | null;
    insert?: (root: DesignNode, kind: ElementKind) => string | null;
  };
}

/**
 * Selection and tree edits of one design tree, shared by the outline, the inspector and the
 * canvas. Every edit goes through `setRoot`, so the draft's undo stack records it.
 */
export function useDesigner(options: DesignerOptions) {
  const spaces = useSpaceStore();
  const dataTypes = computed<FormSourceType[]>(() =>
    spaces.dataKinds.map((type) => ({ id: type.id, label: type.label, fields: type.fields })),
  );

  const selection = useDesignerSelection(options);
  const { selectedId, labelFor, select } = selection;
  const edits = useDesignerEdits(options, selectedId, dataTypes);
  const { formUnavailable, insert, insertField } = useDesignerInsert(
    options,
    selectedId,
    dataTypes,
    edits,
  );
  const { highlight, editText, resize, canvas } = useCanvasEdits(options, {
    ...selection,
    ...edits,
    insert,
  });

  provideDesigner({
    designKind: options.designKind,
    root: computed(options.root),
    fields: computed(options.fields),
    repeats: computed(() => {
      const root = options.root();
      return root && selectedId.value ? repeatsAround(root, selectedId.value) : [];
    }),
    theme: computed(options.theme),
    breakpoint: computed(options.breakpoint),
    locales: computed(options.locales),
    locale: computed(options.locale),
    readOnly: computed(options.readOnly),
    takenIds: options.takenIds,
    labelFor,
    select,
    remove: edits.remove,
  });

  return {
    formUnavailable,
    selectedId,
    hoveredId: selection.hoveredId,
    selected: selection.selected,
    rows: selection.rows,
    collapsed: selection.collapsed,
    highlight,
    labelFor,
    toggleCollapsed: selection.toggleCollapsed,
    select,
    hover: selection.hover,
    move: edits.move,
    place: edits.place,
    canPlace: edits.canPlace,
    insert,
    insertField,
    remove: edits.remove,
    duplicate: edits.duplicate,
    rename: edits.rename,
    shift: edits.shift,
    indent: edits.indent,
    outdent: edits.outdent,
    patch: edits.patch,
    editText,
    resize,
    canvas,
  };
}

/** The selection and edits of one design tree. */
export type Designer = ReturnType<typeof useDesigner>;
