import type { RichTextNode } from './richtext.js';

/**
 * Converts HTML to the ProseMirror JSON the editor produces, without a DOM. Unknown tags
 * are transparent (text kept); a tagless string is prose split on blank lines.
 */

type Mark = NonNullable<RichTextNode['marks']>[number];

const BLOCKS: Record<string, (attrs: string) => RichTextNode> = {
  p: () => ({ type: 'paragraph' }),
  h1: () => heading(1),
  h2: () => heading(2),
  h3: () => heading(3),
  h4: () => heading(4),
  h5: () => heading(5),
  h6: () => heading(6),
  ul: () => ({ type: 'bulletList' }),
  ol: (attrs) => {
    const start = Number(attribute(attrs, 'start'));
    return {
      type: 'orderedList',
      attrs: { start: Number.isFinite(start) && start > 0 ? start : 1 },
    };
  },
  li: () => ({ type: 'listItem' }),
  blockquote: () => ({ type: 'blockquote' }),
  pre: () => ({ type: 'codeBlock', attrs: { language: null } }),
};

const MARKS: Record<string, (attrs: string) => Mark | null> = {
  strong: () => ({ type: 'bold' }),
  b: () => ({ type: 'bold' }),
  em: () => ({ type: 'italic' }),
  i: () => ({ type: 'italic' }),
  s: () => ({ type: 'strike' }),
  strike: () => ({ type: 'strike' }),
  del: () => ({ type: 'strike' }),
  code: () => ({ type: 'code' }),
  a: (attrs) => {
    const href = attribute(attrs, 'href');
    // Safe schemes only; e.g. `javascript:` keeps the text but drops the link.
    if (!href || !/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return null;
    const target = attribute(attrs, 'target');
    return {
      type: 'link',
      attrs: {
        href,
        target: target === '_blank' ? '_blank' : null,
        rel: target === '_blank' ? 'noopener noreferrer nofollow' : null,
        class: null,
      },
    };
  },
};

/** Nodes that hold inline content. */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);
const LISTS = new Set(['bulletList', 'orderedList']);

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

export function htmlToRichTextDoc(html: string): RichTextNode {
  // Drop script and style bodies.
  const source = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '').trim();
  const doc: RichTextNode = { type: 'doc', content: [] };
  if (!source) return doc;
  if (!/<[a-z][^>]*>/i.test(source)) return prose(source);

  /** Open nodes, innermost last; `doc` at the bottom. */
  const stack: Array<{ node: RichTextNode; tag: string | null }> = [{ node: doc, tag: null }];
  const marks: Array<{ tag: string; mark: Mark | null }> = [];
  const top = () => stack[stack.length - 1] as { node: RichTextNode; tag: string | null };
  const inPre = () => stack.some((frame) => frame.node.type === 'codeBlock');

  const append = (node: RichTextNode) => {
    const parent = top().node;
    parent.content ??= [];
    parent.content.push(node);
  };

  const open = (node: RichTextNode, tag: string | null) => {
    append(node);
    stack.push({ node, tag });
  };

  const closeTextblock = () => {
    while (stack.length > 1 && TEXTBLOCKS.has(top().node.type)) stack.pop();
  };

  /** Ensures the innermost open node can take a block of this type. */
  const prepareFor = (type: string) => {
    closeTextblock();
    if (type === 'listItem') {
      if (!LISTS.has(top().node.type)) open({ type: 'bulletList' }, null);
      return;
    }
    // Non-items inside a list get wrapped in an item.
    if (LISTS.has(top().node.type)) open({ type: 'listItem' }, null);
  };

  const ensureTextblock = () => {
    if (TEXTBLOCKS.has(top().node.type)) return;
    prepareFor('paragraph');
    open({ type: 'paragraph' }, null);
  };

  const pushText = (raw: string) => {
    const pre = inPre();
    let text = decode(pre ? raw : raw.replace(/\s+/g, ' '));
    if (!pre && !TEXTBLOCKS.has(top().node.type)) {
      // Ignore whitespace between blocks.
      if (!text.trim()) return;
      text = text.replace(/^\s+/, '');
    }
    if (!text) return;
    ensureTextblock();
    const active = marks.map((entry) => entry.mark).filter((mark): mark is Mark => Boolean(mark));
    const node: RichTextNode = { type: 'text', text };
    if (active.length) node.marks = dedupeMarks(active);
    append(node);
  };

  const closeTag = (tag: string) => {
    if (tag in MARKS) {
      const index = marks.map((entry) => entry.tag).lastIndexOf(tag);
      if (index !== -1) marks.splice(index, 1);
      return;
    }
    if (!(tag in BLOCKS)) return;
    const index = stack.map((frame) => frame.tag).lastIndexOf(tag);
    if (index > 0) stack.length = index;
  };

  for (const token of source.matchAll(
    /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|[^<]+|</g,
  )) {
    const [whole, rawTag, attrs = ''] = token;
    if (whole.startsWith('<!--')) continue;
    if (!rawTag) {
      pushText(whole);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (whole.startsWith('</')) {
      closeTag(tag);
      continue;
    }

    if (tag === 'br') {
      ensureTextblock();
      append({ type: 'hardBreak' });
    } else if (tag === 'hr') {
      prepareFor('horizontalRule');
      append({ type: 'horizontalRule' });
    } else if (tag in BLOCKS) {
      const node = (BLOCKS[tag] as (attrs: string) => RichTextNode)(attrs);
      prepareFor(node.type);
      open(node, tag);
    } else if (tag in MARKS) {
      // `code` inside `pre` is the block's wrapper, not a mark.
      if (tag === 'code' && inPre()) continue;
      marks.push({ tag, mark: (MARKS[tag] as (attrs: string) => Mark | null)(attrs) });
    }
  }

  return tidy(doc);
}

/** Blank lines split paragraphs; single newlines become breaks. */
function prose(text: string): RichTextNode {
  return {
    type: 'doc',
    content: text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => ({
        type: 'paragraph',
        content: block
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .flatMap((line, index) => [
            ...(index ? [{ type: 'hardBreak' }] : []),
            { type: 'text', text: line },
          ]),
      })),
  };
}

/** Normalises to the editor's shape: no empty text, trimmed textblocks, non-empty list items. */
function tidy(node: RichTextNode): RichTextNode {
  if (!node.content) return node;
  let content = node.content.map(tidy).filter((child) => child.type !== 'text' || child.text);

  if (TEXTBLOCKS.has(node.type) && node.type !== 'codeBlock') {
    const last = content[content.length - 1];
    if (last?.type === 'text' && last.text) {
      last.text = last.text.replace(/\s+$/, '');
      if (!last.text) content = content.slice(0, -1);
    }
  }
  if (node.type === 'listItem' && !content.length) {
    content = [{ type: 'paragraph' }];
  }
  if (LISTS.has(node.type)) content = content.filter((child) => child.type === 'listItem');

  const out: RichTextNode = { ...node };
  if (content.length) out.content = content;
  else delete out.content;
  return out;
}

function heading(level: number): RichTextNode {
  return { type: 'heading', attrs: { level } };
}

function dedupeMarks(marks: Mark[]): Mark[] {
  const seen = new Set<string>();
  return marks.filter((mark) => {
    if (seen.has(mark.type)) return false;
    seen.add(mark.type);
    return true;
  });
}

function attribute(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!match) return null;
  return decode(match[2] ?? match[3] ?? match[4] ?? '');
}

function decode(value: string): string {
  return value
    .replace(/&([a-z]+|#39);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}
