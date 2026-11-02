import {
  allowedTypeIdsIn,
  assertOnType,
  type PluginRpcContext,
  type PluginRpcKit,
  pluginGuard,
  schemas,
} from '@manablox/api-rpc/plugin';
import { assertCan, can } from '@manablox/auth';
import { ManabloxError, type Permission } from '@manablox/core';
import { z } from 'zod';
import { SITE_DESIGN_KINDS, type SiteDesignKindName } from '../../shared/site.js';
import {
  type AiDesigner,
  type AiSiteBlockInput,
  type AiSiteThemeInput,
  designSiteBlock,
  designSiteTheme,
} from '../ai/design.js';
import { websiteKeys } from '../keys.js';
import { siteCodeChanged } from '../services/design/rules.js';
import { SHARE_LINK_MAX_SECONDS } from '../services/design/share.js';
import {
  GOOGLE_FONT_FAMILY,
  GOOGLE_FONT_MAX_VARIANTS,
  importGoogleFont,
} from '../services/fonts.js';
import type { WebsiteServices } from '../services/index.js';

const { spaceItem, spaceScoped, uuid } = schemas;

/** The AI plugin's flag. */
const AI_FEATURE = 'plugins.ai';

const kind = z.enum(SITE_DESIGN_KINDS);
const designKey = z.string().min(1).max(100);
const designRef = spaceScoped.extend({ kind, key: designKey });

/** A theme bundle file and how to apply it; the service validates the bundle. */
const themeImport = spaceScoped.extend({
  bundle: z.unknown(),
  /** Overwrite stored drafts; default on. */
  replace: z.boolean().optional(),
  /** `kind:key` of bundle designs to leave out. */
  skip: z.array(z.string().max(200)).max(1000).optional(),
});

/** Provider and model, as the other AI designs take them; the AI plugin checks the provider. */
const aiDesign = spaceScoped.extend({
  providerKind: z
    .string()
    .regex(/^[a-z0-9][a-z0-9:-]{0,79}$/)
    .optional(),
  model: z.string().max(200).optional(),
  prompt: z.string().max(12_000),
});

/**
 * The AI plugin's design service for the space; not found while that plugin is missing or
 * hidden there, like the admin, which then hides the AI buttons, and 403 `control.feature`
 * while it is locked.
 */
async function aiDesigner(
  context: PluginRpcContext<WebsiteServices>,
  spaceId: string,
  path: string,
): Promise<AiDesigner> {
  // Typed here: the website does not depend on the AI plugin for its service types.
  const ai = context.plugins.get('ai') as { design: AiDesigner } | undefined;
  if (!ai) throw ManabloxError.notFound('route.notFound', { path });
  if (!(await context.plugins.isOn('ai', spaceId))) {
    const { controls } = context.manablox;
    if ((await controls.feature(spaceId, AI_FEATURE)).presentation === 'locked') {
      await controls.assertFeature(spaceId, AI_FEATURE);
    }
    throw ManabloxError.notFound('route.notFound', { path });
  }
  assertCan(context.principal, spaceId, 'ai:use');
  return ai.design;
}

/** Code fields of the `site` design need `website:code` to change. */
async function assertCodeAllowed(
  context: PluginRpcContext<WebsiteServices>,
  spaceId: string,
  designKind: SiteDesignKindName,
  before: unknown,
  after: unknown,
): Promise<void> {
  if (designKind === 'site' && siteCodeChanged(before, after)) {
    assertCan(context.principal, spaceId, 'website:code');
  }
}

/** Refuses a write while designing is off for the space. */
const designing = pluginGuard<WebsiteServices>(async (context) => {
  await context.manablox.controls.assertFeature(
    context.env?.spaceId ?? null,
    websiteKeys.features.design,
  );
});

/**
 * Design documents of a designed site. The rules are in `SiteDesignService`. Every write
 * needs `features.plugins.website.design`.
 */
