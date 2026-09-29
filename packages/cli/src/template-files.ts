import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorLine, commentStyle, regionText } from './regions.js';

/** Reads scaffold files from `templates/` and fills their `{{#if}}` blocks and `__TOKEN__`s. */

export type Tokens = Record<string, string>;
export type Flags = Record<string, boolean>;
/** One plugin's fragment for a slot: raw template text. */
export interface SlotPart {
  id: string;
  fragment: string;
}
/** The plugins' fragments for the `{{slot <name>}}` lines, by name, in plugin order. */
export type Slots = Record<string, readonly SlotPart[]>;

/** `templates/` at the package root, beside `src/` or `dist/`. */
let root: string | null = null;
export function templatesRoot(): string {
  if (root) return root;
  const path = fileURLToPath(new URL('../templates/', import.meta.url));
  if (!existsSync(join(path, 'instance')) || !existsSync(join(path, 'shared', 'server.js'))) {
    throw new Error('the templates are missing from the package');
  }
  root = path;
  return path;
}

/** One template, filled; its path picks the comment syntax of the slot anchors. */
export function renderTemplate(path: string, tokens: Tokens, flags?: Flags, slots?: Slots): string {
  const raw = readFileSync(join(templatesRoot(), ...path.split('/')), 'utf8');
  return fill(raw, tokens, flags, slots, path);
}

const SLOT = /^([ \t]*)\{\{slot ([a-z][a-zA-Z.]*)\}\}[ \t]*(?:\n|$)/gm;

/**
 * Puts each `{{slot}}` line's anchor in its place, followed by one marked region per plugin
 * fragment (see `regions.ts`), indented like the slot line. A fragment that renders empty
 * gets no region. JSON has no comments: there the fragments stand alone, unmarked.
 */
export function fillSlots(
  content: string,
  slots: Slots,
  path: string,
  render: (fragment: string) => string = (fragment) => fragment,
): string {
  const style = commentStyle(path);
  return content.replace(SLOT, (_line, indent: string, name: string) => {
    let out = style ? anchorLine(style, indent, name) : '';
    for (const { id, fragment } of slots[name] ?? []) {
      const rendered = render(fragment);
      if (!rendered.trim()) continue;
      out += style
        ? regionText(style, indent, id, rendered)
        : rendered.endsWith('\n')
          ? rendered
          : `${rendered}\n`;
    }
    return out;
  });
}

/**
 * Resolves the `{{#if}}` blocks when `flags` is given, replaces every token, then fills the
 * slots when `slots` is, each fragment rendered with the same tokens and flags.
 */
export function fill(
  content: string,
  tokens: Tokens,
  flags?: Flags,
  slots?: Slots,
  path = '',
): string {
  let out = flags ? conditionals(content, flags) : content;
  out = replaceTokens(out, tokens);
  return slots
    ? fillSlots(out, slots, path, (fragment) => fill(fragment, tokens, flags, undefined, path))
    : out;
}

function replaceTokens(content: string, tokens: Tokens): string {
  let out = content;
  // A function replacement keeps `$` in a value literal.
  for (const [token, value] of Object.entries(tokens)) out = out.replaceAll(token, () => value);
  return out;
}

const DIRECTIVE = /\{\{(?:#if (!?)([a-zA-Z]+)|(#else)|\/if)\}\}/g;

/** Nestable `{{#if flag}}`/`{{#if !flag}}`/`{{#else}}`/`{{/if}}`; a directive alone on its line takes the line with it. */
function conditionals(content: string, flags: Flags): string {
  let out = '';
  let printing = true;
  let cursor = 0;
  // One entry per open block: whether the enclosing block prints, and whether the `if` branch does.
  const blocks: Array<{ parent: boolean; taken: boolean }> = [];
  for (const match of content.matchAll(DIRECTIVE)) {
    let start = match.index;
    let end = start + match[0].length;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const newline = content.indexOf('\n', end);
    const lineEnd = newline === -1 ? content.length : newline;
    const alone =
      /^[ \t]*$/.test(content.slice(lineStart, start)) &&
      /^[ \t]*$/.test(content.slice(end, lineEnd));
    if (alone) {
      start = lineStart;
      end = newline === -1 ? content.length : newline + 1;
    }
    if (printing) out += content.slice(cursor, start);
    cursor = end;

    const [, negate, name, isElse] = match;
    if (name !== undefined) {
      const value = flags[name];
      if (value === undefined) throw new Error(`unknown template flag '${name}'`);
      const taken = negate ? !value : value;
      blocks.push({ parent: printing, taken });
      printing = printing && taken;
    } else {
      const block = blocks.at(-1);
      if (!block) throw new Error(`'${match[0]}' without an open block`);
      if (isElse) printing = block.parent && !block.taken;
      else {
        blocks.pop();
        printing = block.parent;
      }
    }
  }
  if (blocks.length > 0) throw new Error('an unclosed template block');
  return out + content.slice(cursor);
}
