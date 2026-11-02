import { describe, expect, it, vi } from 'vitest';
import {
  googleFontCssUrl,
  googleFontId,
  importGoogleFont,
  parseGoogleFontCss,
} from '../../src/server/services/fonts.js';

const CSS = `/* latin-ext */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/pd/v1/ext-400.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/pd/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/pd/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(https://evil.example/latin-italic.woff2) format('woff2');
}`;

const response = (body: string | Uint8Array, status = 200) =>
  new Response(typeof body === 'string' ? body : Buffer.from(body), { status });

describe('Google Fonts import', () => {
  it('builds the sorted css2 URL and a token id', () => {
    expect(
      googleFontCssUrl('Playfair Display', [
        { weight: 700, style: 'normal' },
        { weight: 400, style: 'italic' },
        { weight: 400, style: 'normal' },
      ]),
    ).toBe(
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap',
    );
    expect(googleFontId('Playfair Display')).toBe('playfair-display');
    expect(googleFontId('Mono')).toBe('mono-font');
  });

  it('reads the faces with their subsets', () => {
    const faces = parseGoogleFontCss(CSS);
    expect(faces).toHaveLength(4);
    expect(faces[0]).toMatchObject({ subset: 'latin-ext', weight: '400', style: 'normal' });
  });

  it('stores each latin file once and skips files from other hosts', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith('https://fonts.googleapis.com/')
        ? response(CSS)
        : response(new Uint8Array([0x77, 0x4f, 0x46, 0x32])),
    );
    const store = vi.fn(async () => ({ id: 'asset-1' }));
    const family = await importGoogleFont(
      {
        family: 'Playfair Display',
        variants: [
          { weight: 400, style: 'normal' },
          { weight: 700, style: 'normal' },
          { weight: 400, style: 'italic' },
        ],
        fallback: 'Georgia, serif',
      },
      { store, fetch: fetch as typeof globalThis.fetch },
    );
    expect(store).toHaveBeenCalledTimes(1);
    expect(family).toEqual({
      id: 'playfair-display',
      name: 'Playfair Display',
      source: 'google',
      files: [
        { assetId: 'asset-1', weight: 400, style: 'normal' },
        { assetId: 'asset-1', weight: 700, style: 'normal' },
      ],
      fallback: 'Georgia, serif',
    });
  });

  it('reports an unknown family and a network failure', async () => {
    const store = vi.fn(async () => ({ id: 'x' }));
    const variants = [{ weight: 400, style: 'normal' as const }];
    await expect(
      importGoogleFont(
        { family: 'Nope', variants },
        { store, fetch: (async () => response('bad', 400)) as typeof globalThis.fetch },
      ),
    ).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(
      importGoogleFont(
        { family: 'Inter', variants },
        {
          store,
          fetch: (async () => {
            throw new TypeError('fetch failed');
          }) as typeof globalThis.fetch,
        },
      ),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(store).not.toHaveBeenCalled();
  });
});
