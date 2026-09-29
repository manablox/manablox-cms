/**
 * Rich text (ProseMirror JSON) to HTML. Output is escaped, uses a fixed tag set and drops
 * unsafe links, so it is safe for `innerHTML`.
 */

/** A ProseMirror node; a document is a `doc` node. */
export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: RichTextNode[] | undefined;
  marks?: RichTextMark[] | undefined;
  text?: string | undefined;
}

export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown> | undefined;
}

/** Renders a document as HTML; a non-document renders as `''`. */
export function richTextToHtml(doc: unknown): string {
  return isRichTextNode(doc) ? renderChildren(doc) : '';
}

/** Flattens a document to plain text. */
export function richTextToText(doc: unknown): string {
  if (!isRichTextNode(doc)) return '';
  const parts: string[] = [];
  const walk = (node: RichTextNode) => {
    if (node.text) parts.push(node.text);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** True when a rich text value has no text. */
export function isRichTextEmpty(doc: unknown): boolean {
  return richTextToText(doc) === '';
}

export function isRichTextNode(value: unknown): value is RichTextNode {
  return (
    typeof value === 'object' && value !== null && typeof (value as RichTextNode).type === 'string'
  );
}

function renderChildren(node: RichTextNode): string {
  return (node.content ?? []).map(renderNode).join('');
}

function renderNode(node: RichTextNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(escapeHtml(node.text ?? ''), node.marks ?? []);
    case 'paragraph':
      return `<p${alignAttribute(node)}>${renderChildren(node)}</p>`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 2) || 2));
      return `<h${level}${alignAttribute(node)}>${renderChildren(node)}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${renderChildren(node)}</ul>`;
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      const attr = Number.isInteger(start) && start !== 1 ? ` start="${start}"` : '';
      return `<ol${attr}>${renderChildren(node)}</ol>`;
    }
    case 'listItem':
      return `<li>${renderChildren(node)}</li>`;
    case 'blockquote':
      return `<blockquote>${renderChildren(node)}</blockquote>`;
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const attr = language ? ` class="language-${escapeHtml(language)}"` : '';
      return `<pre><code${attr}>${renderChildren(node)}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'hardBreak':
      return '<br>';
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
      if (!isSafeHref(src)) return '';
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
    }
    case 'table':
      return `<table>${renderChildren(node)}</table>`;
    case 'tableRow':
      return `<tr>${renderChildren(node)}</tr>`;
    case 'tableHeader':
      return `<th${spanAttributes(node)}>${renderChildren(node)}</th>`;
    case 'tableCell':
      return `<td${spanAttributes(node)}>${renderChildren(node)}</td>`;
    default:
      // Unknown nodes still render their children.
      return renderChildren(node);
  }
}

/** A non-default `text-align` style. */
function alignAttribute(node: RichTextNode): string {
  const align = node.attrs?.textAlign;
  return align === 'center' || align === 'right' || align === 'justify'
    ? ` style="text-align: ${align}"`
    : '';
}

function spanAttributes(node: RichTextNode): string {
  let out = '';
  for (const name of ['colspan', 'rowspan'] as const) {
    const value = Number(node.attrs?.[name]);
    if (Number.isInteger(value) && value > 1) out += ` ${name}="${value}"`;
  }
  return out;
}

function applyMarks(html: string, marks: RichTextMark[]): string {
  return marks.reduce((inner, mark) => {
    switch (mark.type) {
      case 'bold':
        return `<strong>${inner}</strong>`;
      case 'italic':
        return `<em>${inner}</em>`;
      case 'underline':
        return `<u>${inner}</u>`;
      case 'strike':
        return `<s>${inner}</s>`;
      case 'code':
        return `<code>${inner}</code>`;
      case 'subscript':
        return `<sub>${inner}</sub>`;
      case 'superscript':
        return `<sup>${inner}</sup>`;
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        if (!isSafeHref(href)) return inner;
        const target = mark.attrs?.target === '_blank' ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${escapeHtml(href)}"${target}>${inner}</a>`;
      }
      default:
        return inner;
    }
  }, html);
}

/** http(s), mailto, tel, root-relative or fragment only. */
function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|\/|#)/i.test(href.trim());
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}
