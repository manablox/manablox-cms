import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { designSiteBlock, designSiteTheme } from '../../src/server/ai/design.js';
import { failure, invoke, principal, production } from '../helpers/rpc.js';
import { pluginContext, website } from '../helpers/website-rpc.js';

vi.mock('../../src/server/ai/design.js', () => ({
  designSiteTheme: vi.fn(async () => ({ theme: {}, problems: [] })),
  designSiteBlock: vi.fn(async () => ({ design: {}, problems: [] })),
}));

const siteDesignRouter = website.design;

const REPORT = { name: '', entries: [], codeSkipped: false, missingAssets: [] };

/** The AI plugin's design service, as `plugins.get('ai')` hands it out. */
const designer = { design: vi.fn() };

function themeContext(role = 'owner', withAi = true) {
  const themes = {
    exportBundle: vi.fn(async () => ({ format: 'manablox-theme' })),
    previewImport: vi.fn(async () => REPORT),
    importBundle: vi.fn(async () => REPORT),
    starterThemes: vi.fn(async () => []),
    applyStarter: vi.fn(async () => REPORT),
  };
  const designs = {
    get: vi.fn(async (_spaceId: string, kind: string) => ({
      kind,
      key: 'default',
      status: 'generated',
      design: null,
      data: kind === 'theme' ? { colors: {} } : null,
    })),
  };
  const aiDesign = { designSiteTheme, designSiteBlock };
  const ctx = pluginContext({ designs, themes }, principal({ spaces: { [ids.space]: role } }));
  (ctx.manablox as unknown as Record<string, unknown>).plugins = {
    has: (id: string) => withAi && id === 'ai',
    get: (id: string) => (withAi && id === 'ai' ? { design: designer } : undefined),
    isOn: async (id: string) => withAi && id === 'ai',
  };
  return { ctx, themes, designs, aiDesign };
}

describe('plugins.website.design theme procedures', () => {
  it('exports with code only for website:code', async () => {
    const owner = themeContext('owner');
    await invoke(siteDesignRouter.exportTheme, { spaceId: ids.space }, owner.ctx);
    expect(owner.themes.exportBundle).toHaveBeenCalledWith(production(ids.space), {
      variant: undefined,
      includeCode: true,
    });

    const editor = themeContext('editor');
    await invoke(
      siteDesignRouter.exportTheme,
      { spaceId: ids.space, variant: 'draft' },
      editor.ctx,
    );
    expect(editor.themes.exportBundle).toHaveBeenCalledWith(production(ids.space), {
      variant: 'draft',
      includeCode: false,
    });
  });

  it('previews and imports with the caller code permission, and refuses viewers', async () => {
    const editor = themeContext('editor');
    const input = { spaceId: ids.space, bundle: { format: 'manablox-theme' }, replace: false };
    await invoke(siteDesignRouter.previewThemeImport, input, editor.ctx);
    expect(editor.themes.previewImport).toHaveBeenCalledWith(production(ids.space), input.bundle, {
      replace: false,
      skip: undefined,
      allowCode: false,
    });
    await invoke(siteDesignRouter.importTheme, input, editor.ctx);
    expect(editor.themes.importBundle).toHaveBeenCalledWith(
      production(ids.space),
      input.bundle,
      { replace: false, skip: undefined, allowCode: false },
      ids.user,
    );

    const viewer = themeContext('viewer');
    expect(await failure(invoke(siteDesignRouter.importTheme, input, viewer.ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      await failure(invoke(siteDesignRouter.starterThemes, { spaceId: ids.space }, viewer.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lists and applies starter themes', async () => {
    const owner = themeContext('owner');
    await invoke(siteDesignRouter.starterThemes, { spaceId: ids.space }, owner.ctx);
    expect(owner.themes.starterThemes).toHaveBeenCalledWith(production(ids.space));
    await invoke(
      siteDesignRouter.applyStarter,
      { spaceId: ids.space, id: 'builtin:bold', replace: true },
      owner.ctx,
    );
    expect(owner.themes.applyStarter).toHaveBeenCalledWith(
      production(ids.space),
      'builtin:bold',
      { replace: true, allowCode: true },
      ids.user,
    );
  });

  it('designs a theme on the current one', async () => {
    const editor = themeContext('editor');
    await invoke(
      siteDesignRouter.aiTheme,
      { spaceId: ids.space, prompt: 'Calm', brandColor: '#112233' },
      editor.ctx,
    );
    expect(editor.aiDesign.designSiteTheme).toHaveBeenCalledWith(
      designer,
      expect.objectContaining({
        spaceId: ids.space,
        prompt: 'Calm',
        brandColor: '#112233',
        base: { colors: {} },
        actorId: ids.user,
      }),
    );
    expect(
      await failure(
        invoke(
          siteDesignRouter.aiTheme,
          { spaceId: ids.space, prompt: 'x', brandColor: 'blue' },
          editor.ctx,
        ),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('designs a block only for a block type of the space', async () => {
    const editor = themeContext('editor');
    const block = { id: ids.type, kind: 'block', isSystem: false, spaceId: null, fields: [] };
    (editor.ctx.manablox.contentTypes as unknown as Record<string, unknown>).tryGet = (
      id: string,
    ) => (id === ids.type ? block : undefined);
    (editor.ctx.repos.spaces.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultLocale: 'de',
      locales: ['en', 'de'],
    });
    await invoke(
      siteDesignRouter.aiBlockDesign,
      { spaceId: ids.space, typeId: ids.type, prompt: 'A card' },
      editor.ctx,
    );
    expect(editor.aiDesign.designSiteBlock).toHaveBeenCalledWith(
      designer,
      expect.objectContaining({ type: block, locales: ['de', 'en'], current: null }),
    );
    expect(
      await failure(
        invoke(
          siteDesignRouter.aiBlockDesign,
          { spaceId: ids.space, typeId: ids.doc, prompt: 'A card' },
          editor.ctx,
        ),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers not found without the AI plugin, and needs ai:use with it', async () => {
    const without = themeContext('editor', false);
    for (const [procedure, input] of [
      [siteDesignRouter.aiTheme, { spaceId: ids.space, prompt: 'Calm' }],
      [siteDesignRouter.aiBlockDesign, { spaceId: ids.space, typeId: ids.type, prompt: 'A card' }],
    ] as const) {
      expect(await failure(invoke(procedure, input, without.ctx))).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    const viewer = themeContext('viewer');
    expect(
      await failure(
        invoke(siteDesignRouter.aiTheme, { spaceId: ids.space, prompt: 'Calm' }, viewer.ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});
