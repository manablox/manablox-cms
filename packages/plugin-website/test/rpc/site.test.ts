import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { failure, invoke, principal, production } from '../helpers/rpc.js';
import { pluginContext, website } from '../helpers/website-rpc.js';

const siteDesignRouter = website.design;
const siteDomainRouter = website.domains;

const DESIGN = { id: ids.doc, spaceId: ids.space, kind: 'site', key: 'default', draft: {} };

function siteContext(role = 'owner') {
  const designs = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({
      kind: 'site',
      key: 'default',
      status: 'generated',
      design: null,
      data: {},
    })),
    getById: vi.fn(async () => DESIGN),
    saveDraft: vi.fn(async () => DESIGN),
    publish: vi.fn(async () => DESIGN),
    publishAll: vi.fn(async () => ({ published: [], revision: 1 })),
    discardDraft: vi.fn(async () => DESIGN),
    versions: vi.fn(async () => []),
    version: vi.fn(async () => ({ data: { headCode: '<script></script>' } })),
    restore: vi.fn(async () => DESIGN),
    delete: vi.fn(async () => undefined),
    createShareLink: vi.fn(async () => ({ token: 't', expiresAt: new Date() })),
  };
  const domains = {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: ids.doc })),
    update: vi.fn(async () => ({ id: ids.doc })),
    verify: vi.fn(async () => ({ id: ids.doc })),
    delete: vi.fn(async () => undefined),
  };
  const ctx = pluginContext({ designs, domains }, principal({ spaces: { [ids.space]: role } }));
  return { ctx, designs, domains };
}

describe('plugins.website.design', () => {
  it('lets an editor save and publish, but not a viewer', async () => {
    const editor = siteContext('editor');
    await invoke(
      siteDesignRouter.saveDraft,
      { spaceId: ids.space, kind: 'theme', key: 'default', draft: {}, expectedVersion: 0 },
      editor.ctx,
    );
    expect(editor.designs.saveDraft).toHaveBeenCalledWith(
      production(ids.space),
      { kind: 'theme', key: 'default', draft: {}, expectedVersion: 0 },
      ids.user,
    );
    await invoke(siteDesignRouter.publishAll, { spaceId: ids.space }, editor.ctx);
    expect(editor.designs.publishAll).toHaveBeenCalledWith(production(ids.space), ids.user);

    const viewer = siteContext('viewer');
    expect(
      await failure(invoke(siteDesignRouter.list, { spaceId: ids.space }, viewer.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs website:code to change custom CSS or head code', async () => {
    const editor = siteContext('editor');
    const input = {
      spaceId: ids.space,
      kind: 'site',
      key: 'default',
      draft: { headCode: '<script>x</script>' },
    };
    expect(await failure(invoke(siteDesignRouter.saveDraft, input, editor.ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(editor.designs.saveDraft).not.toHaveBeenCalled();
    // Unchanged code fields are fine.
    await invoke(siteDesignRouter.saveDraft, { ...input, draft: { name: 'Site' } }, editor.ctx);
    expect(editor.designs.saveDraft).toHaveBeenCalled();
    // Restoring a version that brings code along is a code change too.
    expect(
      await failure(
        invoke(
          siteDesignRouter.restore,
          { spaceId: ids.space, id: ids.doc, versionId: ids.doc },
          editor.ctx,
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const admin = siteContext('admin');
    await invoke(siteDesignRouter.saveDraft, input, admin.ctx);
    expect(admin.designs.saveDraft).toHaveBeenCalled();
  });

  it('shares a document with a reader of it, and the site with a design reader', async () => {
    const author = siteContext('author');
    (
      author.ctx.repos as unknown as { content: { findById: ReturnType<typeof vi.fn> } }
    ).content.findById = vi.fn(async () => ({ id: ids.doc, spaceId: ids.space, typeId: ids.type }));
    await invoke(
      siteDesignRouter.createShareLink,
      { spaceId: ids.space, contentId: ids.doc, expiresInSeconds: 600 },
      author.ctx,
    );
    expect(author.designs.createShareLink).toHaveBeenCalledWith(production(ids.space), {
      contentId: ids.doc,
      expiresInSeconds: 600,
    });

    const narrow = siteContext();
    narrow.ctx.principal = principal({
      spaces: { [ids.space]: 'custom' },
      permissions: { [ids.space]: ['space:read'] },
    });
    expect(
      await failure(invoke(siteDesignRouter.createShareLink, { spaceId: ids.space }, narrow.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });

    // Reading one type shares its documents, not the drafts of the whole site.
    const oneType = siteContext();
    oneType.ctx.principal = principal({
      spaces: { [ids.space]: 'custom' },
      permissions: { [ids.space]: ['space:read', `content:read:${ids.type}`] },
    });
    expect(
      await failure(invoke(siteDesignRouter.createShareLink, { spaceId: ids.space }, oneType.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const reader = siteContext();
    reader.ctx.principal = principal({
      spaces: { [ids.space]: 'custom' },
      permissions: { [ids.space]: ['space:read', 'content:read'] },
    });
    await invoke(siteDesignRouter.createShareLink, { spaceId: ids.space }, reader.ctx);
    expect(reader.designs.createShareLink).toHaveBeenCalled();
  });
});

describe('plugins.website.domains', () => {
  it('needs website:domains to write, which editors lack', async () => {
    const editor = siteContext('editor');
    await invoke(siteDomainRouter.list, { spaceId: ids.space }, editor.ctx);
    expect(
      await failure(
        invoke(siteDomainRouter.create, { spaceId: ids.space, hostname: 'a.test' }, editor.ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const admin = siteContext('admin');
    await invoke(
      siteDomainRouter.create,
      { spaceId: ids.space, hostname: 'a.test', locale: null },
      admin.ctx,
    );
    expect(admin.domains.create).toHaveBeenCalledWith(production(ids.space), {
      hostname: 'a.test',
      locale: null,
    });
  });
});

describe('plugins.website.domains.verify', () => {
  it('checks a domain for those who manage domains', async () => {
    const admin = siteContext('admin');
    await invoke(siteDomainRouter.verify, { spaceId: ids.space, id: ids.doc }, admin.ctx);
    expect(admin.domains.verify).toHaveBeenCalledWith(production(ids.space), ids.doc);
    const editor = siteContext('editor');
    expect(
      await failure(
        invoke(siteDomainRouter.verify, { spaceId: ids.space, id: ids.doc }, editor.ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});
