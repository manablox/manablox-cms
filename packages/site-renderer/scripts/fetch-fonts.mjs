#!/usr/bin/env node
// Downloads the bundled fonts (`BUNDLED_FONTS` in @manablox/site) and their licences into
// `fonts/`, from pinned upstream revisions, and checks each file's SHA-256. Run it when
// the list changes: `node scripts/fetch-fonts.mjs` (`--check` only verifies local files).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

const INTER = 'https://raw.githubusercontent.com/rsms/inter/v4.1';
const SERIF = 'https://raw.githubusercontent.com/adobe-fonts/source-serif/4.005R';
const GROTESK =
  'https://raw.githubusercontent.com/floriankarsten/space-grotesk/03507d024a01282884232081fc6011c09ff4e849';
const MONO =
  'https://raw.githubusercontent.com/JetBrains/JetBrainsMono/19371302b95d218af43299bce79ddbddd0bc364d';
const FRAUNCES =
  'https://raw.githubusercontent.com/undercasetype/Fraunces/7ccdec31c6028118dce3e47fe864e3744460371d';
const OUTFIT =
  'https://raw.githubusercontent.com/Outfitio/Outfit-Fonts/902773808eb372f70fb34e8946dd1ffe604efc79';
const LORA =
  'https://raw.githubusercontent.com/cyrealtype/Lora-Cyrillic/2d53b449b60e185b39f671b44fded83e0910ad30';
const DM =
  'https://raw.githubusercontent.com/googlefonts/dm-fonts/4412393b7d2de9fe7a92064c2dce9b5af5d7fd26/Sans';
const BRICOLAGE =
  'https://raw.githubusercontent.com/ateliertriay/bricolage/84745e5b96261ae5f8c6c856e262fe78d1d6efdd';
const JAKARTA =
  'https://raw.githubusercontent.com/tokotype/PlusJakartaSans/18d1cd2f7ea10481919d2f05c1f7064b7307fc26';

/** Target path below `fonts/` and source URL; checksums live in `fonts/SHA256SUMS.json`. */
const FILES = [
  ['inter/Inter-Variable.woff2', `${INTER}/docs/font-files/InterVariable.woff2`],
  ['inter/Inter-Italic-Variable.woff2', `${INTER}/docs/font-files/InterVariable-Italic.woff2`],
  ['inter/OFL.txt', `${INTER}/LICENSE.txt`],
  [
    'source-serif-4/SourceSerif4-Variable.woff2',
    `${SERIF}/WOFF2/VAR/SourceSerif4Variable-Roman.ttf.woff2`,
  ],
  [
    'source-serif-4/SourceSerif4-Italic-Variable.woff2',
    `${SERIF}/WOFF2/VAR/SourceSerif4Variable-Italic.ttf.woff2`,
  ],
  ['source-serif-4/OFL.txt', `${SERIF}/LICENSE.md`],
  [
    'space-grotesk/SpaceGrotesk-Variable.woff2',
    `${GROTESK}/fonts/woff2/SpaceGrotesk%5Bwght%5D.woff2`,
  ],
  ['space-grotesk/OFL.txt', `${GROTESK}/OFL.txt`],
  [
    'jetbrains-mono/JetBrainsMono-Variable.woff2',
    `${MONO}/fonts/webfonts/JetBrainsMono%5Bwght%5D.woff2`,
  ],
  ['jetbrains-mono/OFL.txt', `${MONO}/OFL.txt`],
  [
    'fraunces/Fraunces-Variable.woff2',
    `${FRAUNCES}/fonts/webfonts/variable/Fraunces%5BSOFT,WONK,opsz,wght%5D.woff2`,
  ],
  ['fraunces/OFL.txt', `${FRAUNCES}/OFL.txt`],
  ['outfit/Outfit-Variable.woff2', `${OUTFIT}/fonts/variable/Outfit%5Bwght%5D.woff2`],
  ['outfit/OFL.txt', `${OUTFIT}/OFL.txt`],
  ['lora/Lora-Variable.woff2', `${LORA}/fonts/webfonts/Lora%5Bwght%5D.woff2`],
  ['lora/Lora-Italic-Variable.woff2', `${LORA}/fonts/webfonts/Lora-Italic%5Bwght%5D.woff2`],
  ['lora/OFL.txt', `${LORA}/OFL.txt`],
  ['dm-sans/DMSans-Variable.woff2', `${DM}/fonts/webfonts/DMSans%5Bopsz,wght%5D.woff2`],
  [
    'dm-sans/DMSans-Italic-Variable.woff2',
    `${DM}/fonts/webfonts/DMSans-Italic%5Bopsz,wght%5D.woff2`,
  ],
  ['dm-sans/OFL.txt', `${DM}/OFL.txt`],
  [
    'bricolage-grotesque/BricolageGrotesque-Variable.woff2',
    `${BRICOLAGE}/fonts/webfonts/BricolageGrotesque%5Bopsz,wdth,wght%5D.woff2`,
  ],
  ['bricolage-grotesque/OFL.txt', `${BRICOLAGE}/OFL.txt`],
  [
    'plus-jakarta-sans/PlusJakartaSans-Variable.woff2',
    `${JAKARTA}/fonts/webfonts/PlusJakartaSans%5Bwght%5D.woff2`,
  ],
  [
    'plus-jakarta-sans/PlusJakartaSans-Italic-Variable.woff2',
    `${JAKARTA}/fonts/webfonts/PlusJakartaSans-Italic%5Bwght%5D.woff2`,
  ],
  ['plus-jakarta-sans/OFL.txt', `${JAKARTA}/OFL.txt`],
];

const sums = JSON.parse(readIfExists(join(root, 'SHA256SUMS.json')) ?? '{}');
const check = process.argv.includes('--check');
let failed = 0;

for (const [path, url] of FILES) {
  const target = join(root, path);
  let data;
  if (check) {
    if (!existsSync(target)) {
      console.error(`missing ${path}`);
      failed++;
      continue;
    }
    data = readFileSync(target);
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  const sum = createHash('sha256').update(data).digest('hex');
  if (sums[path] && sums[path] !== sum) {
    console.error(`${path}: checksum ${sum} does not match ${sums[path]}`);
    failed++;
    continue;
  }
  sums[path] = sum;
  if (!check) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    console.log(`${path} (${data.length} bytes)`);
  }
}

if (failed > 0) process.exit(1);
if (!check) {
  const sorted = Object.fromEntries(Object.entries(sums).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(root, 'SHA256SUMS.json'), `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(check ? 'fonts verified' : 'fonts fetched');

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
