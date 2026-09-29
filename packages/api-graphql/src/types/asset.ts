import type { AssetRow, UserRow } from '@manablox/db';
import { absoluteMediaUrl, readImageEdits } from '@manablox/media';
import type { Builder } from '../builder.js';

/** Asset, tag and user types, shared by every content type. */
export function defineAssetTypes(builder: Builder) {
  const focalPointRef = builder.objectRef<{ x: number; y: number }>('FocalPoint').implement({
    description: 'Where the subject is, as fractions of the cropped image; 0.5/0.5 is centred.',
    fields: (t) => ({ x: t.exposeFloat('x'), y: t.exposeFloat('y') }),
  });
  const cropRef = builder
    .objectRef<{ left: number; top: number; width: number; height: number }>('AssetCrop')
    .implement({
      description: "The editor's crop, in the original's pixels. Variants are cut to it.",
      fields: (t) => ({
        left: t.exposeInt('left'),
        top: t.exposeInt('top'),
        width: t.exposeInt('width'),
        height: t.exposeInt('height'),
      }),
    });

  const tagRef = builder.objectRef<{ name: string; slug: string }>('Tag').implement({
    description: 'A tag; `slug` is what the `tags` argument filters by.',
    fields: (t) => ({
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
    }),
  });

  const assetRef = builder.objectRef<AssetRow>('Asset').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      filename: t.exposeString('filename'),
      mimeType: t.exposeString('mimeType'),
      size: t.exposeInt('size'),
      width: t.exposeInt('width', { nullable: true }),
      height: t.exposeInt('height', { nullable: true }),
      alt: t.exposeString('alt', { nullable: true }),
      title: t.exposeString('title', { nullable: true }),
      focalPoint: t.field({
        type: focalPointRef,
        nullable: true,
        resolve: (asset) => readImageEdits(asset.meta).focalPoint ?? null,
      }),
      crop: t.field({
        type: cropRef,
        nullable: true,
        resolve: (asset) => readImageEdits(asset.meta).crop ?? null,
      }),
      // Absolute: delivery consumers run on their own origin.
      url: t.string({
        resolve: (asset, _args, ctx) =>
          absoluteMediaUrl(ctx.media.urlFor(asset), ctx.manablox.config.server.publicUrl),
      }),
      tags: t.field({
        type: [tagRef],
        resolve: (asset, _args, ctx) => ctx.loaders.assetTags.load(asset.id),
      }),
      variant: t.string({
        args: {
          preset: t.arg.string({ required: true }),
          format: t.arg.string({ defaultValue: 'webp' }),
        },
        resolve: (asset, args, ctx) =>
          absoluteMediaUrl(
            ctx.media.urlFor(asset, args.preset, args.format ?? 'webp'),
            ctx.manablox.config.server.publicUrl,
          ),
      }),
    }),
  });

  const userRef = builder.objectRef<UserRow>('User').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      // Email is deliberately absent: the delivery API is public.
      image: t.exposeString('image', { nullable: true }),
    }),
  });

  return { tagRef, assetRef, userRef };
}
