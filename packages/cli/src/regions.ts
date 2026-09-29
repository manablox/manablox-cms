/**
 * Marked regions in the files of an instance. `manablox create` writes an anchor line per
 * slot and each plugin's part between two marker lines after it:
 *
 *   // manablox:slot config.plugins
 *   // manablox:plugin ai >>>
 *   aiPlugin(...),
 *   // manablox:plugin ai <<<
 *
 * `manablox plugin install` and `uninstall` add and remove whole regions at the anchors and
 * never touch anything else; a file without the anchor is left alone.
 */

/** How a file writes a comment line. */
export interface CommentStyle {
  open: string;
  close: string;
}

/** The comment syntax of a file by its path; `null` for JSON, which has none. */
export function commentStyle(path: string): CommentStyle | null {
  const name = path.split('/').at(-1) ?? path;
  if (name.endsWith('.json')) return null;
  if (/\.(?:[cm]?[jt]s)$/.test(name)) return { open: '//', close: '' };
  if (name.endsWith('.md')) return { open: '<!--', close: ' -->' };
  // .env, YAML, the Caddyfile, nginx, the Dockerfile and shell scripts.
  return { open: '#', close: '' };
}

const line = (style: CommentStyle, indent: string, text: string) =>
  `${indent}${style.open} ${text}${style.close}\n`;

/** The anchor line of a slot. */
export function anchorLine(style: CommentStyle, indent: string, slot: string): string {
  return line(style, indent, `manablox:slot ${slot}`);
}

/** A plugin's part between its markers; the fragment's own indentation is kept. */
export function regionText(
  style: CommentStyle,
  indent: string,
  id: string,
  fragment: string,
): string {
  const body = fragment.endsWith('\n') ? fragment : `${fragment}\n`;
  return `${line(style, indent, `manablox:plugin ${id} >>>`)}${body}${line(style, indent, `manablox:plugin ${id} <<<`)}`;
}

// Any of the three syntaxes, so a file is read the same whatever its name.
const COMMENT = String.raw`^[ \t]*(?:\/\/|#|<!--)[ \t]*`;
const END = String.raw`[ \t]*(?:-->)?[ \t]*$`;
const ANCHOR = new RegExp(`${COMMENT}manablox:slot ([A-Za-z0-9._-]+)${END}`);
const MARKER = new RegExp(`${COMMENT}manablox:plugin ([A-Za-z0-9._@/-]+) (>>>|<<<)${END}`);

/** Lines with their newline, so joining them gives the content back. */
function lines(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function anchorOf(text: string): string | null {
  return ANCHOR.exec(text.replace(/\n$/, ''))?.[1] ?? null;
}

function markerOf(text: string): { id: string; start: boolean } | null {
  const match = MARKER.exec(text.replace(/\n$/, ''));
  return match?.[1] ? { id: match[1], start: match[2] === '>>>' } : null;
}

/** One region of a file. */
export interface Region {
  id: string;
  /** The anchor it follows; `null` for a region that follows none. */
  slot: string | null;
  /** How many anchors of the same slot come before it in the file. */
  occurrence: number;
  /** The marker lines and everything between them. */
  text: string;
}

/** Thrown for a start marker without its end, or the other way round. */
export class UnbalancedRegion extends Error {}

/** The regions of a file in order, each with the anchor it follows. */
export function regionsOf(content: string): Region[] {
  const all = lines(content);
  const regions: Region[] = [];
  const seen = new Map<string, number>();
  let slot: string | null = null;
  let occurrence = 0;
  for (let index = 0; index < all.length; index += 1) {
    const text = all[index] ?? '';
    const anchor = anchorOf(text);
    if (anchor) {
      slot = anchor;
      occurrence = seen.get(anchor) ?? 0;
      seen.set(anchor, occurrence + 1);
      continue;
    }
    const marker = markerOf(text);
    if (!marker) {
      slot = null;
      continue;
    }
    if (!marker.start) throw new UnbalancedRegion(`an end marker of ${marker.id} without a start`);
    const end = all.findIndex((candidate, at) => {
      if (at <= index) return false;
      const other = markerOf(candidate);
      return other?.id === marker.id && !other.start;
    });
    if (end === -1) throw new UnbalancedRegion(`the region of ${marker.id} has no end marker`);
    regions.push({ id: marker.id, slot, occurrence, text: all.slice(index, end + 1).join('') });
    index = end;
  }
  return regions;
}

/** The plugin ids with a region in the content. */
export function regionIds(content: string): string[] {
  return [...new Set(regionsOf(content).map((region) => region.id))];
}

/** Outcome of an insert. */
export type InsertResult =
  | { status: 'inserted' | 'present'; content: string }
  | { status: 'missing'; content: string };

/**
 * Puts a region after the `occurrence`th anchor of `slot` and the regions already there.
 * `present` when that anchor has the plugin's region already, `missing` without the anchor.
 */
export function insertRegion(
  content: string,
  slot: string,
  region: Pick<Region, 'id' | 'text' | 'occurrence'>,
): InsertResult {
  const all = lines(content);
  let seen = 0;
  for (let index = 0; index < all.length; index += 1) {
    if (anchorOf(all[index] ?? '') !== slot) continue;
    if (seen++ !== region.occurrence) continue;
    // Past the regions that follow the anchor.
    let at = index + 1;
    while (at < all.length) {
      const marker = markerOf(all[at] ?? '');
      if (!marker?.start) break;
      if (marker.id === region.id) return { status: 'present', content };
      const end = all.findIndex((candidate, position) => {
        if (position <= at) return false;
        const other = markerOf(candidate);
        return other?.id === marker.id && !other.start;
      });
      if (end === -1) throw new UnbalancedRegion(`the region of ${marker.id} has no end marker`);
      at = end + 1;
    }
    const text = region.text.endsWith('\n') ? region.text : `${region.text}\n`;
    // A last line without a newline gets one before the region.
    const before = all.slice(0, at).join('');
    const joined = before && !before.endsWith('\n') ? `${before}\n` : before;
    return { status: 'inserted', content: `${joined}${text}${all.slice(at).join('')}` };
  }
  return { status: 'missing', content };
}

/** Takes out every region of the plugin; the content stays as it is without one. */
export function removeRegions(content: string, id: string): { content: string; removed: number } {
  const regions = regionsOf(content).filter((region) => region.id === id);
  let out = content;
  for (const region of regions) out = out.replace(region.text, '');
  return { content: out, removed: regions.length };
}
