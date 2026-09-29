import type { AssetImageEdits, MediaPreset } from '@manablox/core';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { coverWindow, hasAdjustments, rotatedSize } from './edits.js';

/** Formats a variant can be rendered in. */
export const IMAGE_FORMATS = new Set(['avif', 'webp', 'jpeg', 'png']);

/**
 * Renders a preset through the edits in the editor's order: EXIF orientation, mirror,
 * turn, crop plus `cover` focal window (one extract), resize, then colour (cheaper after).
 */
export async function transform(
  source: Buffer,
  preset: MediaPreset,
  format: string,
  edits: AssetImageEdits = {},
): Promise<Buffer> {
  // `autoOrient` handles EXIF, since sharp allows only one `rotate()`. Sharp always
  // mirrors before turning, matching the editor preview.
  const pipeline = sharp(source, { failOn: 'error' }).autoOrient();
  if (edits.flipHorizontal) pipeline.flop();
  if (edits.flipVertical) pipeline.flip();
  if (edits.rotate) pipeline.rotate(edits.rotate);

  const meta = await pipeline.metadata();
  const oriented = rotatedSize(orientedSize(meta) ?? { width: 0, height: 0 }, edits.rotate);
  let region = edits.crop ?? null;
  const size = region ? { width: region.width, height: region.height } : oriented;

  if (preset.width && preset.height && (preset.fit ?? 'inside') === 'cover' && size) {
    const window = coverWindow(
      size,
      { width: preset.width, height: preset.height },
      edits.focalPoint ?? undefined,
    );
    region = {
      left: (region?.left ?? 0) + window.left,
      top: (region?.top ?? 0) + window.top,
      width: window.width,
      height: window.height,
    };
  }

  if (region) pipeline.extract(region);

  if (preset.width || preset.height) {
    pipeline.resize({
      ...(preset.width ? { width: preset.width } : {}),
      ...(preset.height ? { height: preset.height } : {}),
      fit: preset.fit ?? 'inside',
      withoutEnlargement: true,
    });
  }

  applyColour(pipeline, edits);

  const quality = preset.quality ?? 82;
  switch (format) {
    case 'avif':
      return pipeline.avif({ quality }).toBuffer();
    case 'png':
      return pipeline.png().toBuffer();
    case 'jpeg':
      return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    default:
      return pipeline.webp({ quality }).toBuffer();
  }
}

/** Sepia as a channel mix. */
const SEPIA: [[number, number, number], [number, number, number], [number, number, number]] = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];

/** Adjustments, then the effect. Contrast is a linear ramp about mid-grey. */
function applyColour(pipeline: Sharp, edits: AssetImageEdits): void {
  const adjust = edits.adjust ?? null;
  if (hasAdjustments(adjust) && adjust) {
    const { brightness, saturation, hue } = adjust;
    if (
      (brightness !== undefined && brightness !== 1) ||
      (saturation !== undefined && saturation !== 1) ||
      (hue !== undefined && hue !== 0)
    ) {
      pipeline.modulate({
        ...(brightness !== undefined ? { brightness } : {}),
        ...(saturation !== undefined ? { saturation } : {}),
        ...(hue !== undefined ? { hue } : {}),
      });
    }
    const contrast = adjust.contrast;
    if (contrast !== undefined && contrast !== 1) {
      pipeline.linear(contrast, 128 * (1 - contrast));
    }
  }

  switch (edits.effect) {
    case 'grayscale':
      pipeline.greyscale();
      break;
    case 'sepia':
      // Alpha is left untouched.
      pipeline.recomb(SEPIA);
      break;
    case 'invert':
      pipeline.negate({ alpha: false });
      break;
    default:
      break;
  }
}

export async function probeImage(body: Buffer | string, mimeType: string) {
  if (!mimeType.startsWith('image/')) return null;
  try {
    return orientedSize(await sharp(body).metadata());
  } catch {
    // A format sharp cannot read is stored without dimensions.
    return null;
  }
}

/** A rendered variant's stored dimensions. */
export async function renderedSize(
  body: Buffer,
): Promise<{ width: number | null; height: number | null }> {
  const meta = await sharp(body).metadata();
  return { width: meta.width ?? null, height: meta.height ?? null };
}

/** The size as displayed, with EXIF orientation applied. */
function orientedSize(meta: Metadata): { width: number; height: number } | null {
  if (!meta.width || !meta.height) return null;
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

/** Magic-number sniffing for the formats worth trusting; falls back to the declared type. */
export async function detectMimeType(body: Buffer, declared: string): Promise<string> {
  const signatures: Array<[string, number[]]> = [
    ['image/png', [0x89, 0x50, 0x4e, 0x47]],
    ['image/jpeg', [0xff, 0xd8, 0xff]],
    ['image/gif', [0x47, 0x49, 0x46, 0x38]],
    ['application/pdf', [0x25, 0x50, 0x44, 0x46]],
    ['font/woff2', [0x77, 0x4f, 0x46, 0x32]],
    ['font/woff', [0x77, 0x4f, 0x46, 0x46]],
  ];

  for (const [mimeType, bytes] of signatures) {
    if (bytes.every((byte, index) => body[index] === byte)) return mimeType;
  }

  // RIFF....WEBP
  if (
    body.subarray(0, 4).toString('ascii') === 'RIFF' &&
    body.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // ISO-BMFF brands: AVIF and HEIC share the ftyp box.
  if (body.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = body.subarray(8, 12).toString('ascii');
    if (brand.startsWith('avif')) return 'image/avif';
    if (brand.startsWith('heic') || brand.startsWith('mif1')) return 'image/heic';
    if (brand.startsWith('isom') || brand.startsWith('mp4')) return 'video/mp4';
  }

  // Unrecognised bytes keep the declared type; the allowlist still applies.
  return declared;
}
