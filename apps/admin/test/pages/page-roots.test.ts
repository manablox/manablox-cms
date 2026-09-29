// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

interface TemplateNode {
  type: number;
  tag?: string;
  content?: string;
  props?: Array<{ name: string }>;
}

const has = (node: TemplateNode, name: string) =>
  node.props?.some((prop) => prop.name === name) ?? false;

/** The `.vue` file a component tag is imported from. */
function importOf(file: string, tag: string): string | null {
  const match = new RegExp(`import\\s+${tag}\\s+from\\s+'([^']+\\.vue)'`).exec(
    readFileSync(file, 'utf8'),
  );
  if (!match?.[1]) return null;
  const spec = match[1];
  const target = spec.startsWith('~/') ? join(src, spec.slice(2)) : resolve(dirname(file), spec);
  return existsSync(target) ? target : null;
}

/** Why the file's root is not one element (following a component root), or null. */
function rootProblem(file: string): string | null {
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file });
  const nodes = (descriptor.template?.ast?.children ?? []) as TemplateNode[];
  const roots = nodes.filter((node) => !(node.type === 2 && !node.content?.trim()));
  const where = relative(src, file);
  // A v-if / v-else-if / v-else chain renders one of its branches.
  const last = roots.length - 1;
  const chain =
    roots.length > 1 &&
    roots.every(
      (node, i) => node.type === 1 && has(node, i === 0 ? 'if' : i === last ? 'else' : 'else-if'),
    );
  if (roots.length !== 1 && !chain) return `${where}: ${roots.length} root nodes`;
  const root = roots[0];
  if (root?.type !== 1) return `${where}: no root element`;
  if (roots.length === 1 && has(root, 'if')) return `${where}: a v-if root without v-else`;
  if (root.tag === 'template' || root.tag === 'slot') return `${where}: a <${root.tag}> root`;
  if (roots.length === 1 && root.tag && /^[A-Z]/.test(root.tag)) {
    const target = importOf(file, root.tag);
    const inner = target ? rootProblem(target) : null;
    return inner ? `${where} > ${inner}` : null;
  }
  return null;
}

describe('routed pages', () => {
  // The shell switches pages with an out-in transition, which never finishes on a fragment.
  it('render one root element', () => {
    const pages = readdirSync(join(src, 'pages')).filter((name) => name.endsWith('.vue'));
    const problems = pages.map((name) => rootProblem(join(src, 'pages', name))).filter(Boolean);
    expect(problems).toEqual([]);
  });
});
