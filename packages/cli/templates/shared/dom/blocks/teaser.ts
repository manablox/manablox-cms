import { fieldAttribute } from '@manablox/live-preview';
import {
  type Asset,
  assetUrl,
  type Block,
  isImage,
  isRichTextEmpty,
  richTextToHtml,
} from '@manablox/public-sdk';
import { el } from '../dom.js';

/**
 * A `teaser` block. `data-manablox-field` is what makes click-to-edit work: the editor
 * reads it to map a click back to a field. Set through the helper, so the path cannot drift.
 */
export function renderTeaser(block: Block, path: (string | number)[]): HTMLElement {
  const image = block.image;

  return el(
    'section',
    { class: 'teaser', ...fieldAttribute(path) },
    isAsset(image) && isImage(image) ? renderPicture(image, block.headline) : null,
    block.headline ? el('h2', fieldAttribute([...path, 'headline']), String(block.headline)) : null,
    isRichTextEmpty(block.body) ? null : renderBody(block.body, [...path, 'body']),
  );
}

/**
 * The SDK renders rich text as HTML: it escapes every string and emits a fixed set of
 * tags, which is the only reason `innerHTML` is acceptable here.
 */
function renderBody(body: unknown, path: (string | number)[]): HTMLElement {
  const node = el('div', { class: 'body', ...fieldAttribute(path) });
  node.innerHTML = richTextToHtml(body);
  return node;
}

/**
 * A `<picture>` from the instance's signed variant URLs. The SDK cannot build a transform
 * path, since it carries an HMAC of the media secret, so `assetUrl` looks up what the API
 * served. An unknown preset falls back to the original.
 */
function renderPicture(asset: Asset, alt: unknown): HTMLElement {
  const card = assetUrl(asset, { preset: 'card' });
  const thumb = assetUrl(asset, { preset: 'thumb' });

  return el(
    'picture',
    {},
    el('source', { media: '(max-width: 480px)', srcset: thumb }),
    el('img', {
      src: card,
      alt: asset.alt ?? (typeof alt === 'string' ? alt : ''),
      width: asset.width ? String(asset.width) : undefined,
      height: asset.height ? String(asset.height) : undefined,
      loading: 'lazy',
      decoding: 'async',
    }),
  );
}

function isAsset(value: unknown): value is Asset {
  return typeof value === 'object' && value !== null && 'url' in value && 'mimeType' in value;
}
