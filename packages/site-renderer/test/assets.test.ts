import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_FONTS } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import {
  bundledFontFile,
  clientAssetUrls,
  FONTS_DIR,
  findClientAsset,
  loadClientAssets,
} from '../src/assets.js';

describe('bundled fonts', () => {
  it('ships every bundled font file as woff2, with its licence', () => {
    for (const family of BUNDLED_FONTS) {
      for (const file of family.files) {
        const path = bundledFontFile(file.bundledPath as string);
        expect(path, file.bundledPath).not.toBeNull();
        expect(
          readFileSync(path as string)
            .subarray(0, 4)
            .toString('latin1'),
        ).toBe('wOF2');
      }
      const folder = (family.files[0]?.bundledPath as string).split('/')[0] as string;
      expect(existsSync(join(FONTS_DIR, folder, 'OFL.txt'))).toBe(true);
    }
  });

  it('serves only known font paths', () => {
    expect(bundledFontFile('../package.json')).toBeNull();
    expect(bundledFontFile('inter/OFL.txt')).toBeNull();
  });
});

describe('client assets', () => {
  it('bundles the islands and the canvas from source, content-hashed', async () => {
    const assets = await loadClientAssets();
    expect(assets.islands.menu.fileName).toMatch(/^islands\/menu\.[0-9a-f]{10}\.js$/);
    expect(assets.islands.form.fileName).toMatch(/^islands\/form\.[0-9a-f]{10}\.js$/);
    expect(assets.canvas.fileName).toMatch(/^canvas\.[0-9a-f]{10}\.js$/);
    // Islands stay small and never pull in Vue.
    expect(assets.islands.menu.code.length).toBeLessThan(6000);
    expect(assets.islands.form.code).not.toContain('createApp');
    expect(assets.islands.menu.code).not.toMatch(/^import /m);
    expect(await loadClientAssets()).toBe(assets);

    const urls = clientAssetUrls(assets);
    expect(urls.islandSrc.menu).toBe(`/_site/${assets.islands.menu.fileName}`);
    expect(urls.canvasSrc).toBe(`/_site/${assets.canvas.fileName}`);
    expect(findClientAsset(assets, assets.islands.form.fileName)).toBe(assets.islands.form);
    expect(findClientAsset(assets, 'islands/nope.js')).toBeNull();

    // The inline rich text editor is a chunk of its own, loaded when an edit starts.
    const editor = assets.chunks.find((chunk) => chunk.code.includes('toggleBold'));
    expect(editor?.fileName).toMatch(/^[\w-]+\.[\w-]+\.js$/);
    expect(assets.canvas.code).toContain(`./${editor?.fileName}`);
    expect(assets.canvas.code).not.toContain('toggleBold');
    expect(findClientAsset(assets, editor?.fileName ?? '')).toBe(editor);
  }, 60_000);
});
