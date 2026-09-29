import {
  blocksOf,
  gridValueOf,
  isBlockGrid,
  resolveBlockGrid,
  withBlocks,
  withPlacement,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import type { DraftDocument } from '@manablox/admin-sdk/features/content/model/draft';
import type {
  ContentTypeSummary,
  FieldDefinition,
  FieldTypeMeta,
} from '@manablox/admin-sdk/lib/api-types';
import { moveInList } from '@manablox/admin-sdk/lib/collections';
import { getAt, setAt } from '@manablox/admin-sdk/lib/paths';
import type { BlockBreakpoint, BlockLayout, BlockPlacement, BlockValue } from '@manablox/core';
import { blockPathWithin, type FieldPath, type InlineKind, samePath } from '@manablox/live-preview';
import { computed, type Ref } from 'vue';
import { htmlToRichText } from '~/features/content/model/richtext-html';

export interface DraftBlocksOptions {
  doc: () => DraftDocument | null;
  contentType: () => ContentTypeSummary | null;
  typeById: (id: string) => ContentTypeSummary | null;
  fieldTypeMeta: (name: string) => FieldTypeMeta | null;
  blockKinds: () => ContentTypeSummary[];
  /** A block, a block field, or a document field; follows moves and clears on removal. */
  selection: Ref<FieldPath | null>;
}

function isBlock(value: unknown): value is BlockValue {
  return typeof value === 'object' && value !== null && 'blockId' in value && 'type' in value;
}

/** Block list edits on the draft document, addressed by path. */
export function useDraftBlocks(options: DraftBlocksOptions) {
  const { selection } = options;
  const selectedBlockPath = computed(() =>
    selection.value ? blockPathWithin(selection.value) : null,
  );
  const selectedBlock = computed(() =>
    selectedBlockPath.value ? (blockAt(selectedBlockPath.value) ?? null) : null,
  );
  /** The field inside the selected block, when one is selected. */
  const selectedFieldName = computed(() => {
    const path = selection.value;
    const block = selectedBlockPath.value;
    if (!path || !block || path.length <= block.length) return null;
    const name = path[block.length];
    return typeof name === 'string' ? name : null;
  });
  /** A document-level field or the title, when outside every block. */
  const selectedTopField = computed(() => {
    const path = selection.value;
    if (!path || selectedBlockPath.value || path.length === 0) return null;
    return typeof path[0] === 'string' ? path[0] : null;
  });
  const selectedList = computed(() => selectedBlockPath.value?.slice(0, -1) ?? null);
  const selectedIndex = computed(() => {
    const last = selectedBlockPath.value?.[selectedBlockPath.value.length - 1];
    return typeof last === 'number' ? last : -1;
  });
  const selectedSiblings = computed(() => (selectedList.value ? listAt(selectedList.value) : []));
  const selectedListDefinition = computed(() =>
    selectedList.value ? listDefinition(selectedList.value) : null,
  );
  const selectedGrid = computed(() => {
    if (!selectedList.value) return null;
    const grid = resolveBlockGrid(gridValueOf(getAt(options.doc()?.fields, selectedList.value)));
    return isBlockGrid(grid) ? grid : null;
  });
  const selectedTypeLabel = computed(() =>
    selectedBlock.value ? (options.typeById(selectedBlock.value.type)?.label ?? 'Block') : '',
  );

  /** The selected block's field definition by name, or the document's when none is selected. */
  function definitionFor(name: string): FieldDefinition | null {
    const block = selectedBlock.value;
    const owner = block ? options.typeById(block.type) : options.contentType();
    return owner?.fields.find((field) => field.name === name) ?? null;
  }

  function blockAt(path: FieldPath): BlockValue | undefined {
    const value = getAt(options.doc()?.fields, path);
    return isBlock(value) ? value : undefined;
  }

  function listAt(list: FieldPath): BlockValue[] {
    return blocksOf(getAt(options.doc()?.fields, list));
  }

  function writeFields(next: Record<string, unknown>): void {
    const doc = options.doc();
    if (doc) doc.fields = next;
  }

  /** Writes a list's blocks, keeping its grid. */
  function writeList(list: FieldPath, blocks: BlockValue[]): void {
    const doc = options.doc();
    if (!doc) return;
    writeFields(setAt(doc.fields, list, withBlocks(getAt(doc.fields, list), blocks)));
  }

  function ownerOf(blockPath: FieldPath): ContentTypeSummary | null {
    const block = blockAt(blockPath);
    return block ? options.typeById(block.type) : null;
  }

  /** Field definition for a list path, e.g. `['components']` or `['components', 0, 'children']`. */
  function listDefinition(list: FieldPath): FieldDefinition | null {
    if (list.length === 0) return null;
    const owner = list.length === 1 ? options.contentType() : ownerOf(list.slice(0, -1));
    const name = list[list.length - 1];
    return owner?.fields.find((field) => field.name === name) ?? null;
  }

  /** Block types a list accepts; an unrestricted field takes any. */
  function allowedTypes(list: FieldPath): ContentTypeSummary[] {
    const definition = listDefinition(list);
    const ids = definition
      ? ((definition.settings.types as string[] | undefined) ??
        (definition.settings.type ? [definition.settings.type as string] : []))
      : [];
    if (definition && !ids.length) return options.blockKinds();
    return ids
      .map((id) => options.typeById(id))
      .filter((type): type is ContentTypeSummary => type !== null);
  }

  function move(list: FieldPath, from: number, to: number): void {
    const blocks = listAt(list);
    const next = moveInList(blocks, from, to);
    if (next === blocks) return;
    writeList(list, [...next]);
    // Keep the moved block selected.
    if (selection.value && samePath(selectedBlockPath.value, [...list, from])) {
      selection.value = [...list, to, ...selection.value.slice(list.length + 1)];
    }
  }

  function remove(list: FieldPath, index: number): void {
    const blocks = listAt(list);
    if (index < 0 || index >= blocks.length) return;
    writeList(
      list,
      blocks.filter((_, at) => at !== index),
    );
    if (samePath(selectedBlockPath.value, [...list, index])) selection.value = null;
  }

  /** Inserts a block of `typeId` and resolves to its path. */
  function insert(list: FieldPath, index: number, typeId: string): FieldPath {
    const blocks = listAt(list);
    const at = Math.max(0, Math.min(index, blocks.length));
    const block: BlockValue = { blockId: crypto.randomUUID(), type: typeId, fields: {} };
    writeList(list, [...blocks.slice(0, at), block, ...blocks.slice(at)]);
    return [...list, at];
  }

  function setLayout(blockPath: FieldPath, layout: BlockLayout | undefined): void {
    const doc = options.doc();
    if (doc) writeFields(setAt(doc.fields, [...blockPath, 'layout'], layout));
  }

  /** A drag or resize in the frame, for one breakpoint. */
  function layout(
    list: FieldPath,
    index: number,
    breakpoint: BlockBreakpoint,
    placement: BlockPlacement | null,
  ): void {
    const block = listAt(list)[index];
    if (block) setLayout([...list, index], withPlacement(block.layout, breakpoint, placement));
  }

  /** The board names blocks by id; the draft by path. */
  function setLayoutById(list: FieldPath, blockId: string, layout: BlockLayout | undefined): void {
    const index = listAt(list).findIndex((block) => block.blockId === blockId);
    if (index >= 0) setLayout([...list, index], layout);
  }

  /** Inline text edit from the frame, converted per field type. */
  async function edit(path: FieldPath, inline: InlineKind, text: string, html: string) {
    const doc = options.doc();
    if (!doc) return;
    if (path.length === 1 && path[0] === 'title') {
      doc.title = text.replace(/\n+$/, '');
      return;
    }
    const name = path[path.length - 1];
    if (typeof name !== 'string') return;
    const blockPath = blockPathWithin(path);
    const owner = blockPath ? ownerOf(blockPath) : options.contentType();
    const definition = owner?.fields.find((field) => field.name === name);
    if (!definition) return;

    let value: unknown;
    if (inline === 'richtext' || definition.type === 'richtext') value = await htmlToRichText(html);
    else if (definition.type === 'number') {
      const parsed = Number(text.trim().replace(',', '.'));
      value = text.trim() === '' || Number.isNaN(parsed) ? null : parsed;
    } else value = text.replace(/\n+$/, '');

    const current = options.doc();
    if (current) writeFields(setAt(current.fields, path, value));
  }

  /** Board card label: type plus summary. */
  function labelOf(block: BlockValue): string {
    const type = options.typeById(block.type);
    for (const field of type?.fields ?? []) {
      if (!options.fieldTypeMeta(field.type)?.admin.summary) continue;
      const value = block.fields[field.name];
      if (typeof value === 'string' && value) return `${type?.label ?? 'Block'} - ${value}`;
    }
    return `${type?.label ?? 'Block'} - ${block.blockId.slice(0, 8)}`;
  }

  return {
    selectedBlockPath,
    selectedBlock,
    selectedFieldName,
    selectedTopField,
    selectedList,
    selectedIndex,
    selectedSiblings,
    selectedListDefinition,
    selectedGrid,
    selectedTypeLabel,
    definitionFor,
    blockAt,
    listAt,
    listDefinition,
    allowedTypes,
    move,
    remove,
    insert,
    layout,
    setLayoutById,
    edit,
    labelOf,
  };
}
