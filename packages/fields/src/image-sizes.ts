import type { ContentTypeRegistry, MediaPreset } from '@manablox/core';
import { z } from 'zod';

/** A rendition declared on an asset field. `name` keys the delivered `variants` map. */
export const imageSize = z.object({
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z][a-z0-9_-]*$/, 'lower-case letters, digits, - and _'),
  width: z.number().int().min(1).max(8000).optional(),
  height: z.number().int().min(1).max(8000).optional(),
  fit: z.enum(['cover', 'contain', 'inside', 'outside', 'fill']).default('cover'),
  format: z.enum(['avif', 'webp', 'jpeg', 'png']).default('webp'),
  quality: z.number().int().min(1).max(100).optional(),
});

export type ImageSize = z.infer<typeof imageSize>;

/** Named by measurements so equal sizes share a variant; `s-` avoids clashing with presets. */
export function imageSizePreset(size: ImageSize): string {
  const quality = size.quality ?? 82;
  return `s-${size.width ?? 0}x${size.height ?? 0}-${size.fit}-${size.format}-${quality}`;
}

export function imageSizeToPreset(size: ImageSize): MediaPreset {
  return {
    ...(size.width !== undefined ? { width: size.width } : {}),
    ...(size.height !== undefined ? { height: size.height } : {}),
    fit: size.fit,
    format: size.format,
    ...(size.quality !== undefined ? { quality: size.quality } : {}),
  };
}

/** All sizes declared by asset fields, as presets. Doubles as the transform allowlist. */
export function declaredImageSizes(registry: ContentTypeRegistry): Record<string, MediaPreset> {
  const out: Record<string, MediaPreset> = {};
  for (const type of registry.all) {
    for (const field of type.fields) {
      if (field.type !== 'asset') continue;
      for (const size of readImageSizes(field.settings)) {
        out[imageSizePreset(size)] = imageSizeToPreset(size);
      }
    }
  }
  return out;
}

/** Reads sizes leniently, skipping invalid entries. */
export function readImageSizes(settings: unknown): ImageSize[] {
  const raw = (settings as { sizes?: unknown } | null | undefined)?.sizes;
  if (!Array.isArray(raw)) return [];
  const out: ImageSize[] = [];
  for (const entry of raw) {
    const parsed = imageSize.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
