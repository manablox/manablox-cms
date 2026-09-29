import { fieldAttribute } from '@manablox/live-preview';
import {
  type Asset,
  assetSrcSet,
  assetUrl,
  type Block,
  isImage,
  isRichTextEmpty,
  richTextToHtml,
} from '@manablox/public-sdk';

/**
 * A `teaser` block. `data-manablox-field` is what makes click-to-edit work: the editor
 * reads it to map a click back to a field. Set through the helper, so the path cannot drift.
 */
export function Teaser({ block, path }: { block: Block; path: (string | number)[] }) {
  const headline = typeof block.headline === 'string' ? block.headline : null;
  const body = isRichTextEmpty(block.body) ? null : richTextToHtml(block.body);
  // A relation arrives as an id unless the page expanded it.
  const image = isAsset(block.image) && isImage(block.image) ? block.image : null;

  return (
    <section className="teaser" {...fieldAttribute(path)}>
      {image && (
        <img
          src={assetUrl(image, { preset: 'card' })}
          srcSet={assetSrcSet(image, { thumb: 320, card: 640, hero: 1920 })}
          sizes="(max-width: 46rem) 100vw, 46rem"
          alt={image.alt ?? headline ?? ''}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          loading="lazy"
          decoding="async"
          {...fieldAttribute([...path, 'image'])}
        />
      )}
      {headline && <h2 {...fieldAttribute([...path, 'headline'])}>{headline}</h2>}
      {body && (
        // Safe only because `richTextToHtml` escapes every string and emits a fixed set
        // of tags. Never pass a CMS string to `dangerouslySetInnerHTML` unescaped.
        <div
          {...fieldAttribute([...path, 'body'])}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the SDK escapes it
          dangerouslySetInnerHTML={{ __html: body }}
        />
      )}
    </section>
  );
}

function isAsset(value: unknown): value is Asset {
  return typeof value === 'object' && value !== null && 'url' in value && 'mimeType' in value;
}