export const designProcedures = ({ scoped }: PluginRpcKit<WebsiteServices>) => {
  const writes = (permission: Permission) => scoped(permission).use(designing);
  return {
    /** Every design the space has or implies, with its status. */
    list: scoped('website:read')
      .input(spaceScoped)
      .handler(async ({ context }) => context.plugin.services.designs.list(context.env)),

    /** One design by kind and key; generated when nothing is stored. */
    get: scoped('website:read')
      .input(designRef)
      .handler(async ({ input, context }) =>
        context.plugin.services.designs.get(context.env, input.kind, input.key),
      ),

    /** Stores a draft; `expectedVersion` is the version it was made from, `0` for a generated one. */
    saveDraft: writes('website:write')
      .input(
        designRef.extend({
          name: z.string().max(200).optional(),
          draft: z.unknown(),
          expectedVersion: z.number().int().min(0).optional(),
        }),
      )
      .handler(async ({ input, context }) => {
        const { designs } = context.plugin.services;
        const { spaceId, environment: _environment, ...data } = input;
        if (data.kind === 'site') {
          const current = await designs.get(context.env, data.kind, data.key);
          await assertCodeAllowed(context, spaceId, data.kind, current.data, data.draft);
        }
        return designs.saveDraft(context.env, data, context.principal?.userId ?? null);
      }),

    publish: writes('website:publish')
      .input(spaceItem)
      .handler(async ({ input, context }) =>
        context.plugin.services.designs.publish(
          context.env,
          input.id,
          context.principal?.userId ?? null,
        ),
      ),

    /** Publishes every design with changes at once and bumps the site revision. */
    publishAll: writes('website:publish')
      .input(spaceScoped)
      .handler(async ({ context }) =>
        context.plugin.services.designs.publishAll(context.env, context.principal?.userId ?? null),
      ),

    /** Sets the draft back to the live copy; `null` when a never published design was dropped. */
    discardDraft: writes('website:write')
      .input(spaceItem)
      .handler(async ({ input, context }) => {
        const { designs } = context.plugin.services;
        const row = await designs.getById(context.env, input.id);
        await assertCodeAllowed(context, input.spaceId, row.kind, row.draft, row.published);
        return designs.discardDraft(context.env, input.id, context.principal?.userId ?? null);
      }),

    /** Publish snapshots, newest first, without their data. */
    versions: scoped('website:read')
      .input(spaceItem)
      .handler(async ({ input, context }) =>
        context.plugin.services.designs.versions(context.env, input.id),
      ),

    version: scoped('website:read')
      .input(spaceItem.extend({ versionId: uuid }))
      .handler(async ({ input, context }) =>
        context.plugin.services.designs.version(context.env, input.id, input.versionId),
      ),

    /** Copies a snapshot into the draft. */
    restore: writes('website:write')
      .input(spaceItem.extend({ versionId: uuid }))
      .handler(async ({ input, context }) => {
        const { designs } = context.plugin.services;
        const row = await designs.getById(context.env, input.id);
        const snapshot = await designs.version(context.env, input.id, input.versionId);
        await assertCodeAllowed(context, input.spaceId, row.kind, row.draft, snapshot.data);
        return designs.restore(
          context.env,
          input.id,
          input.versionId,
          context.principal?.userId ?? null,
        );
      }),

    /** Resets a design to generated, live copy included. */
    delete: writes('website:publish')
      .input(spaceItem)
      .handler(async ({ input, context }) => {
        const { designs } = context.plugin.services;
        const row = await designs.getById(context.env, input.id);
        await assertCodeAllowed(context, input.spaceId, row.kind, row.draft, null);
        await designs.delete(context.env, input.id);
        return { ok: true };
      }),

    /**
     * Downloads a Google Fonts family's woff2 files into the space's assets and returns the
     * theme's family entry; the caller adds it to the theme draft.
     */
    importGoogleFont: writes('website:write')
      .input(
        spaceScoped.extend({
          family: z.string().trim().regex(GOOGLE_FONT_FAMILY),
          variants: z
            .array(
              z.object({
                weight: z.number().int().min(100).max(900).multipleOf(100),
                style: z.enum(['normal', 'italic']),
              }),
            )
            .min(1)
            .max(GOOGLE_FONT_MAX_VARIANTS),
          fallback: z.string().max(200).optional(),
        }),
      )
      .handler(async ({ input, context }) => {
        const { spaceId, ...font } = input;
        // The files become assets of the space.
        assertCan(context.principal, spaceId, 'asset:write');
        return importGoogleFont(font, {
          store: ({ filename, body }) =>
            context.media.upload({
              spaceId,
              filename,
              mimeType: 'font/woff2',
              body,
              actorId: context.principal?.userId ?? null,
            }),
        });
      }),

    /**
     * The space's designs as a theme bundle, `published` (default) or `draft`. Custom CSS, head
     * and body code are left out unless the caller holds `website:code`.
     */
    exportTheme: scoped('website:read')
      .input(spaceScoped.extend({ variant: z.enum(['published', 'draft']).optional() }))
      .handler(async ({ input, context }) =>
        context.plugin.services.themes.exportBundle(context.env, {
          variant: input.variant,
          includeCode: can(context.principal, input.spaceId, 'website:code'),
        }),
      ),

    /** What importing a bundle would create, replace and skip; writes nothing. */
    previewThemeImport: scoped('website:write')
      .input(themeImport)
      .handler(async ({ input, context }) =>
        context.plugin.services.themes.previewImport(context.env, input.bundle, {
          replace: input.replace,
          skip: input.skip,
          allowCode: can(context.principal, input.spaceId, 'website:code'),
        }),
      ),

    /** Writes a bundle's designs as drafts. Code fields need `website:code`, else they are kept. */
    importTheme: writes('website:write')
      .input(themeImport)
      .handler(async ({ input, context }) =>
        context.plugin.services.themes.importBundle(
          context.env,
          input.bundle,
          {
            replace: input.replace,
            skip: input.skip,
            allowCode: can(context.principal, input.spaceId, 'website:code'),
          },
          context.principal?.userId ?? null,
        ),
      ),

    /** The starter gallery: built-in themes and code themes targeting the space. */
    starterThemes: scoped('website:read')
      .input(spaceScoped)
      .handler(async ({ context }) => context.plugin.services.themes.starterThemes(context.env)),

    /**
     * Writes a starter theme as drafts; `replace` (default off) overwrites stored designs.
     * `preset` adds a design preset's layout, menus and block and page designs.
     */
    applyStarter: writes('website:write')
      .input(
        spaceScoped.extend({
          id: z.string().min(1).max(200),
          replace: z.boolean().optional(),
          preset: z.string().min(1).max(100).optional(),
        }),
      )
      .handler(async ({ input, context }) =>
        context.plugin.services.themes.applyStarter(
          context.env,
          input.id,
          {
            replace: input.replace,
            allowCode: can(context.principal, input.spaceId, 'website:code'),
            preset: input.preset,
          },
          context.principal?.userId ?? null,
        ),
      ),

    /** Theme tokens from a brand color or a description, built on the current theme; not saved. */
    aiTheme: writes('website:write')
      .input(
        aiDesign.extend({
          brandColor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
        }),
      )
      .handler(async ({ input, context }) => {
        const designer = await aiDesigner(context, input.spaceId, 'plugins.website.design.aiTheme');
        const { spaceId, environment: _environment, ...request } = input;
        const current = await context.plugin.services.designs.get(context.env, 'theme', 'default');
        return designSiteTheme(designer, {
          ...request,
          spaceId,
          base: current.data as AiSiteThemeInput['base'],
          actorId: context.principal?.userId ?? null,
        });
      }),

    /** A design for a block type, starting from its current one; not saved. */
    aiBlockDesign: writes('website:write')
      .input(aiDesign.extend({ typeId: uuid }))
      .handler(async ({ input, context }) => {
        const designer = await aiDesigner(
          context,
          input.spaceId,
          'plugins.website.design.aiBlockDesign',
        );
        const { spaceId, environment: _environment, typeId, ...request } = input;
        const type = context.manablox.contentTypes.tryGet(typeId);
        if (
          type?.kind !== 'block' ||
          type.isSystem ||
          (type.spaceId !== null && !context.manablox.contentTypes.inScope(type, context.env))
        ) {
          throw ManabloxError.notFound('contentType.notFound', { id: typeId });
        }
        const { designs } = context.plugin.services;
        const [theme, current, space] = await Promise.all([
          designs.get(context.env, 'theme', 'default'),
          designs.get(context.env, 'block', typeId),
          context.spaces.get(spaceId),
        ]);
        return designSiteBlock(designer, {
          ...request,
          spaceId,
          type,
          theme: theme.data as AiSiteBlockInput['theme'],
          current: current.data as AiSiteBlockInput['current'],
          locales: space
            ? [space.defaultLocale, ...space.locales.filter((l) => l !== space.defaultLocale)]
            : ['en'],
          actorId: context.principal?.userId ?? null,
        });
      }),

    /**
     * A signed, time-limited token for a draft preview of the site, or of one document. Needs
     * `website:read`, or reading the document (every type without one).
     */
    createShareLink: scoped('space:read')
      .input(
        spaceScoped.extend({
          contentId: uuid.nullable().optional(),
          expiresInSeconds: z.number().int().min(60).max(SHARE_LINK_MAX_SECONDS).optional(),
        }),
      )
      .handler(async ({ input, context }) => {
        const { spaceId, contentId } = input;
        if (!can(context.principal, spaceId, 'website:read')) {
          const row = contentId ? await context.content.stored(context.env, contentId) : null;
          if (contentId && row) assertOnType(context, spaceId, 'content:read', row.typeId);
          // A link for the whole site shows drafts of every type.
          else if (contentId || allowedTypeIdsIn(context, spaceId, 'content:read') !== null)
            assertCan(context.principal, spaceId, 'website:read');
        }
        return context.plugin.services.designs.createShareLink(context.env, {
          contentId,
          expiresInSeconds: input.expiresInSeconds,
        });
      }),
  };
};
