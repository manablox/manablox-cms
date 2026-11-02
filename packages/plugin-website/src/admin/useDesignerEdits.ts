import { toast } from '@manablox/admin-sdk';
import { type DesignNode, duplicateNode, findNode, removeNode, updateNode } from '@manablox/site';
import type { Ref } from 'vue';
import { type FormSourceType, requiredInputError } from './model/form-design';
import {
  type DropPosition,
  dropSpot,
  indentNode,
  outdentNode,
  placeNode,
  renameNode,
  shiftNode,
} from './model/outline';
import type { DesignerOptions } from './useDesigner';

/**
 * Moves, removals and patches of a design tree. Every edit goes through `setRoot`, so the
 * draft's undo stack records it.
 */
export function useDesignerEdits(
  options: DesignerOptions,
  selectedId: Ref<string | null>,
  dataTypes: Readonly<Ref<FormSourceType[]>>,
) {
  function refused(reason: string | null | undefined): boolean {
    if (reason) toast.error(reason);
    return Boolean(reason);
  }

  function apply(next: DesignNode | null, group?: string): boolean {
    if (!next || options.readOnly()) return false;
    options.setRoot(next, group);
    return true;
  }

  function move(id: string, parentId: string, index: number) {
    const root = options.root();
    if (root) apply(placeNode(root, options.designKind, id, parentId, index));
  }

  /** Drops a node on an outline row. */
  function place(id: string, targetId: string, position: DropPosition): boolean {
    const root = options.root();
    const spot = root ? dropSpot(root, targetId, position) : null;
    if (!root || !spot) return false;
    return apply(placeNode(root, options.designKind, id, spot.parentId, spot.index));
  }

  /** Whether a node may be dropped on a row, for the outline's drop feedback. */
  function canPlace(id: string, targetId: string, position: DropPosition): boolean {
    const root = options.root();
    const spot = root ? dropSpot(root, targetId, position) : null;
    return Boolean(
      root && spot && placeNode(root, options.designKind, id, spot.parentId, spot.index),
    );
  }

  function remove(id: string) {
    const root = options.root();
    if (!root || root.id === id || options.readOnly()) return;
    if (
      refused(options.refuse?.remove?.(root, id) ?? requiredInputError(root, id, dataTypes.value))
    )
      return;
    const found = findNode(root, id);
    if (!apply(removeNode(root, id))) return;
    if (selectedId.value === id) {
      const siblings = found?.parent?.children ?? [];
      const next = siblings[found ? found.index + 1 : -1] ?? siblings[(found?.index ?? 0) - 1];
      selectedId.value = next?.id ?? found?.parent?.id ?? null;
    }
  }

  function duplicate(id: string) {
    const root = options.root();
    if (!root || options.readOnly()) return;
    if (refused(options.refuse?.duplicate?.(root, id))) return;
    const result = duplicateNode(root, id);
    if (result.id && apply(result.root)) selectedId.value = result.id;
  }

  function rename(id: string, label: string) {
    const root = options.root();
    if (root) apply(renameNode(root, id, label), `rename:${id}`);
  }

  function shift(id: string, delta: -1 | 1) {
    const root = options.root();
    if (root) apply(shiftNode(root, id, delta));
  }

  function indent(id: string) {
    const root = options.root();
    if (root) apply(indentNode(root, options.designKind, id));
  }

  function outdent(id: string) {
    const root = options.root();
    if (root) apply(outdentNode(root, options.designKind, id));
  }

  /** Replaces one node; edits of the same `group` in a row share an undo step. */
  function patch(id: string, fn: (node: DesignNode) => DesignNode, group?: string) {
    const root = options.root();
    if (root) apply(updateNode(root, id, fn), group);
  }

  return {
    apply,
    refused,
    move,
    place,
    canPlace,
    remove,
    duplicate,
    rename,
    shift,
    indent,
    outdent,
    patch,
  };
}
