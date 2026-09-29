/**
 * The media library. Files are generated rather than fetched: a seed that needs the
 * network is a seed that fails on a train, and bytes made here are small, varied and
 * unique - the media service dedupes by checksum, so two identical files would be one
 * asset and the count would quietly come up short.
 *
 * Images go through sharp, which is what the instance uses to derive renditions anyway,
 * so the uploads have real dimensions and the eager `thumb` preset has something to make.
 */
import sharp from 'sharp';
import { chance, count, faker, pick, sentence, title, words } from './random.mts';
import type { Asset, Media } from './types.mts';

/**
 * A flat colour card with a few shapes on it, as SVG. The source for every raster upload,
 * and for the SVG uploads as they stand. Shapes rather than a caption: the container has
 * no fonts installed, and a seed should not print a fontconfig error per file.
 */
function card(width: number, height: number): Buffer {
  const hue = count(0, 359);
  const shapes = Array.from({ length: count(2, 6) }, () => {
    const size = count(Math.round(height / 8), Math.round(height / 2));
    const fill = `hsl(${(hue + count(20, 180)) % 360} 80% ${count(45, 75)}%)`;
    return chance(0.5)
      ? `<circle cx="${count(0, width)}" cy="${count(0, height)}" r="${size / 2}" fill="${fill}" opacity="0.75"/>`
      : `<rect x="${count(0, width)}" y="${count(0, height)}" width="${size}" height="${size}" fill="${fill}" opacity="0.7" transform="rotate(${count(0, 90)} ${width / 2} ${height / 2})"/>`;
  });
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="hsl(${hue} 70% 45%)"/>${shapes.join('')}</svg>`,
  );
}

/** The smallest thing that is still a PDF: one page with a line of text on it. */
function pdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

interface Upload {
  filename: string;
  mimeType: string;
  body: Buffer;
}

async function raster(): Promise<Upload> {
  const width = pick([320, 640, 800, 1200, 1600]);
  const height = Math.round(width / pick([1, 1.33, 1.5, 1.78]));
  const image = sharp(card(width, height));
  const format = pick(['png', 'jpeg', 'webp'] as const);
  const body = await (format === 'png'
    ? image.png()
    : format === 'jpeg'
      ? image.jpeg({ quality: 80 })
      : image.webp()
  ).toBuffer();
  return {
    filename: `${faker.system.commonFileName('').replace(/\..*$/, '')}-${count(1000, 9999)}.${format === 'jpeg' ? 'jpg' : format}`,
    mimeType: `image/${format}`,
    body,
  };
}

function text(): Upload {
  const kind = pick(['md', 'csv', 'txt', 'vtt'] as const);
  if (kind === 'csv') {
    const rows = [['name', 'email', 'city', 'signed_up'].join(',')];
    for (let index = 0; index < count(5, 40); index++) {
      rows.push(
        [
          faker.person.fullName().replace(/,/g, ''),
          faker.internet.email(),
          faker.location.city(),
          faker.date.past().toISOString(),
        ].join(','),
      );
    }
    return {
      filename: `${faker.word.noun()}-export.csv`,
      mimeType: 'text/csv',
      body: Buffer.from(rows.join('\n')),
    };
  }
  if (kind === 'vtt') {
    const lines = ['WEBVTT', ''];
    for (let index = 0; index < count(3, 10); index++) {
      const start = index * 4;
      lines.push(
        `00:00:${String(start).padStart(2, '0')}.000 --> 00:00:${String(start + 3).padStart(2, '0')}.500`,
        sentence(8),
        '',
      );
    }
    return {
      filename: `${faker.word.noun()}-captions.vtt`,
      mimeType: 'text/vtt',
      body: Buffer.from(lines.join('\n')),
    };
  }
  const body =
    kind === 'md'
      ? `# ${title()}\n\n${faker.lorem.paragraphs(count(2, 6), '\n\n')}\n`
      : faker.lorem.paragraphs(count(1, 4), '\n\n');
  return {
    filename: `${words(2).replace(/\s+/g, '-')}.${kind}`,
    mimeType: kind === 'md' ? 'text/markdown' : 'text/plain',
    body: Buffer.from(body),
  };
}

async function next(): Promise<Upload> {
  const roll = faker.number.float();
  if (roll < 0.6) return raster();
  if (roll < 0.7) {
    const body = card(pick([400, 800]), pick([300, 600]));
    return { filename: `${words(2).replace(/\s+/g, '-')}.svg`, mimeType: 'image/svg+xml', body };
  }
  if (roll < 0.85) return text();
  return {
    filename: `${words(2).replace(/\s+/g, '-')}.pdf`,
    mimeType: 'application/pdf',
    body: pdf(title()),
  };
}

/**
 * Uploads `total` files into the space through the media service, so each one is probed,
 * stored by the configured driver and indexed the way an editor's upload would be.
 * A refusal - a mime type this instance does not allow, say - is logged and skipped
 * rather than ending the run: the rest of the seed does not depend on any one file.
 */
export async function buildAssets(
  media: Media,
  spaceId: string,
  total: number,
  actorId: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<Asset[]> {
  const assets: Asset[] = [];
  for (let index = 0; index < total; index++) {
    const upload = await next();
    try {
      assets.push(
        await media.upload({
          spaceId,
          filename: upload.filename,
          mimeType: upload.mimeType,
          body: upload.body,
          alt: chance(0.7) ? sentence(6) : '',
          title: title(),
          actorId,
        }),
      );
    } catch (error) {
      console.warn(`  asset ${upload.filename} skipped: ${(error as Error).message}`);
    }
    onProgress?.(index + 1, total);
  }
  return assets;
}
