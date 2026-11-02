import { describe, expect, it } from 'vitest';
import {
  canContain,
  canPlace,
  collectNodeIds,
  type DesignNode,
  designRoots,
  duplicateNode,
  findNode,
  insertNode,
  moveNode,
  NODE_ID,
  newNodeId,
  removeNode,
  updateNode,
  walkNodes,
} from '../src/index.js';

const tree = (): DesignNode => ({
  id: 'root',
  el: 'stack',
  children: [
    { id: 'a', el: 'text' },
    { id: 'b', el: 'box', children: [{ id: 'b1', el: 'text' }] },
    { id: 'c', el: 'text' },
  ],
});

const childIds = (node: DesignNode | undefined) => node?.children?.map((child) => child.id);

describe('tree helpers', () => {
  it('walks depth-first with parents, indexes and depth, and can skip subtrees', () => {
    const seen: string[] = [];
    walkNodes(tree(), ({ node, parent, index, depth }) => {
      seen.push(`${node.id}:${parent?.id ?? '-'}:${index}:${depth}`);
    });
    expect(seen).toEqual(['root:-:0:0', 'a:root:0:1', 'b:root:1:1', 'b1:b:0:2', 'c:root:2:1']);
    const skipped: string[] = [];
    walkNodes(tree(), ({ node }) => {
      skipped.push(node.id);
      return node.id === 'b' ? false : undefined;
    });
    expect(skipped).toEqual(['root', 'a', 'b', 'c']);
  });

  it('finds nodes with parent, index and ancestors', () => {
    const found = findNode(tree(), 'b1');
    expect(found?.parent?.id).toBe('b');
    expect(found?.index).toBe(0);
    expect(found?.path.map((node) => node.id)).toEqual(['root', 'b']);
    expect(findNode(tree(), 'nope')).toBeNull();
  });

  it('inserts without mutating the input and shares untouched branches', () => {
    const before = tree();
    const after = insertNode(before, 'b', 0, { id: 'new', el: 'text' });
    expect(childIds(findNode(after, 'b')?.node)).toEqual(['new', 'b1']);
    expect(childIds(findNode(before, 'b')?.node)).toEqual(['b1']);
    expect(after.children?.[0]).toBe(before.children?.[0]);
    expect(childIds(insertNode(before, 'root', 99, { id: 'z', el: 'text' }))).toEqual([
      'a',
      'b',
      'c',
      'z',
    ]);
  });

  it('removes nodes but never the root', () => {
    expect(childIds(removeNode(tree(), 'b'))).toEqual(['a', 'c']);
    const root = tree();
    expect(removeNode(root, 'root')).toBe(root);
    expect(removeNode(root, 'missing')).toBe(root);
  });

  it('moves nodes within and across parents', () => {
    expect(childIds(moveNode(tree(), 'a', 'root', 3))).toEqual(['b', 'c', 'a']);
    expect(childIds(moveNode(tree(), 'c', 'root', 0))).toEqual(['c', 'a', 'b']);
    const across = moveNode(tree(), 'a', 'b', 1);
    expect(childIds(across)).toEqual(['b', 'c']);
    expect(childIds(findNode(across, 'b')?.node)).toEqual(['b1', 'a']);
  });

  it('refuses to move a node into itself or its subtree', () => {
    const root = tree();
    expect(moveNode(root, 'b', 'b1', 0)).toBe(root);
    expect(moveNode(root, 'b', 'b', 0)).toBe(root);
    expect(moveNode(root, 'root', 'b', 0)).toBe(root);
  });

  it('duplicates a subtree with fresh ids right after the original', () => {
    const { root, id } = duplicateNode(tree(), 'b');
    expect(root.children?.map((child) => child.el)).toEqual(['text', 'box', 'box', 'text']);
    const copy = root.children?.[2] as DesignNode;
    expect(copy.id).toBe(id);
    expect(copy.children?.[0]?.id).not.toBe('b1');
    const ids = [...collectNodeIds(root)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(duplicateNode(tree(), 'root').id).toBeNull();
  });

  it('updates one node', () => {
    const next = updateNode(tree(), 'a', (node) => ({ ...node, props: { text: { en: 'Hi' } } }));
    expect(findNode(next, 'a')?.node.props).toEqual({ text: { en: 'Hi' } });
  });

  it('creates valid ids that are not taken', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newNodeId(taken);
      expect(id).toMatch(NODE_ID);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
    expect(collectNodeIds(tree()).has(newNodeId(tree()))).toBe(false);
  });

  it('lists the trees of each design kind', () => {
    const root = tree();
    expect(designRoots('page', { root })).toEqual([root]);
    expect(designRoots('layout', { root })).toEqual([root]);
    expect(
      designRoots('block', {
        variants: { b: { label: 'B', root: { id: 'x', el: 'box' } }, a: { label: 'A', root } },
        default: 'a',
      }).map((entry) => entry.id),
    ).toEqual(['root', 'x']);
    expect(designRoots('theme', {})).toEqual([]);
    expect(designRoots('page', null)).toEqual([]);
  });
});

describe('placement rules', () => {
  it('keeps chrome in layouts and form parts in forms', () => {
    expect(canPlace('menu', 'layout', [])).toBe(true);
    expect(canPlace('menu', 'page', [])).toBe(false);
    expect(canPlace('formField', 'block', ['box'])).toBe(false);
    expect(canPlace('formField', 'block', ['form', 'stack'])).toBe(true);
    expect(canPlace('form', 'block', ['form'])).toBe(false);
    expect(canPlace('button', 'block', ['link', 'box'])).toBe(false);
  });

  it('only lets containers hold children', () => {
    expect(canContain('stack', 'text')).toBe(true);
    expect(canContain('text', 'text')).toBe(false);
    expect(canContain('link', 'image')).toBe(true);
    expect(canContain('link', 'link')).toBe(false);
  });
});
