import { type DesignNode, type ElementKind, newNodeId } from '@manablox/site';
import { computed, type Ref } from 'vue';
import { elementForField } from './model/bindings';
import { FORM_DESIGN_KINDS } from './model/elements';
import {
  boundFieldOf,
  enclosingForm,
  type FormSourceType,
  formFieldNode,
  formPaletteReasons,
  needsBoundInput,
  newForm,
  nextFormField,
} from './model/form-design';
import {
  addNode,
  createNode,
  firstBinding,
  insertSpot,
  nodeForField,
  wantsBinding,
} from './model/outline';
import type { DesignerOptions } from './useDesigner';

/** New elements for a design tree: from the palette or for an unplaced field. */
export function useDesignerInsert(
  options: DesignerOptions,
  selectedId: Ref<string | null>,
  dataTypes: Readonly<Ref<FormSourceType[]>>,
  edit: {
    apply: (next: DesignNode | null) => boolean;
    refused: (reason: string | null | undefined) => boolean;
  },
) {
  /** Form elements that cannot go where the selection is, with the reason. */
  const formUnavailable = computed(() =>
    FORM_DESIGN_KINDS.includes(options.designKind)
      ? formPaletteReasons(options.root(), selectedId.value, dataTypes.value)
      : {},
  );

  /** A form for the first data type, or an input for the next field of the form at `parentId`. */
  function buildForm(
    kind: 'form' | 'formField',
    root: DesignNode,
    parentId: string,
    taken: Set<string>,
  ): DesignNode | null {
    if (kind === 'form') {
      const type = dataTypes.value[0];
      return type ? newForm(type, taken, options.locale()) : null;
    }
    const form = enclosingForm(root, parentId);
    if (form && boundFieldOf(form))
      return needsBoundInput(form) ? { id: newNodeId(taken), el: 'formField' } : null;
    const field = form ? nextFormField(form, dataTypes.value) : null;
    return field ? formFieldNode(field, taken, options.locale()) : null;
  }

  /** A new element for a spot, bound to the first fitting field when it needs one. */
  function build(kind: ElementKind, root: DesignNode, parentId: string): DesignNode {
    const taken = options.takenIds();
    if (kind === 'form' || kind === 'formField') {
      const node = buildForm(kind, root, parentId, taken);
      if (node) return node;
    }
    const binding = wantsBinding(kind)
      ? firstBinding(root, options.fields(), kind, parentId)
      : null;
    const node = createNode(kind, newNodeId(taken), { locale: options.locale(), binding });
    taken.add(node.id);
    if (kind === 'repeat' && binding) {
      const entry: ElementKind =
        binding.field.type === 'repeater'
          ? 'stack'
          : elementForField({
              ...binding.field,
              settings: { ...binding.field.settings, multiple: false },
            });
      const childBinding =
        entry === 'stack' ? null : { ...binding, value: `${binding.value}.$item`, item: true };
      node.children = [
        createNode(entry, newNodeId(taken), { locale: options.locale(), binding: childBinding }),
      ];
    }
    return node;
  }

  /** Inserts an element at a spot, or after the selection; selects it. */
  function insert(kind: ElementKind, spot?: { parentId: string; index: number }): boolean {
    const root = options.root();
    if (!root || options.readOnly()) return false;
    if (edit.refused(options.refuse?.insert?.(root, kind))) return false;
    const node = build(kind, root, spot?.parentId ?? selectedId.value ?? root.id);
    const at = spot ?? insertSpot(root, options.designKind, node, selectedId.value);
    if (!at) return false;
    // The binding depends on the spot; build again for the final one.
    const final = spot ? node : build(kind, root, at.parentId);
    if (!edit.apply(addNode(root, options.designKind, final, at.parentId, at.index))) return false;
    selectedId.value = final.id;
    return true;
  }

  /** Inserts the generated element for a field that no element shows yet. */
  function insertField(fieldId: string): boolean {
    const root = options.root();
    const field = options.fields().find((entry) => entry.id === fieldId);
    if (!root || !field) return false;
    const node = nodeForField(field, options.takenIds());
    const at = node ? insertSpot(root, options.designKind, node, selectedId.value) : null;
    if (!node || !at) return false;
    if (!edit.apply(addNode(root, options.designKind, node, at.parentId, at.index))) return false;
    selectedId.value = node.id;
    return true;
  }

  return { formUnavailable, insert, insertField };
}
