// Shared pieces of the source scanners in `scripts/check-*.mjs`.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Yields every file under `root` matching `ext`; `skip(path)` prunes files and folders. */
export function* walk(root, { skip = () => false, ext = /\.(vue|ts)$/ } = {}) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (skip(path)) continue;
    if (statSync(path).isDirectory()) yield* walk(path, { skip, ext });
    else if (ext.test(entry)) yield path;
  }
}

/** The 1-based line of `index` in `text`. */
export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Prints `{ where, found, message }` findings and exits 1, or the clean line and exits 0. */
export function report(label, findings, cleanNote) {
  if (findings.length === 0) {
    console.log(`${label}: clean (${cleanNote})`);
    process.exit(0);
  }
  console.error(`${label}: ${findings.length} finding(s)\n`);
  for (const finding of findings) {
    console.error(`  ${finding.where}\n    ${finding.found} - ${finding.message}`);
  }
  process.exit(1);
}
